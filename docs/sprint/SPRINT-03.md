# スプリント 3 計画

- **状態**: 進行中
- **期間**: 2026-07-19 〜(1〜2 週間目安)
- **スプリントゴール**: 「書き心地と保守性」— Markdown の見た目を確認しながら書け、よく使うノートにすぐ届き、コードの負債を返す
- **選択ストーリー**: B-04 Markdown プレビュー+シンタックスハイライト(S→M 相当に補正)、B-05 ピン留め・並び替え(S)、B-14 サマリ生成の共通化(S)
- **Issue / PR**: B-04 → Issue [#86](https://github.com/ougotti/simplenotebook/issues/86)、B-05 → Issue [#87](https://github.com/ougotti/simplenotebook/issues/87)、B-14 → Issue [#88](https://github.com/ougotti/simplenotebook/issues/88)

> **スコープ補正**: B-04 は当初「プレビュー強化」としていたが、現状エディタは textarea のみでプレビューが存在しないことが判明。プレビュー表示の追加から行うため実質 M サイズとして扱う。

## タスク分解

### B-14 サマリ生成の共通化(最初に着手)
- [ ] `hooks/useNotes.ts` に `toNoteSummary(note)` を追加(content を除外し他フィールドは自動で通す形)
- [ ] create/update の手組みサマリを共通関数に置き換え
- [ ] 既存 E2E(特にタグ・検索)が全て通ることを確認

### B-04 Markdown プレビュー+シンタックスハイライト
- [ ] 依存追加: react-markdown / remark-gfm / rehype-highlight
- [ ] `components/MarkdownPreview.tsx` 作成(GFM + コードハイライト)
- [ ] エディタに「編集/プレビュー」切り替えタブを追加
- [ ] プレビュー用スタイル(見出し・リスト・引用・コード)+ ダークモード対応のハイライトテーマ
- [ ] E2E テスト: 見出し・コードブロックのレンダリング/タブ切り替え/ダークモード

### B-05 ピン留め・並び替え
- [ ] Note に `pinned?: boolean` を追加(S3 保存、後方互換: 既存ノートは未ピン扱い)
- [ ] Lambda / localApi / useNotes のピン対応(サマリは B-14 の共通関数経由で自動反映)
- [ ] 一覧にピン留めトグル(📌)を追加、ピン留めノートを上部表示
- [ ] 並び替えセレクタ(更新日時/作成日時/タイトル順)
- [ ] E2E テスト: ピン留め/解除/上部表示/並び替え/永続化

## マージ順の運用(スプリント2の Try を反映)
1. **B-14 → B-04 → B-05 の順にマージする**
2. B-14 と B-05 は `hooks/useNotes.ts`、B-04 と B-05 は `app/notes/new/page.tsx` が重なるため、B-05 は先行2本のマージ後に着手する(並行開発によるコンフリクトを避ける)
3. dev サーバー起動中はプロダクションビルドを実行しない(スプリント2の Problem 対応)

## Definition of Done
- `npm run lint` / `npm run build` 通過
- 新規機能に E2E テストあり、全 E2E テストが通る
- basePath(`/simplenotebook`)配下で動作確認済み
- S3 セキュリティ(ユーザー分離)を壊さない

## 振り返り(スプリント終了時に記入)
- Keep:
- Problem:
- Try:
