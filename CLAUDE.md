# CLAUDE.md

このファイルは Claude Code がこのリポジトリで作業する際のプロジェクトルールです。

## 開発フロー

### Issue 毎に PR を作成する
- バックログ項目(`docs/sprint/BACKLOG.md`)に着手する際は、まず GitHub Issue を作成する(既存 Issue があれば流用)
- Issue 毎に専用ブランチを切る: `feat/<issue番号>-<内容>`(例: `feat/68-note-search`)
- その Issue の変更だけを含む PR を作成し、本文に `Closes #<番号>` を入れて紐付ける
- 複数のストーリー・Issue の変更を1つのブランチ/PR にまとめない

### PR レビューへの対応
- レビューコメント(Copilot・人間レビュアー問わず)に対応したら、修正をコミット・push した後、**各コメントにインラインで返信する**
- 「対応しました」だけで終わらせず、具体的に何をどう変更したか(該当コミットハッシュ含む)を一言添える
- 返信には `gh api repos/<owner>/<repo>/pulls/<PR番号>/comments -f body="..." -F in_reply_to=<コメントID>` を使う
  (`-F` は `@` 接頭辞がない限りファイル読み込みではなく型付き値として送信されるため、`in_reply_to` の数値指定として正しい。文字列は `-f`、数値・真偽値は `-F` を使う)

## スプリント運用
- `.claude/agents/` に役割エージェント(product-owner, scrum-master, frontend-dev, backend-dev, qa-engineer, ux-designer)を定義済み
- スプリント文書は `docs/sprint/`(README.md=運用ガイド、BACKLOG.md=バックログ、SPRINT-XX.md=各スプリント)を参照

## 開発コマンド
- `npm run dev` - 開発サーバー起動
- `npm run build` - 静的サイトビルド
- `npm run lint` - ESLint
- `npx playwright test` - E2E テスト

## 制約
- `output: 'export'` による静的書き出しのため SSR/API Routes は使用不可
- basePath は `/simplenotebook`。パス直書き禁止(`next.config.js` から参照する)
- S3 セキュリティ(Public Block ALL、CORS、ユーザー分離)を壊す変更は行わない
