# スプリント 1 計画

- **期間**: 2026-07-18 〜(1〜2 週間目安)
- **スプリントゴール**: 「ノートが増えても快適に使える」— 検索とダークモードで日常利用の体験を引き上げる
- **選択ストーリー**: B-01 ノート検索(M)、B-02 ダークモード(S)
- **Issue / PR**: B-01 → Issue [#68](https://github.com/ougotti/simplenotebook/issues/68) / PR [#70](https://github.com/ougotti/simplenotebook/pull/70)、B-02 → Issue [#69](https://github.com/ougotti/simplenotebook/issues/69) / PR [#71](https://github.com/ougotti/simplenotebook/pull/71)

## タスク分解

### B-01 ノート検索
- [x] `components/SearchBox.tsx` 作成(入力 + クリアボタン)
- [x] 絞り込みロジック追加 — `hooks/useNoteSearch.ts` として分離(タイトル+本文、大文字小文字無視。一覧 API は本文を返さないため、検索時に本文を取得し `id:updatedAt` キーでキャッシュ)
- [x] ノート一覧画面(`app/notes/new/page.tsx`)に検索ボックスを組み込み
- [x] 0 件時の空状態表示(`search-no-results`)
- [x] E2E テスト: タイトル検索/本文検索/0件表示+クリア(`tests/note-search.spec.ts`)

### B-02 ダークモード
- [x] `tailwind.config.js` に `darkMode: 'class'` 設定
- [x] テーマ切り替え hook(`hooks/useTheme.ts`)— OS 追従 + 手動切替 + localStorage 保存
- [x] ヘッダーに切り替えトグル追加(`components/ThemeToggle.tsx`)+ `app/layout.tsx` に描画前適用スクリプト(フラッシュ防止)
- [x] 全画面のダーク配色対応(一覧、エディタ、設定ページ、設定モーダル、ログイン画面、削除モーダル)
- [x] E2E テスト: トグル切り替え/リロード後の永続化/OS 設定追従(`tests/dark-mode.spec.ts`)

## Definition of Done
- `npm run lint` / `npm run build` 通過
- 新規機能に E2E テストあり、新規テストは全て通る
- 既存テストは main 時点の既知失敗8件(B-13 参照)を除き全て通る
- basePath(`/simplenotebook`)配下で動作確認済み

## 検証結果(2026-07-18)
- `npm run lint` / `npm run build`: 通過
- 新規 E2E 6件: 全て成功
- ブラウザ実機確認: ノート2件作成 → 本文キーワード「スプリント」で1件に絞り込み → クリアで全件復帰 → ダーク切替(bg: gray-900)→ リロード後も維持、を確認
- 既存 E2E の失敗 8件(basic-functionality ×2, dev-server-functionality ×2, final-working ×1, fixed-selectors ×3)は **main でも同様に失敗する既存の問題**(h2 の strict mode violation 等、今回の変更とは無関係)→ バックログ候補

## 振り返り(スプリント終了時に記入)
- Keep:
- Problem: 既存 E2E に main 時点で失敗しているテストが8件ある(セレクタの strict mode violation)
- Try: 次スプリントで既存テストの修繕タスクを入れる
