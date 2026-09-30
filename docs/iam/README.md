# IAM ポリシー（版管理）

このディレクトリには、GitHub Actions から AWS へデプロイするために使っている IAM ロールのポリシー文書を置く。
**AWS 上の実物とこのディレクトリの内容を一致させること。** 変更するときは、ここを直してから適用する。

> このリポジトリは public のため、ARN のアカウントID部分は `__ACCOUNT_ID__` プレースホルダにしてある。
> 適用時に実アカウントIDへ置換する（手順は後述）。

## 対象ロール

| ロール | 用途 | 信頼ポリシー | 権限ポリシー |
| --- | --- | --- | --- |
| `GitHubActionsCdkDeployRole` | `.github/workflows/nextjs.yml` の `deploy-aws` ジョブが `cdk deploy` を実行するために引き受ける | [github-actions-cdk-deploy-role.trust.json](github-actions-cdk-deploy-role.trust.json) | インラインポリシー `CDKDeployPolicy` = [github-actions-cdk-deploy-role.policy.json](github-actions-cdk-deploy-role.policy.json) |
| `cdk-snbook-cfn-exec-role-<アカウント>-ap-northeast-1` | simplenotebook 専用の CDK ブートストラップ(qualifier `snbook`)の CloudFormation 実行ロール。スタックのリソースを作成・更新・削除する | CDK ブートストラップが作成(CloudFormation のみ) | 管理ポリシー `simplenotebook-cfn-exec-policy` = [cdk-snbook-cfn-exec-policy.json](cdk-snbook-cfn-exec-policy.json) |

## 専用の CDK ブートストラップ(B-21)

### なぜ専用にするか

既定のブートストラップ(qualifier `hnb659fds`、スタック `CDKToolkit-hnb659fds`)の実行ロール `cdk-hnb659fds-cfn-exec-role` は
既定の AdministratorAccess のままで、**同じアカウント・リージョンのほかの CDK アプリ(Radiko 系・Zoom 系)と共有**している。
これを絞るとほかのアプリのデプロイを壊すため、simplenotebook 専用のブートストラップ(qualifier `snbook`、スタック `CDKToolkit-snbook`)を作り、
その実行ロールにだけ simplenotebook のリソースに絞った権限を付ける。スタックは `cdk/bin/simplenotebook.ts` で qualifier `snbook` を指定している。

### 実行ロールの権限の考え方

- ノートのバケット・認証テーブル(`simplenotebook-*`)、Lambda 関数・IAM ロール(`SimplenotebookStack*`、`GitHubActionsCdkDeployRole`)に絞る
- IAM ロールへの管理ポリシーのアタッチは、Lambda と API Gateway のログ用の 2 つ(`AWSLambdaBasicExecutionRole`・`AmazonAPIGatewayPushToCloudWatchLogs`)だけ
- API Gateway・Cognito はリソースを作る前に ARN を決められないため、リージョン単位で許可している
- **Route 53 と ACM の権限は付けていない。** MCP のカスタムドメイン(`MCP_DOMAIN_NAME` など)を設定する前に、次の 2 つの Statement を追加する
  (`<MCP のドメイン>` は実際の値に置き換える。ほかのレコードは変更できない)

```json
{
  "Sid": "McpDomainRecordsOnly",
  "Effect": "Allow",
  "Action": ["route53:ChangeResourceRecordSets"],
  "Resource": "arn:aws:route53:::hostedzone/<ホストゾーン ID>",
  "Condition": {
    "ForAllValues:StringLike": {
      "route53:ChangeResourceRecordSetsNormalizedRecordNames": ["<MCP のドメイン>", "_*.<MCP のドメイン>"]
    }
  }
},
{
  "Sid": "McpDomainReadAndCertificate",
  "Effect": "Allow",
  "Action": ["route53:GetHostedZone", "route53:ListResourceRecordSets", "route53:GetChange", "acm:RequestCertificate", "acm:DescribeCertificate", "acm:DeleteCertificate", "acm:AddTagsToCertificate", "acm:ListTagsForCertificate"],
  "Resource": "*"
}
```

### 検証のしかた

本番のスタックを変更する前に、開発用スタックで「作成」「失敗時のロールバック」「削除」が権限不足なく通ることを確かめる。
開発用スタックは CI ロールや API Gateway のアカウント設定を作らない(本番と衝突しないため)。

```bash
cd cdk
ENVIRONMENT=dev STACK_NAME=SimplenotebookStack-dev npx cdk deploy SimplenotebookStack-dev --require-approval never
ENVIRONMENT=dev STACK_NAME=SimplenotebookStack-dev npx cdk destroy SimplenotebookStack-dev --force
```

