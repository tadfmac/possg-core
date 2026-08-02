// renderer.js
// possg genviewer / geneditor - shared, UI-agnostic article rendering engine.
// Exposes window.PossgRenderer. Used by viewer-runtime.js (drag & drop viewer) and
// editor-runtime.js (geneditor) alike; contains no DOM/UI wiring of its own.
// Expects the following globals to be defined by earlier <script> tags in the
// embedding HTML (viewer.html / viewer-static.html / editor.html):
//   window.__VIEWER_CONFIG__      { iconurl, returnurl, returntext, blogtitle, footertext,
//                                   contentUrlBase, frontmatter, siteBaseUrl, ... }
//   window.__VIEWER_TEMPLATE_FN__ precompiled EJS render function (client mode)
//   window.__VIEWER_CSS_TEXT__    possg.css file content
//   window.__VIEWER_JS_TEXT__     possg.js file content (copy button)
//   markdownit, markdownItImageFigures, jsyaml (from bundled UMD libraries)
//   FmParser, customFunc (from bundled possg files)

(function () {
  const HLJS_CDN_URL = "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.11.1/highlight.min.js";

  function formatMMDD(datetime) {
    const ymd = datetime.split(" ")[0];
    return `${ymd.slice(4, 6)}/${ymd.slice(6, 8)}`;
  }

  function formatDateTime(datetime) {
    const [date, time] = datetime.split(" ");
    return `${date.slice(0, 4)}/${date.slice(4, 6)}/${date.slice(6, 8)} ${time}`;
  }

  /* ---------- zip reader ---------- */

  function parseZipEntries(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const EOCD_SIG = 0x06054b50;
    let eocdOffset = -1;
    const minSearch = Math.max(0, bytes.byteLength - 22 - 65536);
    for (let i = bytes.byteLength - 22; i >= minSearch; i--) {
      if (view.getUint32(i, true) === EOCD_SIG) { eocdOffset = i; break; }
    }
    if (eocdOffset === -1) throw new Error("zipファイルとして認識できません(EOCDが見つかりません)");

    const cdEntryCount = view.getUint16(eocdOffset + 10, true);
    const cdOffset = view.getUint32(eocdOffset + 16, true);

    const entries = [];
    let ptr = cdOffset;
    const CD_SIG = 0x02014b50;
    const decoder = new TextDecoder("utf-8");
    for (let i = 0; i < cdEntryCount; i++) {
      const sig = view.getUint32(ptr, true);
      if (sig !== CD_SIG) throw new Error("central directoryの読み取りに失敗しました");
      const compressionMethod = view.getUint16(ptr + 10, true);
      const compressedSize = view.getUint32(ptr + 20, true);
      const uncompressedSize = view.getUint32(ptr + 24, true);
      const fileNameLength = view.getUint16(ptr + 28, true);
      const extraFieldLength = view.getUint16(ptr + 30, true);
      const fileCommentLength = view.getUint16(ptr + 32, true);
      const localHeaderOffset = view.getUint32(ptr + 42, true);
      const nameStart = ptr + 46;
      const fileName = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLength));

      entries.push({ fileName, compressionMethod, compressedSize, uncompressedSize, localHeaderOffset });
      ptr = nameStart + fileNameLength + extraFieldLength + fileCommentLength;
    }
    return entries;
  }

  async function inflateRawBrowser(compressedBytes) {
    const ds = new DecompressionStream("deflate-raw");
    const stream = new Blob([compressedBytes]).stream().pipeThrough(ds);
    const buf = await new Response(stream).arrayBuffer();
    return new Uint8Array(buf);
  }

  async function extractEntryData(bytes, entry) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const lh = entry.localHeaderOffset;
    const LFH_SIG = 0x04034b50;
    if (view.getUint32(lh, true) !== LFH_SIG) throw new Error("local file headerの読み取りに失敗しました");
    const fileNameLength = view.getUint16(lh + 26, true);
    const extraFieldLength = view.getUint16(lh + 28, true);
    const dataStart = lh + 30 + fileNameLength + extraFieldLength;
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);

    if (entry.compressionMethod === 0) return compressed;
    if (entry.compressionMethod === 8) return await inflateRawBrowser(compressed);
    throw new Error("非対応の圧縮方式です: " + entry.compressionMethod);
  }

  function isJunkEntry(fileName) {
    if (fileName.endsWith("/")) return true;
    if (fileName.includes("__MACOSX/")) return true;
    const base = fileName.split("/").pop();
    return base.startsWith(".");
  }

  // zip/フォルダどちらから読んでも、以降の処理(frontmatter解析・レンダリング等)は
  // 共通の { fileName, getBytes() } 形式で扱う
  function entriesFromZip(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const allEntries = parseZipEntries(bytes);
    return allEntries
      .filter((e) => !isJunkEntry(e.fileName))
      .map((e) => ({
        fileName: e.fileName.split("/").pop(),
        getBytes: () => extractEntryData(bytes, e)
      }));
  }

  // possg importのフォルダ入稿と同じく、直下にindex.mdと画像等が並んだ
  // フラットな構造を前提とする(サブフォルダは無視する)
  async function entriesFromDirectoryHandle(dirHandle) {
    const entries = [];
    for await (const [name, handle] of dirHandle.entries()) {
      if (handle.kind !== "file") continue;
      if (isJunkEntry(name)) continue;
      entries.push({
        fileName: name,
        getBytes: async () => {
          const file = await handle.getFile();
          return new Uint8Array(await file.arrayBuffer());
        }
      });
    }
    return entries;
  }

  /* ---------- frontmatter ---------- */

  function splitFrontmatter(raw) {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { data: {}, content: raw.trim() };
    const data = jsyaml.load(m[1]) || {};
    return { data, content: m[2].trim() };
  }

  // レンダリング結果中の<!--#include virtual="X"-->をすべて自動検出し、
  // Xをそのままfetch()して内容を置換する。Apache SSIのvirtual=はサイトルート
  // 相対の絶対パスであり、ブラウザのfetch(絶対パス)と解決方式が同じため、
  // アプリ側の設定(マッピング)は不要。同一オリジンでホスティングされている
  // 場合のみ機能する(file:///ではfetch失敗、記事本体のレンダリングは継続)。
  async function resolveSSIIncludesViaFetch(html) {
    const directiveRe = /<!--#include\s+virtual=["']([^"']+)["']\s*-->/g;
    const virtualPaths = new Set();
    let m;
    while ((m = directiveRe.exec(html)) !== null) {
      virtualPaths.add(m[1]);
    }
    if (virtualPaths.size === 0) return html;

    let result = html;
    for (const virtualPath of virtualPaths) {
      try {
        const res = await fetch(virtualPath);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const includeContent = await res.text();
        const escapedVirtualPath = virtualPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(`<!--#include\\s+virtual=["']${escapedVirtualPath}["']\\s*-->`, "g");
        result = result.replace(re, includeContent);
      } catch (err) {
        console.error(`SSIインクルードのfetchに失敗しました(${virtualPath}):`, err);
      }
    }
    return result;
  }

  // root-relative(例: href="/css/site.css")なsrc/href属性値を、customFuncの
  // getViewerSiteBaseUrl()が設定されていればそのoriginを付与した絶対URLに書き換える。
  // SSIで取り込んだ内容だけでなく、テンプレートがfunc.getIconUrl()等のcustomFunc呼び出しで
  // 返すroot-relativeなURLも、レンダリング結果に対して行うことでまとめて対応できる。
  // file:///で開いた場合、root-relativeなパスは実サイトと無関係なローカルファイルシステムの
  // ルートに対して解決されてしまうため、常に実サイトのoriginを明示する必要がある。
  // "//"始まり(protocol-relative)は対象外。ドロップした記事自身のアセット(ファイル名のみ、
  // "/"始まりではない)を置換する後段の処理とは対象が重ならないため競合しない。
  function rewriteRootRelativeUrls(html, baseUrl) {
    if (!baseUrl) return html;
    const origin = new URL(baseUrl).origin;
    return html.replace(/((?:src|href))=(["'])\/(?!\/)([^"']*)\2/g, (full, attr, quote, rest) => {
      return `${attr}=${quote}${origin}/${rest}${quote}`;
    });
  }

  /* ---------- highlight.js (CDN, optional) ---------- */

  function loadHljs() {
    return new Promise((resolve) => {
      if (typeof hljs !== "undefined") { resolve(true); return; }
      const s = document.createElement("script");
      s.src = HLJS_CDN_URL;
      s.onload = () => resolve(true);
      s.onerror = () => resolve(false);
      document.head.appendChild(s);
    });
  }

  function buildMarkdownIt() {
    const md = markdownit({
      html: true,
      highlight: function (str, lang) {
        if (typeof hljs !== "undefined" && lang && hljs.getLanguage(lang)) {
          try {
            return hljs.highlight(str, { language: lang }).value;
          } catch (__) {}
        }
        return "";
      }
    }).use(markdownItImageFigures, { figcaption: true, copyAttrs: true });
    return md;
  }

  /* ---------- main pipeline ---------- */

  // mdText: index.mdの生テキスト(frontmatter込み)、key: 記事の識別子、
  // images: Map<fileName, Blob|Uint8Array>(既に取得済みのアセット実体)
  async function renderArticle({ mdText, key, images }) {
    const { data: fm, content: body } = splitFrontmatter(mdText);

    const fmParser = new FmParser(window.__VIEWER_CONFIG__.frontmatter);
    const coreData = fmParser.parseCore(fm);
    if (!coreData) throw new Error("frontmatterの必須項目(title/datetime等)が不足しているか、形式が不正です");
    const meta = fmParser.parseMeta(fm);

    // 画像等のアセットをBlob URL化(ファイル名基準でマッピング)
    const assetUrls = {};
    for (const [fileName, data] of images) {
      assetUrls[fileName] = URL.createObjectURL(data instanceof Blob ? data : new Blob([data]));
    }

    await loadHljs();
    const md = buildMarkdownIt();
    const content = md.render(body);

    const year = coreData.datetime.slice(0, 4);
    const nav = {
      currentYear: year,
      currentYearArticles: [{
        id: key,
        title: coreData.title,
        date: formatMMDD(coreData.datetime),
        link: "#"
      }],
      prevYear: null,
      nextYear: null
    };

    const cfg = window.__VIEWER_CONFIG__;
    const cssBlobUrl = URL.createObjectURL(new Blob([window.__VIEWER_CSS_TEXT__], { type: "text/css" }));
    const jsBlobUrl = URL.createObjectURL(new Blob([window.__VIEWER_JS_TEXT__], { type: "text/javascript" }));
    const customFuncInstance = (typeof customFunc !== "undefined") ? new customFunc() : null;

    const locals = {
      iconurl: cfg.iconurl,
      cssurl: cssBlobUrl,
      jsurl: jsBlobUrl,
      returnurl: cfg.returnurl,
      returntext: cfg.returntext,
      blogtitle: cfg.blogtitle,
      toplink: cfg.contentUrlBase,
      footertext: cfg.footertext,
      title: coreData.title,
      datetime: formatDateTime(coreData.datetime),
      meta,
      content,
      currentId: key,
      gaid: null,
      nav,
      func: customFuncInstance || {}
    };

    let renderedHtml = window.__VIEWER_TEMPLATE_FN__(locals);
    renderedHtml = await resolveSSIIncludesViaFetch(renderedHtml);
    renderedHtml = rewriteRootRelativeUrls(renderedHtml, cfg.siteBaseUrl);
    // テンプレートが直接生成する画像タグ(例: カルーセルの<img src="1.jpg?v=...">)も
    // 含めて、クエリ文字列付きの参照もファイル名基準でBlob URLに置換する
    return renderedHtml.replace(/((?:src|href))="([^"/#][^"]*)"/g, (full, attr, value) => {
      const name = value.split(/[?#]/)[0];
      return assetUrls[name] ? `${attr}="${assetUrls[name]}"` : full;
    });
  }

  // entries: [{ fileName, getBytes() }] (zip・フォルダ共通の抽象化)。
  // index.mdをテキストとして取り出し、それ以外を画像Mapとしてまとめ、renderArticle()に渡す。
  async function renderEntries(entries, key) {
    const mdEntry = entries.find(e => e.fileName === "index.md");
    if (!mdEntry) throw new Error("index.mdが見つかりません");

    const mdBytes = await mdEntry.getBytes();
    const mdText = new TextDecoder("utf-8").decode(mdBytes);

    const images = new Map();
    for (const e of entries) {
      if (e === mdEntry) continue;
      images.set(e.fileName, await e.getBytes());
    }

    return renderArticle({ mdText, key, images });
  }

  async function processZipArrayBuffer(arrayBuffer, key) {
    return renderEntries(entriesFromZip(arrayBuffer), key);
  }

  async function processDirectoryHandle(dirHandle, key) {
    return renderEntries(await entriesFromDirectoryHandle(dirHandle), key);
  }

  window.PossgRenderer = {
    renderArticle,
    renderEntries,
    processZipArrayBuffer,
    processDirectoryHandle,
    entriesFromZip,
    entriesFromDirectoryHandle,
    isJunkEntry,
    splitFrontmatter
  };
})();
