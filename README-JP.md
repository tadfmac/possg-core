# possg-core

[English](./README.md)

シンプルなBLOG向けSSGのCOREです。

## 特徴

- zipファイルまたはフォルダによる記事の入稿
- front matter付きmarkdownからHTMLを出力(EJSテンプレート)
- 軽量JSON DB([@seald-io/nedb](https://github.com/seald/nedb))を利用。特別なDBサーバ不要
- staging(下書き)/content(公開)の2状態管理
- frontmatterの`tags`によるタグ別indexページの自動生成
- 全記事一覧JSON(`alllist.json`)の自動生成(indexの再生成と同じタイミング)
- コードブロックのシンタックスハイライト(ビルド時、[highlight.js](https://highlightjs.org/))
- `possg genviewer`用: zipファイルまたはフォルダの記事をブラウザ単体でドラッグ&ドロッププレビューできるHTMLの生成
- `possg geneditor`用: 同じレンダリングエンジンによるライブプレビュー付きの自己完結型記事エディタの生成

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
- 実際に参照されているファイルだけが記事のアセットフォルダに取り込まれます。zip/フォルダ内にあっても参照されていないファイル(未使用の画像、`.DS_Store`等)は取り込まれません。「参照されている」とは、(1)front matterのYAML領域のどこかにそのファイル名が文字列値として書かれている(`images`のような特定のキーに限定せず、任意のキー・ネストしたオブジェクト・リストの中まで走査します)、または(2)markdown本文中のリンク・画像記法(`[text](file)` / `![alt](file)`、拡張子は問わずPDF等の非画像添付も対象)の参照先になっている、のいずれかです。markdown側の参照先がローカルファイルとして見つからない場合はimportを失敗させず、コンソール警告を出して該当ファイルをスキップします。一方、front matter中の文字列(タイトル・タグ・日付等)が実在ファイルと一致しない場合は、警告無しで単に取り込み対象外として扱われます。`http://`/`https://`/`data:`等の絶対URLはローカルファイルとして取り込み対象にしません
- markdown本文またはfrontmatterの`images`から最初の画像を検出し、`THUMBNAIL`設定のサイズでサムネイルを自動生成します
- `frontmatter.core`の項目は`title`/`datetime`に限らず全てDBに保存されます(`alllist.json`から参照されます)。記事に書かれていない任意項目は保存されません
- `frontmatter.core`の必須項目が欠けている・形式が不正な場合はimportが失敗します(エラーメッセージに対象の`index.md`を表示します)
- 同じkeyを再importしても旧ファイルが残りません。記事が以前存在していた実フォルダ(staging/contentのどちらか、旧年であっても)を新しいアセット書き込み前に完全に削除するため、新しい内容で参照されなくなった画像・サムネイルが残留することはなく、公開済み(release)だった記事を再importした場合も正しくクリーンなstagingフォルダへ差し戻されます

### `async publish(key, isRelease)`

記事の公開状態を切り替えます。`isRelease`が`true`ならstaging→content(公開)へ、`false`ならcontent→stagingへ、記事のHTML・アセット一式を移動します。記事の実体は常にどちらか一方のフォルダにのみ存在します(移動方式であり複製ではありません)。

### `async remove(key)`

指定したkeyの記事を削除します(staging/contentどちらにあっても削除されます)。

### `async removeAll()`

登録されている記事を全件削除します。

### `async buildAll()`

DBに登録済みの情報を元に、記事HTML・nav・index・タグindex・`alllist.json`を一括で再生成します。テンプレートを修正した後の反映などに使います。

### `async buildAllList({ isStaging })`

全記事の一覧JSON(`alllist.json`)を、`isStaging`が`true`ならstagingの、`false`ならcontentの直下に生成します。indexを再生成する処理(`import`/`publish`/`remove`/`removeAll`/`buildAll`)から両方が自動的に呼ばれるため、通常は個別に呼ぶ必要はありません。詳細は「記事一覧JSON(alllist.json)」を参照してください。

### `async genViewer()`

`possg genviewer`コマンド用です。アプリの`config.mjs`・`template/`・`customfunc.mjs`を読み込み、zipファイルまたはフォルダの記事をブラウザだけでドラッグ&ドロッププレビューできる自己完結HTML(`viewer.html`)を、アプリのルートディレクトリ直下に生成します。`init()`は不要です(DB接続やMarkdownIt初期化を行わないぶん軽量です)。詳細は「genviewer(記事プレビュー)」を参照してください。

### `async genEditor()`

`possg geneditor`コマンド用です。`genViewer()`とほぼ同じ準備処理(config/template/customFuncの読み込み、同じ`{static}`オプション)を共有しつつ、viewerの代わりに自己完結型の記事エディタ(`editor.html`)を生成します。こちらも`init()`は不要です。詳細は「geneditor(記事エディタ)」を参照してください。

## タグ機能

frontmatterの`meta.tags`(config.mjsの`frontmatter.meta.tags`で定義)にタグを指定すると、タグごとに絞り込まれたindexページが自動生成されます。

- 生成先: `contents/tags/<タグ名>/`、`staging/tags/<タグ名>/`(`config.mjs`の`TAGS_DIR`で変更可、デフォルト`"tags"`)
- staging側のタグindex・タグ一覧は下書き含む全記事を横断的に集計・表示します。content側は公開済み記事のみです
- 各indexページの説明文直後にタグ一覧(件数付き、選択中タグは強調表示)が表示されます。先頭には常に「全体」(全記事一覧に戻るリンク)が入ります
- 記事から使われなくなったタグのページは、次回の再生成時に自動的に削除されます
- `frontmatter.meta.tags`のスキーマ自体を定義していないアプリでは、タグ機能全体が無効化されます(タグ一覧・タグページとも一切生成されません)

## 記事一覧JSON(alllist.json)

indexページを再生成するタイミング(`import`/`publish`/`unpublish`/`remove`/`removeAll`/`buildAll`)で毎回、全記事の一覧をまとめたJSONをstaging・contentそれぞれの直下に生成します。HTMLを解析することなく記事一覧を取得できるため、クライアントサイド検索・アーカイブページ・他アプリからの参照などに利用できます。

- 生成先: `contents/alllist.json`、`staging/alllist.json`(`config.mjs`の`ALLLIST_FILE_NAME`で変更可、デフォルト`"alllist.json"`)
- 対象記事の範囲はindexページと同じで、staging側は下書き＋公開済みを横断、content側は公開済みのみです
- 記事は日時の降順(新しい順)に並びます
- 対象記事が0件の場合はファイルを生成しません(生成の有無に関わらず既存ファイルは削除してから作り直すため、古い一覧が残ることはありません)
- **`alllist.json`はindexページ・タグindexページのHTMLより先に生成されます。** そのためindexテンプレートから`customfunc.mjs`のメソッドを呼び、その中で`alllist.json`を読んでページを組み立てられます(常にその時点の最新の内容が読めます)

出力される項目は以下の通りです。

| フィールド | 内容 |
|---|---|
| `key` | 記事のDB key(importしたzipファイル名・フォルダ名) |
| `frontmatter.core`の全項目 | `title`/`datetime`等。記事に書かれていない任意項目は出力されません |
| `frontmatter.meta`のうち`listup: true`の項目 | 出力したいmeta項目のスキーマに`listup: true`を追加します(下記) |
| `link` | 記事のURL。記事自身のrelease状態で決まるため、staging側の一覧に載っている公開済み記事のリンク先はcontent側の実URLになります |
| `release` | 公開済みなら`true`、下書きなら`false` |

```js
"meta": {
  "tags": {
    "type": "array",
    "items": { "type": "string" },
    "required": false,
    "listup": true    // ← この項目をalllist.jsonに出力する
  }
}
```

出力例:

```json
{
  "count": 2,
  "items": [
    {
      "key": "20260126",
      "title": "たぬき表示テストです。",
      "datetime": "20260126 15:00",
      "tags": ["テスト", "たぬき"],
      "link": "/staging/2026/20260126/",
      "release": false
    }
  ]
}
```

- `key`/`link`/`release`はpossgが必ず出力する予約フィールドです。frontmatterに同名の項目を定義した場合、そちらは出力対象から除外されます(コンソールに警告を出します)
- `title`/`datetime`以外の`core`項目は、その記事を**importした時点**の値がDBに保存されます。後から`core`項目を追加した場合、既存記事の値は再importするまで`alllist.json`に現れません(`buildAll()`はDBの内容だけを使い、frontmatterの再解析は行いません)

### indexテンプレートから読む

indexテンプレート(`index-template.ejs`)には、読むべき`alllist.json`の絶対パスが変数`alllistPath`として渡されます。あわせて、そのページがstaging側かcontent側かを示す`isStaging`も渡されます。

- `alllistPath`は常にstaging・contentそれぞれの直下の`alllist.json`を指します。タグindexページの出力先は`tags/<タグ名>/`配下ですが、そこではなく**そのページが属する側のルート**のパスになります
- 対象記事が0件のときは`alllist.json`自体が存在しないため、読む前に存在チェックをしてください

```ejs
<%- func.renderArchive(alllistPath, isStaging) %>
```

`customfunc.mjs`のソースは`genviewer`/`geneditor`が生成するHTMLに**ファイル全体がそのまま埋め込まれ、ブラウザ上でも実行されます**(クラシックな`<script>`として)。そのため、indexテンプレートからしか呼ばないメソッドであっても、ファイルの先頭に`import fs from "fs"`のようなES Moduleのimport文を書くとブラウザ側で構文エラーになり、`customFunc`クラス自体が未定義になって`viewer.html`/`editor.html`が動かなくなります。import文を使わず、Node上でのみ`fs`を取得する形にしてください。

```js
// customfunc.mjs
const nodeFs = (typeof process !== "undefined" && process.getBuiltinModule)
  ? process.getBuiltinModule("node:fs") : null;   // ブラウザではnullになる

class customFunc {
  renderArchive(alllistPath, isStaging){
    if (!nodeFs) return "";                          // viewer/editor(ブラウザ)側では何もしない
    if (!nodeFs.existsSync(alllistPath)) return "";  // 記事0件のときはファイルが無い
    const alllist = JSON.parse(nodeFs.readFileSync(alllistPath, "utf8"));
    // ...alllistを使ってHTMLを組み立てる
  }
}
```

`process.getBuiltinModule()`はNode 20.16/22.3以降で使えます。

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

利用するには、`customfunc.mjs`に`getViewerSiteBaseUrl()`メソッドを追加し、実サイトの基準URLを返すようにします。

```js
class customFunc {
  // ...

  // genViewer()実行時(Node側)に、static指定の有無によらず毎回呼ばれる。実サイトの基準URLを返す
  getViewerSiteBaseUrl() {
    return "https://your-real-site.example.com";
  }
}
```

`getViewerSiteBaseUrl()`は2つの用途に使われます。SSIの`virtual=`パスの解決(ビルド時、`-static`限定)と、`viewer.html`/`viewer-static.html`どちらでも、レンダリング結果中のroot-relativeな`src`/`href`(例: `href="/css/site.css"`、`src="/images/logo.png"`、あるいはテンプレートが直接呼ぶ`func.getIconUrl()`/`func.getFaceUrl()`のようなcustomFuncメソッドが返す値)を、このoriginを付与した絶対URLに書き換える処理です。この書き換えはブラウザ側でレンダリング後に行われるため、SSIで取り込んだ内容由来か、customFuncメソッド呼び出し由来かを問わず、root-relativeなURLであれば拾えます。これが必要な理由は、`file:///`環境ではroot-relativeなパスは実サイトとは無関係なローカルファイルシステムのルートに対して解決されてしまうため、そのままではCSSや画像が読み込めなくなるからです(`//`始まりのprotocol-relativeなURLは書き換え対象外です)。

`getViewerSiteBaseUrl()`が未定義の場合や、個別のSSIインクルードのfetchに失敗した場合でも、`genviewer -static`自体は中断しません。エラーをコンソールに出力した上で、該当ディレクティブの文字列をそのまま`viewer-static.html`に埋め込みます(ランタイム版と同じgraceful degradation)。

トレードオフとして(名前の通り)、`viewer-static.html`はスナップショットです。SSIで参照している実際のコンテンツが後で更新されても、再度`possg genviewer -static`を実行するまで反映されません。SSIの内容を常に最新に保ちたい場合(かつホスティングできる場合)は通常の`viewer.html`を、`file:///`・オフラインで完全に動作させたい場合は`viewer-static.html`を使い分けてください。

## geneditor(記事エディタ)

```
possg geneditor [-static] [-title <title>]
```

`editor.html`(`-static`指定時は`editor-static.html`、SSI/root-relative URLのトレードオフは`genviewer -static`と同じ)を生成します。`genviewer`と同じレンダリングエンジンを使ったライブプレビュー付きの自己完結型記事エディタです。テキストエディタ本体には[CodeMirror 6](https://codemirror.net/)を採用しており(YAML frontmatter・Markdown本文をハイライトするカスタム`StreamLanguage`モード付き)、ビルド時に一度だけesbuildで`libs/codemirror.bundle.js`にバンドルしたもの(`npm run build:cm`)を、他のUMDアセットと同様に埋め込んでいます。実行時にビルドツールは不要で、`build-tools/cm-entry.mjs`を変更した場合のみバンドルの再生成が必要です。初期表示されるYAML frontmatterは、汎用の決め打ちテンプレートではなく、アプリの`frontmatter`スキーマ(core/meta各フィールド)から、型に応じたプレースホルダー付きで生成されます。「YAML画像リスト」パネル(`meta.images`が`{name, alt, ...}`形式のオブジェクト配列として定義されている場合)は、スキーマにその定義があれば追加設定無しで自動的に表示されます。`-title <title>` でページの`<title>`・ヘッダ表示テキストを差し替えられます(未指定時は`possg editor`/`possg editor (static)`)。

入力するたびに、実サイトと同じテンプレート・CSS・customFuncを使ってプレビューが再レンダリングされます。アップロードした画像(サイドバーのボタン、またはエディタ領域への直接ドラッグ&ドロップ)は`![name](name)`形式のMarkdownタグ(YAML画像の場合は`images:`エントリ)として挿入され、`genviewer`がドロップされた記事に使うのと同じ仕組み(Blob URL)で即座にプレビューに反映されます。

全てのアイコン(ヘッダのボタン・ドロップダウンメニュー項目・サイドバー一覧の各画像のトリミング/削除ボタン)は、[Material Design Icons](https://pictogrammers.com/library/mdi/)の単色SVGをインライン埋め込みしたもの(パスデータを生成時に埋め込むだけで、CDN等の実行時依存はありません)で、それぞれ背景色との明確なコントラストを確保する色で表示しています。

ヘッダ右側にはアイコンボタンが並んでいます(それぞれhoverでツールチップ表示)。左から順に: フォルダを開くアイコン(次に説明する既存記事の読み込み)、目のアイコン(プレビューの全画面表示に切り替え。エディタと画像リストのサイドバーを隠します。もう一度押すと編集画面に戻ります。切り替えた瞬間に必ず最新の内容で再レンダリングされます)、後述の名前を付けて保存/保存/ダウンロードのアイコン、そして一番右端に歯車アイコン(設定メニューを開き、「トリミングサイズ」(後述の画像トリミングツールの目標サイズ)と「テンプレート保存」(現在の内容を初期テンプレートとして保存、下記の記事保存とは別機能)を選べます)。保存系の操作は、ポップアップダイアログではなく画面下部に3秒間表示されて自動的に消える確認メッセージで結果を知らせます。

**既存記事の読み込み**: ヘッダのフォルダアイコンから、File System Access API経由でフォルダまたはZIPファイルを選ぶメニューを開けます。従来通り、`possg import`が受け付けるのと同じ形式のzipファイルまたはフォルダを、エディタ領域に直接ドラッグ&ドロップして読み込むこともできます。どちらの方法でも、本文とその画像(`meta.images`スキーマに基づきYAML画像/MD画像リストに自動振り分け)が自動的に反映され、プレビューも即座に更新されます。

**保存**:
- 「名前を付けて保存」を押すと、File System Access API(Chromium系ブラウザ限定)経由で保存先を選ぶ小さなメニューが開きます。「フォルダに保存」(`showDirectoryPicker`で選んだフォルダに`index.md`と画像を直接書き込み)、または「ZIPファイルとして保存」(`showSaveFilePicker`で選んだ場所に`.zip`を直接書き込み、ブラウザの自動ダウンロードフォルダを経由しません)のどちらかを選べます。新規作成の記事にも、既に編集中の記事(別の場所に複製保存したい場合など)にも使え、保存後はその場所から「読み込んだ」扱いになり、以後は「保存」ボタンで素早く再保存できます。
- 「保存」(記事がドラッグ&ドロップで読み込まれるか、「名前を付けて保存」で保存先が決まるまでは非表示)は、読み込んだ/保存したのと全く同じファイル・フォルダに、同じ形式(フォルダはフォルダのまま、zipはzipのまま)で上書き保存します(再ダウンロード&手動置き換えは不要です)。
- 「名前を付けて保存」・「保存」ともFile System Access APIに依存しており、**特定のファイル・フォルダに対して最初に書き込む際、書き込み許可を求めるブラウザのネイティブダイアログが一度だけ表示されます**(スキップや事前承認はできないため、必ず許可してください)。
- 「ZIPをダウンロード」は、保存先を選ばないシンプルな代替手段として引き続き利用できます(どのブラウザでも動作)。常にブラウザの標準ダウンロード先に`.zip`をダウンロードするだけで、保存先を記憶したり「保存」ボタンを有効化したりはしません。

フッタは常に「Generated by possg (c)2026 TripArts Music」固定表示です([possgのnpmパッケージページ](https://www.npmjs.com/package/possg)・[mz4u.net](https://mz4u.net)へそれぞれリンク)。これはツール自体のクレジット表示であり、アプリ側の`FOOTERTEXT`設定(`genviewer`が生成するサイト側ページでのみ使用)とは独立しています。

**画像トリミング(クロップ機能)**: YAML/MD画像リストの各項目には、ファイル名の前にトリミングアイコンがあります(削除アイコンとは離れた位置にあり、誤操作を防いでいます)。背景色でその画像のトリミング状態がひと目でわかります。**水色**はトリミング済み、または(未トリミングでも)元画像の実サイズが設定中のトリミングサイズと既に一致していることを示します。**赤色**は未トリミングかつサイズが一致していないことを示します。クリックすると、モーダルのフローティングウィンドウ(別タブ・別ウィンドウではありません)が開きます — `possg/tools/image-cropper/`と同じcanvas位置合わせロジックをベースにしており、トリミングサイズの縦横比に固定された枠の下に元画像を表示し、ドラッグで位置を調整できます。「決定」ボタンでトリミング画像を生成、「キャンセル」ボタンで破棄します。モーダル表示中は他の画像のトリミングアイコンをクリックしても何も起こりません(同時に開けるのは1つだけです)。歯車メニューの「トリミングサイズ」項目で、トリミングの目標幅・高さを設定できます(初期値は後述の`DEFAULT_TRIM`)。この設定値はブラウザ側にのみ保存され、`possg import`やアプリのconfig.mjs自体には一切影響しません。

トリミング後の画像は`<元のファイル名>-trim.<元の拡張子>`として保存されます(同名ファイルがあれば上書き)。出力形式は元の拡張子に合わせます(JPEGは透過非対応のため白背景で塗りつぶし、PNG/WebPは透過を保持します)。保存されるフォルダ・zipには元画像・トリミング画像の両方が含まれますが、これは意図した仕様です。トリミングが行われると、`index.md`(Markdownの画像タグ、またはYAMLの`images:`エントリの`name`)はトリミング後のファイル名を参照するように更新されますが、サイドバーの画像一覧には常に元のファイル名が表示されます。一覧から画像を削除すると、元画像・トリミング画像(存在する場合)の両方がワーク上・本文中の参照から削除されます。再トリミングは常に元画像から行われ、前回のトリミング結果からではありません — トリミング後もアイコンは水色のままクリック可能で、これは再トリミングをいつでもやり直せるようにするためです。

画像の削除アイコンをクリックすると、必ず確認ダイアログ(ネイティブのconfirmダイアログ)が表示されます。新規作成の記事の編集では問題になりませんが、既存のフォルダ・ZIPから読み込んだ記事を編集している場合、保存すると実際に元ファイルが失われることがあります(フォルダへの保存では削除した画像ファイルはそのまま残りますが参照が無くなり孤立します。読み込んだZIPへの上書き保存は内容を作り直すため、一覧から削除した画像はそのZIPからも無くなります)。ダイアログへの回答後は、他の操作と同様に画面下部に3秒間「削除しました」「削除をキャンセルしました」という確認メッセージが表示されます。

**言語**: インターフェースの初期値は英語です(`config.mjs`で`LANG`を`"JP"`に設定している場合を除く。設定項目は後述の一覧を参照)。歯車メニューの「Language」セクションから、この初期値に関わらずいつでも日本語に切り替えられます(元に戻すことも可能)。選択した言語はブラウザの`localStorage`に保存され、次回エディタを開いた際も同じ言語で開きます(記事データの一部ではなく、ブラウザ・プロファイルごとの設定です)。一度切り替えると、そのブラウザでは`config.mjs`の`LANG`より優先されます。アイコンボタンにマウスを乗せると、ブラウザ標準の`title`ツールチップ(OSレベルの遅延が避けられません)ではなく、即座に表示される独自のツールチップが表示されます。

## 主なconfig.mjsキー

| キー | 説明 |
|---|---|
| `WWW_DIR` / `CONTENT_DIR` / `STAGING_DIR` | 出力先ディレクトリ構成 |
| `TAGS_DIR` | タグ別indexの出力先フォルダ名(省略時`"tags"`) |
| `ALLLIST_FILE_NAME` | 全記事一覧JSONのファイル名(省略時`"alllist.json"`) |
| `TEMPLATE_DIR` / `TEMPLATE_FILE_NAME` / `IDX_TEMPLATE_FILE_NAME` | テンプレートの場所とファイル名 |
| `CUSTOMFUNC_DIR` / `CUSTOMFUNC_FILE_NAME` | customfunc.mjsの場所 |
| `CONTENT_URL_BASE` / `STAGING_URL_BASE` | 公開/下書きページのURLベース |
| `ICON_URL` / `CSS_URL` / `JS_URL` | favicon・possg.css・possg.jsのURL(いずれも省略可。無い場合はテンプレート側で該当タグ自体が出力されません) |
| `frontmatter` | frontmatterのスキーマ定義(`core`は必須項目、`meta`は任意項目。`meta.tags`を定義するとタグ機能が有効になります。`meta`の各項目に`listup: true`を付けると`alllist.json`に出力されます) |
| `INDEX_PAGE_SIZE` | 記事一覧の1ページあたりの件数 |
| `THUMBNAIL` | サムネイル生成サイズ(`width`/`height`) |
| `DEFAULT_TRIM` | geneditorの画像トリミングツールの初期クロップサイズ(`width`/`height`)。未設定・不正な場合は`1280`x`720`にフォールバック |
| `LANG` | geneditorのUI既定言語。`"JP"`で日本語、`"EN"`または未設定で英語。あくまで初期値の指定であり、訪問者が既に自分のブラウザで言語を切り替えている場合(`localStorage`に保存済み)は、そちらが優先されます |
| `RELEASE_FEATURE` | `false`にすると`publish()`が無効化されます |

## 依存ライブラリ

`fs-extra` / `unzipper` / `gray-matter` / `markdown-it` / `markdown-it-image-figures` / `highlight.js` / `ejs` / `sharp` / `@seald-io/nedb` / `js-yaml` / `jszip`

開発時のみ(`libs/codemirror.bundle.js`の生成専用で、実行時には不要): `codemirror` / `@codemirror/state` / `@codemirror/view` / `@codemirror/commands` / `@codemirror/language` / `@lezer/highlight` / `esbuild`

## ライセンス

MIT
