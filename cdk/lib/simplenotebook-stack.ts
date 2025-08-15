import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
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
          allowedOrigins: ['https://ougotti.github.io'],
          allowedHeaders: ['*'],
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
        callbackUrls: ['https://ougotti.github.io/simplenotebook/callback'],
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
      runtime: lambda.Runtime.NODEJS_18_X,
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
        allowOrigins: ['https://ougotti.github.io'],
        allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
      },
    });

    // Cognito Authorizer
    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'Authorizer', {
      cognitoUserPools: [userPool],
    });

    // API Resources
    const notesResource = api.root.addResource('notes');
    const noteResource = notesResource.addResource('{noteId}');

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(notesFunction);

    // API Methods
    notesResource.addMethod('GET', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    notesResource.addMethod('POST', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    noteResource.addMethod('GET', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    noteResource.addMethod('PUT', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    noteResource.addMethod('DELETE', lambdaIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

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