# IAM ポリシー（版管理）

このディレクトリには、GitHub Actions から AWS へデプロイするために使っている IAM ロールのポリシー文書を置く。
**AWS 上の実物とこのディレクトリの内容を一致させること。** 変更するときは、ここを直してから適用する。

> このリポジトリは public のため、ARN のアカウントID部分は `__ACCOUNT_ID__` プレースホルダにしてある。
> 適用時に実アカウントIDへ置換する（手順は後述）。

## 対象ロール

| ロール | 用途 | 信頼ポリシー | 権限ポリシー |
| --- | --- | --- | --- |
| `GitHubActionsCdkDeployRole` | `.github/workflows/nextjs.yml` の `deploy-aws` ジョブが `cdk deploy` を実行するために引き受ける | [github-actions-cdk-deploy-role.trust.json](github-actions-cdk-deploy-role.trust.json) | インラインポリシー `CDKDeployPolicy` = [github-actions-cdk-deploy-role.policy.json](github-actions-cdk-deploy-role.policy.json) |

## 設計の根拠

### 信頼ポリシー: `sub` を完全一致で1つだけ許可する

`deploy-aws` ジョブは `environment: production` を持つため、GitHub が発行する OIDC トークンの `sub` は
environment 形式 `repo:ougotti/simplenotebook:environment:production` に固定される（`push` / `workflow_dispatch` のどちらでも同じ）。

CloudTrail の `AssumeRoleWithWebIdentity`（直近90日 = lookup-events の保持上限）を集計しても、
このロールを引き受けている `sub` はこの1つだけだった。ワイルドカードが不要なので `StringLike` ではなく `StringEquals` を使う。

### 権限ポリシー: CDK ブートストラップロールへの `sts:AssumeRole` だけにする

CDK v2 は ambient な認証情報で直接リソースを作らず、ブートストラップロール（`cdk-hnb659fds-*`）を引き受けて作業する。

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
