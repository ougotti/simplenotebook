# リポジトリのCopilot言語ポリシー

- このリポジトリにおけるCopilotの出力（PRタイトル・本文、要約、レビューコメント、説明文など）は、原則として日本語（です/ます調、簡潔）で記載してください。
- PR本文は次の順で構成してください: 概要 → 変更内容 → 動作確認 → 影響範囲 → 関連Issue/PR → チェックリスト。
- 固有名詞やAPI名は原語を保持し、不要な直訳は避けます。コードやコマンドは必要最小限で簡潔に。
- 本方針に矛盾する指示がある場合は、本ファイルの指示を優先します。

---

# Simplenotebook

Simplenotebookは、Markdownノートを作成・編集するためのNext.jsウェブアプリケーションです。GitHub Actionsワークフローによる自動デプロイでGitHub Pagesに静的サイトを生成します。

**必ず最初にこれらの指示に従い、ここの情報と一致しない予期しない情報に遭遇した場合のみ検索やbashコマンドにフォールバックしてください。**

## 効果的な作業方法

### ブートストラップとセットアップ
- 依存関係のインストール: `npm install` -- 約51秒かかります。絶対にキャンセルしないでください。90秒以上のタイムアウトを設定してください。
- このリポジトリはNode.js v20+およびnpm v10+が必要です
- 追加のシステム依存関係やセットアップスクリプトは不要です

### 開発
- 開発サーバーの起動: `npm run dev` -- 約2秒で起動、http://localhost:3000/simplenotebookで配信
- **重要**: このアプリはGitHub Pagesとの互換性のためbasePath `/simplenotebook`を使用します。`http://localhost:3000/simplenotebook`にアクセスしてください。`http://localhost:3000`ではありません。
- 開発サーバーはホットリロードとファストリフレッシュをサポートします

### ビルドと静的エクスポート
- 本番用ビルド: `npm run build` -- 約18秒かかります。絶対にキャンセルしないでください。60秒以上のタイムアウトを設定してください。
- ビルドは`out/`ディレクトリに静的サイトを生成します
- `output: 'export'`設定でNext.js 14静的エクスポートを使用します
- **注意**: `npm run start`は静的エクスポート設定では動作しません - 代わりに`npm run preview`を使用してください

### 本番ビルドのプレビュー
- ビルドサイトのプレビュー: `npm run preview` -- `npx serve out`を使用、http://localhost:3000で配信
- **重要**: プレビューは`http://localhost:3000`にアクセスしてください（開発サーバーのような`/simplenotebook`ではありません）
- serveパッケージは初回実行時に自動的にインストールされます
- **注意**: ブラウザコンソールでアセット読み込みエラーが表示される場合がありますが、これはbasePathでGitHub Pages用に最適化されたビルドでは想定内です

### リンティングとコード品質
- リンティングの実行: `npm run lint` -- 約2秒、Next.js設定でESLintを使用
- 変更をコミットする前に必ず`npm run lint`を実行してください - リンティングエラーがあるとCIが失敗します
- 独立したフォーマッティングツールは設定されていません - ESLintがコード品質を処理します

## バリデーションシナリオ

### 手動テストの要件
変更を加えた後、必ず以下のシナリオをテストしてください:

1. **ノート作成フロー**:
   - `http://localhost:3000/simplenotebook`にナビゲート
   - テキストエリアにMarkdownテキストを入力（例: `# Test\n\n**Bold text**`）
   - "保存"ボタンをクリック
   - 成功メッセージ"保存しました（ローカル保存）"が表示されることを確認
   - ページリフレッシュ後もコンテンツが保持されることを確認（localStorageを使用）

2. **App Routerルート**:
   - `http://localhost:3000/simplenotebook/notes/new`にナビゲート
   - 同じノート作成インターフェースが表示されることを確認

3. **ビルドバリデーション**:
   - `npm run build`を実行してエラーがないことを確認
   - `out/`ディレクトリに`index.html`、`notes/new.html`、`_next/`アセットが含まれていることを確認
   - `npm run preview`を実行して本番ビルドで両方のルートをテスト: `/`と`/notes/new`
   - **注意**: プレビューでブラウザコンソールにアセット読み込みエラーが表示されるのは想定内です

## プロジェクト構造

