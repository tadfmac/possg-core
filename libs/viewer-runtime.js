// viewer-runtime.js
// possg genviewer - drag & drop viewer UI. Rendering itself is delegated to
// window.PossgRenderer (see renderer.js, loaded as an earlier <script> tag).
// Expects the following DOM elements in the embedding viewer.html:
//   #dropArea, #reloadBtn, #status, #preview (iframe)

(function () {
  const { processZipArrayBuffer, processDirectoryHandle } = window.PossgRenderer;

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
