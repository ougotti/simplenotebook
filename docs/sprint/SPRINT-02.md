# スプリント 2 計画

- **状態**: 進行中
- **期間**: 2026-07-18 〜(1〜2 週間目安)
- **スプリントゴール**: 「整理と信頼性」— ノートが増えても整理でき、CI を信頼できる状態にする
- **選択ストーリー**: B-13 既存 E2E テストの修繕(S)、B-03 タグ機能(M)
- **Issue / PR**: B-13 → Issue [#78](https://github.com/ougotti/simplenotebook/issues/78)、B-03 → Issue [#79](https://github.com/ougotti/simplenotebook/issues/79)

## タスク分解

### B-13 既存 E2E テストの修繕(先行して着手)
- [ ] 失敗8件の原因調査(basic-functionality ×2、dev-server-functionality ×2、final-working ×1、fixed-selectors ×3)
- [ ] `locator('h2')` 等の strict mode violation をセレクタの特定化で修繕
- [ ] テストの無効化・削除ではなく、現在の UI に合わせた修繕であることを確認
- [ ] `npx playwright test` 全件成功

### B-03 タグ機能
- [ ] データ形式設計 — Note に `tags: string[]` を追加(S3 保存、後方互換: 既存ノートはタグなし扱い)
- [ ] `lib/api.ts` / `lib/localApi.ts` の Note 型・CRUD にタグを追加
- [ ] バックエンド(Lambda)の入力サニタイゼーションにタグを追加(必要な場合)
- [ ] タグ入力 UI — エディタにタグ付与・削除(`components/TagInput.tsx`)
- [ ] 一覧にタグ表示 + タグクリックで絞り込み
- [ ] 検索(B-01)との共存 — タグ絞り込みとキーワード検索の併用
- [ ] E2E テスト: タグ付与/削除/絞り込み/永続化

## マージ順の運用(前スプリントの Try を反映)
- B-13 を先にマージし、B-03 は信頼できる CI の上で検証する
- 同一ファイルを触る PR が並行する場合は、先行 PR のマージ後に後続をマージ前 rebase する

## Definition of Done
- `npm run lint` / `npm run build` 通過
- 新規機能に E2E テストあり、全 E2E テストが通る(B-13 完了後は既知失敗の除外なし)
- basePath(`/simplenotebook`)配下で動作確認済み
- S3 セキュリティ(ユーザー分離)を壊さない

## 振り返り(スプリント終了時に記入)
- Keep:
- Problem:
- Try:
