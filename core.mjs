// core.mjs
// possg core
// (C)2026 by D.F.Mac.@TripArts Music

const DBG = false;

import fs from "fs-extra";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import unzipper from "unzipper";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import markdownItImageFigures from "markdown-it-image-figures";
import hljs from "highlight.js";
import ejs from "ejs";
import sharp from "sharp";
import Datastore from "@seald-io/nedb";
import FmParser from "./libs/fmparser.mjs";

const CORE_DIR = path.dirname(fileURLToPath(import.meta.url));

// genViewer()がmarkdown-it等のUMDビルドを直接読むために使う。
// これらは"CORE_DIR/node_modules/<pkg>"に必ずあるとは限らない
// (npmのインストール状況によっては、possg本体側にホイストされることがある)。
// そのためNode本来のモジュール解決(import.meta.resolve)でパッケージの
// 実際のインストール場所を特定する(possg.mjsのgetVersions()と同じ手法)。
function resolvePackageRoot(pkgName) {
  const resolvedPath = fileURLToPath(import.meta.resolve(pkgName));
  const marker = path.sep + "node_modules" + path.sep + pkgName + path.sep;
  const idx = resolvedPath.lastIndexOf(marker);
  if (idx === -1) {
    throw new Error(`${pkgName}のインストール場所を特定できませんでした`);
  }
  return resolvedPath.slice(0, idx + marker.length - 1);
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// geneditorが使うlocalStorageキー(トリミングサイズ/テンプレート保存/言語設定)を
// アプリごとに分離するための名前空間文字列を、非暗号学的ハッシュ(FNV-1a)で作る。
// file://で開いた場合、異なるディレクトリのHTMLでも同一originとしてlocalStorageを
// 共有してしまうブラウザがあるため、genEditor()呼び出し元(アプリのルートパス)を
// 元にした短い識別子をキーに付与し、別アプリのeditor.html間で設定が混ざらないようにする。
function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

// YAMLのfrontmatterオブジェクトを再帰的に走査し、キー名を問わず全ての文字列値をoutに集める。
// (importでの「YAML領域のどこかにファイル名が書かれていれば取り込み対象にする」判定に使う)
function collectStringValues(value, out) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStringValues(v, out);
  } else if (value && typeof value === "object") {
    for (const v of Object.values(value)) collectStringValues(v, out);
  }
}

// 参照候補の文字列群から、ローカルファイルへの相対パスとみなせるものだけを正規化して返す。
// http(s)/data等の絶対URL・プロトコル相対URLは実体を持たないため除外する。
function normalizeLocalRefs(candidates) {
  const result = new Set();
  for (const ref of candidates) {
    if (!ref || typeof ref !== "string") continue;
    if (ref.startsWith("//")) continue; // プロトコル相対URL
    if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) continue; // http:, https:, data: 等の絶対URL
    let decoded = ref;
    try { decoded = decodeURIComponent(ref); } catch { /* 不正なエンコードはそのまま扱う */ }
    result.add(decoded.replace(/^\.\//, ""));
  }
  return result;
}

// geneditorのアイコンは絵文字ではなくMaterial Design Icons(MDI, https://pictogrammers.com/library/mdi/)の
// 単色SVGパスをインライン埋め込みで使用する(実行時のCDN依存を避けるため、ビルド時にパスデータのみ取得・埋め込み)。
// fillはcurrentColorとし、各ボタンのCSS color値(背景とのコントラストを考慮して個別設定)に追従させる。
function mdiIcon(pathD) {
  return `<svg class="mdi-icon" viewBox="0 0 24 24"><path d="${pathD}"/></svg>`;
}
const MDI_PATHS = {
  cog: "M12,15.5A3.5,3.5 0 0,1 8.5,12A3.5,3.5 0 0,1 12,8.5A3.5,3.5 0 0,1 15.5,12A3.5,3.5 0 0,1 12,15.5M19.43,12.97C19.47,12.65 19.5,12.33 19.5,12C19.5,11.67 19.47,11.34 19.43,11L21.54,9.37C21.73,9.22 21.78,8.95 21.66,8.73L19.66,5.27C19.54,5.05 19.27,4.96 19.05,5.05L16.56,6.05C16.04,5.66 15.5,5.32 14.87,5.07L14.5,2.42C14.46,2.18 14.25,2 14,2H10C9.75,2 9.54,2.18 9.5,2.42L9.13,5.07C8.5,5.32 7.96,5.66 7.44,6.05L4.95,5.05C4.73,4.96 4.46,5.05 4.34,5.27L2.34,8.73C2.21,8.95 2.27,9.22 2.46,9.37L4.57,11C4.53,11.34 4.5,11.67 4.5,12C4.5,12.33 4.53,12.65 4.57,12.97L2.46,14.63C2.27,14.78 2.21,15.05 2.34,15.27L4.34,18.73C4.46,18.95 4.73,19.03 4.95,18.95L7.44,17.94C7.96,18.34 8.5,18.68 9.13,18.93L9.5,21.58C9.54,21.82 9.75,22 10,22H14C14.25,22 14.46,21.82 14.5,21.58L14.87,18.93C15.5,18.67 16.04,18.34 16.56,17.94L19.05,18.95C19.27,19.03 19.54,18.95 19.66,18.73L21.66,15.27C21.78,15.05 21.73,14.78 21.54,14.63L19.43,12.97Z",
  eye: "M12,9A3,3 0 0,0 9,12A3,3 0 0,0 12,15A3,3 0 0,0 15,12A3,3 0 0,0 12,9M12,17A5,5 0 0,1 7,12A5,5 0 0,1 12,7A5,5 0 0,1 17,12A5,5 0 0,1 12,17M12,4.5C7,4.5 2.73,7.61 1,12C2.73,16.39 7,19.5 12,19.5C17,19.5 21.27,16.39 23,12C21.27,7.61 17,4.5 12,4.5Z",
  contentSaveMove: "M17,3H5A2,2 0 0,0 3,5V19A2,2 0 0,0 5,21H11.81C11.42,20.34 11.17,19.6 11.07,18.84C9.5,18.31 8.66,16.6 9.2,15.03C9.61,13.83 10.73,13 12,13C12.44,13 12.88,13.1 13.28,13.29C15.57,11.5 18.83,11.59 21,13.54V7L17,3M15,9H5V5H15V9M13,17H17V14L22,18.5L17,23V20H13V17",
  contentSave: "M15,9H5V5H15M12,19A3,3 0 0,1 9,16A3,3 0 0,1 12,13A3,3 0 0,1 15,16A3,3 0 0,1 12,19M17,3H5C3.89,3 3,3.9 3,5V19A2,2 0 0,0 5,21H19A2,2 0 0,0 21,19V7L17,3Z",
  download: "M5,20H19V18H5M19,9H15V3H9V9H5L12,16L19,9Z",
  rulerSquare: "M3,5V21H9V19.5H7V18H9V16.5H5V15H9V13.5H7V12H9V10.5H5V9H9V5H10.5V9H12V7H13.5V9H15V5H16.5V9H18V7H19.5V9H21V3H5A2,2 0 0,0 3,5M6,7A1,1 0 0,1 5,6A1,1 0 0,1 6,5A1,1 0 0,1 7,6A1,1 0 0,1 6,7Z",
  pin: "M16,12V4H17V2H7V4H8V12L6,14V16H11.2V22H12.8V16H18V14L16,12Z",
  folder: "M10,4H4C2.89,4 2,4.89 2,6V18A2,2 0 0,0 4,20H20A2,2 0 0,0 22,18V8C22,6.89 21.1,6 20,6H12L10,4Z",
  folderZip: "M20 6H12L10 4H4C2.9 4 2 4.9 2 6V18C2 19.1 2.9 20 4 20H20C21.1 20 22 19.1 22 18V8C22 6.9 21.1 6 20 6M18 12H16V14H18V16H16V18H14V16H16V14H14V12H16V10H14V8H16V10H18V12Z",
  folderOpen: "M19,20H4C2.89,20 2,19.1 2,18V6C2,4.89 2.89,4 4,4H10L12,6H19A2,2 0 0,1 21,8H21L4,8V18L6.14,10H23.21L20.93,18.5C20.7,19.37 19.92,20 19,20Z",
  crop: "M7,17V1H5V5H1V7H5V17A2,2 0 0,0 7,19H17V23H19V19H23V17M17,15H19V7C19,5.89 18.1,5 17,5H9V7H17V15Z",
  delete: "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z",
  upload: "M9,16V10H5L12,3L19,10H15V16H9M5,20V18H19V20H5Z"
};

// alllist.jsonの各エントリでpossgが必ず出力するフィールド名。frontmatterのcore/metaに
// 同名のキーが定義されていた場合、そちらは出力対象から除外する(possg側の値が常に優先)
const ALLLIST_RESERVED_KEYS = new Set(["key", "link", "release"]);

function escapeScriptClose(str) {
  return str
    .replace(/<\/script/gi, "<\\/script")
    // テンプレート由来の静的HTMLがApacheのmod_include(SSI)によって
    // ディレクティブと誤認識されないよう、生バイト列としては
    // "<!--#" が出現しないようにする(JS文字列としては#が"#"に
    // 解決されるため、レンダリング結果は変化しない)
    .replace(/<!--#/g, "<!--\\u0023");
}

class PossgCore{
  constructor(config){
    if(DBG) console.log("PossgCore.constructor()");
    this.ROOT = process.cwd();
    if(DBG) console.log("ROOT = "+this.ROOT);
    this.WWW_ROOT = path.join(this.ROOT, config.WWW_DIR); //WWW_DIR = "www"
    if(DBG) console.log("WWW_ROOT = "+this.WWW_ROOT);
    this.CONTENT_ROOT = path.join(this.WWW_ROOT,config.CONTENT_DIR); // CONTENT_DIR = "contents"
    if(DBG) console.log("CONTENT_ROOT = "+this.CONTENT_ROOT);
    this.STAGING_ROOT = path.join(this.WWW_ROOT,config.STAGING_DIR); // STAGING_DIR = "staging"
    if(DBG) console.log("STAGING_ROOT = "+this.STAGING_ROOT);
    this.TAGS_DIR = config.TAGS_DIR ?? "tags"; // TAGS_DIR = "tags"
    if(DBG) console.log("TAGS_DIR = "+this.TAGS_DIR);
    this.ALLLIST_FILE_NAME = config.ALLLIST_FILE_NAME ?? "alllist.json"; // ALLLIST_FILE_NAME = "alllist.json"
    if(DBG) console.log("ALLLIST_FILE_NAME = "+this.ALLLIST_FILE_NAME);
    this.TMP_PATH = path.join(this.ROOT,config.TMP_DIR); // TMP_DIR = ".tmp"
    if(DBG) console.log("TMP_PATH = "+this.TMP_PATH);
    this.DB_ROOT = path.join(this.ROOT,config.DB_DIR); // DB_DIR = "db"
    if(DBG) console.log("DB_ROOT = "+this.DB_ROOT);
    this.DB_PATH = path.join(this.DB_ROOT,config.DB_FILE_NAME); // DB_FILE_NAME = "articles.db"
    if(DBG) console.log("DB_PATH = "+this.DB_PATH);
    this.STAGING_URL_BASE = config.STAGING_URL_BASE; // STAGING_URL_BASE = "/staging"
    if(DBG) console.log("STAGING_URL_BASE = "+this.STAGING_URL_BASE);
    this.CONTENT_URL_BASE = config.CONTENT_URL_BASE; // CONTENT_URL_BASE = ""
    if(DBG) console.log("CONTENT_URL_BASE = "+this.CONTENT_URL_BASE);
    this.TEMPLATE_ROOT = path.join(this.ROOT,config.TEMPLATE_DIR) // TEMPLATE_DIR = "template"
    if(DBG) console.log("TEMPLATE_ROOT = "+this.TEMPLATE_ROOT);
    this.TEMPLATE_PATH = path.join(this.TEMPLATE_ROOT,config.TEMPLATE_FILE_NAME); // TEMPLATE_FILE_NAME = "content-template.ejs"
    if(DBG) console.log("TEMPLATE_PATH = "+this.TEMPLATE_PATH);
    this.IDX_TEMPLATE_PATH = path.join(this.TEMPLATE_ROOT,config.IDX_TEMPLATE_FILE_NAME); // IDX_TEMPLATE_FILE_NAME = "index-template.ejs"
    if(DBG) console.log("IDX_TEMPLATE_PATH = "+this.IDX_TEMPLATE_PATH);
    this.CUSTOMFUNC_ROOT = path.join(this.ROOT,config.CUSTOMFUNC_DIR) // CUSTOMFUNC_DIR = "customfunc"
    if(DBG) console.log("CUSTOMFUNC_ROOT = "+this.CUSTOMFUNC_ROOT);
    this.CUSTOMFUNC_PATH = path.join(this.CUSTOMFUNC_ROOT,config.CUSTOMFUNC_FILE_NAME); // CUSTOMFUNC_FILE_NAME = "customfunc.mjs"
    if(DBG) console.log("CUSTOMFUNC_PATH = "+this.CUSTOMFUNC_PATH);
    this.fmParser = new FmParser(config.frontmatter);
    this.GA_ID = config.GA_ID;
    if(DBG) console.log("GA_ID = "+this.GA_ID);
    this.BLOGTITLE = config.BLOGTITLE;
    if(DBG) console.log("BLOGTITLE = "+this.BLOGTITLE);
    this.FOOTERTEXT = config.FOOTERTEXT;
    if(DBG) console.log("FOOTERTEXT = "+this.FOOTERTEXT);
    this.BLOGDESC = config.BLOGDESC;
    if(DBG) console.log("BLOGDESC = "+this.BLOGDESC);
    this.INDEX_PAGE_SIZE = config.INDEX_PAGE_SIZE;
    if(DBG) console.log("INDEX_PAGE_SIZE = "+this.INDEX_PAGE_SIZE);
    this.ICON_URL = config.ICON_URL;
    if(DBG) console.log("ICON_URL = "+this.ICON_URL);
    this.CSS_URL = config.CSS_URL;
    if(DBG) console.log("CSS_URL = "+this.CSS_URL);
    this.JS_URL = config.JS_URL;
    if(DBG) console.log("JS_URL = "+this.JS_URL);
    this.RETURN_URL = config.RETURN_URL;
    if(DBG) console.log("RETURN_URL = "+this.RETURN_URL);
    this.RETURN_TEXT = config.RETURN_TEXT;
    if(DBG) console.log("RETURN_TEXT = "+this.RETURN_TEXT);
    this.THUMBNAIL = config.THUMBNAIL;
    if(DBG) console.log("THUMBNAIL.width = "+this.THUMBNAIL.width+" height = "+this.THUMBNAIL.height);
    this.DEFAULT_TRIM = this.#normalizeDefaultTrim(config.DEFAULT_TRIM);
    if(DBG) console.log("DEFAULT_TRIM.width = "+this.DEFAULT_TRIM.width+" height = "+this.DEFAULT_TRIM.height);
    this.LANG = this.#normalizeLang(config.LANG);
    if(DBG) console.log("LANG = "+this.LANG);
    this.RELEASE_FEATURE = config.RELEASE_FEATURE;
    if(DBG) console.log("RELEASE_FEATURE = "+this.RELEASE_FEATURE);
  }
  async init(){
    if(DBG) console.log("PossgCore.init()");
    await fs.ensureDir(this.DB_ROOT);
    this.db = new Datastore({ filename: this.DB_PATH, autoload: true });
    this.md = new MarkdownIt({
      html: true,
      highlight: function (str, lang) {
        if (lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(str, { language: lang }).value;
          } catch (__) {}
        }
        return "";
      }
    })
      .use(markdownItImageFigures, {figcaption: true,copyAttrs: true});;
    const { default: customFunc } = await import(this.CUSTOMFUNC_PATH);
    this.customfunc = new customFunc();
  }
  async import(sourcePath){
    if(DBG) console.log("PossgCore.import() sourcePath = "+sourcePath);
    if (!sourcePath) throw new Error("zip or folder required");

    const stat = await fs.stat(sourcePath);
    const isDirectory = stat.isDirectory();
    const key = isDirectory
      ? path.basename(path.resolve(sourcePath))
      : path.basename(sourcePath, ".zip");

    await fs.remove(this.TMP_PATH);
    await fs.ensureDir(this.TMP_PATH);
    if (isDirectory) {
      await fs.copy(sourcePath, path.join(this.TMP_PATH, key));
    } else {
      await fs.createReadStream(sourcePath)
        .pipe(unzipper.Extract({ path: this.TMP_PATH }))
        .promise();
    }

    const mdPath = path.join(this.TMP_PATH, key, "index.md");
    const raw = await fs.readFile(mdPath, "utf8");
    const parsed = matter(raw);

    const coreData = this.fmParser.parseCore(parsed.data);
    const meta = this.fmParser.parseMeta(parsed.data);

    // parseCore()はfrontmatter.coreの必須項目が欠けているとnullを返す
    if (!coreData) {
      throw new Error(`front matter of required field is missing or invalid: ${key}/index.md`);
    }

    const { datetime } = coreData;
    const body = parsed.content.trim();
    const year = datetime.slice(0, 4);

    // 再import時に旧フォルダの資産(画像・旧HTML)が残らないよう、上書き前に
    // 既存レコードの物理的な所在(staging/contentどちらか、旧年)を控えておく
    const existing = await new Promise(r =>
      this.db.findOne({ _id: key }, (_, d) => r(d))
    );

    // DB upsert
    // coreはtitle/datetimeに限らず、設定された項目を全てそのまま保存する
    // (alllist.jsonがcore全項目を列挙できるようにするため)。
    // _id/meta/body/releaseはpossg側の予約フィールドなので、coreに同名の項目が
    // 定義されていても上書きされないよう後置する
    await new Promise((res, rej) =>
      this.db.update(
        { _id: key },
        { $set: { ...coreData, _id: key, meta, body, release: false } },
        { upsert: true },
        e => (e ? rej(e) : res())
      )
    );

    if (existing) {
      const oldYear = existing.datetime.slice(0, 4);
      const oldRoot = existing.release ? this.CONTENT_ROOT : this.STAGING_ROOT;
      await fs.remove(path.join(oldRoot, oldYear, key));
      await this.#removeDirIfEmpty(path.join(oldRoot, oldYear));
      // importは常にstagingへ戻すため、旧年が違う・旧release=trueだった場合は
      // 消えた記事の隣接記事のnavを作り直す必要がある(旧年=新年かつ旧release=false
      // の通常の再importは、この後の通常フローのrebuildNavAroundで賄える)
      if (existing.release || oldYear !== year) {
        await this.rebuildNavAround({ year: oldYear, isStaging: !existing.release });
      }
    }

    // assets: YAML領域(frontmatter全体、特定のキーに限定しない)またはmarkdown本文の
    // リンク・画像記法で参照されているファイルだけを取り込む(拡張子は問わない)。
    // 参照されていないファイルはzip/フォルダ内にあってもコピーしない
    const base = path.join(this.STAGING_ROOT, year, key);
    await fs.ensureDir(base);
    const sourceDir = path.join(this.TMP_PATH, key);
    const referencedAssets = await this.#collectReferencedAssets({ frontmatter: parsed.data, body, sourceDir });
    for (const rel of referencedAssets) {
      const src = path.join(sourceDir, rel);
      if (!(await fs.pathExists(src))) {
        console.error(`import: referenced asset not found, skipped: ${rel}`);
        continue;
      }
      const dest = path.join(base, rel);
      await fs.ensureDir(path.dirname(dest));
      await fs.copy(src, dest);
    }

    // 画像候補取得
    const image = this.#getIndexImage({ meta, body });

    let thumbnail = null;
    if (image && !image.startsWith("http")) {
      const generated = await this.#generateThumbnail(base, image);
      if (generated) {
        thumbnail = "thumbnail.jpg";
      }
    }

    await new Promise((res, rej) =>
      this.db.update(
        { _id: key },
        { $set: { thumbnail } },
        {},
        e => (e ? rej(e) : res())
      )
    );

    await this.renderArticle({ key, isStaging: true });
    await this.rebuildNavAround({year,isStaging: true,});
    await this.rebuildIndexes();
    await fs.remove(this.TMP_PATH);
  }

  async renderArticle({ key, isStaging }) {
    if(DBG) console.log("PossgCore.renderArticle() key = "+key+" isStaging = "+isStaging);
    const article = await new Promise(r =>
      this.db.findOne({ _id: key }, (_, d) => r(d))
    );
    const articles = await new Promise(r =>
      this.db.find(isStaging ? {} : { release: true },(_, d) => r(d))
    );

    const nav = this.buildNav({ articles, current: article, isStaging });
    const html = await ejs.renderFile(this.TEMPLATE_PATH,
      {
        iconurl:this.ICON_URL,
        cssurl:this.CSS_URL,
        jsurl:this.JS_URL,
        returnurl:this.RETURN_URL,
        returntext:this.RETURN_TEXT,
        blogtitle:this.BLOGTITLE,
        toplink: (isStaging)? this.STAGING_URL_BASE : this.CONTENT_URL_BASE,
        footertext:this.FOOTERTEXT,
        title: article.title,
        datetime: this.#formatDateTime(article.datetime),
        meta:article.meta,
        content: this.md.render(article.body),
        currentId: key,
        gaid:this.GA_ID,
        nav,
        func:this.customfunc
      }
    );

    const root = isStaging ? this.STAGING_ROOT : this.CONTENT_ROOT;
    const out = `${root}/${article.datetime.slice(0, 4)}/${key}`;
    await fs.ensureDir(out);
    await fs.writeFile(`${out}/index.html`, html);
  }
  #formatMMDD(datetime) {
    const ymd = datetime.split(" ")[0]; // "20260118"
    const mm = ymd.slice(4, 6);         // "01"
    const dd = ymd.slice(6, 8);         // "18"
    return `${mm}/${dd}`;
  }
　#formatDateTime(datetime) {
    const [date, time] = datetime.split(" ");
    const y = date.slice(0, 4);
    const m = date.slice(4, 6);
    const d = date.slice(6, 8);
    return `${y}/${m}/${d} ${time}`;
  }
  #plainTextFromMd(md, maxLength = 200) {
    if (!md) return "";

    let text = md;
    text = text.replace(/```[\s\S]*?```/g, "");
    text = text.replace(/`[^`]*`/g, "");
    text = text.replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1");
    text = text.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    text = text.replace(/[#>*_~\-]+/g, "");
    text = text.replace(/\s+/g, " ").trim();
    if (text.length > maxLength) {
      text = text.slice(0, maxLength)+"…";
    }
    return text;
  }
  // YAML領域(frontmatter全体)とmarkdown本文中のリンク・画像記法から、importで
  // 実際に取り込むべきローカルファイルの参照名を収集する(拡張子は問わない)。
  // - YAML側は特定のキー名(images等)に限定せず全ての文字列値を候補にし、
  //   実際にsourceDir配下に存在するファイルと一致するものだけを採用する
  //   (title/datetime/tagsのような非ファイル参照の文字列は、この実在チェックで
  //   自然に除外される)
  // - markdown側は`[text](url)`/`![alt](url)`両方の記法をリンク先ごと収集する
  //   (存在しない場合は呼び出し側で警告してスキップする対象として、そのまま返す)
  async #collectReferencedAssets({ frontmatter, body, sourceDir }) {
    const yamlCandidates = [];
    collectStringValues(frontmatter, yamlCandidates);
    const fromYaml = new Set();
    for (const ref of normalizeLocalRefs(yamlCandidates)) {
      if (await fs.pathExists(path.join(sourceDir, ref))) {
        fromYaml.add(ref);
      }
    }

    const mdCandidates = [];
    if (body) {
      const re = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
      let m;
      while ((m = re.exec(body)) !== null) {
        mdCandidates.push(m[1]);
      }
    }
    const fromMarkdown = normalizeLocalRefs(mdCandidates);

    return new Set([...fromYaml, ...fromMarkdown]);
  }
  #getIndexImage(article) {
    if (!article) return null;

    // 1. frontmatter images
    if (
      article.meta &&
      Array.isArray(article.meta.images) &&
      article.meta.images.length > 0 &&
      article.meta.images[0].name
    ) {
      return article.meta.images[0].name;
    }
    // 2. markdown の最初の ![alt](url)
    if (article.body) {
//      const match = article.body.match(/!\[[^\]]*\]\(([^)]+)\)/);
      const match = article.body.match(/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/);
      if (match && match[1]) {
        return match[1];
      }
    }
    // 3. なし
    return null;
  }
  #getIndexImageUrl(article) {
    if (!article.thumbnail) return null;

    const baseUrl = article.release
      ? this.CONTENT_URL_BASE
      : this.STAGING_URL_BASE;

    const year = article.datetime.slice(0, 4);

    return `${baseUrl}/${year}/${article._id}/${article.thumbnail}`;
  }
  async #generateThumbnail(articleDir, imageName) {
    const inputPath = path.join(articleDir, imageName);
    const outputPath = path.join(articleDir, "thumbnail.jpg");

    if (!await fs.pathExists(inputPath)) return false;

    await sharp(inputPath)
      .rotate()
      .resize(this.THUMBNAIL.width, this.THUMBNAIL.height, {
        fit: "cover",
        position: "center"
      }).jpeg({ quality: 80 }).toFile(outputPath);

    return true;
  }
  buildNav({ articles, current, isStaging }) {
    if (DBG) console.log("PossgCore.buildNav()");

    const year = current.datetime.slice(0, 4);

    const byYear = {};
    for (const a of articles) {
      const y = a.datetime.slice(0, 4);
      byYear[y] ??= [];
      byYear[y].push(a);
    }

    for (const list of Object.values(byYear)) {
      list.sort((a, b) => b.datetime.localeCompare(a.datetime));
    }

    const years = Object.keys(byYear).sort((a, b) => Number(b) - Number(a));
    const idx = years.indexOf(year); // -1 の可能性あり

    const base = isStaging ? this.STAGING_URL_BASE : this.CONTENT_URL_BASE;

    const currentYearArticles = (byYear[year] ?? []).map(a => {
      const linkBase = a.release
        ? this.CONTENT_URL_BASE
        : this.STAGING_URL_BASE;

      return {
        id: a._id,
        title: a.title,
        date: this.#formatMMDD(a.datetime),
        link: `${linkBase}/${year}/${a._id}/`,
      };
    });

    const prevYear =
      idx > 0 && byYear[years[idx - 1]]?.length
        ? {
            year: years[idx - 1],
            link: `${base}/${years[idx - 1]}/${byYear[years[idx - 1]].at(-1)._id}/`,
          }
        : null;

    const nextYear =
      idx !== -1 && idx < years.length - 1 && byYear[years[idx + 1]]?.length
        ? {
            year: years[idx + 1],
            link: `${base}/${years[idx + 1]}/${byYear[years[idx + 1]][0]._id}/`,
          }
        : null;

    return {
      currentYear: year,
      currentYearArticles,
      prevYear,
      nextYear,
    };
  }
  
  async rebuildNavAround({ year, isStaging }) {
    if(DBG) console.log("PossgCore.rebuildNavAround() year = "+year+" isStaging = "+isStaging);
    const query = isStaging ? { release: false } : { release: true };

    const articles = await new Promise((resolve) => {
      this.db.find(query, (_, d) => {
        resolve(d);
      });
    });

    const years = new Set([
      year,
      String(Number(year) - 1),
      String(Number(year) + 1),
    ]);

    const targets = articles.filter(a =>
      years.has(a.datetime.slice(0, 4))
    );

    for (const a of targets) {
      await this.renderArticle({
        key: a._id,
        isStaging,
      });
    }
  }
  async #removeDirIfEmpty(dir) {
    try {
      const files = await fs.readdir(dir);
      const visibleFiles = files.filter(name => !name.startsWith("."));

      if (visibleFiles.length === 0) {
        await fs.remove(dir);
        return true;
      }
    } catch {
    }
    return false;
  }
  async #copyAssets(srcDir, destDir) {
    try {
      const files = await fs.readdir(srcDir);
      for (const file of files) {
        if (file === "index.html") continue;
        await fs.copy(path.join(srcDir,file),path.join(destDir,file),{overwrite:true});
      }
    } catch (err) {
    }
  }
  async publish(key,isRelease){
    if(DBG) console.log("PossgCore.publish() key = "+key+" isRelease = "+isRelease);
    if(!this.RELEASE_FEATURE){
      console.error("publish is aborted due to config.RELEASE_FEATURE is false!");
      return;
    }
    const article = await new Promise((resolve) =>{
      this.db.findOne({ _id: key }, (_, d) => {
        resolve(d);
      });
    });
    if (!article) throw "not found";
    await new Promise((resolve) => {
      this.db.update({ _id: key }, { $set: { release:isRelease } }, {}, ()=>{
        resolve();
      })
    });
    const year = article.datetime.slice(0, 4);
    const stagingDir = path.join(this.STAGING_ROOT, year, key);
    const contentDir = path.join(this.CONTENT_ROOT, year, key);

    if (isRelease) {
      await fs.ensureDir(contentDir);
      await this.#copyAssets(stagingDir, contentDir);
      await this.renderArticle({ key, isStaging: false });
      await fs.remove(stagingDir);
      await this.#removeDirIfEmpty(path.join(this.STAGING_ROOT,year));
    } else {
      await fs.ensureDir(stagingDir);
      await this.#copyAssets(contentDir, stagingDir);
      await this.renderArticle({ key, isStaging: true });
      await fs.remove(contentDir);
      await this.#removeDirIfEmpty(path.join(this.CONTENT_ROOT,year));
    }
    await this.rebuildNavAround({ year, isStaging: false });
    await this.rebuildNavAround({ year, isStaging: true });
    await this.rebuildIndexes();
  }
  async removeAll() {
    if(DBG) console.log("PossgCore.removeAll()");
    await new Promise((resolve, reject) => {
      this.db.remove({}, { multi: true }, (err) => {
        (err)? reject(err) : resolve();
      });
    });
    await fs.remove(this.CONTENT_ROOT);
    await fs.remove(this.STAGING_ROOT);
    await this.rebuildIndexes();
  }
  async remove(key){
    if(DBG) console.log("PossgCore.remove() key = "+key);
    if (!key) {
      throw new Error("key is required");
    }
    const article = await new Promise((resolve) => {
      this.db.findOne({ _id: key }, (_, d) => {
        resolve(d);
      });
    });

    if (!article) {
      throw new Error(`article not found: ${key}`);
    }

    const year = article.datetime.slice(0, 4);
    await new Promise((resolve, reject) =>{
      this.db.remove({ _id: key }, {}, (err) => {
        (err)? reject(err) : resolve();
      });
    });

    await fs.remove(path.join(this.CONTENT_ROOT, year, key));
    await fs.remove(path.join(this.STAGING_ROOT, year, key));
    await this.#removeDirIfEmpty(path.join(this.CONTENT_ROOT, year));
    await this.#removeDirIfEmpty(path.join(this.STAGING_ROOT, year));
    await this.rebuildNavAround({ year, isStaging: true });
    await this.rebuildNavAround({ year, isStaging: false });
    await this.rebuildIndexes();

    return {key,title: article.title,year};
  }
  async buildAll() {
    if(DBG) console.log("PossgCore.buildAll()");
    const articles = await new Promise((resolve) => {
      this.db.find({}, (_, docs) => {
        resolve(docs);
      });
    });

    const years = new Set(
      articles.map((a) => a.datetime.slice(0, 4))
    );

    for (const article of articles) {
      if (article.release) continue;
      await this.renderArticle({key: article._id,isStaging: true});
    }

    for (const article of articles) {
      if (!article.release) continue;
      await this.renderArticle({key: article._id,isStaging: false});
    }

    for (const year of years) {
      await this.rebuildNavAround({ year, isStaging: true });
      await this.rebuildNavAround({ year, isStaging: false });
    }
    await this.rebuildIndexes();
  }
  async #loadCustomFuncForViewer() {
    if (!(await fs.pathExists(this.CUSTOMFUNC_PATH))) return null;
    try {
      const { default: CustomFuncClass } = await import(pathToFileURL(this.CUSTOMFUNC_PATH).href);
      return new CustomFuncClass();
    } catch (err) {
      console.error(`genViewer: customfunc.mjsの読み込みに失敗しました: ${err.message}`);
      return null;
    }
  }
  #callViewerHook(instance, methodName, fallback) {
    if (instance && typeof instance[methodName] === "function") {
      try {
        return instance[methodName]();
      } catch (err) {
        console.error(`genViewer: customFunc.${methodName}()の呼び出しでエラー: ${err.message}`);
      }
    }
    return fallback;
  }
  // genviewer -static 用。SSI(<!--#include virtual="X"-->)をビルド時に
  // fetch()で解決し、テンプレート文字列中に直接埋め込む。ブラウザ側の
  // resolveSSIIncludesViaFetch()は埋め込み済みHTMLに対しては何もしない
  // (ディレクティブが残っていないため)ので、viewer-runtime.js側の変更は不要。
  // baseUrlはvirtualPathの絶対パス解決の基準になるだけで、末尾のパスは無視される。
  async #resolveSSIIncludesAtBuildTime(templateSource, baseUrl) {
    const directiveRe = /<!--#include\s+virtual=["']([^"']+)["']\s*-->/g;
    const virtualPaths = new Set();
    let m;
    while ((m = directiveRe.exec(templateSource)) !== null) {
      virtualPaths.add(m[1]);
    }
    if (virtualPaths.size === 0) return templateSource;

    let result = templateSource;
    let failedCount = 0;
    for (const virtualPath of virtualPaths) {
      try {
        const url = new URL(virtualPath, baseUrl).href;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const includeContent = await res.text();
        const escapedVirtualPath = virtualPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`<!--#include\\s+virtual=["']${escapedVirtualPath}["']\\s*-->`, "g");
        result = result.replace(re, includeContent);
      } catch (err) {
        failedCount++;
        console.error(`genviewer -static: SSIインクルードの解決に失敗しました(${virtualPath}): ${err.message}`);
      }
    }
    if (failedCount > 0) {
      console.error(`genviewer -static: ${failedCount}件のSSIインクルードが未解決のまま埋め込まれました(viewer-static.htmlにディレクティブ文字列がそのまま残ります)`);
    }
    return result;
  }
  // geneditor用。frontmatterスキーマ(this.fmParser.setting)から、
  // core/meta各キーの型に応じたプレースホルダYAMLを1フィールド分生成する。
  #yamlPlaceholderLine(key, rule, indent) {
    const pad = "  ".repeat(indent);
    if (!rule) return `${pad}${key}: `;
    switch (rule.type) {
      case "string":
        return `${pad}${key}: ""`;
      case "datetime":
        return `${pad}${key}: "20260101 00:00"`;
      case "array": {
        if (rule.items && rule.items.type === "object") {
          const props = Object.entries(rule.items.properties || {});
          if (props.length === 0) return `${pad}${key}:\n${pad}  - `;
          const sub = props.map(([k, r], i) => {
            const line = this.#yamlPlaceholderLine(k, r, 0).trim();
            return (i === 0 ? `${pad}  - ` : `${pad}    `) + line;
          }).join("\n");
          return `${pad}${key}:\n${sub}`;
        }
        return `${pad}${key}:\n${pad}  - ""`;
      }
      case "object": {
        const props = Object.entries(rule.properties || {});
        const sub = props.map(([k, r]) => this.#yamlPlaceholderLine(k, r, indent + 1)).join("\n");
        return `${pad}${key}:\n${sub}`;
      }
      default:
        return `${pad}${key}: `;
    }
  }
  // frontmatterスキーマ全体(core+meta)から、possg import可能なindex.mdの
  // ひな形(frontmatter+本文)を生成する。geneditor起動直後の初期表示に使う。
  #buildDefaultArticleText() {
    const setting = this.fmParser.setting;
    const lines = ["---"];
    for (const [key, rule] of Object.entries(setting.core || {})) {
      lines.push(this.#yamlPlaceholderLine(key, rule, 0));
    }
    for (const [key, rule] of Object.entries(setting.meta || {})) {
      lines.push(this.#yamlPlaceholderLine(key, rule, 0));
    }
    lines.push("---");
    lines.push("");
    lines.push("記事の本文をここに書きます。");
    return lines.join("\n");
  }
  // genViewer()/genEditor()共通の組み立て処理。customFuncフックの呼び出し、
  // SSIのビルド時解決(static時)、EJSコンパイル、埋め込み用UMDビルド類の読み込みを行う。
  async #assembleEmbeddedScripts({ static: isStatic }) {
    const customFuncInstance = await this.#loadCustomFuncForViewer();
    const viewerExternalScripts = this.#callViewerHook(customFuncInstance, "getViewerExternalScripts", []);
    const viewerExternalStyles = this.#callViewerHook(customFuncInstance, "getViewerExternalStyles", []);
    // root-relativeなURL(SSIの内容だけでなく、テンプレートがfunc.getIconUrl()等
    // customFunc呼び出しで返すURLも含む)を絶対URL化するための基準。後者は記事を
    // ドロップした閲覧時(ブラウザ側)に初めて評価されるため、この値はビルド時に
    // 使うSSI解決以外に、viewerConfig経由でブラウザ側にも渡す(static/非staticともに)。
    const siteBaseUrl = this.#callViewerHook(customFuncInstance, "getViewerSiteBaseUrl", null);

    let templateSource = await fs.readFile(this.TEMPLATE_PATH, "utf8");

    if (isStatic) {
      // 通常はSSIをビルド時ではなくブラウザ側でfetch()して都度解決する
      // (renderer.jsのresolveSSIIncludesViaFetch()、file:///では動作しない)。
      // -staticはその逆で、ビルド時に解決して埋め込む代わりに、以後SSI参照先が
      // 更新されても追従しない(再度 -static での再生成が必要)というトレードオフを持つ。
      if (siteBaseUrl) {
        templateSource = await this.#resolveSSIIncludesAtBuildTime(templateSource, siteBaseUrl);
      } else if (/<!--#include\s+virtual=/.test(templateSource)) {
        console.error("-static: テンプレートにSSIディレクティブがありますが、customFunc.getViewerSiteBaseUrl()が未設定のため解決できません(ディレクティブ文字列がそのまま埋め込まれます)");
      }
    }

    const compiledFnSrc = ejs.compile(templateSource, { client: true }).toString();

    const cssPath = path.join(this.TEMPLATE_ROOT, "possg.css");
    const jsAssetPath = path.join(this.TEMPLATE_ROOT, "possg.js");
    const cssText = (await fs.pathExists(cssPath)) ? await fs.readFile(cssPath, "utf8") : "";
    const jsAssetText = (await fs.pathExists(jsAssetPath)) ? await fs.readFile(jsAssetPath, "utf8") : "";

    const fmParserSrc = (await fs.readFile(path.join(CORE_DIR, "libs", "fmparser.mjs"), "utf8"))
      .replace(/export default \w+;\s*$/, "");
    const customFuncSrc = (await fs.pathExists(this.CUSTOMFUNC_PATH))
      ? (await fs.readFile(this.CUSTOMFUNC_PATH, "utf8")).replace(/export default \w+;\s*$/, "")
      : "class customFunc {}";
    const rendererSrc = await fs.readFile(path.join(CORE_DIR, "libs", "renderer.js"), "utf8");

    const markdownItSrc = await fs.readFile(path.join(resolvePackageRoot("markdown-it"), "dist", "markdown-it.js"), "utf8");
    const imageFiguresSrc = await fs.readFile(path.join(resolvePackageRoot("markdown-it-image-figures"), "dist", "markdown-it-images-figures.umd.js"), "utf8");
    const jsYamlSrc = await fs.readFile(path.join(resolvePackageRoot("js-yaml"), "dist", "js-yaml.min.js"), "utf8");

    const viewerConfig = {
      iconurl: this.ICON_URL,
      returnurl: this.RETURN_URL,
      returntext: this.RETURN_TEXT,
      blogtitle: this.BLOGTITLE,
      footertext: this.FOOTERTEXT,
      contentUrlBase: this.CONTENT_URL_BASE,
      frontmatter: this.fmParser.setting,
      externalScripts: viewerExternalScripts,
      externalStyles: viewerExternalStyles,
      siteBaseUrl: siteBaseUrl
    };

    return {
      compiledFnSrc, cssText, jsAssetText, fmParserSrc, customFuncSrc,
      rendererSrc, markdownItSrc, imageFiguresSrc, jsYamlSrc, viewerConfig
    };
  }
  async genViewer({ static: isStatic = false } = {}) {
    if(DBG) console.log("PossgCore.genViewer() isStatic = "+isStatic);

    const a = await this.#assembleEmbeddedScripts({ static: isStatic });
    const viewerRuntimeSrc = await fs.readFile(path.join(CORE_DIR, "libs", "viewer-runtime.js"), "utf8");

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>possg viewer${isStatic ? " (static)" : ""}</title>
<style>
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; height: 100%; font-family: sans-serif; }
#app { display: flex; height: 100vh; }
#dropArea {
  width: 80px;
  flex-shrink: 0;
  background: #fafafa;
  border-right: 1px solid #ddd;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 8px;
  text-align: center;
  font-size: 11px;
}
#dropArea.dragover { background: #e0f0ff; }
#reloadBtn { width: 100%; padding: 6px 2px; font-size: 11px; cursor: pointer; }
#status { font-size: 10px; color: #666; word-break: break-all; }
#previewPane { flex: 1; height: 100%; }
#preview { width: 100%; height: 100%; border: none; display: block; }
</style>
</head>
<body>
<div id="app">
  <div id="dropArea">
    <div>ここにzip<br>またはフォルダを<br>ドラッグ&amp;ドロップ</div>
    <button id="reloadBtn" type="button">リロード</button>
    <div id="status"></div>
  </div>
  <div id="previewPane">
    <iframe id="preview"></iframe>
  </div>
