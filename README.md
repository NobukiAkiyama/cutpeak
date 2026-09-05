# Framecut

ブラウザだけで動画・画像・音声・字幕を編集する、React / TypeScript / Vite 製のエディターです。
元の素材を書き換えず、編集操作をコマンドと履歴に記録します。自前バックエンド、FFmpeg、WASM、クラウドレンダリングは使用しません。

## 起動

Node.js 22.13 以上を使用してください。Node.js は開発・ビルド・静的ファイル配信にだけ使用します。

```sh
npm ci
npm run dev
```

表示される `http://127.0.0.1:5173/` を開きます。別のHTTPオリジンではブラウザAPIが制限されるため、開発は localhost / 127.0.0.1、本番は HTTPS を使用してください。

```sh
npm test          # ドメイン、PCM音声、保存、Driveプロトコル等のテスト
npm run lint     # 型を含む静的解析
npm run build    # 型チェック、静的ビルド、PWAキャッシュ生成
npm start        # 本番ビルドのローカル確認（既定4173）
```

`dist/` をそのまま HTTPS の静的ホストへ配置できます。Node.js のアプリケーションサーバーは不要です。ホストのドメイン直下 `/` に配置してください。

## 基本操作

1. 「素材を読み込む」で動画・画像・音声を追加します。複数ファイルとドラッグ＆ドロップに対応します。
2. 素材の画像または ＋ を押すか、タイムラインへドラッグします。オーディオパネルからは動画の音声だけも追加できます。
3. クリップをドラッグして移動、左右の端でトリミングします。再生位置で `S` を押すと分割します。
4. テキスト・字幕・図形は左のツールから追加します。SRT は字幕ツールから読み込みます。
5. インスペクターで位置、倍率、回転、クロップ、不透明度、文字装飾、音量、フェードを編集します。タブレットでは下の「編集」で設定シートを開きます。
6. プレビュー上で移動・拡大縮小・回転できます。◇ で現在位置のキーフレームを追加します。
7. 「履歴」で元の状態へ復元、スナップショット、別案の作成・切り替えができます。Undo後に編集しても、元の未来の履歴を残します。
8. 「書き出す」で利用可能な MP4 / WebM を選びます。映像・音声は端末内でエンコードされます。

クロスディゾルブは、同じ映像トラック上で前後のクリップを重ね、後のクリップに設定してください。非表示とミュートは独立しています。映像トラックを隠しても、その音声はミュートしない限り再生されます。

ショートカットは右下のキーボードアイコンで確認できます。ドラッグ時に Alt を押すと一時的にスナップを解除します。数値入力は Enter またはフォーカス移動で確定します。

## タブレットでの編集

- クリップを約0.5秒長押しすると、分割・削除・複製・移動・詳細編集のメニューが下から開きます。長押しした位置に再生ヘッドを移し、その位置で分割します。
- クリップ上をスワイプするとスクロールします。移動する場合はメニューで「移動」を選んでからドラッグしてください。
- タップでクリップを選択すると、左右にトリム用の黄色いハンドルが表示されます。
- 下部の「… 操作」からも同じメニューを開けます。マウスは従来のドラッグに加えて右クリック、キーボードは Shift+F10 に対応します。
- ロック中の編集と、先頭位置での分割は無効です。削除は上部の「元に戻す」で取り消せます。

## パネルの配置

パネル間の紫色の境界線をドラッグすると幅・高さを変更できます。境界線はキーボードでフォーカスして矢印キーでも調整できます。各パネル上部の × で閉じ、ヘッダーの「表示」から再び開けます。「配置をリセット」で比率と表示状態を初期状態に戻せます。素材・編集設定は下部ツールからも開けます。配置はこのブラウザに保存され、編集データや履歴には影響しません。プレビューを閉じると再生は停止します。狭い画面では上下方向に分割します。

## 保存

- 通常は OPFS に素材と編集内容を保存し、IndexedDB にプロジェクト一覧・同期情報を保存します。
- 編集内容は2世代の保存ファイルと HEAD / PREVIOUS で保持します。保存途中の障害が起きても、直前の読み取り可能な状態を残します。
- OPFS が利用できないときは IndexedDB の編集データとセッション中の File にフォールバックします。**この場合、再読み込み後は元の素材ファイルの再接続が必要です。**
- 「プロジェクトを保存」は `.framecut.json` をダウンロードします。編集・履歴を含み、動画・画像・音声のバイナリは含みません。
- ブラウザのサイトデータを消すとローカルの保存内容も消えます。別途バックアップしてください。
- **localhost、127.0.0.1、本番URLは、それぞれ別の保存領域です。** 公開先へ移るときは保存ファイル＋元の素材、または Drive の「素材も保存」を利用します。

## Google Drive

[設定手順](docs/GOOGLE_DRIVE.md) を参照してください。画面の Drive 設定から入力できるため、再ビルドは必須ではありません。`.env.example` にある Vite 変数を使ってビルド時に設定する方法もあります。

アクセストークンはメモリーだけに保持します。`drive.file` スコープを使用し、Google Identity Services、Google Picker、Drive REST API とブラウザから直接通信します。

同期はアプリが開いていて、オンラインかつ認証が有効な間に行います。失敗したキューと再開可能アップロードのセッションを IndexedDB に残します。同期競合を検出した場合は元のデータを上書きせず別案を追加します。更新時は ETag / If-Match を要求し、サーバーが検証情報を返さない場合は既存ファイルを書き換えません。

## 構成

```text
src/core/       純 TypeScript のモデル、コマンド、履歴DAG、キーフレーム、SRT、履歴パック
src/app/        Capability 検出、Zustand、Editor API、初期化
src/media/      Mediabunny の入力、キャッシュ、フレーム、音声ミックス、書き出し
src/render/     共通シーン合成、WebGL2、Canvas2D
src/audio/      AudioContext を基準とした再生、AudioWorklet の出力
src/workers/    メディア、レンダリング、書き出し用 Worker
src/storage/    OPFS、IndexedDB、Drive、Google SDK 型定義
src/sync/       同期キューと競合時の分岐
src/ui/         プレビュー、タイムライン、字幕、インスペクター、各ダイアログ
public/        アイコン、マニフェスト、AudioWorklet、Service Worker テンプレート
scripts/       ビルド後のPWAキャッシュ生成
```

`core/` は React・ブラウザAPI・Google Drive・Mediabunny に依存しません。タイムライン時間は整数フレーム、素材の開始位置はマイクロ秒です。NTSCレートは 30000/1001、60000/1001 として保持します。タイムコード表示は non-drop-frame です。

## 検証範囲

実装状況と未検証項目は [V1_STATUS.md](docs/V1_STATUS.md) に記録しています。実ブラウザの WebCodecs / WebGL 出力と Google OAuth の実接続について、型チェックやモックテストだけで動作保証をしたものではありません。

実装時に参照した一次資料:

- [Mediabunny: Reading media files](https://mediabunny.dev/guide/reading-media-files)
- [Mediabunny: Media sinks](https://mediabunny.dev/guide/media-sinks)
- [Mediabunny: Media sources](https://mediabunny.dev/guide/media-sources)
- [Google Identity Services: Token model](https://developers.google.com/identity/oauth2/web/guides/use-token-model)
- [Google Drive: Upload file data](https://developers.google.com/workspace/drive/api/guides/manage-uploads)
- [Google Picker](https://developers.google.com/workspace/drive/picker/guides/overview)
