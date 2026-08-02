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


    const { title, datetime } = coreData;
    const body = parsed.content.trim();
    const year = datetime.slice(0, 4);

    // DB upsert
    await new Promise((res, rej) =>
      this.db.update(
        { _id: key },
        { $set: { _id: key, title, datetime, meta, body, release: false } },
        { upsert: true },
        e => (e ? rej(e) : res())
      )
    );

    // assets
    const base = path.join(this.STAGING_ROOT, year, key);
    await fs.ensureDir(base);
    for (const f of await fs.readdir(path.join(this.TMP_PATH, key))) {
      if (f !== "index.md") {
        await fs.copy(path.join(this.TMP_PATH, key, f), path.join(base, f));
      }
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
  async genViewer({ static: isStatic = false } = {}) {
    if(DBG) console.log("PossgCore.genViewer() isStatic = "+isStatic);

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
      // (viewer-runtime.jsのresolveSSIIncludesViaFetch()、file:///では動作しない)。
      // -staticはその逆で、ビルド時に解決して埋め込む代わりに、以後SSI参照先が
      // 更新されても追従しない(再度 genviewer -static が必要)というトレードオフを持つ。
      if (siteBaseUrl) {
        templateSource = await this.#resolveSSIIncludesAtBuildTime(templateSource, siteBaseUrl);
      } else if (/<!--#include\s+virtual=/.test(templateSource)) {
        console.error("genviewer -static: テンプレートにSSIディレクティブがありますが、customFunc.getViewerSiteBaseUrl()が未設定のため解決できません(ディレクティブ文字列がそのまま埋め込まれます)");
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
    const viewerRuntimeSrc = await fs.readFile(path.join(CORE_DIR, "libs", "viewer-runtime.js"), "utf8");

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
window.__VIEWER_CONFIG__ = ${escapeScriptClose(JSON.stringify(viewerConfig))};
window.__VIEWER_CSS_TEXT__ = ${escapeScriptClose(JSON.stringify(cssText))};
window.__VIEWER_JS_TEXT__ = ${escapeScriptClose(JSON.stringify(jsAssetText))};
</script>
<script>
${escapeScriptClose(fmParserSrc)}
</script>
<script>
${escapeScriptClose(customFuncSrc)}
</script>
<script>
${escapeScriptClose(markdownItSrc)}
</script>
<script>
${escapeScriptClose(imageFiguresSrc)}
</script>
<script>
${escapeScriptClose(jsYamlSrc)}
</script>
<script>
window.__VIEWER_TEMPLATE_FN__ = ${escapeScriptClose(compiledFnSrc)};
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
