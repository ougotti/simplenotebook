# デプロイ手順

## デプロイ順（ランブック）

1. **Google Console**

   * 同意画面（外部）→ 承認済みドメインに `amazoncognito.com`
   * OAuthクライアントID（Web）発行

     * リダイレクトURI：`https://<domain>.auth.ap-northeast-1.amazoncognito.com/oauth2/idpresponse`
       ※ `<domain>` は、手順3で設定する Cognito ドメインプレフィックス（例: `notes-app-prod`）に置き換えてください。
   * Client ID/Secret を控える

2. **AWS（Secrets Manager）**

   * `google/oauth` に

     ```json
     {"client_id":"xxxx.apps.googleusercontent.com","client_secret":"yyyy"}
     ```

3. **CDK（UserPool/IdP/Domain/API/S3/Lambda）**

   * User Pool + Google IdP（Secrets参照）
   * **Domain**：`domainPrefix`（例 `notes-app-prod`）
   * User Pool Client（Auth Code + PKCE、callback/logout は後で上書き可）
   * API Gateway / Lambda / S3 / CORS

4. **CDKデプロイ**

   * PowerShell:

     ```powershell
     npm i -g aws-cdk
     cd cdk; npm ci
     # 例: aws://123456789012/ap-northeast-1
     cdk bootstrap aws://<account-id>/<region>
     cdk deploy
     ```
   * 出力：Hosted UI ドメイン、API URL、クライアントID

5. **CognitoのコールバックURLを確定**

   * `https://<user>.github.io/<repo>/callback` を **User Pool Client** に登録
   * ログアウトURL：`https://<user>.github.io/<repo>/`

6. **GitHub Pages（config）**

   * `/config/config.json` に公開値のみ配置：

     ```json
     {
       "apiBaseUrl": "https://xxxx.execute-api.ap-northeast-1.amazonaws.com/prod",
       "cognitoDomain": "https://<domain>.auth.ap-northeast-1.amazoncognito.com",
       "clientId": "xxxx"
     }
     ```

7. **GitHub OIDC（既定方針どおり）**

   * Actionsロールで `secretsmanager:GetSecretValue`（`google/oauth`）とCDK一式権限
   * `deploy.yml` で OIDC AssumeRole → `cdk deploy`

## 動作確認（3分チェック）

* **Hosted UI**：
  `https://<domain>.auth.ap-northeast-1.amazoncognito.com/login` → Googleでサインインできる
* **Callback一致**：
  Pagesの`/callback`に戻ってトークン交換が完了する（`redirect_uri_mismatch`が出ない）
* **API + 署名URL**：
  ログイン後、`/notes/sign` に `action=put,key=test.md` POST → URL返る → そのURLへPUTで200
* **S3反映**：
  バケットに`<sub>/.../test.md`が出来ている

## 詰まりやすい点（落とし穴だけ）

* Googleの**承認済みリダイレクトURI**が Cognito ドメインの`/oauth2/idpresponse`になっていない
* User Pool Client の **callback/logout URL** に Pages のURLを入れ忘れ
* CORS：API/S3で `https://<user>.github.io` を許可していない
* Secrets名/キー名の typo（`google/oauth`, `client_id`, `client_secret`）