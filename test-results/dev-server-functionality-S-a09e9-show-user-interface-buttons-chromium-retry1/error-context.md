# Page snapshot

```yaml
- alert
- heading "SimpleNotebook" [level=1]
- paragraph: 開発モード - ローカルストレージ使用中
- text: 設定未読み込み local@example.com
- button "設定"
- button "サインアウト"
- heading "新規ノート" [level=2]
- textbox "ノートのタイトル"
- textbox "Markdownを書いてください..."
- button "保存"
- heading "保存されたノート" [level=2]
- button "更新"
- text: まだノートがありません
- dialog "初回設定":
  - heading "初回設定" [level=2]
  - paragraph: 初回設定を行ってください。この設定は後から変更できます。
  - text: 表示名 *
  - textbox "表示名 *"
  - paragraph: 100文字以内で入力してください。絵文字や全角文字も使用できます。
  - button "保存" [disabled]
```