</div>
<script>
window.__VIEWER_CONFIG__ = ${escapeScriptClose(JSON.stringify(a.viewerConfig))};
window.__VIEWER_CSS_TEXT__ = ${escapeScriptClose(JSON.stringify(a.cssText))};
window.__VIEWER_JS_TEXT__ = ${escapeScriptClose(JSON.stringify(a.jsAssetText))};
</script>
<script>
${escapeScriptClose(a.fmParserSrc)}
</script>
<script>
${escapeScriptClose(a.customFuncSrc)}
</script>
<script>
${escapeScriptClose(a.markdownItSrc)}
</script>
<script>
${escapeScriptClose(a.imageFiguresSrc)}
</script>
<script>
${escapeScriptClose(a.jsYamlSrc)}
</script>
<script>
window.__VIEWER_TEMPLATE_FN__ = ${escapeScriptClose(a.compiledFnSrc)};
</script>
<script>
${escapeScriptClose(a.rendererSrc)}
</script>
<script>
${escapeScriptClose(viewerRuntimeSrc)}
</script>
</body>
</html>
`;

    const outPath = path.join(this.ROOT, isStatic ? "viewer-static.html" : "viewer.html");
    await fs.writeFile(outPath, html);
    return outPath;
  }
  // frontmatter.meta.imagesがname付きオブジェクト配列として定義されている場合のみ、
  // editor.htmlの「YAML画像リスト」パネルを有効化する(possg-core側で既に
  // サムネイル自動検出等に使われているmeta.imagesの規約に合わせる)
  #hasYamlImageField() {
    const imagesRule = this.fmParser?.setting?.meta?.images;
    return Boolean(
      imagesRule &&
      imagesRule.type === "array" &&
      imagesRule.items?.type === "object" &&
      imagesRule.items.properties?.name
    );
  }
  // geneditorの画像トリミングサイズ初期値。config.mjsにDEFAULT_TRIMが
  // 正しく設定されていない場合は1280x720にフォールバックする
  #normalizeDefaultTrim(trim) {
    const isPositiveNumber = (v) => typeof v === "number" && isFinite(v) && v > 0;
    if (trim && isPositiveNumber(trim.width) && isPositiveNumber(trim.height)) {
      return { width: trim.width, height: trim.height };
    }
    return { width: 1280, height: 720 };
  }
  // geneditorのUI既定言語。config.mjsのLANGが"JP"(大小文字不問)なら日本語、
  // "EN"または未定義・その他の値の場合は英語にフォールバックする。
  // ブラウザ側でユーザーが個別に切り替えた言語(localStorage)はこれより優先される。
  #normalizeLang(lang) {
    return (typeof lang === "string" && lang.toUpperCase() === "JP") ? "ja" : "en";
  }
  async genEditor({ static: isStatic = false, title } = {}) {
    if(DBG) console.log("PossgCore.genEditor() isStatic = "+isStatic);

    const a = await this.#assembleEmbeddedScripts({ static: isStatic });
    const editorRuntimeSrc = await fs.readFile(path.join(CORE_DIR, "libs", "editor-runtime.js"), "utf8");

    const codemirrorBundleSrc = await fs.readFile(path.join(CORE_DIR, "libs", "codemirror.bundle.js"), "utf8");
    const jszipSrc = await fs.readFile(path.join(resolvePackageRoot("jszip"), "dist", "jszip.min.js"), "utf8");

    const editorConfig = {
      defaultContent: this.#buildDefaultArticleText(),
      yamlImageEnabled: this.#hasYamlImageField(),
      defaultTrim: this.DEFAULT_TRIM,
      defaultLang: this.LANG,
      appNamespace: hashString(this.ROOT)
    };

    const pageTitle = title ? title : `possg editor${isStatic ? " (static)" : ""}`;

    const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<title>${escapeHtml(pageTitle)}</title>
<style>
body, html { margin: 0; padding: 0; height: 100%; background: #FFFFFF; color: #ccc; overflow: hidden; }
body { display: flex; flex-direction: column; }

header {
    flex-shrink: 0; box-sizing: border-box; min-height: 45px; background: #FFCCAA; color: #000000; display: flex;
    align-items: center; justify-content: space-between; padding: 0 20px;
    font-size: 16px; font-weight: bold; border-bottom: 1px solid #444;
    box-shadow: 0 2px 5px rgba(0,0,0,0.3); z-index: 100;
}

.header-actions { display: flex; align-items: center; gap: 6px; }
.icon-btn {
    width: 32px; height: 32px; padding: 0; box-sizing: border-box;
    background: #FFF; border: 1px solid #666; color: #000;
    font-size: 16px; line-height: 1; cursor: pointer; border-radius: 4px;
    display: inline-flex; align-items: center; justify-content: center;
}
.icon-btn:hover { background: #555; color: #fff; }
.icon-btn.active { background: #333; color: #fff; border-color: #333; }

.mdi-icon { display: block; width: 18px; height: 18px; fill: currentColor; flex-shrink: 0; }

/* ネイティブtitle属性はOS/ブラウザ側の固定表示遅延があり速くできないため使わず、
   data-tooltip属性+CSSの疑似要素による自前ツールチップにして遅延なしで表示する */
[data-tooltip] { position: relative; }
[data-tooltip]::after {
    content: attr(data-tooltip);
    position: absolute; top: 100%; right: 0; margin-top: 6px;
    background: #222; color: #fff; font-size: 11px; font-weight: normal;
    padding: 4px 8px; border-radius: 4px; white-space: nowrap;
    box-shadow: 0 2px 6px rgba(0,0,0,0.3); z-index: 300;
    opacity: 0; visibility: hidden; pointer-events: none;
}
[data-tooltip]:hover::after { opacity: 1; visibility: visible; }

.dropdown-wrap { position: relative; }
.dropdown-menu {
    position: absolute; top: 38px; right: 0; z-index: 200;
    background: #FFF; border: 1px solid #666; border-radius: 4px;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3); display: flex; flex-direction: column;
    min-width: 190px; overflow: hidden;
}
.dropdown-item {
    display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; text-align: left;
    padding: 8px 12px; background: #FFF; border: none; border-bottom: 1px solid #eee;
    color: #000; font-size: 13px; cursor: pointer;
}
.dropdown-item:last-child { border-bottom: none; }
.dropdown-item:hover { background: #eee; }

.dropdown-lang-section { padding: 8px 12px; border-top: 1px solid #eee; }
.dropdown-lang-label { font-size: 11px; color: #666; margin-bottom: 6px; }
.dropdown-lang-options { display: flex; gap: 6px; }
.lang-option-btn {
    flex: 1; padding: 5px 0; border: 1px solid #999; border-radius: 4px;
    background: #FFF; color: #000; font-size: 12px; cursor: pointer;
}
.lang-option-btn.active { background: #333; color: #fff; border-color: #333; }

.dropdown-form { padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.dropdown-form label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; color: #333; }
.dropdown-form input[type="number"] { font-size: 13px; padding: 4px 6px; box-sizing: border-box; border: 1px solid #999; border-radius: 3px; }
.dropdown-form-actions { display: flex; gap: 6px; margin-top: 2px; }
.dropdown-form-actions .btn { flex: 1; }

.container { position: relative; display: flex; flex-direction: column; flex: 1; min-height: 0; }
.main-content { display: flex; flex: 1; overflow: hidden; flex-direction: row; }
#editor { flex: 1; min-width: 0; overflow: hidden; }
#editor .cm-editor { height: 100%; }
#previewPane { flex: 1; min-width: 0; border-left: 1px solid #333; }
#preview { width: 100%; height: 100%; border: none; display: block; background: #fff; }

.sidebar { width: 260px; flex-shrink: 0; background: #252526; border-left: 1px solid #333; display: flex; flex-direction: column; padding: 10px; box-sizing: border-box; }
.pane { flex: 1; display: flex; flex-direction: column; min-height: 0; margin-bottom: 15px; }
.pane:last-child { margin-bottom: 0; }

.pane h3 { font-size: 13px; margin: 0 0 8px 0; color: #9cdcfe; border-bottom: 1px solid #333; padding-bottom: 4px; }
.file-list { flex: 1; overflow-y: auto; list-style: none; padding: 0; margin: 0; background: #1e1e1e; border-radius: 4px; }
.file-item { display: flex; justify-content: space-between; align-items: center; background: #37373d; padding: 6px 8px; margin: 4px; border-radius: 3px; font-size: 11px; }
.file-item span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; margin-right: 5px; }

.btn { height: 32px; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 11px; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
.del-btn { background: #e81123; padding: 2px 6px; }
.upload-trigger { background: #4a4a4a; margin-bottom: 5px; width: 100%; }
.btn-primary { background: #4a4a4a; }
.btn-secondary { background: #999; }
.trim-btn { padding: 2px 6px; margin-right: 4px; }
/* 背景色との明確なコントラストを確保するため、明るい背景(trim-ok/trim-pending)は
   濃色アイコン、暗い背景(trim-needed)は白アイコンにする */
.trim-btn.trim-ok { background: #4fc3f7; color: #000; }
.trim-btn.trim-needed { background: #e81123; color: #fff; }
.trim-btn.trim-pending { background: #999; color: #000; }
.trim-btn .mdi-icon, .del-btn .mdi-icon { width: 14px; height: 14px; }

#save-btn { display: none; }
#load-save-status { display: none; position: absolute; bottom: 22px; left: 0; right: 0; text-align: center; font-size: 11px; color: #444; background: rgba(255,255,255,0.9); padding: 2px 0; }

.cm-zenkaku-space { box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1); }
.cm-yaml-sep, .cm-yaml-list-marker { color: #c586c0 !important; font-weight: bold; }
.cm-yaml-key { color: #9cdcfe !important; }
.cm-yaml-val-str { color: #ce9178 !important; }
.cm-md-header { color: #569cd6 !important; font-weight: bold; }
.cm-md-list { color: #b5cea8 !important; }
.cm-md-link-text { color: #ce9178 !important; }
.cm-md-link-url { color: #4ec9b0 !important; text-decoration: underline; }

footer {
  color:#666; font-size:12px; height:20px; line-height: 20px;
  vertical-align: middle; text-align: center; background-color:#FFCCAA;
}
footer a { color: inherit; text-decoration: underline; }

.hidden { display: none !important; }

/* ---------- 画像トリミング用モーダル(フローティングウィンドウ) ---------- */
.trim-modal-overlay {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 500;
    display: flex; align-items: center; justify-content: center;
}
.trim-modal {
    background: #252526; border-radius: 6px; box-shadow: 0 4px 24px rgba(0,0,0,0.6);
    padding: 16px; display: flex; flex-direction: column; gap: 12px;
}
.trim-modal-header { color: #fff; font-weight: bold; font-size: 14px; }
.trim-canvas-wrap { background: #111; border-radius: 4px; overflow: hidden; line-height: 0; }
.trim-canvas-wrap canvas { display: block; cursor: grab; }
.trim-canvas-wrap canvas.grabbing { cursor: grabbing; }
.trim-modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
.trim-modal-actions .btn { min-width: 120px; padding: 10px 24px; font-size: 13px; white-space: nowrap; }

@media screen and (max-width: 1024px) {
    .main-content { flex-direction: column; }
    #previewPane { border-left: none; border-top: 1px solid #333; min-height: 300px; }
    .sidebar { width: 100%; height: 300px; border-left: none; border-top: 1px solid #333; }
}
</style>
</head>
<body>

<header>
    <span>${escapeHtml(pageTitle)}</span>
    <div class="header-actions">
        <div class="dropdown-wrap">
            <button id="load-btn" class="icon-btn" data-tooltip-i18n="loadBtnTitle" data-tooltip="Load existing article (folder/ZIP)">${mdiIcon(MDI_PATHS.folderOpen)}</button>
            <div id="load-menu" class="dropdown-menu hidden">
                <button id="load-folder-btn" class="dropdown-item">${mdiIcon(MDI_PATHS.folder)}<span data-i18n="loadFolder">Load from folder</span></button>
                <button id="load-zip-btn" class="dropdown-item">${mdiIcon(MDI_PATHS.folderZip)}<span data-i18n="loadZip">Load from ZIP file</span></button>
            </div>
        </div>
        <button id="toggle-preview-btn" class="icon-btn" data-tooltip-i18n="togglePreviewTitle" data-tooltip="Toggle full-screen preview">${mdiIcon(MDI_PATHS.eye)}</button>
        <div class="dropdown-wrap">
            <button id="save-as-btn" class="icon-btn" data-tooltip-i18n="saveAsBtnTitle" data-tooltip="Save As (choose destination)">${mdiIcon(MDI_PATHS.contentSaveMove)}</button>
            <div id="save-as-menu" class="dropdown-menu hidden">
                <button id="save-as-folder-btn" class="dropdown-item">${mdiIcon(MDI_PATHS.folder)}<span data-i18n="saveAsFolder">Save to folder</span></button>
                <button id="save-as-zip-btn" class="dropdown-item">${mdiIcon(MDI_PATHS.folderZip)}<span data-i18n="saveAsZip">Save as ZIP file</span></button>
            </div>
        </div>
        <button id="save-btn" class="icon-btn" data-tooltip-i18n="saveBtnTitle" data-tooltip="Save (overwrite source)">${mdiIcon(MDI_PATHS.contentSave)}</button>
        <button id="download-btn" class="icon-btn" data-tooltip-i18n="downloadBtnTitle" data-tooltip="Download ZIP">${mdiIcon(MDI_PATHS.download)}</button>
        <div class="dropdown-wrap">
            <button id="settings-btn" class="icon-btn" data-tooltip-i18n="settingsBtnTitle" data-tooltip="Settings">${mdiIcon(MDI_PATHS.cog)}</button>
            <div id="settings-menu" class="dropdown-menu hidden">
                <div id="settings-menu-list">
                    <button id="trim-size-item" class="dropdown-item">${mdiIcon(MDI_PATHS.rulerSquare)}<span data-i18n="menuTrimSize">Trim size</span></button>
                    <button id="save-template-item" class="dropdown-item">${mdiIcon(MDI_PATHS.pin)}<span data-i18n="menuSaveTemplate">Save template</span></button>
                    <div class="dropdown-lang-section">
                        <div class="dropdown-lang-label" data-i18n="menuLanguage">Language</div>
                        <div class="dropdown-lang-options">
                            <button class="lang-option-btn" data-lang="en">English</button>
                            <button class="lang-option-btn" data-lang="ja">日本語</button>
                        </div>
                    </div>
                </div>
                <div id="trim-size-form" class="dropdown-form hidden">
                    <label><span data-i18n="trimWidthLabel">Width (px)</span><input type="number" id="trim-width-input" min="1" step="1"></label>
                    <label><span data-i18n="trimHeightLabel">Height (px)</span><input type="number" id="trim-height-input" min="1" step="1"></label>
                    <div class="dropdown-form-actions">
                        <button id="trim-size-save-btn" class="btn upload-trigger" data-i18n="trimSizeSaveBtn">Save</button>
                        <button id="trim-size-cancel-btn" class="btn btn-secondary" data-i18n="trimSizeCancelBtn">Back</button>
                    </div>
                </div>
            </div>
        </div>
    </div>
</header>

<div class="container">
    <div class="main-content">
        <div id="editor"></div>
        <div id="previewPane" class="hidden">
            <iframe id="preview"></iframe>
        </div>

        <div class="sidebar">
            <div class="pane" id="yaml-pane">
                <h3 data-i18n="yamlPaneTitle">YAML Images</h3>
                <input type="file" id="yaml-image-input" accept="image/*" multiple style="display:none">
                <button id="yaml-upload-btn" class="btn upload-trigger">${mdiIcon(MDI_PATHS.upload)}<span data-i18n="yamlUploadBtn">Select YAML Image</span></button>
                <ul id="yaml-file-list" class="file-list"></ul>
            </div>
            <div class="pane" id="md-pane">
                <h3 data-i18n="mdPaneTitle">Markdown Images</h3>
                <input type="file" id="md-image-input" accept="image/*" multiple style="display:none">
                <button id="md-upload-btn" class="btn upload-trigger">${mdiIcon(MDI_PATHS.upload)}<span data-i18n="mdUploadBtn">Select MD Image</span></button>
                <ul id="md-file-list" class="file-list"></ul>
            </div>
        </div>
    </div>
    <div id="load-save-status"></div>
    <footer>Generated by <a href="https://www.npmjs.com/package/possg" target="_blank" rel="noopener">possg</a> (c)2026 <a href="https://mz4u.net" target="_blank" rel="noopener">TripArts Music</a></footer>
</div>

<div id="trim-modal-overlay" class="trim-modal-overlay hidden">
    <div class="trim-modal">
        <div class="trim-modal-header" data-i18n="trimModalTitle">Image Trim</div>
        <div id="trim-canvas-wrap" class="trim-canvas-wrap">
            <canvas id="trim-canvas"></canvas>
        </div>
        <div class="trim-modal-actions">
            <button id="trim-confirm-btn" class="btn btn-primary" data-i18n="trimConfirmBtn">OK</button>
            <button id="trim-cancel-btn" class="btn btn-secondary" data-i18n="trimCancelBtn">Cancel</button>
        </div>
    </div>
</div>

<script>
window.__VIEWER_CONFIG__ = ${escapeScriptClose(JSON.stringify(a.viewerConfig))};
window.__VIEWER_CSS_TEXT__ = ${escapeScriptClose(JSON.stringify(a.cssText))};
window.__VIEWER_JS_TEXT__ = ${escapeScriptClose(JSON.stringify(a.jsAssetText))};
window.__EDITOR_CONFIG__ = ${escapeScriptClose(JSON.stringify(editorConfig))};
</script>
<script>
${escapeScriptClose(a.fmParserSrc)}
</script>
<script>
${escapeScriptClose(a.customFuncSrc)}
</script>
<script>
${escapeScriptClose(a.markdownItSrc)}
</script>
<script>
${escapeScriptClose(a.imageFiguresSrc)}
</script>
<script>
${escapeScriptClose(a.jsYamlSrc)}
</script>
<script>
window.__VIEWER_TEMPLATE_FN__ = ${escapeScriptClose(a.compiledFnSrc)};
</script>
<script>
${escapeScriptClose(a.rendererSrc)}
</script>
<script>
${escapeScriptClose(jszipSrc)}
</script>
<script>
${escapeScriptClose(codemirrorBundleSrc)}
</script>
<script>
${escapeScriptClose(editorRuntimeSrc)}
</script>
</body>
</html>
`;

    const outPath = path.join(this.ROOT, isStatic ? "editor-static.html" : "editor.html");
    await fs.writeFile(outPath, html);
    return outPath;
  }
  async rebuildIndexes() {
    if(DBG) console.log("PossgCore.rebuildIndexes()");
    await this.#cleanIndexPages(this.STAGING_ROOT);
    await this.#cleanIndexPages(this.CONTENT_ROOT);
    await fs.remove(path.join(this.STAGING_ROOT, this.TAGS_DIR));
    await fs.remove(path.join(this.CONTENT_ROOT, this.TAGS_DIR));
    await this.buildIndex({ isStaging: true });
    await this.buildIndex({ isStaging: false });
    if (this.#tagsEnabled()) {
      await this.buildTagIndexes({ isStaging: true });
      await this.buildTagIndexes({ isStaging: false });
    }
    await this.buildAllList({ isStaging: true });
    await this.buildAllList({ isStaging: false });
  }
  // alllist.jsonに出力するfrontmatter項目名を、config.mjsのスキーマから決める。
  // coreは全項目、metaは`listup: true`の項目のみが対象。possgが必ず出力する
  // 予約フィールド(key/link/release)と衝突する定義は警告して除外する
  #collectAllListKeys() {
    const setting = this.fmParser?.setting ?? {};
    const coreKeys = [];
    const metaKeys = [];
    for (const key of Object.keys(setting.core ?? {})) {
      if (ALLLIST_RESERVED_KEYS.has(key)) {
        console.error(`alllist: skip reserved key in frontmatter.core: ${key}`);
        continue;
      }
      coreKeys.push(key);
    }
    for (const [key, rule] of Object.entries(setting.meta ?? {})) {
      if (!rule?.listup) continue;
      if (ALLLIST_RESERVED_KEYS.has(key)) {
        console.error(`alllist: skip reserved key in frontmatter.meta: ${key}`);
        continue;
      }
      metaKeys.push(key);
    }
    return { coreKeys, metaKeys };
  }
  #buildAllListItem(article, { coreKeys, metaKeys }) {
    const item = { key: article._id };
    for (const key of coreKeys) {
      if (article[key] !== undefined) item[key] = article[key];
    }
    for (const key of metaKeys) {
      const value = article.meta?.[key];
      if (value !== undefined) item[key] = value;
    }
    // 記事の実体は常にstaging/contentのどちらか一方にしか無いため、リンク先は
    // 出力先ではなくその記事自身のrelease状態で決める(index/navと同じ規則)
    const linkBase = article.release ? this.CONTENT_URL_BASE : this.STAGING_URL_BASE;
    item.link = `${linkBase}/${article.datetime.slice(0, 4)}/${article._id}/`;
    item.release = Boolean(article.release);
    return item;
  }
  // 記事一覧(全件)のJSONを、staging/contentそれぞれの直下に生成する。
  // 記事が0件の場合はファイル自体を生成しない(古い内容が残らないよう、
  // 生成の有無に関わらず既存ファイルは常に削除してから作り直す)
  async buildAllList({ isStaging }) {
    if(DBG) console.log("PossgCore.buildAllList() isStaging = "+isStaging);
    const query = isStaging ? {} : { release: true };

    const articles = await new Promise(resolve => {
      this.db.find(query, (_, docs) => resolve(docs));
    });

    const outDir = (isStaging)? this.STAGING_ROOT : this.CONTENT_ROOT;
    const outPath = path.join(outDir, this.ALLLIST_FILE_NAME);
    await fs.remove(outPath);

    const keys = this.#collectAllListKeys();
    const items = articles
      .filter(a => a.datetime)
      .sort((a, b) => b.datetime.localeCompare(a.datetime))
      .map(a => this.#buildAllListItem(a, keys));

    if (items.length === 0) return null;

    await fs.ensureDir(outDir);
    await fs.writeFile(outPath, JSON.stringify({ count: items.length, items }, null, 2));
    return outPath;
  }
  #tagsEnabled() {
    return Boolean(this.fmParser?.setting?.meta?.tags);
  }
  async #cleanIndexPages(outDir) {
    try {
      const files = await fs.readdir(outDir);
      const targets = files.filter(
        name => name === "index.html" || /^index-\d+\.html$/.test(name)
      );
      for (const file of targets) {
        await fs.remove(path.join(outDir, file));
      }
    } catch {
      // outDir が存在しない場合は無視
    }
  }
  #collectTags(articles, isStaging) {
    if (!this.#tagsEnabled()) return [];
    const baseUrl = isStaging ? this.STAGING_URL_BASE : this.CONTENT_URL_BASE;
    const counts = {};
    for (const a of articles) {
      for (const rawTag of (a.meta?.tags ?? [])) {
        const tag = String(rawTag).trim();
        if (!tag || tag.includes("/") || tag.includes("\\")) {
          console.error(`skip unsafe tag: ${JSON.stringify(rawTag)}`);
          continue;
        }
        counts[tag] = (counts[tag] ?? 0) + 1;
      }
    }
    const tagList = Object.keys(counts)
      .sort((a, b) => a.localeCompare(b, "ja"))
      .map(tag => ({
        name: tag,
        count: counts[tag],
        link: `${baseUrl}/${this.TAGS_DIR}/${tag}/`,
        isAll: false
      }));

    return [
      { name: "全体", count: articles.length, link: `${baseUrl}/`, isAll: true },
      ...tagList
    ];
  }
  async #renderIndexPageSet({ articles, isStaging, outDir, blogtitle, blogdesc, tags, currentTag }) {
    const sorted = articles
      .filter(a => a.datetime)
      .sort((a, b) => b.datetime.localeCompare(a.datetime));

    const totalPages = Math.max(1,Math.ceil(sorted.length / this.INDEX_PAGE_SIZE));

    await fs.ensureDir(outDir);

    for (let page = 1; page <= totalPages; page++) {
      const start = (page - 1) * this.INDEX_PAGE_SIZE;
      const end = start + this.INDEX_PAGE_SIZE;

      const pageItems = sorted.slice(start, end);

      const items = [];
      for (const a of pageItems) {
        const linkBase = a.release
          ? this.CONTENT_URL_BASE
          : this.STAGING_URL_BASE;

        const thumb = await this.#getIndexImageUrl(a);

        items.push( {
          datetime: this.#formatDateTime(a.datetime),
          bodytext: this.#plainTextFromMd(a.body, 60),
          title: a.title,
          link: `${linkBase}/${a.datetime.slice(0, 4)}/${a._id}/`,
          image: thumb
        });
      }

      const html = await ejs.renderFile(path.join(this.TEMPLATE_ROOT, "index-template.ejs"),
        {
          items,
          iconurl:this.ICON_URL,
          cssurl:this.CSS_URL,
          returnurl:this.RETURN_URL,
          returntext:this.RETURN_TEXT,
          blogtitle,
          blogdesc,
          footertext: this.FOOTERTEXT,
          gaid: this.GA_ID,
          tags,
          currentTag,
          currentPage: page,
          totalPages,
          prevPage: page > 1 ? page - 1 : null,
          nextPage: page < totalPages ? page + 1 : null,
          func:this.customfunc
        });

      const filename = (page === 1)? "index.html" : `index-${page}.html`;

      await fs.writeFile(
        path.join(outDir, filename),
        html
      );
    }
  }
  async buildIndex({ isStaging }) {
    if(DBG) console.log("PossgCore.buildIndex() isStaging = "+isStaging);
    const query = isStaging ? {} : { release: true };

    const articles = await new Promise(resolve => {
      this.db.find(query, (_, docs) => resolve(docs));
    });

    const outDir = (isStaging)? this.STAGING_ROOT : this.CONTENT_ROOT;
    const tags = this.#collectTags(articles, isStaging);

    await this.#renderIndexPageSet({
      articles,
      isStaging,
      outDir,
      blogtitle: this.BLOGTITLE,
      blogdesc: this.BLOGDESC,
      tags,
      currentTag: null
    });
  }
  async buildTagIndexes({ isStaging }) {
    if(DBG) console.log("PossgCore.buildTagIndexes() isStaging = "+isStaging);
    const query = isStaging ? {} : { release: true };

    const articles = await new Promise(resolve => {
      this.db.find(query, (_, docs) => resolve(docs));
    });

    const root = (isStaging)? this.STAGING_ROOT : this.CONTENT_ROOT;
    const tags = this.#collectTags(articles, isStaging);

    const byTag = {};
    for (const a of articles) {
      for (const rawTag of (a.meta?.tags ?? [])) {
        const tag = String(rawTag).trim();
        if (!tag || tag.includes("/") || tag.includes("\\")) continue;
        byTag[tag] ??= [];
        byTag[tag].push(a);
      }
    }

    for (const [tag, tagArticles] of Object.entries(byTag)) {
      const outDir = path.join(root, this.TAGS_DIR, tag);
      await this.#renderIndexPageSet({
        articles: tagArticles,
        isStaging,
        outDir,
        blogtitle: this.BLOGTITLE,
        blogdesc: this.BLOGDESC,
        tags,
        currentTag: tag
      });
    }
  }
}

export default PossgCore;
