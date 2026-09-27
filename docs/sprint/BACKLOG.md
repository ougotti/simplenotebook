# プロダクトバックログ

> 管理者: product-owner / 更新: 2026-09-27
> 優先度は ユーザー価値 × 実装コスト で判断。見積り: S(〜半日) / M(〜2日) / L(3日〜)

## 優先度: 高(次スプリント候補)

### B-04 Markdown プレビュー強化(シンタックスハイライト)【S】
コードブロックのハイライト表示。エンジニアユーザーへの訴求。

### B-05 ノートのピン留め・並び替え 【S】
よく使うノートを上部固定。更新日時/作成日時/タイトル順の切り替え。

### B-14 ノート一覧サマリ生成の共通化 【S】(技術的負債)
`hooks/useNotes.ts` の create/update がサマリを手組みしており、フィールド追加時に漏れやすい
(スプリント2で tags の落とし漏れが実際に発生)。サマリ生成関数を共通化して再発を防ぐ。

### エージェント連携(MCP)
Claude / Codex などの AI エージェントから、MCP 経由で本人の権限でノートを参照・追加できるようにする。
設計: `docs/design/agent-interface.md`。依存順に着手する。

- **B-15 Lambda オーソライザーへの置き換え 【M】** (依存: なし) — Cognito JWT のみ・挙動は現行と同一。認証経路の差し替えだけを行い、E2E で回帰を確認する
- **B-16 PAT 基盤 【M】** (依存: B-15) — 認証用 DynamoDB テーブル + PAT の発行・失効 API + オーソライザーでの PAT 検証・スコープ判定
- **B-17 エージェント連携 UI 【M】** (依存: B-16) — 設定画面でトークンを発行・一覧・失効。Claude Code / Codex の接続例を表示
- **B-18 notesService の切り出し + API 拡張 【M】** (依存: B-15) — 検索・タグ一覧・追記・ETag/If-Match・入力の厳格化・エラーコード・OpenAPI
- **B-19 リモート MCP 【M】** (依存: B-16, B-18) — HTTP API + カスタムドメイン + `/mcp`(PAT 認証)。ここで Claude Code / Codex から使えるようになる
- **B-20 OAuth ファサード + 同意画面 【L】** (依存: B-19) — ここで Claude.ai / Desktop のコネクタから使えるようになる

## 優先度: 中

### B-21 CloudFormation 実行ロールの権限縮小 【M】
cdk bootstrap の `cfn-exec-role` が既定の AdministratorAccess のまま。共用している Route 53 ゾーンのほかのレコードを誤って変更しないよう、`--cloudformation-execution-policies` で権限を絞る。

### B-06 エクスポート機能 【S】
ノートを Markdown ファイルとしてダウンロード。全ノート一括 zip も検討。

### B-07 キーボードショートカット 【S】
保存(Ctrl+S)、新規作成(Ctrl+N)、検索(Ctrl+K)など。

### B-08 PWA 対応(オフライン閲覧)【L】
Service Worker でオフライン時も閲覧可能に。静的サイトと相性良。

## 優先度: 低(アイデア)

- B-09 ノートのバージョン履歴(S3 バージョニング活用)【L】
- B-10 画像アップロード(S3 直接アップロード + 署名付き URL)【L】
- B-11 ノート共有(閲覧専用リンク)【L】
- B-12 Mermaid 図表サポート 【S】

## Done

### B-01 ノート検索 【M】(Issue #68 / PR #70) スプリント1
ノート一覧にタイトル・本文のリアルタイム検索を追加。`hooks/useNoteSearch.ts` + `components/SearchBox.tsx`。

### B-02 ダークモード 【S】(Issue #69 / PR #71) スプリント1
OS 追従 + 手動切替 + 永続化のダークモードを全画面に追加。`hooks/useTheme.ts` + `components/ThemeToggle.tsx`。

### B-13 既存 E2E テストの修繕 【S】(Issue #78 / PR #81) スプリント2
main 時点で失敗していた8件を修繕(strict mode violation・placeholder の hasText 誤用・古い期待値)。全テスト成功に。

### B-03 タグ機能 【M】(Issue #79 / PR #82) スプリント2
タグの付与・削除・一覧絞り込み・S3 保存を追加。`components/TagInput.tsx` + Lambda の `sanitizeTags`。検索と AND 併用可。
