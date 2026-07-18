# スプリント運用ガイド

Simplenotebook の改善活動をスプリント形式で回すためのガイドです。

## 役割エージェント(`.claude/agents/`)

| エージェント | 役割 | 使いどころ |
|---|---|---|
| `product-owner` | バックログ管理・ストーリー作成・優先順位付け | 「何を作るか」の検討、受け入れ条件の定義 |
| `scrum-master` | スプリント計画・タスク分解・進捗/振り返り | スプリントの開始・終了・整理 |
| `frontend-dev` | React/Next.js/Tailwind の実装 | UI 機能の実装タスク |
| `backend-dev` | CDK/Lambda/S3/Cognito の実装 | API・インフラのタスク |
| `qa-engineer` | E2E/ユニットテスト・受け入れ検証 | 実装後の検証、テスト整備 |
| `ux-designer` | UI 設計・デザインレビュー・a11y 監査 | 実装前のデザイン検討 |

呼び出し例: 「product-owner エージェントで B-03 のストーリーを詳細化して」

## スプリントの流れ

1. **計画**: product-owner がバックログから選択 → scrum-master が SPRINT-XX.md にタスク分解
2. **設計**: UI を伴う機能は ux-designer が先に画面設計
3. **実装**: ストーリー毎に GitHub Issue を作成し、**Issue 毎に個別ブランチ(`feat/<issue番号>-<内容>`)+ 個別 PR** で進める(PR 本文に `Closes #<番号>`)。複数ストーリーを1ブランチにまとめない
4. **検証**: qa-engineer が受け入れ条件を E2E で検証
5. **振り返り**: scrum-master が Keep/Problem/Try を記録し、BACKLOG.md を更新

## ドキュメント

- [BACKLOG.md](BACKLOG.md) — プロダクトバックログ(優先順位付き)
- `SPRINT-XX.md` — 各スプリントの計画・進捗・振り返り
