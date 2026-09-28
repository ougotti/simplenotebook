import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { SimplenotebookStack } from '../lib/simplenotebook-stack';

function synth(environment: string): Template {
  const app = new cdk.App();
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
        GlobalSecondaryIndexes: [
          Match.objectLike({
            IndexName: 'GSI1',
            KeySchema: [
              { AttributeName: 'GSI1PK', KeyType: 'HASH' },
              { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
            ],
          }),
        ],
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
