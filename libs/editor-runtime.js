// editor-runtime.js
// possg geneditor - schema-aware article editor UI with live preview.
// Rendering itself is delegated to window.PossgRenderer (see renderer.js).
// Expects the following globals to be defined by earlier <script> tags:
//   window.__EDITOR_CONFIG__  { defaultContent, yamlImageEnabled }
//   CM (from codemirror.bundle.js), JSZip

(function () {
  const cfg = window.__EDITOR_CONFIG__ || {};
  const isEnableYamlImage = !!cfg.yamlImageEnabled;

  // localStorageのキーをアプリごと(genEditor()呼び出し元のルートパス由来のハッシュ)に
  // 分離する。file://で開いた場合、異なるディレクトリのHTMLでも同一originとして
  // localStorageを共有してしまうブラウザがあり、そのままだと別アプリのeditor.html間で
  // トリミングサイズ・テンプレート・言語設定が混ざってしまうため。
  const STORAGE_NS = cfg.appNamespace ? `__${cfg.appNamespace}` : "";
  function nsKey(key) { return key + STORAGE_NS; }

  let mdFiles = new Map();
  let yamlFiles = new Map();

  // 既存のzip/フォルダを読み込んで編集している場合、そのFileSystemDirectoryHandle/
  // FileSystemFileHandleを保持し、「保存」で同じ場所・同じ形式に書き戻せるようにする。
  // 新規作成の場合はnullのまま(ZIPダウンロードのみ)。
  let currentHandle = null;

  /* ---------- 多言語対応(i18n) ---------- */
  // デフォルトは英語。このブラウザのエディタでのみ有効な設定として
  // localStorageに保存し、次回起動時も同じ言語で開く。

  const LANG_KEY = nsKey("article_editor_lang");

  const I18N = {
    en: {
      loadBtnTitle: "Load existing article (folder/ZIP)",
      loadFolder: "Load from folder",
      loadZip: "Load from ZIP file",
      togglePreviewTitle: "Toggle full-screen preview",
      saveAsBtnTitle: "Save As (choose destination)",
      saveAsFolder: "Save to folder",
      saveAsZip: "Save as ZIP file",
      saveBtnTitle: "Save (overwrite source)",
      downloadBtnTitle: "Download ZIP",
      settingsBtnTitle: "Settings",
      menuTrimSize: "Trim size",
      menuSaveTemplate: "Save template",
      menuLanguage: "Language",
      trimWidthLabel: "Width (px)",
      trimHeightLabel: "Height (px)",
      trimSizeSaveBtn: "Save",
      trimSizeCancelBtn: "Back",
      yamlPaneTitle: "YAML Images",
      yamlUploadBtn: "Select YAML Image",
      mdPaneTitle: "Markdown Images",
      mdUploadBtn: "Select MD Image",
      trimModalTitle: "Image Trim",
      trimConfirmBtn: "OK",
      trimCancelBtn: "Cancel",
      trimIconTitle: "Trim",
      deleteIconTitle: "Delete",
      defaultBodyText: "Write the article body here.",
      statusTemplateSaved: "Default template updated.",
      statusTrimSizeInvalid: "Width and height must be at least 1.",
      statusTrimSizeSaved: "Trim size updated.",
      statusImageLoadFailed: "Failed to load the image.",
      statusTrimGenFailed: "Failed to generate the trimmed image.",
      statusTrimmed: "Trimmed.",
      statusLoadedFolder: (name) => `Loaded (folder: ${name}/)`,
      statusLoadedFile: (name) => `Loaded (${name})`,
      statusSaving: "Saving… (a native permission dialog will appear the first time — please allow it)",
      statusSavedFolder: (name) => `Saved (folder: ${name}/)`,
      statusSavedFile: (name) => `Saved (${name})`,
      statusSaveError: (msg) => `Save error: ${msg}`,
      statusSaveAsSaving: "Saving…",
      statusSaveAsSavedFolder: (name) => `Saved as (folder: ${name}/)`,
      statusSaveAsSavedFile: (name) => `Saved as (${name})`,
      alertLoadFailed: (msg) => `Failed to load the article: ${msg}`,
      errorIndexMdNotFound: "index.md was not found.",
      alertNoDirPickerLoad: "Your browser doesn't support choosing a folder (Chromium-based browsers only). Please use drag and drop onto the editor area instead.",
      alertPickDirFailedLoad: (msg) => `Failed to choose a folder: ${msg}`,
      alertNoFilePickerLoad: "Your browser doesn't support choosing a file (Chromium-based browsers only). Please use drag and drop onto the editor area instead.",
      alertPickFileFailedLoad: (msg) => `Failed to choose a file: ${msg}`,
      alertNoDirPickerSave: "Your browser doesn't support saving to a folder (Chromium-based browsers only). Please use \"Download ZIP\" instead.",
      alertPickDirFailedSave: (msg) => `Failed to choose a destination folder: ${msg}`,
      alertNoFilePickerSave: "Your browser doesn't support choosing a save location (Chromium-based browsers only). Please use \"Download ZIP\" instead.",
      alertPickFileFailedSave: (msg) => `Failed to choose a destination: ${msg}`,
      previewErrorHeading: "Preview error:\n\n",
      confirmDeleteImage: "Delete this image? The original file may also be removed the next time you save.",
      statusImageDeleted: "Image deleted.",
      statusImageDeleteCancelled: "Image deletion cancelled."
    },
    ja: {
      loadBtnTitle: "既存の記事を読み込み(フォルダ/ZIP)",
      loadFolder: "フォルダを読み込み",
      loadZip: "ZIPファイルを読み込み",
      togglePreviewTitle: "プレビューを全画面表示/編集画面に戻す",
      saveAsBtnTitle: "名前を付けて保存(保存先を選択)",
      saveAsFolder: "フォルダに保存",
      saveAsZip: "ZIPファイルとして保存",
      saveBtnTitle: "保存(読み込み元に上書き)",
      downloadBtnTitle: "ZIPをダウンロード",
      settingsBtnTitle: "設定",
      menuTrimSize: "トリミングサイズ",
      menuSaveTemplate: "テンプレート保存",
      menuLanguage: "言語",
      trimWidthLabel: "幅(px)",
      trimHeightLabel: "高さ(px)",
      trimSizeSaveBtn: "保存",
      trimSizeCancelBtn: "戻る",
      yamlPaneTitle: "YAML画像リスト",
      yamlUploadBtn: "YAML画像を選択",
      mdPaneTitle: "Markdown画像リスト",
      mdUploadBtn: "MD画像を選択",
      trimModalTitle: "画像のトリミング",
      trimConfirmBtn: "決定",
      trimCancelBtn: "キャンセル",
      trimIconTitle: "トリミング",
      deleteIconTitle: "削除",
      defaultBodyText: "記事の本文をここに書きます。",
      statusTemplateSaved: "初期テンプレートを更新しました。",
      statusTrimSizeInvalid: "幅・高さには1以上の数値を指定してください。",
      statusTrimSizeSaved: "トリミングサイズを更新しました。",
      statusImageLoadFailed: "画像の読み込みに失敗しました。",
      statusTrimGenFailed: "トリミング画像の生成に失敗しました。",
      statusTrimmed: "トリミングしました。",
      statusLoadedFolder: (name) => `読み込みました(フォルダ: ${name}/)`,
      statusLoadedFile: (name) => `読み込みました(${name})`,
      statusSaving: "保存中…(初回は書き込み許可のダイアログが表示されるので「許可」を選択してください)",
      statusSavedFolder: (name) => `保存しました(フォルダ: ${name}/)`,
      statusSavedFile: (name) => `保存しました(${name})`,
      statusSaveError: (msg) => `保存エラー: ${msg}`,
      statusSaveAsSaving: "保存中…",
      statusSaveAsSavedFolder: (name) => `名前を付けて保存しました(フォルダ: ${name}/)`,
      statusSaveAsSavedFile: (name) => `名前を付けて保存しました(${name})`,
      alertLoadFailed: (msg) => `記事の読み込みに失敗しました: ${msg}`,
      errorIndexMdNotFound: "index.mdが見つかりませんでした",
      alertNoDirPickerLoad: "お使いのブラウザはフォルダの選択に対応していません(Chromium系ブラウザでご利用ください)。エディタ領域へのドラッグ&ドロップをご利用ください。",
      alertPickDirFailedLoad: (msg) => `フォルダの選択に失敗しました: ${msg}`,
      alertNoFilePickerLoad: "お使いのブラウザはファイルの選択に対応していません(Chromium系ブラウザでご利用ください)。エディタ領域へのドラッグ&ドロップをご利用ください。",
      alertPickFileFailedLoad: (msg) => `ファイルの選択に失敗しました: ${msg}`,
      alertNoDirPickerSave: "お使いのブラウザはフォルダへの保存に対応していません(Chromium系ブラウザでご利用ください)。「ZIPをダウンロード」をご利用ください。",
      alertPickDirFailedSave: (msg) => `保存先フォルダの選択に失敗しました: ${msg}`,
      alertNoFilePickerSave: "お使いのブラウザは保存先を選んでのファイル保存に対応していません(Chromium系ブラウザでご利用ください)。「ZIPをダウンロード」をご利用ください。",
      alertPickFileFailedSave: (msg) => `保存先の選択に失敗しました: ${msg}`,
      previewErrorHeading: "プレビューエラー:\n\n",
      confirmDeleteImage: "この画像を削除しますか？保存時に元ファイルも削除される可能性があります。",
      statusImageDeleted: "画像を削除しました。",
      statusImageDeleteCancelled: "画像削除をキャンセルしました。"
    }
  };

  // 優先順位: このブラウザでユーザーが手動で切り替えた言語(localStorage)
  // > config.mjsのLANGから決まるサーバー側既定値(cfg.defaultLang) > 英語
  function getLang() {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === "ja" || saved === "en") return saved;
    if (cfg.defaultLang === "ja" || cfg.defaultLang === "en") return cfg.defaultLang;
    return "en";
  }

  let currentLang = getLang();

  function t(key, ...args) {
    const entry = (I18N[currentLang] && I18N[currentLang][key] !== undefined) ? I18N[currentLang][key] : I18N.en[key];
    return typeof entry === "function" ? entry(...args) : entry;
  }

  function applyTranslations() {
    document.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.dataset.i18n);
    });
    document.querySelectorAll("[data-tooltip-i18n]").forEach((el) => {
      el.setAttribute("data-tooltip", t(el.dataset.tooltipI18n));
    });
    document.querySelectorAll(".lang-option-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.lang === currentLang);
    });
    document.documentElement.lang = currentLang;
  }

  function setLang(lang) {
    if (lang !== "ja" && lang !== "en") return;
    currentLang = lang;
    localStorage.setItem(LANG_KEY, lang);
    applyTranslations();
    updateLists(); // 画像一覧のトリミング/削除ボタンのツールチップも再生成する
  }

  function sanitizeFileName(name) {
    return name.replace(/[()\[\]#\s]/g, "_");
  }

  function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // core.mjs側と同じくMaterial Design Icons(MDI)の単色SVGパスをインライン埋め込みで使用する。
  // 画像一覧はJS側で動的に生成するため、ここにも同じ方式でパスデータを持つ。
  function mdiIcon(pathD) {
    return `<svg class="mdi-icon" viewBox="0 0 24 24"><path d="${pathD}"/></svg>`;
  }
  const ICON_CROP = "M7,17V1H5V5H1V7H5V17A2,2 0 0,0 7,19H17V23H19V19H23V17M17,15H19V7C19,5.89 18.1,5 17,5H9V7H17V15Z";
  const ICON_DELETE = "M19,4H15.5L14.5,3H9.5L8.5,4H5V6H19M6,19A2,2 0 0,0 8,21H16A2,2 0 0,0 18,19V7H6V19Z";

  /* ---------- 画像トリミング関連の共通ヘルパー ---------- */
  // トリミング後の画像は "<元の名前>-trim.<拡張子>" というファイル名で扱う。
  // 元画像・トリミング画像は常にペアで1つのmdFiles/yamlFilesエントリに保持し、
  // 画像一覧には常に元のファイル名だけを表示する(-trimは表示しない)。

  function trimNameFor(safeName) {
    const idx = safeName.lastIndexOf(".");
    if (idx === -1) return safeName + "-trim";
    return safeName.slice(0, idx) + "-trim" + safeName.slice(idx);
  }

  function loadImageDimensions(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve({ width: img.naturalWidth, height: img.naturalHeight }); };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }

  // トリミング導線アイコンの表示状態:
  //  trim-ok     : 既にトリミング済み、または元画像が既にトリミングサイズと同じ(水色)
  //  trim-needed : 未トリミングかつサイズも異なる(赤色)
  //  trim-pending: 元画像のサイズをまだ計測中
  function trimIconState(info) {
    if (info.trimBlob) return "trim-ok";
    if (info.width == null || info.height == null) return "trim-pending";
    const trimSize = getTrimSize();
    return (info.width === trimSize.width && info.height === trimSize.height) ? "trim-ok" : "trim-needed";
  }

  /* ---------- 独自のYAML+Markdownハイライト(CodeMirror StreamLanguage) ---------- */
  // Ace版のカスタムモード(yaml-sep/yaml-list-marker/yaml-key/yaml-val-str/
  // md-header/md-list/md-link-text/md-link-url/zenkaku-space)を、状態遷移含めて
  // そのまま踏襲する形でCM6のstream方式パーサーに移植したもの。

  function tokenBase(stream, state) {
    if (state.pending && state.pending.length) {
      const part = state.pending.shift();
      stream.pos += part.text.length;
      return part.tag;
    }

    if (state.mode === "yaml") {
      if (stream.sol() && stream.match(/^---$/)) { state.mode = "markdown"; return "yaml-sep"; }
      if (stream.sol() && stream.match(/^\s*-\s/)) return "yaml-list-marker";
      if (stream.match(/^[^\s:]+(?=:)/)) return "yaml-key";
      if (stream.match(/^".*?"/)) return "yaml-val-str";
      if (stream.match("　", true)) return "zenkaku-space";
      stream.next();
      return null;
    }

    // "start"(最初の---より前、通常は無い) / "markdown"(2つ目の---より後)は同じ扱い
    if (state.mode === "start" && stream.sol() && stream.match(/^---$/)) { state.mode = "yaml"; return "yaml-sep"; }
    if (stream.sol() && stream.match(/^#.*$/)) return "md-header";
    if (stream.sol() && stream.match(/^\s*([*+-]|\d+\.)\s/)) return "md-list";
    if (stream.peek() === "[") {
      const rest = stream.string.slice(stream.pos);
      const m = /^\[(.*?)\]\((.*?)\)/.exec(rest);
      if (m) {
        const parts = [
          { text: "[", tag: null },
          { text: m[1], tag: "md-link-text" },
          { text: "](", tag: null },
          { text: m[2], tag: "md-link-url" },
          { text: ")", tag: null }
        ].filter((p) => p.text.length > 0);
        state.pending = parts.slice(1);
        stream.pos += parts[0].text.length;
        return parts[0].tag;
      }
    }
    if (stream.match("　", true)) return "zenkaku-space";
    stream.next();
    return null;
  }

  const customMdYamlLanguage = CM.StreamLanguage.define({
    startState: () => ({ mode: "start", pending: null }),
    token: tokenBase,
    tokenTable: {
      "yaml-sep": CM.tags.meta,
      "yaml-list-marker": CM.tags.punctuation,
      "yaml-key": CM.tags.propertyName,
      "yaml-val-str": CM.tags.string,
      "zenkaku-space": CM.tags.invalid,
      "md-header": CM.tags.heading,
      "md-list": CM.tags.list,
      "md-link-text": CM.tags.link,
      "md-link-url": CM.tags.url
    }
  });

  const customHighlightStyle = CM.HighlightStyle.define([
    { tag: CM.tags.meta, class: "cm-yaml-sep" },
    { tag: CM.tags.punctuation, class: "cm-yaml-list-marker" },
    { tag: CM.tags.propertyName, class: "cm-yaml-key" },
    { tag: CM.tags.string, class: "cm-yaml-val-str" },
    { tag: CM.tags.invalid, class: "cm-zenkaku-space" },
    { tag: CM.tags.heading, class: "cm-md-header" },
    { tag: CM.tags.list, class: "cm-md-list" },
    { tag: CM.tags.link, class: "cm-md-link-text" },
    { tag: CM.tags.url, class: "cm-md-link-url" }
  ]);

  /* ---------- エディタ初期化 ---------- */
  // 旧Ace版の ace/theme/monokai 相当のダーク配色。ページ全体のレイアウトCSSは
  // core.mjs側の<style>で、エディタ自身の配色はここ(EditorView.theme)で担当する。

  // 総称フォント名"monospace"は、ブラウザによってはbold書体の文字送り幅が
  // レギュラー書体と一致しない実フォントに解決されることがあり、
  // 太字にした.cm-yaml-sep/.cm-yaml-list-marker等の隣接文字(スペースを含む)の
  // 幅がずれて等幅崩れして見える不具合があったため、bold/regularで文字幅が
  // 保証されている実フォントを明示指定する。.cm-scrollerにも指定しないと
  // CodeMirror自身のbaseThemeが持つ"monospace"指定に上書きされてしまう。
  const monospaceFontFamily = "Menlo, Consolas, 'DejaVu Sans Mono', 'Liberation Mono', monospace";

  const darkTheme = CM.EditorView.theme({
    "&": { height: "100%", backgroundColor: "#272822", color: "#f8f8f2", fontSize: "16px" },
    ".cm-content": { caretColor: "#f8f8f0", fontFamily: monospaceFontFamily },
    ".cm-scroller": { fontFamily: monospaceFontFamily },
    ".cm-gutters": { backgroundColor: "#272822", color: "#75715e", border: "none", fontFamily: monospaceFontFamily },
    ".cm-activeLine": { backgroundColor: "rgba(255,255,255,0.06)" },
    ".cm-activeLineGutter": { backgroundColor: "rgba(255,255,255,0.1)" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "rgba(255,255,255,0.25) !important" },
    ".cm-highlightSpace:before": { color: "rgba(255,255,255,0.12)" }
  }, { dark: true });

  // config.mjs由来の初期本文プレースホルダーはNode側(#buildDefaultArticleText())で
  // 日本語固定で生成されるため、現在の言語が英語の場合はここで文言だけ差し替える。
  // ユーザー自身が保存したテンプレート(savedTemplate)には手を加えない。
  function localizeDefaultContent(text) {
    if (currentLang === "en" && text.includes(I18N.ja.defaultBodyText)) {
      return text.split(I18N.ja.defaultBodyText).join(I18N.en.defaultBodyText);
    }
    return text;
  }

  const savedTemplate = localStorage.getItem(nsKey("article_editor_template"));
  const initialDoc = savedTemplate || localizeDefaultContent(cfg.defaultContent || "");

  const changeListener = CM.EditorView.updateListener.of((update) => {
    if (update.docChanged) schedulePreview();
  });

  const view = new CM.EditorView({
    state: CM.EditorState.create({
      doc: initialDoc,
      extensions: [
        CM.basicSetup,
        darkTheme,
        CM.highlightWhitespace(),
        customMdYamlLanguage,
        CM.syntaxHighlighting(customHighlightStyle),
        CM.EditorView.lineWrapping,
        changeListener
      ]
    }),
    parent: document.getElementById("editor")
  });

  function getValue() {
    return view.state.doc.toString();
  }

  function setValue(text) {
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
  }

  if (!isEnableYamlImage) {
    document.getElementById("yaml-pane").style.display = "none";
  }

  /* ---------- 歯車メニュー(トリミングサイズ / テンプレート保存) ---------- */
  // ここで設定するトリミングサイズはこのブラウザのエディタでのみ有効な値であり、
  // possg importやconfig.mjsのDEFAULT_TRIMそのものを書き換えるものではない。

  const TRIM_SIZE_KEY = nsKey("article_editor_trim_size");

  function getTrimSize() {
    try {
      const saved = JSON.parse(localStorage.getItem(TRIM_SIZE_KEY));
      if (saved && Number(saved.width) > 0 && Number(saved.height) > 0) {
        return { width: Number(saved.width), height: Number(saved.height) };
      }
    } catch (err) { /* 無視してデフォルトへ */ }
    return { width: cfg.defaultTrim?.width || 1280, height: cfg.defaultTrim?.height || 720 };
  }

  const settingsBtn = document.getElementById("settings-btn");
  const settingsMenu = document.getElementById("settings-menu");
  const settingsMenuList = document.getElementById("settings-menu-list");
  const trimSizeForm = document.getElementById("trim-size-form");
  const trimWidthInput = document.getElementById("trim-width-input");
  const trimHeightInput = document.getElementById("trim-height-input");

  function showSettingsList() {
    settingsMenuList.classList.remove("hidden");
    trimSizeForm.classList.add("hidden");
  }

  settingsBtn.onclick = (e) => {
    e.stopPropagation();
    const willShow = settingsMenu.classList.contains("hidden");
    settingsMenu.classList.toggle("hidden");
    if (willShow) showSettingsList();
  };
  settingsMenu.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => settingsMenu.classList.add("hidden"));

  document.getElementById("save-template-item").onclick = () => {
    localStorage.setItem(nsKey("article_editor_template"), getValue());
    setLoadSaveStatus(t("statusTemplateSaved"));
    settingsMenu.classList.add("hidden");
  };

  document.getElementById("trim-size-item").onclick = () => {
    const current = getTrimSize();
    trimWidthInput.value = current.width;
    trimHeightInput.value = current.height;
    settingsMenuList.classList.add("hidden");
    trimSizeForm.classList.remove("hidden");
  };

  document.getElementById("trim-size-cancel-btn").onclick = () => showSettingsList();

  document.getElementById("trim-size-save-btn").onclick = () => {
    const width = parseInt(trimWidthInput.value, 10);
    const height = parseInt(trimHeightInput.value, 10);
    if (!(width > 0) || !(height > 0)) {
      setLoadSaveStatus(t("statusTrimSizeInvalid"));
      return;
    }
    localStorage.setItem(TRIM_SIZE_KEY, JSON.stringify({ width, height }));
    setLoadSaveStatus(t("statusTrimSizeSaved"));
    settingsMenu.classList.add("hidden");
  };

  document.querySelectorAll(".lang-option-btn").forEach((btn) => {
    btn.onclick = () => {
      setLang(btn.dataset.lang);
      settingsMenu.classList.add("hidden");
    };
  });

  // 初回描画時点で(localStorage優先、無ければ英語の)言語を静的HTML側にも反映する
  applyTranslations();

  function updateLists() {
    renderList("md-file-list", mdFiles, "removeMdFile", "md");
    if (isEnableYamlImage) renderList("yaml-file-list", yamlFiles, "removeYamlFile", "yaml");
  }

  function renderList(id, map, delFuncName, mapKind) {
    const list = document.getElementById(id);
    list.innerHTML = "";
    map.forEach((fileInfo, originalName) => {
      const li = document.createElement("li");
      li.className = "file-item";
      const trimClass = trimIconState(fileInfo);
      li.innerHTML = `<button class="trim-btn btn ${trimClass}" data-tooltip="${escapeHtml(t("trimIconTitle"))}" onclick="openTrimTool('${mapKind}','${originalName}')">${mdiIcon(ICON_CROP)}</button><span>${fileInfo.safeName}</span><button class="del-btn btn" data-tooltip="${escapeHtml(t("deleteIconTitle"))}" onclick="${delFuncName}('${originalName}')">${mdiIcon(ICON_DELETE)}</button>`;
      list.appendChild(li);
    });
  }

  /* ---------- 画像トリミング(位置合わせUI) ---------- */
  // possg/tools/image-cropper/index.html のcanvas描画・ドラッグ・クロップ生成ロジックを
  // フローティングウィンドウ(モーダルのオーバーレイdiv、別タブ/別ウィンドウにはしない)として
  // geneditorに統合したもの。クロップ枠はトリミングサイズの縦横比に固定し、
  // ユーザーは枠の下で元画像をドラッグして位置を合わせる(参考実装と同じ操作感)。

  const trimCanvas = document.getElementById("trim-canvas");
  const trimCtx = trimCanvas.getContext("2d");
  const trimModalOverlay = document.getElementById("trim-modal-overlay");
  const trimConfirmBtn = document.getElementById("trim-confirm-btn");
  const trimCancelBtn = document.getElementById("trim-cancel-btn");

  // nullでなければトリミングウィンドウ表示中(=他画像のトリミング呼び出しを抑止するモーダル状態)
  let trimSession = null;

  function extOf(name) {
    const idx = name.lastIndexOf(".");
    return idx === -1 ? "" : name.slice(idx).toLowerCase();
  }

  function mimeTypeForExt(ext) {
    if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
    if (ext === ".webp") return "image/webp";
    return "image/png";
  }

  // クロップ枠とドラッグ用のスケールを、実画像サイズとトリミングサイズ(clipW×clipH)を
  // 比較した上で決める。ワークスペースの表示倍率(scaleToCanvas)は画面上の見た目の
  // 拡大率でしかなく、実際に画像を拡大するかどうかの判定に使ってはいけない
  // (以前の実装は表示倍率込みの値を1と比較してクランプしていたため、DEFAULT_TRIM等の
  // トリミングサイズがワークスペースより大きい場合に、クランプ後の値をそのままexport側の
  // スケールとして使い回してしまい、小さい画像が意図せず拡大される不具合があった)。
  //
  // - 画像がトリミングサイズをカバーできる大きさの場合(boxScale=1): 枠はトリミングサイズの
  //   まま、画像側をカバー配置に縮小してドラッグする(従来通りの挙動)。
  // - 画像がトリミングサイズより小さい場合(boxScale<1): 画像は等倍(拡大しない)のまま、
  //   枠自体をトリミングサイズと同じ縦横比を保ちつつ実画像に収まる大きさへ縮小する。
  //   縦横比が画像と一致しない軸には余白(ドラッグ可能な範囲)が残る。
  function fitTrimImageToCrop(session) {
    const scaleToCanvas = Math.min(trimCanvas.width / session.clipW, trimCanvas.height / session.clipH);

    const boxScale = Math.min(1, session.img.width / session.clipW, session.img.height / session.clipH);
    const realScale = Math.min(1, Math.max(session.clipW / session.img.width, session.clipH / session.img.height));

    const w = session.clipW * boxScale * scaleToCanvas;
    const h = session.clipH * boxScale * scaleToCanvas;
    session.cropRect = { w, h, x: (trimCanvas.width - w) / 2, y: (trimCanvas.height - h) / 2 };

    session.scale = realScale * scaleToCanvas;
    session.imgX = session.cropRect.x + (session.cropRect.w - session.img.width * session.scale) / 2;
    session.imgY = session.cropRect.y + (session.cropRect.h - session.img.height * session.scale) / 2;
  }

  function drawTrim(session) {
    trimCtx.clearRect(0, 0, trimCanvas.width, trimCanvas.height);
    const drawW = session.img.width * session.scale;
    const drawH = session.img.height * session.scale;
    trimCtx.drawImage(session.img, session.imgX, session.imgY, drawW, drawH);

    const cropRect = session.cropRect;
    trimCtx.fillStyle = "rgba(0,0,0,0.5)";
    trimCtx.fillRect(0, 0, trimCanvas.width, cropRect.y);
    trimCtx.fillRect(0, cropRect.y + cropRect.h, trimCanvas.width, trimCanvas.height - (cropRect.y + cropRect.h));
    trimCtx.fillRect(0, cropRect.y, cropRect.x, cropRect.h);
    trimCtx.fillRect(cropRect.x + cropRect.w, cropRect.y, trimCanvas.width - (cropRect.x + cropRect.w), cropRect.h);

    trimCtx.strokeStyle = "#0077ff";
    trimCtx.lineWidth = 2;
    trimCtx.strokeRect(cropRect.x, cropRect.y, cropRect.w, cropRect.h);
  }

  window.openTrimTool = function (mapKind, originalName) {
    if (trimSession) return; // 表示中は他画像のトリミング呼び出しを抑止(モーダル・重複防止)

    const map = mapKind === "yaml" ? yamlFiles : mdFiles;
    const fileInfo = map.get(originalName);
    if (!fileInfo) return;

    const trimSize = getTrimSize();
    trimCanvas.width = Math.min(800, Math.floor(window.innerWidth * 0.8));
    trimCanvas.height = Math.min(600, Math.floor(window.innerHeight * 0.7));

    // 常に元画像(fileInfo.blob)から作り直す(再トリミングも元画像基準で行える)
    const url = URL.createObjectURL(fileInfo.blob);
    const img = new Image();
    img.onload = () => {
      const session = {
        mapKind, fileInfo,
        clipW: trimSize.width, clipH: trimSize.height,
        img, url,
        scale: 1, imgX: 0, imgY: 0,
        dragging: false, startX: 0, startY: 0
      };
      fitTrimImageToCrop(session);
      trimSession = session;
      drawTrim(session);
      trimModalOverlay.classList.remove("hidden");
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setLoadSaveStatus(t("statusImageLoadFailed"));
    };
    img.src = url;
  };

  function closeTrimModal() {
    if (trimSession) URL.revokeObjectURL(trimSession.url);
    trimSession = null;
    trimModalOverlay.classList.add("hidden");
    trimCanvas.classList.remove("grabbing");
  }

  trimCanvas.addEventListener("mousedown", (e) => {
    if (!trimSession) return;
    trimSession.dragging = true;
    trimSession.startX = e.offsetX;
    trimSession.startY = e.offsetY;
    trimCanvas.classList.add("grabbing");
  });

  function stopTrimDragging() {
    if (!trimSession) return;
    trimSession.dragging = false;
    trimCanvas.classList.remove("grabbing");
  }
  trimCanvas.addEventListener("mouseup", stopTrimDragging);
  trimCanvas.addEventListener("mouseleave", stopTrimDragging);

  trimCanvas.addEventListener("mousemove", (e) => {
    const session = trimSession;
    if (!session || !session.dragging) return;

    const dx = e.offsetX - session.startX;
    const dy = e.offsetY - session.startY;
    const cropRect = session.cropRect;
    const drawW = session.img.width * session.scale;
    const drawH = session.img.height * session.scale;

    if (drawW > cropRect.w) session.imgX += dx;
    if (drawH > cropRect.h) session.imgY += dy;

    if (drawW > cropRect.w) {
      session.imgX = Math.min(cropRect.x, Math.max(cropRect.x + cropRect.w - drawW, session.imgX));
    } else {
      session.imgX = cropRect.x + (cropRect.w - drawW) / 2;
    }
    if (drawH > cropRect.h) {
      session.imgY = Math.min(cropRect.y, Math.max(cropRect.y + cropRect.h - drawH, session.imgY));
    } else {
      session.imgY = cropRect.y + (cropRect.h - drawH) / 2;
    }

    session.startX = e.offsetX;
    session.startY = e.offsetY;
    drawTrim(session);
  });

  function swapMdImageReferenceToTrim(fileInfo) {
    const origTag = `![${fileInfo.safeName}](${fileInfo.safeName})`;
    const trimTag = `![${fileInfo.trimSafeName}](${fileInfo.trimSafeName})`;
    setValue(getValue().split(origTag).join(trimTag));
  }

  function swapYamlImageReferenceToTrim(fileInfo) {
    const lines = getValue().split("\n");
    const nameLineRe = new RegExp(`^(\\s*-\\s*name\\s*:\\s*)${escapeRegExp(fileInfo.safeName)}(\\s*)$`);
    const idx = lines.findIndex((l) => nameLineRe.test(l));
    if (idx !== -1) {
      lines[idx] = lines[idx].replace(nameLineRe, `$1${fileInfo.trimSafeName}$2`);
      setValue(lines.join("\n"));
    }
  }

  trimCancelBtn.onclick = () => closeTrimModal();

  trimConfirmBtn.onclick = () => {
    const session = trimSession;
    if (!session) return;

    const { cropRect, img, scale, imgX, imgY, fileInfo, mapKind } = session;

    // 画像がトリミングサイズより小さい場合、出力もトリミングサイズそのまま(拡大)に
    // せず、実画像に収まる大きさ(fitTrimImageToCropのboxScaleと同じ計算)に縮小する。
    // 画像がトリミングサイズをカバーできる場合は従来通りトリミングサイズちょうどにする。
    const boxScale = Math.min(1, img.width / session.clipW, img.height / session.clipH);
    const outW = Math.round(session.clipW * boxScale);
    const outH = Math.round(session.clipH * boxScale);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = outW;
    outCanvas.height = outH;
    const outCtx = outCanvas.getContext("2d");

    const srcX = (cropRect.x - imgX) / scale;
    const srcY = (cropRect.y - imgY) / scale;
    const srcW = cropRect.w / scale;
    const srcH = cropRect.h / scale;

    const mimeType = mimeTypeForExt(extOf(fileInfo.safeName));
    if (mimeType === "image/jpeg") {
      // JPEGは透過不可のため白で塗ってから描画する(PNG/WEBPは透過を保持)
      outCtx.fillStyle = "#fff";
      outCtx.fillRect(0, 0, outW, outH);
    }
    outCtx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, outW, outH);

    outCanvas.toBlob((blob) => {
      if (!blob) { setLoadSaveStatus(t("statusTrimGenFailed")); return; }
      fileInfo.trimBlob = blob;
      if (mapKind === "yaml") swapYamlImageReferenceToTrim(fileInfo);
      else swapMdImageReferenceToTrim(fileInfo);
      updateLists();
      setLoadSaveStatus(t("statusTrimmed"));
      closeTrimModal();
    }, mimeType, mimeType === "image/jpeg" ? 0.9 : undefined);
  };

  window.removeMdFile = function (originalName) {
    const fileInfo = mdFiles.get(originalName);
    if (!fileInfo) return;
    // 読み込んだ既存記事を編集している場合、保存時にワークからだけでなく元ファイルも
    // 削除されうる操作のため、削除ボタン押下時のみ確認ダイアログを挟む
    if (!confirm(t("confirmDeleteImage"))) {
      setLoadSaveStatus(t("statusImageDeleteCancelled"));
      return;
    }
    mdFiles.delete(originalName);
    const tag = `![${fileInfo.safeName}](${fileInfo.safeName})`;
    const trimTag = `![${fileInfo.trimSafeName}](${fileInfo.trimSafeName})`;
    setValue(getValue().split(tag).join("").split(trimTag).join(""));
    updateLists();
    setLoadSaveStatus(t("statusImageDeleted"));
  };

  function insertMdImage(file) {
    const safeName = sanitizeFileName(file.name);
    const info = { blob: file, safeName: safeName, trimBlob: null, trimSafeName: trimNameFor(safeName), width: null, height: null };
    mdFiles.set(file.name, info);
    const cursorLineNum = view.state.doc.lineAt(view.state.selection.main.head).number; // 1-indexed
    const lines = getValue().split("\n");
    let yamlEnd = -1, sepCount = 0;
    for (let i = 0; i < lines.length; i++) { if (lines[i].trim() === "---") { sepCount++; if (sepCount === 2) { yamlEnd = i; break; } } }
    const tag = `![${safeName}](${safeName})`;
    const cursorLineIdx = cursorLineNum - 1;
    if (cursorLineIdx <= yamlEnd || yamlEnd === -1) {
      lines.splice(yamlEnd !== -1 ? yamlEnd + 1 : lines.length, 0, tag);
    } else {
      const line = lines[cursorLineIdx];
      if (line.trim() === "") lines[cursorLineIdx] = tag;
      else lines.splice(cursorLineIdx + 1, 0, tag);
    }
    setValue(lines.join("\n"));
    updateLists();
    loadImageDimensions(file).then((dims) => {
      if (dims && mdFiles.get(file.name) === info) {
        info.width = dims.width;
        info.height = dims.height;
        updateLists();
      }
    });
  }

  window.addYamlImage = function (file) {
    if (!isEnableYamlImage) return;
    if (yamlFiles.has(file.name)) return;
    const safeName = sanitizeFileName(file.name);
    const info = { blob: file, safeName: safeName, trimBlob: null, trimSafeName: trimNameFor(safeName), width: null, height: null };
    yamlFiles.set(file.name, info);

    let lines = getValue().split("\n");
    let firstSep = -1, secondSep = -1;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].trim() === "---") {
        if (firstSep === -1) firstSep = i;
        else { secondSep = i; break; }
      }
    }

    // 厳密なインデント: - の前に2つ、alt/captionの前に4つ。
    // コロンの前にスペースを入れるとシンタックスハイライトのyaml-key判定
    // ([^\s:]+(?=:))にマッチしなくなるため、詰めて書く
    const entry = `  - name: ${safeName}\n    alt: \n    caption: `;

    if (firstSep !== -1 && secondSep !== -1) {
      let yamlLines = lines.slice(firstSep + 1, secondSep);
      let imagesIndex = yamlLines.findIndex(l => l.trim() === "images:");
      if (imagesIndex === -1) {
        lines.splice(secondSep, 0, "images:", entry);
      } else {
        // images:配下(インデントされている行)の末尾、つまり次のトップレベルキー
        // または閉じの---の直前に追加する(先頭挿入ではなく末尾追加にするため)
        const imagesAbsIdx = firstSep + 1 + imagesIndex;
        let insertIdx = imagesAbsIdx + 1;
        while (insertIdx < secondSep && lines[insertIdx].trim() !== "" && lines[insertIdx].match(/^\s*/)[0].length > 0) {
          insertIdx++;
        }
        lines.splice(insertIdx, 0, entry);
      }
    }
    setValue(lines.join("\n"));
    updateLists();
    loadImageDimensions(file).then((dims) => {
      if (dims && yamlFiles.get(file.name) === info) {
        info.width = dims.width;
        info.height = dims.height;
        updateLists();
      }
    });
  };

  window.removeYamlFile = function (originalName) {
    if (!isEnableYamlImage) return;
    const fileInfo = yamlFiles.get(originalName);
    if (!fileInfo) return;
    // 読み込んだ既存記事を編集している場合、保存時にワークからだけでなく元ファイルも
    // 削除されうる操作のため、削除ボタン押下時のみ確認ダイアログを挟む
    if (!confirm(t("confirmDeleteImage"))) {
      setLoadSaveStatus(t("statusImageDeleteCancelled"));
      return;
    }
    yamlFiles.delete(originalName);

    // 「- name : <safeName>」の行を探し、そこから同じリスト項目に属する
    // 後続行(alt/caption等、より深くインデントされた行)をまとめて削除する。
    // alt/captionの中身(引用符の有無・空欄・ユーザーによる手入力)に依存しない。
    // トリミング済みの場合、本文側はtrim名で参照されているため両方に対応する。
    const lines = getValue().split("\n");
    const namesPattern = [fileInfo.safeName, fileInfo.trimSafeName].map(escapeRegExp).join("|");
    const nameLineRe = new RegExp(`^\\s*-\\s*name\\s*:\\s*(${namesPattern})\\s*$`);
    const startIdx = lines.findIndex((l) => nameLineRe.test(l));
    if (startIdx !== -1) {
      const startIndent = lines[startIdx].match(/^\s*/)[0].length;
      let endIdx = startIdx + 1;
      while (endIdx < lines.length && lines[endIdx].trim() !== "" && lines[endIdx].match(/^\s*/)[0].length > startIndent) {
        endIdx++;
      }
      lines.splice(startIdx, endIdx - startIdx);
      setValue(lines.join("\n"));
    }
    updateLists();
    setLoadSaveStatus(t("statusImageDeleted"));
  };

  document.getElementById("md-upload-btn").onclick = () => document.getElementById("md-image-input").click();
  document.getElementById("md-image-input").onchange = (e) => Array.from(e.target.files).forEach(insertMdImage);
  document.getElementById("yaml-upload-btn").onclick = () => { if (isEnableYamlImage) document.getElementById("yaml-image-input").click(); };
  document.getElementById("yaml-image-input").onchange = (e) => Array.from(e.target.files).forEach(addYamlImage);

  const editorDiv = document.getElementById("editor");
  editorDiv.addEventListener("dragover", (e) => e.preventDefault());
  editorDiv.addEventListener("drop", async (e) => {
    e.preventDefault();

    // dataTransferの中身はawaitを挟むと失効する可能性があるため、
    // 非同期処理に入る前に同期的に取り出しておく
    const item = e.dataTransfer.items && e.dataTransfer.items[0];
    const fallbackFile = e.dataTransfer.files && e.dataTransfer.files[0];

    let handle = null;
    if (item && typeof item.getAsFileSystemHandle === "function") {
      try { handle = await item.getAsFileSystemHandle(); } catch (err) { console.error(err); }
    }

    // フォルダ、またはzipファイルのドロップは「既存記事の読み込み」として扱う。
    // それ以外(画像ファイル等)は従来通りMarkdown画像として挿入する。
    if (handle && handle.kind === "directory") {
      await loadArticleFromHandle(handle);
      return;
    }
    if (handle && handle.kind === "file") {
      const file = await handle.getFile();
      if (/\.zip$/i.test(file.name)) {
        await loadArticleFromHandle(handle);
        return;
      }
    }
    if (!handle && fallbackFile && /\.zip$/i.test(fallbackFile.name)) {
      // getAsFileSystemHandle非対応ブラウザでのフォールバック
      // (ハンドルを保持できないため、以後の保存はZIPダウンロードのみになる)
      await loadArticleFromHandle(fallbackFile);
      return;
    }

    Array.from(e.dataTransfer.files).forEach(insertMdImage);
  });

  /* ---------- 既存記事の読み込み ---------- */

  let loadSaveStatusTimer = null;
  function setLoadSaveStatus(text) {
    const el = document.getElementById("load-save-status");
    if (!el) return;
    el.textContent = text;
    el.style.display = text ? "block" : "none";
    clearTimeout(loadSaveStatusTimer);
    if (text) {
      loadSaveStatusTimer = setTimeout(() => { el.style.display = "none"; }, 3000);
    }
  }

  function updateSaveButtonVisibility() {
    const btn = document.getElementById("save-btn");
    if (btn) btn.style.display = currentHandle ? "inline-flex" : "none";
  }

  // handleOrFile: FileSystemDirectoryHandle / FileSystemFileHandle(zip) / 素のFile(zip、フォールバック)
  async function loadArticleFromHandle(handleOrFile) {
    try {
      let entries;
      let isDirectory = handleOrFile.kind === "directory";
      if (isDirectory) {
        entries = await window.PossgRenderer.entriesFromDirectoryHandle(handleOrFile);
      } else {
        const file = (typeof handleOrFile.getFile === "function") ? await handleOrFile.getFile() : handleOrFile;
        const buf = await file.arrayBuffer();
        entries = window.PossgRenderer.entriesFromZip(buf);
      }

      const mdEntry = entries.find((en) => en.fileName === "index.md");
      if (!mdEntry) throw new Error(t("errorIndexMdNotFound"));
      const mdText = new TextDecoder("utf-8").decode(await mdEntry.getBytes());

      // "<元名>-trim.<拡張子>" というファイルが、対応する元ファイルと共に存在する場合は
      // トリミング済み画像として元画像のエントリに合流させ、一覧には別項目として出さない
      const trimEntryByBaseName = new Map(); // baseName(元ファイル名) -> trimのentry
      const baseNameByTrimFileName = new Map(); // trimファイル名 -> baseName(逆引き、frontmatter参照名の正規化用)
      for (const en of entries) {
        const m = /^(.*)-trim(\.[^.]+)$/.exec(en.fileName);
        if (!m) continue;
        const baseName = m[1] + m[2];
        if (entries.some((e2) => e2.fileName === baseName)) {
          trimEntryByBaseName.set(baseName, en);
          baseNameByTrimFileName.set(en.fileName, baseName);
        }
      }

      // frontmatterのmeta.images(name付きオブジェクト配列)に載っているファイル名は
      // YAML画像として、それ以外の画像はMarkdown画像として振り分ける。
      // トリミング済みの場合、参照名がtrim名のことがあるため元名に正規化してから照合する。
      const { data: fm } = window.PossgRenderer.splitFrontmatter(mdText);
      const yamlImageNames = new Set(
        (isEnableYamlImage && Array.isArray(fm.images))
          ? fm.images.map((im) => im && im.name).filter(Boolean).map((n) => baseNameByTrimFileName.get(n) || n)
          : []
      );

      const newMdFiles = new Map();
      const newYamlFiles = new Map();
      const dimensionTargets = [];
      for (const en of entries) {
        if (en === mdEntry) continue;
        if (baseNameByTrimFileName.has(en.fileName)) continue; // trim companion。元画像側にまとめて合流
        const blob = new Blob([await en.getBytes()]);
        const trimEntry = trimEntryByBaseName.get(en.fileName);
        const info = {
          blob,
          safeName: en.fileName,
          trimBlob: trimEntry ? new Blob([await trimEntry.getBytes()]) : null,
          trimSafeName: trimNameFor(en.fileName),
          width: null,
          height: null
        };
        dimensionTargets.push(info);
        if (yamlImageNames.has(en.fileName)) newYamlFiles.set(en.fileName, info);
        else newMdFiles.set(en.fileName, info);
      }

      mdFiles = newMdFiles;
      yamlFiles = newYamlFiles;
      setValue(mdText);
      currentHandle = (typeof handleOrFile.getFile === "function" || handleOrFile.kind) ? handleOrFile : null;
      updateLists();
      updateSaveButtonVisibility();
      setLoadSaveStatus(isDirectory ? t("statusLoadedFolder", handleOrFile.name) : t("statusLoadedFile", handleOrFile.name || "zip"));

      dimensionTargets.forEach((info) => {
        loadImageDimensions(info.blob).then((dims) => {
          const stillCurrent = [...mdFiles.values(), ...yamlFiles.values()].includes(info);
          if (dims && stillCurrent) {
            info.width = dims.width;
            info.height = dims.height;
            updateLists();
          }
        });
      });
    } catch (err) {
      console.error(err);
      alert(t("alertLoadFailed", err.message));
    }
  }

  /* ---------- 保存関連の共通処理 ---------- */

  function computeFolderName() {
    const content = getValue();
    const keyMatch = content.match(/key:\s*["']?([^"'\n]+)["']?/);
    return (keyMatch && keyMatch[1].trim() !== "" ? keyMatch[1].trim() : "untitled").replace(/[\\\/:*?"<>|]/g, "");
  }

  async function writeArticleIntoDirectory(dirHandle, content) {
    const mdHandle = await dirHandle.getFileHandle("index.md", { create: true });
    const mdWritable = await mdHandle.createWritable();
    await mdWritable.write(content);
    await mdWritable.close();

    const allImages = [...mdFiles.values(), ...(isEnableYamlImage ? [...yamlFiles.values()] : [])];
    for (const info of allImages) {
      const fh = await dirHandle.getFileHandle(info.safeName, { create: true });
      const w = await fh.createWritable();
      await w.write(info.blob);
      await w.close();
      if (info.trimBlob) {
        const trimFh = await dirHandle.getFileHandle(info.trimSafeName, { create: true });
        const trimW = await trimFh.createWritable();
        await trimW.write(info.trimBlob);
        await trimW.close();
      }
    }
  }

  async function buildZipBlob(folderName, content) {
    const zip = new JSZip();
    const root = zip.folder(folderName);
    root.file("index.md", content);
    const addImage = (info) => {
      root.file(info.safeName, info.blob);
      if (info.trimBlob) root.file(info.trimSafeName, info.trimBlob);
    };
    mdFiles.forEach(addImage);
    if (isEnableYamlImage) yamlFiles.forEach(addImage);
    return zip.generateAsync({ type: "blob" });
  }

  /* ---------- 読み込んだ記事の上書き保存(同じ場所・同じ形式) ---------- */

  const saveBtn = document.getElementById("save-btn");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      if (!currentHandle) return;
      // 書き込み権限がまだ無い場合、ここでブラウザのネイティブ許可ダイアログが
      // 表示される(初回のみ)。ダイアログを見落とさないよう先にステータスで案内する。
      setLoadSaveStatus(t("statusSaving"));
      try {
        const content = getValue();

        if (currentHandle.kind === "directory") {
          await writeArticleIntoDirectory(currentHandle, content);
          setLoadSaveStatus(t("statusSavedFolder", currentHandle.name));
        } else {
          // zipとして読み込んだ/保存した場合は、同じ内部フォルダ構造(possg importが
          // 前提とする<key>/index.md 形式)を保ったまま、同じファイルに上書き保存する
          const folderName = currentHandle.name.replace(/\.zip$/i, "");
          const blob = await buildZipBlob(folderName, content);
          const writable = await currentHandle.createWritable();
          await writable.write(blob);
          await writable.close();
          setLoadSaveStatus(t("statusSavedFile", currentHandle.name));
        }
      } catch (err) {
        console.error(err);
        setLoadSaveStatus(t("statusSaveError", err.message));
      }
    };
  }
  updateSaveButtonVisibility();

  /* ---------- 名前を付けて保存(新規記事・既存記事とも、保存先を都度選択) ---------- */

  const saveAsBtn = document.getElementById("save-as-btn");
  const saveAsMenu = document.getElementById("save-as-menu");
  if (saveAsBtn && saveAsMenu) {
    saveAsBtn.onclick = (e) => {
      e.stopPropagation();
      saveAsMenu.classList.toggle("hidden");
    };
    saveAsMenu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => saveAsMenu.classList.add("hidden"));

    document.getElementById("save-as-folder-btn").onclick = async () => {
      saveAsMenu.classList.add("hidden");
      await saveAsToDirectory();
    };
    document.getElementById("save-as-zip-btn").onclick = async () => {
      saveAsMenu.classList.add("hidden");
      await saveAsToZipFile();
    };
  }

  /* ---------- 記事の読み込み(フォルダ/ZIPファイルを選択。エディタ領域への
     ドラッグ&ドロップでの読み込みも引き続き利用できる、そちらとは別の導線) ---------- */

  const loadBtn = document.getElementById("load-btn");
  const loadMenu = document.getElementById("load-menu");
  if (loadBtn && loadMenu) {
    loadBtn.onclick = (e) => {
      e.stopPropagation();
      loadMenu.classList.toggle("hidden");
    };
    loadMenu.addEventListener("click", (e) => e.stopPropagation());
    document.addEventListener("click", () => loadMenu.classList.add("hidden"));

    document.getElementById("load-folder-btn").onclick = async () => {
      loadMenu.classList.add("hidden");
      await loadFromDirectoryPicker();
    };
    document.getElementById("load-zip-btn").onclick = async () => {
      loadMenu.classList.add("hidden");
      await loadFromZipPicker();
    };
  }

  async function loadFromDirectoryPicker() {
    if (typeof window.showDirectoryPicker !== "function") {
      alert(t("alertNoDirPickerLoad"));
      return;
    }
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker();
    } catch (err) {
      if (err.name === "AbortError") return; // ユーザーがダイアログをキャンセル
      console.error(err);
      alert(t("alertPickDirFailedLoad", err.message));
      return;
    }
    await loadArticleFromHandle(dirHandle);
  }

  async function loadFromZipPicker() {
    if (typeof window.showOpenFilePicker !== "function") {
      alert(t("alertNoFilePickerLoad"));
      return;
    }
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }]
      });
    } catch (err) {
      if (err.name === "AbortError") return; // ユーザーがダイアログをキャンセル
      console.error(err);
      alert(t("alertPickFileFailedLoad", err.message));
      return;
    }
    await loadArticleFromHandle(handles[0]);
  }

  async function saveAsToDirectory() {
    if (typeof window.showDirectoryPicker !== "function") {
      alert(t("alertNoDirPickerSave"));
      return;
    }
    let dirHandle;
    try {
      dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (err) {
      if (err.name === "AbortError") return; // ユーザーがダイアログをキャンセル
      console.error(err);
      alert(t("alertPickDirFailedSave", err.message));
      return;
    }
    try {
      setLoadSaveStatus(t("statusSaving"));
      await writeArticleIntoDirectory(dirHandle, getValue());
      currentHandle = dirHandle;
      updateSaveButtonVisibility();
      setLoadSaveStatus(t("statusSaveAsSavedFolder", dirHandle.name));
    } catch (err) {
      console.error(err);
      setLoadSaveStatus(t("statusSaveError", err.message));
    }
  }

  async function saveAsToZipFile() {
    if (typeof window.showSaveFilePicker !== "function") {
      alert(t("alertNoFilePickerSave"));
      return;
    }
    const folderName = computeFolderName();
    let fileHandle;
    try {
      fileHandle = await window.showSaveFilePicker({
        suggestedName: `${folderName}.zip`,
        types: [{ description: "ZIP", accept: { "application/zip": [".zip"] } }]
      });
    } catch (err) {
      if (err.name === "AbortError") return; // ユーザーがダイアログをキャンセル
      console.error(err);
      alert(t("alertPickFileFailedSave", err.message));
      return;
    }
    try {
      setLoadSaveStatus(t("statusSaveAsSaving"));
      const blob = await buildZipBlob(folderName, getValue());
      const writable = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();
      currentHandle = fileHandle;
      updateSaveButtonVisibility();
      setLoadSaveStatus(t("statusSaveAsSavedFile", fileHandle.name));
    } catch (err) {
      console.error(err);
      setLoadSaveStatus(t("statusSaveError", err.message));
    }
  }

  /* ---------- live preview ---------- */

  const previewFrame = document.getElementById("preview");

  function buildImagesMap() {
    const images = new Map();
    const addInfo = (info) => {
      images.set(info.safeName, info.blob);
      if (info.trimBlob) images.set(info.trimSafeName, info.trimBlob);
    };
    mdFiles.forEach(addInfo);
    if (isEnableYamlImage) yamlFiles.forEach(addInfo);
    return images;
  }

  function currentKey() {
    const content = getValue();
    const m = content.match(/key:\s*["']?([^"'\n]+)["']?/);
    return (m && m[1].trim() !== "") ? m[1].trim() : "preview";
  }

  function escapeHtml(s) {
    return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function showPreviewError(message) {
    previewFrame.srcdoc =
      '<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body>' +
      '<pre style="white-space:pre-wrap;font-family:monospace;padding:20px;color:#b31d28;">' +
      escapeHtml(t("previewErrorHeading")) + escapeHtml(String(message)) +
      "</pre></body></html>";
  }

  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(renderPreview, 400);
  }

  async function renderPreview() {
    try {
      const html = await window.PossgRenderer.renderArticle({
        mdText: getValue(),
        key: currentKey(),
        images: buildImagesMap()
      });
      previewFrame.srcdoc = html;
    } catch (err) {
      showPreviewError(err.message);
    }
  }

  renderPreview();

  /* ---------- プレビューの全画面表示切り替え ---------- */
  // プレビュー表示中はeditor/サイドバーを隠して全画面表示にする(編集画面とは排他)

  const previewPane = document.getElementById("previewPane");
  const editorDivEl = document.getElementById("editor");
  const sidebarEl = document.querySelector(".sidebar");
  const togglePreviewBtn = document.getElementById("toggle-preview-btn");

  let previewFullscreen = false;
  function setPreviewFullscreen(on) {
    previewFullscreen = on;
    previewPane.classList.toggle("hidden", !on);
    editorDivEl.classList.toggle("hidden", on);
    if (sidebarEl) sidebarEl.classList.toggle("hidden", on);
    togglePreviewBtn.classList.toggle("active", on);
    if (on) renderPreview();
  }

  togglePreviewBtn.onclick = () => setPreviewFullscreen(!previewFullscreen);

  /* ---------- zip export ---------- */

  document.getElementById("download-btn").onclick = async () => {
    const folderName = computeFolderName();
    const blob = await buildZipBlob(folderName, getValue());
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${folderName}.zip`; a.click();
    URL.revokeObjectURL(url);
  };
})();
