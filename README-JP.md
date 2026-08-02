# possg-core

[English](./README.md)

シンプルなBLOG向けSSGのCOREです。

## 特徴

- zipファイルまたはフォルダによる記事の入稿
- front matter付きmarkdownからHTMLを出力(EJSテンプレート)
- 軽量JSON DB([@seald-io/nedb](https://github.com/seald/nedb))を利用。特別なDBサーバ不要
- staging(下書き)/content(公開)の2状態管理
- frontmatterの`tags`によるタグ別indexページの自動生成
- コードブロックのシンタックスハイライト(ビルド時、[highlight.js](https://highlightjs.org/))
- `possg genviewer`用: zipファイルまたはフォルダの記事をブラウザ単体でドラッグ&ドロッププレビューできるHTMLの生成

## API

`import PossgCore from "possg-core";` で読み込み、`new PossgCore(config)` でインスタンス化して使います(configの詳細は[possgのconfig.example.mjs](https://github.com/tadfmac/possg/blob/main/config.example.mjs)を参照してください)。

### `async init()`

DB接続、MarkdownItインスタンスの構築、`customfunc.mjs`の読み込みを行います。`genViewer()`以外のメソッドを呼ぶ前に必ず一度呼んでください。

### `async import(sourcePath)`

記事を1件登録します。`sourcePath`には**zipファイル、またはフォルダ**を指定できます。

- zipファイルの場合: ファイル名(`.zip`を除く)がレコードのkeyになります
- フォルダの場合: フォルダ名自体がレコードのkeyになります
- どちらも、直下に`index.md`(front matter付きmarkdown)と画像等のアセットが並んだ構造であることが前提です
- 既に登録済みのkeyと同じものをimportすると、既存レコードが上書き更新されます
- importした記事は必ず**staging(下書き)状態**になります
- markdown本文またはfrontmatterの`images`から最初の画像を検出し、`THUMBNAIL`設定のサイズでサムネイルを自動生成します

### `async publish(key, isRelease)`

記事の公開状態を切り替えます。`isRelease`が`true`ならstaging→content(公開)へ、`false`ならcontent→stagingへ、記事のHTML・アセット一式を移動します。記事の実体は常にどちらか一方のフォルダにのみ存在します(移動方式であり複製ではありません)。

### `async remove(key)`

指定したkeyの記事を削除します(staging/contentどちらにあっても削除されます)。

### `async removeAll()`

登録されている記事を全件削除します。

### `async buildAll()`

DBに登録済みの情報を元に、記事HTML・nav・index・タグindexを一括で再生成します。テンプレートを修正した後の反映などに使います。

### `async genViewer()`

`possg genviewer`コマンド用です。アプリの`config.mjs`・`template/`・`customfunc.mjs`を読み込み、zipファイルまたはフォルダの記事をブラウザだけでドラッグ&ドロッププレビューできる自己完結HTML(`viewer.html`)を、アプリのルートディレクトリ直下に生成します。`init()`は不要です(DB接続やMarkdownIt初期化を行わないぶん軽量です)。詳細は「genviewer(記事プレビュー)」を参照してください。

## タグ機能

frontmatterの`meta.tags`(config.mjsの`frontmatter.meta.tags`で定義)にタグを指定すると、タグごとに絞り込まれたindexページが自動生成されます。

- 生成先: `contents/tags/<タグ名>/`、`staging/tags/<タグ名>/`(`config.mjs`の`TAGS_DIR`で変更可、デフォルト`"tags"`)
- staging側のタグindex・タグ一覧は下書き含む全記事を横断的に集計・表示します。content側は公開済み記事のみです
- 各indexページの説明文直後にタグ一覧(件数付き、選択中タグは強調表示)が表示されます。先頭には常に「全体」(全記事一覧に戻るリンク)が入ります
- 記事から使われなくなったタグのページは、次回の再生成時に自動的に削除されます
- `frontmatter.meta.tags`のスキーマ自体を定義していないアプリでは、タグ機能全体が無効化されます(タグ一覧・タグページとも一切生成されません)

## staging/release(下書き/公開)モデル

- 記事のHTML本体は、常にstaging・contentのどちらか一方にのみ物理的に存在します(`import`→staging生成、`publish`→content移動、`unpublish`→staging復帰。移動時は元フォルダの実体を削除します)
- 一方、**サイドバー(他の記事へのnav)・記事一覧(index)の表示内容は、stagingでは下書き＋公開済みを横断的に一覧できます**。公開済み記事がstaging側の一覧に現れても、そのリンク先は自動的にcontent側の実URLを指すため、記事ファイル自体が複製されることはありません

## シンタックスハイライト

コードフェンス(` ```言語名 `)で言語が明示されている場合のみ、ビルド時(サーバーサイド)にhighlight.jsで色付けされます。未指定・未対応言語の場合はプレーンな(無色の)コードとして出力されます。テーマはCSS側(`.hljs-*`クラス)で管理します。

## genviewer(記事プレビュー)

`possg genviewer`コマンドで生成される`viewer.html`は、`possg import`と同じzipファイルまたはフォルダの記事をドラッグ&ドロップするだけで、実際のテンプレート・CSSでレンダリングした結果をその場でプレビューできる単一の自己完結HTMLファイルです。Node.jsは不要で、ブラウザだけで動作します。

zipファイルの代わりにフォルダをドロップした場合、もう一つ利点があります。「リロード」を押すたびにディスク上のフォルダを毎回スキャンし直すため、`index.md`や画像を編集した内容がzip再圧縮・再ドロップ無しでそのまま反映されます(フォルダのドラッグ&ドロップはFile System Access APIに依存するため、「リロード」自体と同じくChromium系ブラウザ限定です)。

ただし、テンプレートがApacheのSSI(`<!--#include virtual="...">`)を使っている場合、`file:///`として直接開くとSSI部分だけ解決されません(詳細は後述)。SSIを使うテンプレートで完全に動作確認したい場合は、`viewer.html`をWebサーバでホスティングしてアクセスしてください。SSIを使わないテンプレートであれば`file:///`のままで問題ありません。

**customFunc.mjsによる拡張(アプリ固有の設定)**

テンプレートが外部のCDNライブラリ(jQuery/カルーセルライブラリ等)に依存している場合、`customfunc.mjs`に以下のメソッドを実装すると`genViewer()`実行時に自動的に呼び出されます。

```js
class customFunc {
  // ...

  // genViewer()実行時(Node側)に呼ばれる。CDN URLの配列を返す
  getViewerExternalScripts() {
    return ["https://cdn.jsdelivr.net/npm/some-lib/dist/lib.min.js"];
  }
  getViewerExternalStyles() {
    return ["https://cdn.jsdelivr.net/npm/some-lib/dist/lib.min.css"];
  }
}
```

テンプレートがApacheのSSI(`<!--#include virtual="/path/to/x.html">`)を使っている場合は、customFunc側の対応は不要です。`viewer.html`はテンプレート中の全SSIディレクティブを自動検出し、その仮想パスをそのまま`fetch()`して内容を解決します(Apache SSIの`virtual=`とブラウザの絶対パスfetchは解決方式が同じため)。**同一オリジンでホスティングした場合のみ機能し、`file:///`では解決されません**(fetch失敗時はエラーをコンソールに出力するのみで、記事本体のレンダリングは継続します)。

customFunc.mjsのクラス定義自体は`viewer.html`にも埋め込まれ、テンプレートレンダリング用の`func`としてブラウザ上でも使われます。そのため、これらのメソッドは**fs/path等のNode専用APIに依存させず、プレーンな値(配列)を返すだけ**にしてください。

**`possg genviewer -static`: SSIをビルド時に解決する**

`fetch()`によるSSI解決は`file:///`では原理的に動作しません(これはブラウザの`file://`スキームに対する制限であり、`fetch()`固有の問題ではありません。`XMLHttpRequest`に置き換えても解決しないことを確認済みです)。オフライン・`file:///`環境でも完全に自己完結したプレビューが必要な場合は、以下を実行します。

```
possg genviewer -static
```

これは`viewer.html`の代わりに、別ファイル`viewer-static.html`を生成します。SSIディレクティブをブラウザ側で都度解決する代わりに、`genViewer()`が生成時(Node側)に一度だけ解決し、その内容をテンプレートに直接埋め込みます。そのため、ブラウザ側のエンジンは`fetch()`する対象が最初から存在しない状態になります。

利用するには、`customfunc.mjs`に`getViewerSSIBaseUrl()`メソッドを追加し、SSIの`virtual=`パスを解決する基準となるoriginを返すようにします。

```js
class customFunc {
  // ...

  // genViewer({static:true})実行時(Node側)に呼ばれる。SSIのvirtual=を解決する基準URLを返す
  getViewerSSIBaseUrl() {
    return "https://your-real-site.example.com";
  }
}
```

このメソッドが未定義の場合や、個別のSSIインクルードのfetchに失敗した場合でも、`genviewer -static`自体は中断しません。エラーをコンソールに出力した上で、該当ディレクティブの文字列をそのまま`viewer-static.html`に埋め込みます(ランタイム版と同じgraceful degradation)。

トレードオフとして(名前の通り)、`viewer-static.html`はスナップショットです。SSIで参照している実際のコンテンツが後で更新されても、再度`possg genviewer -static`を実行するまで反映されません。SSIの内容を常に最新に保ちたい場合(かつホスティングできる場合)は通常の`viewer.html`を、`file:///`・オフラインで完全に動作させたい場合は`viewer-static.html`を使い分けてください。

## 主なconfig.mjsキー

| キー | 説明 |
|---|---|
| `WWW_DIR` / `CONTENT_DIR` / `STAGING_DIR` | 出力先ディレクトリ構成 |
| `TAGS_DIR` | タグ別indexの出力先フォルダ名(省略時`"tags"`) |
| `TEMPLATE_DIR` / `TEMPLATE_FILE_NAME` / `IDX_TEMPLATE_FILE_NAME` | テンプレートの場所とファイル名 |
| `CUSTOMFUNC_DIR` / `CUSTOMFUNC_FILE_NAME` | customfunc.mjsの場所 |
| `CONTENT_URL_BASE` / `STAGING_URL_BASE` | 公開/下書きページのURLベース |
| `ICON_URL` / `CSS_URL` / `JS_URL` | favicon・possg.css・possg.jsのURL(いずれも省略可。無い場合はテンプレート側で該当タグ自体が出力されません) |
| `frontmatter` | frontmatterのスキーマ定義(`core`は必須項目、`meta`は任意項目。`meta.tags`を定義するとタグ機能が有効になります) |
| `INDEX_PAGE_SIZE` | 記事一覧の1ページあたりの件数 |
| `THUMBNAIL` | サムネイル生成サイズ(`width`/`height`) |
| `RELEASE_FEATURE` | `false`にすると`publish()`が無効化されます |

## 依存ライブラリ

`fs-extra` / `unzipper` / `gray-matter` / `markdown-it` / `markdown-it-image-figures` / `highlight.js` / `ejs` / `sharp` / `@seald-io/nedb`

## ライセンス

MIT
