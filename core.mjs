// core.mjs
// possg core
// (C)2026 by D.F.Mac.@TripArts Music

const DBG = false;

import fs from "fs-extra";
import path from "path";
import unzipper from "unzipper";
import matter from "gray-matter";
import MarkdownIt from "markdown-it";
import markdownItImageFigures from "markdown-it-image-figures";
import ejs from "ejs";
import Datastore from "@seald-io/nedb";

import FmParser from "./libs/fmparser.mjs";

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
    this.RETURN_URL = config.RETURN_URL;
    if(DBG) console.log("RETURN_URL = "+this.RETURN_URL);
    this.RETURN_TEXT = config.RETURN_TEXT;
    if(DBG) console.log("RETURN_TEXT = "+this.RETURN_TEXT);
  }
  async init(){
    if(DBG) console.log("PossgCore.init()");
    await fs.ensureDir(this.DB_ROOT);
    this.db = new Datastore({ filename: this.DB_PATH, autoload: true });
    this.md = new MarkdownIt({html: true})
      .use(markdownItImageFigures, {figcaption: true,copyAttrs: true});;
  }
  async import(zipPath){
    if(DBG) console.log("PossgCore.import() zipPath = "+zipPath);
    if (!zipPath) throw new Error("zip required");

    const key = path.basename(zipPath, ".zip");

    await fs.remove(this.TMP_PATH);
    await fs.ensureDir(this.TMP_PATH);
    await fs.createReadStream(zipPath)
      .pipe(unzipper.Extract({ path: this.TMP_PATH }))
      .promise();

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
  async rebuildIndexes() {
    if(DBG) console.log("PossgCore.rebuildIndexes()");
    await this.#cleanIndexPages(this.STAGING_ROOT);
    await this.#cleanIndexPages(this.CONTENT_ROOT);
    await this.buildIndex({ isStaging: true });
    await this.buildIndex({ isStaging: false });
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
  async buildIndex({ isStaging }) {
    if(DBG) console.log("PossgCore.buildIndex() isStaging = "+isStaging);
    const query = isStaging ? {} : { release: true };

    const articles = await new Promise(resolve => {
      this.db.find(query, (_, docs) => resolve(docs));
    });

    const sorted = articles
      .filter(a => a.datetime)
      .sort((a, b) => b.datetime.localeCompare(a.datetime));

    const totalPages = Math.max(1,Math.ceil(sorted.length / this.INDEX_PAGE_SIZE));
    const baseUrl = (isStaging)? this.STAGING_URL_BASE : this.CONTENT_URL_BASE;
    const outDir = (isStaging)? this.STAGING_ROOT : this.CONTENT_ROOT;

    await fs.ensureDir(outDir);

    for (let page = 1; page <= totalPages; page++) {
      const start = (page - 1) * this.INDEX_PAGE_SIZE;
      const end = start + this.INDEX_PAGE_SIZE;

      const pageItems = sorted.slice(start, end);

      const items = pageItems.map(a => {
        const linkBase = a.release
          ? this.CONTENT_URL_BASE
          : this.STAGING_URL_BASE;

        return {
          datetime: this.#formatDateTime(a.datetime),
          bodytext: this.#plainTextFromMd(a.body, 60),
          title: a.title,
          link: `${linkBase}/${a.datetime.slice(0, 4)}/${a._id}/`,
        };
      });

      const html = await ejs.renderFile(path.join(this.TEMPLATE_ROOT, "index-template.ejs"),
        {
          items,
          iconurl:this.ICON_URL,
          returnurl:this.RETURN_URL,
          returntext:this.RETURN_TEXT,
          blogtitle: this.BLOGTITLE,
          blogdesc: this.BLOGDESC,
          footertext: this.FOOTERTEXT,
          gaid: this.GA_ID,
          currentPage: page,
          totalPages,
          prevPage: page > 1 ? page - 1 : null,
          nextPage: page < totalPages ? page + 1 : null,
        });

      const filename = (page === 1)? "index.html" : `index-${page}.html`;

      await fs.writeFile(
        path.join(outDir, filename),
        html
      );
    }
  }
}

export default PossgCore;
