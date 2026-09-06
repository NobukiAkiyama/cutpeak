# Google Drive の初期設定

1. Google Cloud Console でプロジェクトを作成、または既存プロジェクトを選びます。
2. Google Drive API と Google Picker API を有効にします。
3. Google Auth Platform の同意画面を設定します。テスト中の外部アプリでは、接続するアカウントをテストユーザーに追加してください。
4. OAuth 2.0 クライアントIDを「ウェブアプリケーション」として作成します。Cloudflare Workerで認証コードを交換するため、Client Secretも使用します。
5. 「承認済みの JavaScript 生成元」にアプリの生成元を登録します。例:
   - `http://127.0.0.1:5173`
   - `http://localhost:5173`（このURLを使う場合）
   - `http://127.0.0.1:4173`（本番ビルドのプレビュー）
   - `https://cutpeak.v26001.workers.dev`（現在の公開先）
6. API Key を作成し、使用する生成元の HTTP リファラーと Google Picker API / Drive API に制限します。
7. OAuth Client ID、API Key、Google Cloud のプロジェクト**番号**を、`.env.local` または公開環境のビルド設定へ登録します。プロジェクト番号が App ID です。プロジェクト名や文字列のプロジェクトIDではありません。

   ```env
   VITE_GOOGLE_CLIENT_ID=...
   VITE_GOOGLE_API_KEY=...
   VITE_GOOGLE_APP_ID=...
   ```

8. Cloudflare WorkerへD1データベース `cutpeak-auth` を `AUTH_DB` としてバインドし、`migrations/` のSQLを適用します。
9. WorkerのSecretとして `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET`、32バイトのランダム値をbase64url化した `SESSION_ENCRYPTION_KEY` を登録します。
10. アプリを再ビルドします。以降、利用者は初回だけ「Google Drive と連携」からGoogleアカウントを選びます。セッションが有効な間は、タブを閉じても自動的に接続を復元します。

Client Secretとセッション暗号鍵は秘密情報です。フロントエンド用の `VITE_` 変数やリポジトリへ入れず、Cloudflare WorkerのSecretとしてのみ登録してください。API Key の制限は Google Cloud Console 側で設定します。フロントエンド設定値がないビルドでは、利用者向け画面に管理者への問い合わせ案内が表示されます。

## 保存と復元

- **素材も保存**: 現在の案だけでなく、履歴と別案から参照される素材も保存します。別端末で編集するときに使います。
- **編集内容だけ保存**: 動画などの素材は端末に残します。別端末で開いた場合は元の素材を再接続してください。
- **クラウド素材を端末に保存して編集**: 開く時点で素材をダウンロードし、編集・シークは端末内で行います。Driveをフレーム単位でストリーミングしません。
- 初回の「Drive に保存」では保存名が必須です。`Google Drive/Cutpeak/保存名.cutpeak` フォルダーを作り、プロジェクト一式をその中へまとめます。
- 「Drive から開く」で Google Picker を表示し、**保存名.cutpeak フォルダー**を選びます。内部の `project.json` はアプリが自動で読み込みます。

各 `.cutpeak` フォルダーには project.json、repository.json、history/ 配下の NDJSON パック、必要に応じて assets/ が作られます。パックは複数コミットをまとめた変更しないファイルとして保存し、最後に project.json の参照を切り替えます。

更新はGitの共有リポジトリに近い「先に取得してから条件付きで公開する」方式です。project.json の最新状態とETagをCloudflare WorkerがGoogle Driveから取得し、If-Match付きでproject.jsonだけを更新します。別端末が先に更新していた場合は412として検出し、元データを上書きせず「Drive の別案」として履歴に取り込みます。ブラウザからETagが見えないことが原因だった場合もWorker側で確認できますが、Google Drive側がETagを返さない場合は安全のため保存を保留します。

共有されたプロジェクトを別Googleアカウントで開き、編集権限がない場合は、元の共有プロジェクトを変更しません。保存時に現在のアカウントの `Google Drive/Cutpeak/保存名 - 派生版.cutpeak` へ新しい履歴として保存し、元プロジェクトのID・HEADを出所情報として記録します。編集権限がある共有ユーザーは、条件付き更新と競合検出の対象です。

ネットワーク切断中もローカル編集を続けられます。オンラインへ戻ると、Workerに保存した認証セッションからアクセストークンを更新し、保留キューを再試行します。ブラウザを閉じた後の同期は行いません。

## 検証状況

コードとモック通信テストは実装済みです。実Googleアカウントによるログイン、Picker、API Keyの制限、Worker経由のETag取得、別端末からの復元、Google Drive共有ユーザーの閲覧者派生保存は、設定済みのGoogle Cloudプロジェクトを用意して確認する必要があります。