### 主要なディレクトリとファイル
```
/home/runner/work/simplenotebook/simplenotebook/
├── app/                      # App Routerページ（Next.js 13+）
│   ├── layout.tsx           # HTML構造を持つルートレイアウト
│   └── notes/new/page.tsx   # /notes/newルートコンポーネント
├── pages/                   # Pages Router（レガシー、まだアクティブ）
│   ├── _app.tsx             # アプリラッパー
│   └── index.tsx            # ルートルートコンポーネント
├── styles/globals.css       # グローバルTailwind CSSインポート
├── public/                  # 静的アセット（favicon、画像）
├── .github/workflows/       # デプロイ用GitHub Actions
├── next.config.js           # 静的エクスポート + basePathを持つNext.js設定
├── tailwind.config.js       # Tailwind CSS設定
├── tsconfig.json            # TypeScript設定
└── package.json             # 依存関係とスクリプト
```

### アーキテクチャノート
- **デュアルルーターセットアップ**: Pages Router（`pages/`）とApp Router（`app/`）の両方を使用 - 両方とも機能します
- **静的エクスポート**: GitHub Pages用に`output: 'export'`と`basePath: '/simplenotebook'`で設定
- **スタイリング**: PostCSS処理を伴うTailwind CSS
- **状態管理**: ノート永続化にlocalStorageを使用（クライアントサイドのみ）
- **デプロイ**: mainブランチプッシュでGitHub ActionsによるGitHub Pagesへの自動デプロイ

## ビルドとCI情報

### GitHub Actionsワークフロー
- **ファイル**: `.github/workflows/nextjs.yml`
- **トリガー**: `main`ブランチへのプッシュ
- **プロセス**: `npm ci` → `next build` → `out/`をGitHub Pagesにデプロイ
- **Nodeバージョン**: 20（ワークフローで指定）
- **重要**: CIでのビルドタイムアウトは十分です - ビルドは約18秒で完了

### 依存関係
- **ランタイム**: Next.js 14.2.30、React 18.2.0
- **開発**: TypeScript 5.2.2、ESLint 8.38.0、Tailwind CSS 3.4.1
- **セキュリティ**: バリデーション時点で`npm audit`は脆弱性0を表示

## 共通コマンドリファレンス

### クイックコマンドサマリー
```bash
npm install          # 約51秒 - 依存関係のインストール
npm run dev          # 約2秒 - 開発開始（http://localhost:3000/simplenotebook）
npm run build        # 約18秒 - out/への静的サイトビルド
npm run preview      # プレビューサーバー開始（http://localhost:3000）
npm run lint         # 約2秒 - ESLintバリデーション
```

### タイミング期待値（絶対にキャンセルしない）
- `npm install`: 51秒 - 90秒以上のタイムアウトを設定
- `npm run build`: 18秒 - 60秒以上のタイムアウトを設定
- `npm run dev`: 2秒で起動 - 30秒以上のタイムアウトを設定
- `npm run lint`: 2秒 - 30秒以上のタイムアウトを設定
- `npm run preview`: serveインストールで5-10秒 - 60秒以上のタイムアウトを設定

## トラブルシューティング

### よくある問題
1. **localhost:3000で404**: 代わりに`http://localhost:3000/simplenotebook`にアクセス（開発モードのみ）
2. **npm startが失敗**: 本番テストには`npm run preview`を使用（静的エクスポートはサーバーをサポートしません）
3. **serveパッケージがない**: `npm run preview`は初回実行時にnpx経由でserveを自動インストール
4. **ESLintバージョン警告**: これらは想定内で機能に影響しません
5. **プレビューでアセット読み込みエラー**: GitHub Pages basePath最適化のためプレビューモードでは想定内

### クイックアクセス用ファイル場所
- **メインコンポーネント**: `pages/index.tsx`と`app/notes/new/page.tsx`
- **スタイリング**: `styles/globals.css`（Tailwindインポート）
- **設定**: `next.config.js`（basePath）、`tailwind.config.js`（CSS設定）
- **CI/CD**: `.github/workflows/nextjs.yml`（デプロイワークフロー）

### 開発のヒント
- 両方のルートシステムが動作: Pages Routerは`/`を、App Routerは`/notes/new`を配信
- 使用されるlocalStorageキー: 永続化のための`new-note-content`
- Tailwindクラスはアプリ全体で利用可能
- TypeScript strictモードが有効
- 開発モードでFast Refreshが動作