注意: 開発用スタックは**新規作成**なので、既存スタックを更新するときにだけ起きることは検出できない。
実際、本番スタックの実行ロールを切り替える最初の更新では、CloudFormation が以前のテンプレートのパラメータ
(旧ブートストラップのバージョン `/cdk-bootstrap/hnb659fds/version`)を新しい実行ロールで解決しようとして失敗した(#119)。
そのため実行ロールのポリシーには、このパラメータの読み取りも含めている。

権限が足りないと `cdk-snbook-cfn-exec-role ... is not authorized to perform: <アクション>` で失敗するので、
[cdk-snbook-cfn-exec-policy.json](cdk-snbook-cfn-exec-policy.json) に追加してから、下の手順でポリシーの新しいバージョンを作る。

### 作成・更新手順

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
mkdir -p /tmp/iam-apply
sed "s/__ACCOUNT_ID__/${ACCOUNT_ID}/g" docs/iam/cdk-snbook-cfn-exec-policy.json > /tmp/iam-apply/cfn-exec-policy.json

# 初回: 管理ポリシーを作り、専用ブートストラップを作る
aws iam create-policy --policy-name simplenotebook-cfn-exec-policy --policy-document file:///tmp/iam-apply/cfn-exec-policy.json
(cd cdk && npx cdk bootstrap "aws://${ACCOUNT_ID}/ap-northeast-1" --qualifier snbook --toolkit-stack-name CDKToolkit-snbook \
  --cloudformation-execution-policies "arn:aws:iam::${ACCOUNT_ID}:policy/simplenotebook-cfn-exec-policy")

# 2 回目以降: ポリシーの新しいバージョンを既定にする(バージョンは最大 5 つまで。古いものは delete-policy-version で消す)
aws iam create-policy-version --policy-arn "arn:aws:iam::${ACCOUNT_ID}:policy/simplenotebook-cfn-exec-policy" \
  --policy-document file:///tmp/iam-apply/cfn-exec-policy.json --set-as-default
```

### 移行中の CI ロール

切り替えのデプロイが通るまでは、CI ロールが新旧両方のブートストラップロールを引き受けられるようにしている
([github-actions-cdk-deploy-role.policy.json](github-actions-cdk-deploy-role.policy.json))。
本番のスタックの実行ロールが `cdk-snbook-cfn-exec-role` に切り替わったことを確認したら、`hnb659fds` の 3 ロールと SSM パラメータを外す。

```bash
# 本番スタックの実行ロールを確認する
aws cloudformation describe-stacks --stack-name SimplenotebookStack --query 'Stacks[0].RoleARN' --output text
```

## 設計の根拠

### 信頼ポリシー: `sub` を完全一致で1つだけ許可する

`deploy-aws` ジョブは `environment: production` を持つため、GitHub が発行する OIDC トークンの `sub` は
environment 形式 `repo:ougotti/simplenotebook:environment:production` に固定される（`push` / `workflow_dispatch` のどちらでも同じ）。

CloudTrail の `AssumeRoleWithWebIdentity`（直近90日 = lookup-events の保持上限）を集計しても、
このロールを引き受けている `sub` はこの1つだけだった。ワイルドカードが不要なので `StringLike` ではなく `StringEquals` を使う。

### 権限ポリシー: CDK ブートストラップロールへの `sts:AssumeRole` だけにする

CDK v2 は ambient な認証情報で直接リソースを作らず、ブートストラップロール（B-21 以降は専用の `cdk-snbook-*`。移行中は旧 `cdk-hnb659fds-*` も）を引き受けて作業する。

- CloudFormation 操作・`cfn-exec-role` への `iam:PassRole` → `deploy-role` が持っている
- アセット（Lambda コードの zip）の staging バケットへのアップロード → `file-publishing-role` が持っている
- スタックのリソース作成・更新 → CloudFormation が `cfn-exec-role` で実行する

実際、CloudTrail でこのロールのセッション（`GitHubActions`）が ambient な認証情報で呼んだ API を集計すると、
直近90日で `sts:AssumeRole` と `sts:GetCallerIdentity` しか無い。引き受け先も `deploy-role` と `file-publishing-role` の2つだけだった。

`nextjs.yml` の `deploy-aws` ジョブは `npx cdk deploy` 以外に AWS を直接叩くステップを持たない
（`cdk-outputs.json` の加工は `jq`、`config.json` の検証は `node scripts/verify-config.js` で、いずれも AWS API を呼ばない）。
そのため、旧ポリシーにあった `s3:*` / `lambda:*` / `apigateway:*` / `cognito-idp:*` / `cognito-identity:*` / `logs:*` /
`iam:*` / `cloudformation:*` / `secretsmanager:GetSecretValue` は CIロール側には不要。
特に `iam:*` は実質的な管理者権限への昇格経路になるため外す。

Secrets Manager の値はテンプレート内の動的参照（`{{resolve:secretsmanager:...}}`）として
CloudFormation が `cfn-exec-role` で解決するので、CIロールには `secretsmanager:GetSecretValue` は要らない。

補足:

- `lookup-role` は現時点では使われていない（`fromLookup` 系を使っていないため CloudTrail にも出ない）が、
  context lookup を追加したときに即失敗しないよう、読み取り専用の同ロールだけは引き受け先に含めてある。
- `ssm:GetParameter` はブートストラップバージョン（`/cdk-bootstrap/hnb659fds/version`）1件のみ。
  現状は CDK が `deploy-role` 経由で読むため実測には出ないが、ambient にフォールバックする経路への保険として最小スコープで残す。
- `DockerImageAsset` / `ContainerImage.fromAsset` は使っていない（Lambda は `lambda.Code.fromAsset` の zip アセットのみ）ので、
  `image-publishing-role` への `sts:AssumeRole` は不要。

## 適用手順

```bash
# 0) アカウントIDを取得し、プレースホルダを置換した一時ファイルを作る
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
mkdir -p /tmp/iam-apply
sed "s/__ACCOUNT_ID__/${ACCOUNT_ID}/g" docs/iam/github-actions-cdk-deploy-role.trust.json > /tmp/iam-apply/trust-after.json
sed "s/__ACCOUNT_ID__/${ACCOUNT_ID}/g" docs/iam/github-actions-cdk-deploy-role.policy.json > /tmp/iam-apply/policy-after.json
```

```bash
# 1) 変更前を必ず保存する（ロールバック用。リポジトリにはコミットしないこと）
aws iam get-role --role-name GitHubActionsCdkDeployRole \
  --query 'Role.AssumeRolePolicyDocument' --output json > /tmp/iam-apply/trust-before.json
aws iam get-role-policy --role-name GitHubActionsCdkDeployRole --policy-name CDKDeployPolicy \
  --query 'PolicyDocument' --output json > /tmp/iam-apply/policy-before.json
```

```bash
# 2) 信頼ポリシーを適用する
aws iam update-assume-role-policy --role-name GitHubActionsCdkDeployRole \
  --policy-document file:///tmp/iam-apply/trust-after.json
```

```bash
# 3) 権限ポリシーを適用する
aws iam put-role-policy --role-name GitHubActionsCdkDeployRole --policy-name CDKDeployPolicy \
  --policy-document file:///tmp/iam-apply/policy-after.json
```

## ロールバック手順

`trust-before.json` / `policy-before.json` を保存してあれば、同じコマンドで戻せる。

```bash
aws iam update-assume-role-policy --role-name GitHubActionsCdkDeployRole \
  --policy-document file:///tmp/iam-apply/trust-before.json
```

```bash
aws iam put-role-policy --role-name GitHubActionsCdkDeployRole --policy-name CDKDeployPolicy \
  --policy-document file:///tmp/iam-apply/policy-before.json
```

バックアップを失った場合の復旧値は、このドキュメントの旧版（git 履歴）ではなく、
変更前に取得した CloudTrail / IAM の実測出力を一次情報とすること。

## 検証手順

1. `main` への push か、Actions から `Deploy Next.js site to Pages` を `workflow_dispatch` で実行する
2. `deploy-aws` ジョブの `Configure AWS credentials` が成功する（= 信頼ポリシーが正しい）
3. 同ジョブの `Deploy CDK stack and get outputs` が成功する（= 権限ポリシーが正しい）
4. 失敗した場合は上記ロールバックを実行し、CloudTrail の `errorCode` で不足している API を特定する

**0差分のデプロイでは `ExecuteChangeSet` が実行されない**（全スタックが `(no changes)` だと CDK が打ち切る）。
実変更を伴うデプロイが1回通るまでは、完全な検証にはなっていないと考えること。

## 現状確認のしかた

IAM の現状はドキュメントではなく実物を見る。

```bash
aws iam get-role --role-name GitHubActionsCdkDeployRole --query 'Role.AssumeRolePolicyDocument' --output json
```

```bash
aws iam get-role-policy --role-name GitHubActionsCdkDeployRole --policy-name CDKDeployPolicy --query 'PolicyDocument' --output json
```

`--start-time` は指定しない。省略すると CloudTrail が保持している全期間（直近90日）が対象になる。
日付を直書きすると時間の経過とともに検索範囲が狭まり、本文の「直近90日」という前提とズレる。

```bash
aws cloudtrail lookup-events --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-items 300 --region ap-northeast-1
```

このロール自身が ambient な認証情報で呼んだ API は、セッション名（`configure-aws-credentials` の既定値 `GitHubActions`）で引く。

```bash
aws cloudtrail lookup-events --lookup-attributes AttributeKey=Username,AttributeValue=GitHubActions \
  --max-items 400 --region ap-northeast-1
```
