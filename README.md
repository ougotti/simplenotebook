# Simplenotebook

シンプルなノートブックを作成する Next.js プロジェクトです。Markdown で編集した内容を GitHub Pages で静的サイトとして公開できます。

公開サイト: <https://ougotti.github.io/simplenotebook/>

## 利用できるスクリプト

- `npm run dev` - 開発サーバーを起動
- `npm run build` - GitHub Pages 用に静的サイトをビルド
- `npm run start` - 本番サーバーを起動
- `npm run lint` - ESLint を実行
- `npm run preview` - `out` ディレクトリをローカルでプレビュー

Tailwind CSS を使用しており、PostCSS 経由でスタイルを生成します。

`main` ブランチへの push により、[GitHub Actions ワークフロー](.github/workflows/nextjs.yml) が実行され、`out` ディレクトリの内容が GitHub Pages にデプロイされます。Next.js 14 では `next export` は非推奨のため、`next.config.js` の `output: 'export'` と `npm run build`（＝`next build`）で静的書き出しされます。
