import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SimplenotebookStack } from '../lib/simplenotebook-stack';

function synth(environment: string, context: Record<string, string> = {}): Template {
  const app = new cdk.App({ context });
  const stack = new SimplenotebookStack(app, `TestStack-${environment}`, {
    environment,
    env: { account: '123456789012', region: 'ap-northeast-1' },
  });
  return Template.fromStack(stack);
}

/** 指定した環境変数を持つ Lambda 関数のロールに付いたポリシー文を返す */
function policyStatementsOf(template: Template, functionEnvKey: string, functionEnvValue?: string) {
  const functions = template.findResources('AWS::Lambda::Function', {
    Properties: {
      Environment: { Variables: Match.objectLike({ [functionEnvKey]: functionEnvValue ?? Match.anyValue() }) },
    },
  });
  const roleIds = Object.values(functions).map((fn) => fn.Properties.Role['Fn::GetAtt'][0]);
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies)
    .filter((policy) => policy.Properties.Roles.some((role: { Ref: string }) => roleIds.includes(role.Ref)))
    .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
}

describe('認証用テーブル', () => {
  // synth はアセットの読み込みなどで時間がかかるため、環境ごとに 1 回だけ行う
  let prod: Template;
  let dev: Template;
  beforeAll(() => {
    prod = synth('prod');
    dev = synth('dev');
  }, 120_000);

  it('prod は PITR 有効・RETAIN、TTL と GSI1 を持つ', () => {
    prod.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Retain',
      Properties: Match.objectLike({
        TableName: 'simplenotebook-auth-prod',
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        TimeToLiveSpecification: { AttributeName: 'ttl', Enabled: true },
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        GlobalSecondaryIndexes: Match.arrayWith([
          Match.objectLike({
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
          }),
        ]),
      }),
    });
  });

  it('prod 以外は PITR なし・削除可能', () => {
    dev.hasResource('AWS::DynamoDB::Table', {
      DeletionPolicy: 'Delete',
      Properties: Match.objectLike({
        TableName: 'simplenotebook-auth-dev',
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: false },
      }),
    });
  });

  it('オーソライザーは GetItem と lastUsedAt だけの UpdateItem のみ(S3 には権限なし)', () => {
    const statements = policyStatementsOf(prod, 'USER_POOL_ID');
    const actions = statements.flatMap((s: { Action: string | string[] }) => [s.Action].flat());
    expect(actions.sort()).toEqual(['dynamodb:GetItem', 'dynamodb:UpdateItem']);

    const update = statements.find((s: { Action: string }) => s.Action === 'dynamodb:UpdateItem');
    expect(update.Condition).toEqual({
      'ForAllValues:StringEquals': { 'dynamodb:Attributes': ['PK', 'SK', 'lastUsedAt'] },
      StringEqualsIfExists: { 'dynamodb:ReturnValues': 'NONE' },
    });
  });

  it('トークン管理 Lambda は Get/Put/Update と GSI1 の Query のみ(Delete・Scan・S3 はなし)', () => {
    // Notes Lambda も AUTH_TABLE_NAME を持たないので、ENVIRONMENT を持ち USER_POOL_ID を持たない関数で特定する
    const functions = prod.findResources('AWS::Lambda::Function');
    const tokensFnEntry = Object.entries(functions).find(
      ([, fn]) => fn.Properties.Environment?.Variables?.AUTH_TABLE_NAME && !fn.Properties.Environment.Variables.USER_POOL_ID
    );
    expect(tokensFnEntry).toBeDefined();
    const roleId = tokensFnEntry![1].Properties.Role['Fn::GetAtt'][0];
    const statements = Object.values(prod.findResources('AWS::IAM::Policy'))
      .filter((policy) => policy.Properties.Roles.some((role: { Ref: string }) => role.Ref === roleId))
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const actions = statements.flatMap((s: { Action: string | string[] }) => [s.Action].flat());

    expect(actions.sort()).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem']);
    const query = statements.find((s: { Action: string }) => s.Action === 'dynamodb:Query');
    expect(JSON.stringify(query.Resource)).toContain('/index/GSI1');
  });

  it('Notes Lambda には認証テーブルの権限を与えない', () => {
    const statements = policyStatementsOf(prod, 'NOTES_BUCKET');
    const actions = statements.flatMap((s: { Action: string | string[] }) => [s.Action].flat());
    expect(actions.some((action: string) => action.startsWith('dynamodb:'))).toBe(false);
  });

  it('トークン管理 API のルートにオーソライザーが付いている', () => {
    const resources = prod.findResources('AWS::ApiGateway::Resource');
    const pathParts = Object.values(resources).map((r) => r.Properties.PathPart);
    expect(pathParts).toEqual(expect.arrayContaining(['tokens', 'self', '{tokenId}']));

    const methods = Object.values(prod.findResources('AWS::ApiGateway::Method')).filter(
      (m) => m.Properties.HttpMethod !== 'OPTIONS'
    );
    // 認可なしで公開されているメソッドがないこと
    expect(methods.every((m) => m.Properties.AuthorizationType === 'CUSTOM')).toBe(true);
    // notes 5 + append 1 + tags 1 + settings 2 + tokens 4
    expect(methods).toHaveLength(13);
  });
});

