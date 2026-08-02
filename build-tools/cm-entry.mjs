// possg-core/build-tools/cm-entry.mjs
// esbuildでバンドルしてwindow.CMというグローバル名前空間を作るためのエントリポイント。
// possg-core自体はビルド無しの方針だが、CodeMirror6はESMパッケージ前提の配布形態のため、
// このファイルだけ「生成時に一度だけ」esbuildでIIFEバンドルし、
// possg-core/libs/codemirror.bundle.js として静的ファイル化して配布する
// (Ace同様、実行時にビルドツールを必要としない)。
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap, highlightWhitespace } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { StreamLanguage, HighlightStyle, syntaxHighlighting, LanguageSupport } from "@codemirror/language";
import { tags } from "@lezer/highlight";

export {
  EditorState,
  Compartment,
  EditorView,
  keymap,
  highlightWhitespace,
  basicSetup,
  defaultKeymap,
  history,
  historyKeymap,
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
  LanguageSupport,
  tags
};
