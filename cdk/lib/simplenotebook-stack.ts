import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaAuthorizer, HttpLambdaResponseType } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
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
      // API Gateway のログ用ロールはアカウントで 1 つの設定(AWS::ApiGateway::Account)なので、本番スタックだけが持つ。
      // 開発用スタックを作って消したときに、本番の設定を上書き・削除しないようにする
      cloudWatchRole: environment === 'prod',
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
    // OAuth のトークン系列(GSI2PK = FAMILY#<familyId>)。失効やリフレッシュトークンの再利用検知で系列ごとまとめて引く
    authTable.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'GSI2PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI2SK', type: dynamodb.AttributeType.STRING },
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
      // OAuth の接続を失効させるとき、系列のレコードを順に更新するため既定(3 秒)より余裕を持たせる
      timeout: cdk.Duration.seconds(10),
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
      // GSI1: 自分のトークン一覧 / GSI2: OAuth の接続を失効させるときに系列のトークンを引く
      resources: [`${authTable.tableArn}/index/GSI1`, `${authTable.tableArn}/index/GSI2`],
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

    // ---- リモート MCP(B-19) ----
    // OAuth のディスカバリー(B-20)はホスト直下の /.well-known を探すため、URL にステージ名が入らない
    // HTTP API($default ステージ)を別に作る。オーソライザーは REST API と同じ関数を共有する
    const mcpFunction = new lambda.Function(this, 'McpFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      // notesService を共有するため、Notes Lambda と同じアセットのハンドラーを使う
      handler: 'mcp.handler',
      code: lambda.Code.fromAsset('lambda'),
      memorySize: 512,
      // HTTP API の統合タイムアウト(30 秒)より短くする
      timeout: cdk.Duration.seconds(29),
      environment: {
        NOTES_BUCKET: notesBucket.bucketName,
        NOTES_PREFIX: `${environment}/`,
      },
    });
    notesBucket.grantReadWrite(mcpFunction);

    // カスタムドメインは context で受け取る(ドメイン名とゾーン ID はリポジトリに書かない)。
    // 3 つとも指定されたときだけ作り、未指定なら HTTP API の既定 URL で動かす
    const mcpDomainName = this.node.tryGetContext('mcpDomainName') as string | undefined;
    const hostedZoneId = this.node.tryGetContext('hostedZoneId') as string | undefined;
    const hostedZoneName = this.node.tryGetContext('hostedZoneName') as string | undefined;
    let mcpDomain: apigwv2.DomainName | undefined;
    if (mcpDomainName && hostedZoneId && hostedZoneName) {
      // ホストゾーンは CDK の管理外。fromLookup は使わない(synth 時に Route 53 の参照権限を要求しないため)
      const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
        hostedZoneId,
        zoneName: hostedZoneName,
      });
      const certificate = new acm.Certificate(this, 'McpCertificate', {
        domainName: mcpDomainName,
        validation: acm.CertificateValidation.fromDns(hostedZone),
      });
      mcpDomain = new apigwv2.DomainName(this, 'McpDomainName', {
        domainName: mcpDomainName,
        certificate,
      });
      new route53.ARecord(this, 'McpAliasRecord', {
        zone: hostedZone,
        recordName: mcpDomainName,
        target: route53.RecordTarget.fromAlias(
          new route53Targets.ApiGatewayv2DomainProperties(mcpDomain.regionalDomainName, mcpDomain.regionalHostedZoneId)
        ),
      });
    }

    const mcpApi = new apigwv2.HttpApi(this, 'McpApi', {
      apiName: `simplenotebook-mcp-${environment}`,
      description: 'Remote MCP endpoint for Simplenotebook',
      // スロットリングを付けるため、既定ステージは下で自前で作る
      createDefaultStage: false,
      // /mcp はブラウザからのアクセスを想定しないため CORS は付けない
    });
    const mcpStage = new apigwv2.HttpStage(this, 'McpDefaultStage', {
      httpApi: mcpApi,
      stageName: '$default',
      autoDeploy: true,
      throttle: { rateLimit: 10, burstLimit: 20 },
      domainMapping: mcpDomain ? { domainName: mcpDomain } : undefined,
    });

    // REST API と同じ REQUEST 型(ペイロード 1.0・IAM ポリシー応答)で、同じオーソライザー関数を使う
    const mcpAuthorizer = new HttpLambdaAuthorizer('McpAuthorizer', authorizerFunction, {
      responseTypes: [HttpLambdaResponseType.IAM],
      identitySource: ['$request.header.Authorization'],
      resultsCacheTtl: cdk.Duration.seconds(60),
    });
    // GET / DELETE も認証した上で、MCP Lambda が 405 を返す(ステートレスのため SSE とセッションは提供しない)
    mcpApi.addRoutes({
      path: '/mcp',
      methods: [apigwv2.HttpMethod.POST, apigwv2.HttpMethod.GET, apigwv2.HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('McpIntegration', mcpFunction),
      authorizer: mcpAuthorizer,
    });

    // issuer(認可サーバー)は MCP と同じホスト。OAuth のディスカバリーがホスト直下の /.well-known を探すため
    const mcpOrigin = mcpDomain ? `https://${mcpDomainName}` : mcpApi.apiEndpoint;
    const mcpUrl = `${mcpOrigin}/mcp`;

    // ---- OAuth ファサード(B-20): Claude.ai / Desktop のコネクタ向け ----
    // ユーザー認証は既存の Google + Cognito に任せ、同意を得て snb_ トークンを発行する
    const oauthFunction = new lambda.Function(this, 'OAuthFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('oauth'),
      // リフレッシュトークンの再利用検知で系列を失効させるとき、レコードを順に更新するため既定(3 秒)より余裕を持たせる
      timeout: cdk.Duration.seconds(10),
      environment: {
        AUTH_TABLE_NAME: authTable.tableName,
        ENVIRONMENT: environment,
        ISSUER: mcpOrigin,
        MCP_URL: mcpUrl,
        // 同意画面は GitHub Pages の静的ページ(Cognito のコールバック URL と同じサイト)
        CONSENT_URL: 'https://ougotti.github.io/simplenotebook/oauth/consent',
        ALLOWED_ORIGINS: 'https://ougotti.github.io,http://localhost:3000',
      },
    });
    // 設計書 3.7 節の最小権限: Get/Put/Update/Delete と GSI2 の Query(S3 には権限なし)
    oauthFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem', 'dynamodb:DeleteItem'],
      resources: [authTable.tableArn],
    }));
    oauthFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['dynamodb:Query'],
      resources: [`${authTable.tableArn}/index/GSI2`],
    }));

    const oauthIntegration = new HttpLambdaIntegration('OAuthIntegration', oauthFunction);
    // メタデータ・DCR・authorize・token は認証なし(OAuth の仕様上、トークンを持たない状態で呼ばれる)
    for (const [method, path] of [
      [apigwv2.HttpMethod.GET, '/.well-known/oauth-protected-resource'],
      // RFC 9728 のパス付きの場所(リソースが /mcp のため)
      [apigwv2.HttpMethod.GET, '/.well-known/oauth-protected-resource/mcp'],
      [apigwv2.HttpMethod.GET, '/.well-known/oauth-authorization-server'],
      [apigwv2.HttpMethod.POST, '/oauth/register'],
      [apigwv2.HttpMethod.GET, '/oauth/authorize'],
      [apigwv2.HttpMethod.POST, '/oauth/token'],
      // 同意画面(ブラウザ)から呼ぶ 2 つのエンドポイントのプリフライト
      [apigwv2.HttpMethod.OPTIONS, '/oauth/approve'],
      [apigwv2.HttpMethod.OPTIONS, '/oauth/requests/{requestId}'],
    ] as const) {
      const routes = mcpApi.addRoutes({ path, methods: [method], integration: oauthIntegration });
      if (method === apigwv2.HttpMethod.POST && path === '/oauth/register') {
        // 認証なしで呼べる DCR は、登録を大量に作られないよう個別にさらに絞る。
        // RouteSettings は存在するルートにしか設定できないため、ステージがこのルートに依存するようにして
        // ルートの作成後に適用させる(依存がないと先に適用されてデプロイが失敗する。#113)
        (mcpStage.node.defaultChild as apigwv2.CfnStage).addPropertyOverride('RouteSettings', {
          'POST /oauth/register': { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 },
        });
        mcpStage.node.addDependency(...routes);
      }
    }
    // 同意画面からの呼び出しはログイン済みのユーザー(Cognito の ID トークン)に限る。判定は OAuth Lambda で行う
    mcpApi.addRoutes({
      path: '/oauth/approve',
      methods: [apigwv2.HttpMethod.POST],
      integration: oauthIntegration,
      authorizer: mcpAuthorizer,
    });
    mcpApi.addRoutes({
      path: '/oauth/requests/{requestId}',
      methods: [apigwv2.HttpMethod.GET],
      integration: oauthIntegration,
      authorizer: mcpAuthorizer,
    });

    // IAM Role for GitHub Actions OIDC
    // ロール名が固定(アカウントに 1 つ)なので本番スタックでだけ作る。開発用スタックと名前が衝突しないようにする。
    // 実際の権限は docs/iam/ で管理している(このテンプレートのポリシーとは差分がある)
    const githubOidcRole = environment !== 'prod' ? undefined : new iam.Role(this, 'GitHubActionsCdkDeployRole', {
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
    new cdk.CfnOutput(this, 'McpUrl', {
      value: mcpUrl,
      description: 'Remote MCP endpoint URL',
      exportName: `${id}-McpUrl`,
    });

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

    if (githubOidcRole) {
      new cdk.CfnOutput(this, 'GitHubOidcRoleArn', {
        value: githubOidcRole.roleArn,
        description: 'GitHub Actions OIDC Role ARN',
        exportName: `${id}-GitHubOidcRoleArn`,
      });
    }
  }
}