describe('リモート MCP(HTTP API)', () => {
  let template: Template;
  let withDomain: Template;
  beforeAll(() => {
    template = synth('prod');
    withDomain = synth('prod', {
      mcpDomainName: 'mcp.notes.example.test',
      hostedZoneId: 'Z0000000000TEST',
      hostedZoneName: 'notes.example.test',
    });
  }, 120_000);

  it('$default ステージにスロットリングを付け、自動デプロイする', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      StageName: '$default',
      AutoDeploy: true,
      DefaultRouteSettings: Match.objectLike({ ThrottlingRateLimit: 10, ThrottlingBurstLimit: 20 }),
    });
  });

  it('/mcp の POST・GET・DELETE だけがあり、すべてオーソライザー付き', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route'))
      .map((r) => r.Properties)
      .filter((r) => r.RouteKey.endsWith(' /mcp'));
    expect(routes.map((r) => r.RouteKey).sort()).toEqual(['DELETE /mcp', 'GET /mcp', 'POST /mcp']);
    expect(routes.every((r) => r.AuthorizationType === 'CUSTOM' && r.AuthorizerId)).toBe(true);
  });

  it('オーソライザーは REST API と同じ関数・同じ形式(ペイロード 1.0、IAM ポリシー応答、キャッシュ 60 秒)', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Authorizer', {
      AuthorizerType: 'REQUEST',
      AuthorizerPayloadFormatVersion: '1.0',
      AuthorizerResultTtlInSeconds: 60,
      IdentitySource: ['$request.header.Authorization'],
    });
    const authorizer = Object.values(template.findResources('AWS::ApiGatewayV2::Authorizer'))[0];
    expect(authorizer.Properties.EnableSimpleResponses).not.toBe(true);
    // REST API のオーソライザーと同じ Lambda 関数を指している
    const functions = template.findResources('AWS::Lambda::Function', {
      Properties: { Environment: { Variables: Match.objectLike({ USER_POOL_ID: Match.anyValue() }) } },
    });
    expect(Object.keys(functions)).toHaveLength(1);
    expect(JSON.stringify(authorizer.Properties.AuthorizerUri)).toContain(Object.keys(functions)[0]);
  });

  it('MCP Lambda は notesService と同じアセットの mcp.handler で、認証テーブルの権限を持たない', () => {
    const functions = template.findResources('AWS::Lambda::Function', { Properties: { Handler: 'mcp.handler' } });
    expect(Object.keys(functions)).toHaveLength(1);
    const [id, fn] = Object.entries(functions)[0];
    expect(fn.Properties.Timeout).toBe(29);
    const roleId = fn.Properties.Role['Fn::GetAtt'][0];
    const actions = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) => policy.Properties.Roles.some((role: { Ref: string }) => role.Ref === roleId))
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement)
      .flatMap((s: { Action: string | string[] }) => [s.Action].flat());
    expect(actions.some((action: string) => action.startsWith('dynamodb:'))).toBe(false);
    expect(actions.some((action: string) => action.startsWith('s3:'))).toBe(true);
    expect(id).toBeDefined();
  });

  it('context がなければカスタムドメインを作らず、既定 URL を出力する', () => {
    template.resourceCountIs('AWS::CertificateManager::Certificate', 0);
    template.resourceCountIs('AWS::ApiGatewayV2::DomainName', 0);
    template.resourceCountIs('AWS::Route53::RecordSet', 0);
    const output = template.findOutputs('McpUrl').McpUrl;
    expect(JSON.stringify(output.Value)).toContain('/mcp');
  });

  it('context があれば証明書・ドメイン・マッピング・ALIAS レコードを作り、その URL を出力する', () => {
    withDomain.hasResourceProperties('AWS::CertificateManager::Certificate', {
      DomainName: 'mcp.notes.example.test',
      ValidationMethod: 'DNS',
    });
    withDomain.hasResourceProperties('AWS::ApiGatewayV2::DomainName', { DomainName: 'mcp.notes.example.test' });
    withDomain.resourceCountIs('AWS::ApiGatewayV2::ApiMapping', 1);
    withDomain.hasResourceProperties('AWS::Route53::RecordSet', {
      Name: 'mcp.notes.example.test.',
      Type: 'A',
      HostedZoneId: 'Z0000000000TEST',
    });
    expect(withDomain.findOutputs('McpUrl').McpUrl.Value).toBe('https://mcp.notes.example.test/mcp');
  });
});

