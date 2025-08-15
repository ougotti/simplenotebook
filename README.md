# Simplenotebook

シンプルなノートアプリケーションを作成する Next.js プロジェクトです。AWS バックエンドと Google OAuth 認証を使用して、Markdown でノートを編集・保存できます。GitHub Pages で静的サイトとして公開されます。

公開サイト: <https://ougotti.github.io/simplenotebook/>

## アーキテクチャ

### フロントエンド
- **Framework**: Next.js 14 (App Router + Pages Router)
- **Styling**: Tailwind CSS
- **認証**: AWS Amplify (Cognito + Google OAuth)
- **デプロイ**: GitHub Pages

### バックエンド (AWS)
- **認証**: Amazon Cognito User Pool (Google IdP連携) + Identity Pool
- **API**: API Gateway + Lambda
- **ストレージ**: S3
- **設定管理**: AWS Secrets Manager (Google OAuth credentials)
- **インフラ**: AWS CDK

### セキュリティ
- **GitHubにシークレットなし**: AWS Secrets Manager + GitHub OIDC
- **S3セキュリティ**: Public Block ALL, SSL強制, ユーザー別アクセス制御
- **CORS保護**: GitHub Pages originのみ許可
- **入力サニタイゼーション**: Lambda関数で実装

## セットアップ

詳細なデプロイ手順は [DEPLOYMENT.md](DEPLOYMENT.md) を参照してください。

### 必要な準備

1. **Google Cloud Console**でOAuthクレデンシャルを作成
2. **AWS Secrets Manager**にクレデンシャルを保存
3. **GitHub OIDC**をAWSで設定
4. **GitHub Secrets**にAWS_ACCOUNT_IDを設定

## 利用できるスクリプト

- `npm run dev` - 開発サーバーを起動
- `npm run build` - GitHub Pages 用に静的サイトをビルド
- `npm run start` - 本番サーバーを起動
- `npm run lint` - ESLint を実行
- `npm run preview` - `out` ディレクトリをローカルでプレビュー

## デプロイメント

`main` ブランチへの push により、[GitHub Actions ワークフロー](.github/workflows/nextjs.yml) が実行され、以下の処理が自動実行されます：

1. **AWS インフラデプロイ**: CDKでCognito、API Gateway、Lambda、S3を構築
2. **設定ファイル生成**: デプロイされたリソースのエンドポイントで config.json を更新
3. **フロントエンドビルド**: Next.js アプリケーションをビルド
4. **GitHub Pages デプロイ**: `out` ディレクトリの内容をGitHub Pages にデプロイ

## 機能

- **Google OAuth認証**: Cognito Hosted UI経由でGoogleアカウントでログイン
- **ノート管理**: 作成、読み取り、更新、削除 (CRUD操作)
- **Markdownサポート**: ノートをMarkdownで記述
- **自動保存**: ローカルストレージへの下書き保存
- **ユーザー分離**: 各ユーザーは自分のノートのみアクセス可能

## 技術スタック

`main` ブランチへの push により、[GitHub Actions ワークフロー](.github/workflows/nextjs.yml) が実行され、`out` ディレクトリの内容が GitHub Pages にデプロイされます。Next.js 14 では `next export` は非推奨のため、`next.config.js` の `output: 'export'` と `npm run build`（＝`next build`）で静的書き出しされます。

- **Frontend**: Next.js 14, React 18, TypeScript, Tailwind CSS
- **Backend**: AWS Lambda (Node.js), API Gateway, S3
- **認証**: Amazon Cognito, Google OAuth 2.0
- **インフラ**: AWS CDK, CloudFormation
- **CI/CD**: GitHub Actions, GitHub OIDC

## デプロイ手順

AWS サービスを使用した本格的なデプロイ手順については、[DEPLOY.md](DEPLOY.md) を参照してください。
