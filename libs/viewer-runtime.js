// viewer-runtime.js
// possg genviewer - browser-side rendering engine.
// Expects the following globals to be defined by earlier <script> tags in viewer.html:
//   window.__VIEWER_CONFIG__      { iconurl, returnurl, returntext, blogtitle, footertext,
//                                   contentUrlBase, frontmatter }
//   window.__VIEWER_TEMPLATE_FN__ precompiled EJS render function (client mode)
//   window.__VIEWER_CSS_TEXT__    possg.css file content
//   window.__VIEWER_JS_TEXT__     possg.js file content (copy button)
//   markdownit, markdownItImageFigures, jsyaml (from bundled UMD libraries)

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

  // entries: [{ fileName, getBytes() }] (zip・フォルダ共通の抽象化)
  async function processEntries(entries, key) {
    const mdEntry = entries.find(e => e.fileName === "index.md");
    if (!mdEntry) throw new Error("index.mdが見つかりません");

    const mdBytes = await mdEntry.getBytes();
    const mdText = new TextDecoder("utf-8").decode(mdBytes);
    const { data: fm, content: body } = splitFrontmatter(mdText);

    const fmParser = new FmParser(window.__VIEWER_CONFIG__.frontmatter);
    const coreData = fmParser.parseCore(fm);
    if (!coreData) throw new Error("frontmatterの必須項目(title/datetime等)が不足しているか、形式が不正です");
    const meta = fmParser.parseMeta(fm);

    // 画像等のアセットをBlob URL化(ファイル名基準でマッピング)
    const assetUrls = {};
    for (const e of entries) {
      if (e === mdEntry) continue;
      const data = await e.getBytes();
      assetUrls[e.fileName] = URL.createObjectURL(new Blob([data]));
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
    // テンプレートが直接生成する画像タグ(例: カルーセルの<img src="1.jpg?v=...">)も
    // 含めて、クエリ文字列付きの参照もファイル名基準でBlob URLに置換する
    return renderedHtml.replace(/((?:src|href))="([^"/#][^"]*)"/g, (full, attr, value) => {
      const name = value.split(/[?#]/)[0];
      return assetUrls[name] ? `${attr}="${assetUrls[name]}"` : full;
    });
  }

  async function processZipArrayBuffer(arrayBuffer, key) {
    return processEntries(entriesFromZip(arrayBuffer), key);
  }

  async function processDirectoryHandle(dirHandle, key) {
    return processEntries(await entriesFromDirectoryHandle(dirHandle), key);
  }

  /* ---------- UI wiring ---------- */

  const dropArea = document.getElementById("dropArea");
  const reloadBtn = document.getElementById("reloadBtn");
  const statusEl = document.getElementById("status");
  const frame = document.getElementById("preview");

  let currentHandle = null;

  // 右側プレビューはiframe(別ブラウジングコンテキスト)のため、
  // 親ページのdrag/dropイベントリスナーではiframe上へのドロップを検知できない。
  // iframe内に「ドロップを検知してpostMessageで親へ転送する」スクリプトを
  // 埋め込むことで、iframe上へのドロップにも対応する。
  const DROP_FORWARDER_SCRIPT =
    "<script>(function(){" +
    "document.addEventListener('dragover',function(e){e.preventDefault();});" +
    "document.addEventListener('drop',function(e){" +
    "e.preventDefault();" +
    "var item=e.dataTransfer.items&&e.dataTransfer.items[0];" +
    "var file=e.dataTransfer.files&&e.dataTransfer.files[0];" +
    "if(item&&typeof item.getAsFileSystemHandle==='function'){" +
    "item.getAsFileSystemHandle().then(function(h){" +
    "window.parent.postMessage({__possgViewerDrop:true,handle:h,name:(file&&file.name)||''},'*');" +
    "}).catch(function(){" +
    "if(file)file.arrayBuffer().then(function(buf){" +
    "window.parent.postMessage({__possgViewerDrop:true,name:file.name,buffer:buf},'*');" +
    "});" +
    "});" +
    "}else if(file){" +
    "file.arrayBuffer().then(function(buf){" +
    "window.parent.postMessage({__possgViewerDrop:true,name:file.name,buffer:buf},'*');" +
    "});" +
    "}" +
    "});" +
    "})();</script>";

  const INITIAL_FRAME_HTML =
    '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="margin:0;display:flex;align-items:center;justify-content:center;' +
    'height:100vh;font-family:sans-serif;color:#999;text-align:center;">' +
    "<div>ここにzipファイルまたはフォルダを<br>ドラッグ&amp;ドロップしてください</div>" +
    DROP_FORWARDER_SCRIPT +
    "</body></html>";

  function withDropForwarder(html) {
    return html.includes("</body>")
      ? html.replace("</body>", DROP_FORWARDER_SCRIPT + "</body>")
      : html + DROP_FORWARDER_SCRIPT;
  }

  // config(VIEWER_EXTERNAL_SCRIPTS/VIEWER_EXTERNAL_STYLES)で指定された
  // CDN等の外部スクリプト/スタイルを<head>直後に挿入する。テンプレート自身の
  // 末尾のインラインスクリプト(例: new Splide(...))より先に実行されるよう、
  // <head>の先頭に置き同期読み込みさせる
  function withExternalResources(html) {
    const cfg = window.__VIEWER_CONFIG__ || {};
    const styles = (cfg.externalStyles || [])
      .map((url) => `<link rel="stylesheet" href="${url}">`)
      .join("");
    const scripts = (cfg.externalScripts || [])
      .map((url) => `<script src="${url}"></script>`)
      .join("");
    const inject = styles + scripts;
    if (!inject) return html;
    return html.includes("<head>")
      ? html.replace("<head>", "<head>" + inject)
      : inject + html;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function showError(message) {
    setStatus("エラー(詳細は右側参照)");
    frame.srcdoc = withDropForwarder(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
      '<pre style="white-space:pre-wrap;font-family:monospace;padding:20px;color:#b31d28;">' +
      "エラー:\n\n" + escapeHtml(String(message)) +
      "</pre></body></html>"
    );
  }

  // handleOrFile: FileSystemDirectoryHandle / FileSystemFileHandle / 素のFile(フォールバック経路)
  async function renderFromHandle(handleOrFile) {
    setStatus("レンダリング中…");
    try {
      if (!handleOrFile) throw new Error("ファイル/フォルダを取得できませんでした");

      if (handleOrFile.kind === "directory") {
        const html = await processDirectoryHandle(handleOrFile, handleOrFile.name);
        frame.srcdoc = withDropForwarder(withExternalResources(html));
        setStatus(handleOrFile.name + "/");
        return;
      }

      // FileSystemFileHandleならgetFile()で実体を取得、素のFileならそのまま使う
      const file = (typeof handleOrFile.getFile === "function")
        ? await handleOrFile.getFile()
        : handleOrFile;

      const key = file.name.replace(/\.zip$/i, "");
      const buf = await file.arrayBuffer();
      const html = await processZipArrayBuffer(buf, key);
      frame.srcdoc = withDropForwarder(withExternalResources(html));
      setStatus(file.name);
    } catch (err) {
      console.error(err);
      showError(err.message);
    }
  }

  frame.srcdoc = INITIAL_FRAME_HTML;

  window.addEventListener("error", (ev) => {
    console.error(ev.error || ev.message);
    showError((ev.error && ev.error.message) || ev.message);
  });
  window.addEventListener("unhandledrejection", (ev) => {
    console.error(ev.reason);
    showError((ev.reason && ev.reason.message) || String(ev.reason));
  });

  // 左側のドロップエリア(80px、iframeではない通常のDOM)への直接ドロップ
  dropArea.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    dropArea.classList.add("dragover");
  });
  dropArea.addEventListener("dragleave", () => {
    dropArea.classList.remove("dragover");
  });
  dropArea.addEventListener("drop", async (ev) => {
    ev.preventDefault();
    dropArea.classList.remove("dragover");

    // dataTransferの中身はイベントハンドラを抜けて await を挟むと
    // 失効する可能性があるため、非同期処理に入る前に同期的に取り出しておく
    const item = ev.dataTransfer.items && ev.dataTransfer.items[0];
    const fallbackFile = ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!item && !fallbackFile) {
      setStatus("ファイル/フォルダが取得できませんでした");
      return;
    }

    let handle = null;
    if (item && typeof item.getAsFileSystemHandle === "function") {
      try {
        handle = await item.getAsFileSystemHandle();
      } catch (err) {
        console.error(err);
      }
    }

    if (handle) {
      currentHandle = handle;
      await renderFromHandle(handle);
      return;
    }

    currentHandle = null;
    if (fallbackFile) {
      await renderFromHandle(fallbackFile);
    } else {
      setStatus("ファイル/フォルダが取得できませんでした");
    }
  });

  // 右側プレビュー(iframe)上へのドロップは、iframe内に埋め込んだ
  // DROP_FORWARDER_SCRIPT からのpostMessageで受け取る
  window.addEventListener("message", async (ev) => {
    if (!ev.data || !ev.data.__possgViewerDrop) return;
    if (ev.source !== frame.contentWindow) return;

    if (ev.data.handle) {
      currentHandle = ev.data.handle;
      await renderFromHandle(currentHandle);
    } else if (ev.data.buffer) {
      currentHandle = null;
      const file = { name: ev.data.name, arrayBuffer: () => Promise.resolve(ev.data.buffer) };
      await renderFromHandle(file);
    }
  });

  reloadBtn.addEventListener("click", async () => {
    if (!currentHandle) {
      setStatus("先にzipファイルまたはフォルダをドロップしてください");
      return;
    }
    // ディレクトリハンドルの場合はrenderFromHandle内で毎回フォルダを再走査するため、
    // 直前のドロップ後にフォルダ内のファイルが更新されていてもそのまま反映される
    await renderFromHandle(currentHandle);
  });

  // 動作検証用: ?testzip=<url> が指定された場合、fetch経由でzipを取得しレンダリングする
  // (http(s)経由で開いた場合のみ有効。ドラッグ&ドロップの代替動作確認用)
  window.__viewerProcessZipArrayBuffer = processZipArrayBuffer;
  const testZipUrl = new URLSearchParams(location.search).get("testzip");
  if (testZipUrl) {
    fetch(testZipUrl)
      .then(res => res.arrayBuffer())
      .then(buf => {
        const key = testZipUrl.split("/").pop().replace(/\.zip$/i, "");
        return renderFromHandle({ name: key + ".zip", arrayBuffer: () => Promise.resolve(buf) });
      })
      .catch(err => setStatus("テスト読み込みエラー: " + err.message));
  }
})();
