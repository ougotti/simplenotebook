import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface SimplenotebookStackProps extends cdk.StackProps {
  environment: string;
}

export class SimplenotebookStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: SimplenotebookStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // Secrets Manager for Google OAuth credentials
    const googleOAuthSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'GoogleOAuthSecret',
      'google/oauth'
    );

    // S3 Bucket for notes storage
    const notesBucket = new s3.Bucket(this, 'NotesBucket', {
      bucketName: `simplenotebook-notes-${environment}-${this.account}`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.DELETE],
          allowedOrigins: ['https://ougotti.github.io', 'http://localhost:3000'],
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag'],
          maxAge: 300,
        },
      ],
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Cognito User Pool
    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `simplenotebook-users-${environment}`,
      selfSignUpEnabled: true,
      signInAliases: {
        email: true,
      },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });

    // Google Identity Provider
    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool,
      clientId: googleOAuthSecret.secretValueFromJson('client_id').unsafeUnwrap(),
      clientSecretValue: googleOAuthSecret.secretValueFromJson('client_secret'),
      scopes: ['openid', 'email', 'profile'],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
        givenName: cognito.ProviderAttribute.GOOGLE_GIVEN_NAME,
        familyName: cognito.ProviderAttribute.GOOGLE_FAMILY_NAME,
      },
    });

    // User Pool Client
    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: `simplenotebook-client-${environment}`,
      generateSecret: false,
      authFlows: {
        userSrp: true,
        adminUserPassword: false,
        custom: false,
        userPassword: false,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE, cognito.OAuthScope.OPENID],
        callbackUrls: ['https://ougotti.github.io/simplenotebook/notes/new'],
        logoutUrls: ['https://ougotti.github.io/simplenotebook/'],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
      ],
    });

    // Ensure Google provider is created before the client
    userPoolClient.node.addDependency(googleProvider);

    // Cognito User Pool Domain
    const userPoolDomain = new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool,
      cognitoDomain: {
        domainPrefix: `simplenotebook-${environment}-${this.account}`,
      },
    });

    // Identity Pool
    const identityPool = new cognito.CfnIdentityPool(this, 'IdentityPool', {
      identityPoolName: `simplenotebook_identity_${environment}`,
      allowUnauthenticatedIdentities: false,
      cognitoIdentityProviders: [
        {
          clientId: userPoolClient.userPoolClientId,
          providerName: userPool.userPoolProviderName,
        },
      ],
    });

    // IAM roles for authenticated users
    const authenticatedRole = new iam.Role(this, 'AuthenticatedRole', {
      assumedBy: new iam.FederatedPrincipal(
        'cognito-identity.amazonaws.com',
        {
          StringEquals: {
            'cognito-identity.amazonaws.com:aud': identityPool.ref,
          },
          'ForAnyValue:StringLike': {
            'cognito-identity.amazonaws.com:amr': 'authenticated',
          },
        },
        'sts:AssumeRoleWithWebIdentity'
      ),
      inlinePolicies: {
        S3Access: new iam.PolicyDocument({
          statements: [
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['s3:GetObject', 's3:PutObject', 's3:DeleteObject'],
              resources: [`${notesBucket.bucketArn}/\${cognito-identity.amazonaws.com:sub}/*`],
            }),
          ],
        }),
      },
    });

    // Attach roles to identity pool
    new cognito.CfnIdentityPoolRoleAttachment(this, 'IdentityPoolRoleAttachment', {
      identityPoolId: identityPool.ref,
      roles: {
        authenticated: authenticatedRole.roleArn,
      },
    });

    // Lambda function for notes API
    const notesFunction = new lambda.Function(this, 'NotesFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('lambda'),
      environment: {
        NOTES_BUCKET: notesBucket.bucketName,
        NOTES_PREFIX: `${environment}/`,
      },
    });

    // Grant Lambda permissions to access S3
    notesBucket.grantReadWrite(notesFunction);

    // API Gateway
    const api = new apigateway.RestApi(this, 'NotesApi', {
      restApiName: `simplenotebook-api-${environment}`,
      description: 'API for Simplenotebook app',
      defaultCorsPreflightOptions: {
        allowOrigins: ['https://ougotti.github.io', 'http://localhost:3000'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'If-Match'],
        allowCredentials: true,
      },
    });

    // 認証用テーブル(アクセストークン。将来 OAuth の状態も置く)。ノート本体は S3 のまま
    const authTable = new dynamodb.Table(this, 'AuthTable', {
      tableName: `simplenotebook-auth-${environment}`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: environment === 'prod' },
      removalPolicy: environment === 'prod' ? cdk.RemovalPolicy.RETAIN : cdk.RemovalPolicy.DESTROY,
    });
    // ユーザーごとのトークン一覧(GSI1PK = USER#<sub>, GSI1SK = TOKEN#<createdAt>)
    authTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    // Lambda オーソライザー(Cognito ID トークンと PAT を検証する)
    const authorizerFunction = new lambda.Function(this, 'AuthorizerFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('authorizer'),
      environment: {
        USER_POOL_ID: userPool.userPoolId,
        USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
        AUTH_TABLE_NAME: authTable.tableName,
        ENVIRONMENT: environment,
      },
    });

    // オーソライザーは最小権限: トークンの読み取りと、lastUsedAt だけの更新(ノートの S3 には権限なし)
    authorizerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem'],
      resources: [authTable.tableArn],
    }));
    authorizerFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:UpdateItem'],
      resources: [authTable.tableArn],
      conditions: {
        'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['PK', 'SK', 'lastUsedAt'] },
        StringEqualsIfExists: { 'dynamodb:ReturnValues': 'NONE' },
      },
    }));

    // トークン管理 API(発行・一覧・失効)
    const tokensFunction = new lambda.Function(this, 'TokensFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('tokens'),
      environment: {
        AUTH_TABLE_NAME: authTable.tableName,
        ENVIRONMENT: environment,
      },
    });
    tokensFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
      resources: [authTable.tableArn],
    }));
    tokensFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${authTable.tableArn}/index/GSI1`],
    }));

    const authorizer = new apigateway.RequestAuthorizer(this, 'RequestAuthorizer', {
      handler: authorizerFunction,
      identitySources: [apigateway.IdentitySource.header('Authorization')],
      // 失効の反映遅延を抑えるため、既定(300 秒)より短くする
      resultsCacheTtl: cdk.Duration.seconds(60),
    });

    // authorizer を渡すと認可タイプは CUSTOM になる
    const authorizedMethodOptions: apigateway.MethodOptions = { authorizer };

    // API Resources
    const notesResource = api.root.addResource('notes');
    const noteResource = notesResource.addResource('{noteId}');
    
    // Users API Resources
    const usersResource = api.root.addResource('users');
    const meResource = usersResource.addResource('me');
    const settingsResource = meResource.addResource('settings');

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(notesFunction);

    // Notes API Methods
    notesResource.addMethod('GET', lambdaIntegration, authorizedMethodOptions);
    notesResource.addMethod('POST', lambdaIntegration, authorizedMethodOptions);
    noteResource.addMethod('GET', lambdaIntegration, authorizedMethodOptions);
    noteResource.addMethod('PUT', lambdaIntegration, authorizedMethodOptions);
    noteResource.addMethod('DELETE', lambdaIntegration, authorizedMethodOptions);
    noteResource.addResource('append').addMethod('POST', lambdaIntegration, authorizedMethodOptions);
    api.root.addResource('tags').addMethod('GET', lambdaIntegration, authorizedMethodOptions);

    // Settings API Methods
    settingsResource.addMethod('GET', lambdaIntegration, authorizedMethodOptions);
    settingsResource.addMethod('PUT', lambdaIntegration, authorizedMethodOptions);

    // Tokens API(/tokens/self 以外は Cognito のみ。判定は Tokens Lambda で行う)
    const tokensIntegration = new apigateway.LambdaIntegration(tokensFunction);
    const tokensResource = api.root.addResource('tokens');
    tokensResource.addMethod('GET', tokensIntegration, authorizedMethodOptions);
    tokensResource.addMethod('POST', tokensIntegration, authorizedMethodOptions);
    tokensResource.addResource('self').addMethod('GET', tokensIntegration, authorizedMethodOptions);
    tokensResource.addResource('{tokenId}').addMethod('DELETE', tokensIntegration, authorizedMethodOptions);

    // IAM Role for GitHub Actions OIDC
    const githubOidcRole = new iam.Role(this, 'GitHubActionsCdkDeployRole', {
      roleName: 'GitHubActionsCdkDeployRole',
      assumedBy: new iam.WebIdentityPrincipal(
        'arn:aws:iam::' + this.account + ':oidc-provider/token.actions.githubusercontent.com',
        {
          StringEquals: {
            'token.actions.githubusercontent.com:aud': 'sts.amazonaws.com',
          },
          StringLike: {
            'token.actions.githubusercontent.com:sub': 'repo:ougotti/simplenotebook:*',
          },
        }
      ),
      inlinePolicies: {
        CDKDeployPolicy: new iam.PolicyDocument({
          statements: [
            // CloudFormation permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                'cloudformation:CreateStack',
                'cloudformation:UpdateStack',
                'cloudformation:DeleteStack',
                'cloudformation:DescribeStacks',
                'cloudformation:DescribeStackEvents',
                'cloudformation:DescribeStackResources',
                'cloudformation:GetTemplate',
                'cloudformation:ValidateTemplate',
                'cloudformation:CreateChangeSet',
                'cloudformation:DescribeChangeSet',
                'cloudformation:ExecuteChangeSet',
                'cloudformation:DeleteChangeSet',
                'cloudformation:ListStacks',
                'cloudformation:ListStackResources',
              ],
              resources: ['*'],
            }),
            // AWS service permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: [
                's3:*',
                'lambda:*',
                'apigateway:*',
                'cognito-idp:*',
                'cognito-identity:*',
                'iam:*',
                'logs:*',
              ],
              resources: ['*'],
            }),
            // Secrets Manager permissions
            new iam.PolicyStatement({
              effect: iam.Effect.ALLOW,
              actions: ['secretsmanager:GetSecretValue'],
              resources: [googleOAuthSecret.secretArn],
            }),
          ],
        }),
      },
    });

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
      exportName: `${id}-ApiUrl`,
    });

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
      exportName: `${id}-UserPoolId`,
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
      exportName: `${id}-UserPoolClientId`,
    });

    new cdk.CfnOutput(this, 'IdentityPoolId', {
      value: identityPool.ref,
      description: 'Cognito Identity Pool ID',
      exportName: `${id}-IdentityPoolId`,
    });

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `https://${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI Domain',
      exportName: `${id}-CognitoDomain`,
    });

    new cdk.CfnOutput(this, 'NotesBucketName', {
      value: notesBucket.bucketName,
      description: 'S3 Bucket for notes',
      exportName: `${id}-NotesBucket`,
    });

    new cdk.CfnOutput(this, 'GitHubOidcRoleArn', {
      value: githubOidcRole.roleArn,
      description: 'GitHub Actions OIDC Role ARN',
      exportName: `${id}-GitHubOidcRoleArn`,
    });
  }
}