describe('OAuth ファサード(B-20)', () => {
  let template: Template;
  beforeAll(() => {
    template = synth('prod');
  }, 120_000);

  it('認証テーブルに GSI2(FAMILY#)を追加する', () => {
    const table = Object.values(template.findResources('AWS::DynamoDB::Table'))[0];
    expect(table.Properties.GlobalSecondaryIndexes.map((index: { IndexName: string }) => index.IndexName)).toEqual(['GSI1', 'GSI2']);
  });

  it('メタデータ・DCR・authorize・token は認証なし、同意画面の API は認証あり', () => {
    const routes = Object.values(template.findResources('AWS::ApiGatewayV2::Route')).map((r) => r.Properties);
    const auth = Object.fromEntries(routes.map((r) => [r.RouteKey, r.AuthorizationType ?? 'NONE']));
    expect(auth).toMatchObject({
      'GET /.well-known/oauth-protected-resource': 'NONE',
      'GET /.well-known/oauth-protected-resource/mcp': 'NONE',
      'GET /.well-known/oauth-authorization-server': 'NONE',
      'POST /oauth/register': 'NONE',
      'GET /oauth/authorize': 'NONE',
      'POST /oauth/token': 'NONE',
      'OPTIONS /oauth/approve': 'NONE',
      'OPTIONS /oauth/requests/{requestId}': 'NONE',
      'POST /oauth/approve': 'CUSTOM',
      'GET /oauth/requests/{requestId}': 'CUSTOM',
      'POST /mcp': 'CUSTOM',
    });
  });

  it('DCR は個別にさらに絞る', () => {
    template.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      RouteSettings: { 'POST /oauth/register': { ThrottlingRateLimit: 1, ThrottlingBurstLimit: 5 } },
    });
  });

  it('OAuth Lambda は Get/Put/Update/Delete と GSI2 の Query のみ(S3 なし)', () => {
    const functions = template.findResources('AWS::Lambda::Function', {
      Properties: { Environment: { Variables: Match.objectLike({ CONSENT_URL: Match.anyValue() }) } },
    });
    expect(Object.keys(functions)).toHaveLength(1);
    const roleId = Object.values(functions)[0].Properties.Role['Fn::GetAtt'][0];
    const statements = Object.values(template.findResources('AWS::IAM::Policy'))
      .filter((policy) => policy.Properties.Roles.some((role: { Ref: string }) => role.Ref === roleId))
      .flatMap((policy) => policy.Properties.PolicyDocument.Statement);
    const actions = statements.flatMap((s: { Action: string | string[] }) => [s.Action].flat()).sort();
    expect(actions).toEqual(['dynamodb:DeleteItem', 'dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:Query', 'dynamodb:UpdateItem']);
    const query = statements.find((s: { Action: string }) => s.Action === 'dynamodb:Query');
    expect(JSON.stringify(query.Resource)).toContain('/index/GSI2');
    expect(JSON.stringify(query.Resource)).not.toContain('/index/GSI1');
  });
});

describe('ステージとルートの依存(#113)', () => {
  it('RouteSettings で参照する POST /oauth/register のルートを作ってからステージを更新する', () => {
    const template = synth('prod');
    const routes = template.findResources('AWS::ApiGatewayV2::Route', { Properties: { RouteKey: 'POST /oauth/register' } });
    const [routeId] = Object.keys(routes);
    expect(routeId).toBeDefined();
    const stage = Object.values(template.findResources('AWS::ApiGatewayV2::Stage'))[0];
    expect(Object.keys(stage.Properties.RouteSettings)).toEqual(['POST /oauth/register']);
    expect(stage.DependsOn).toEqual(expect.arrayContaining([routeId]));
  }, 120_000);
});
