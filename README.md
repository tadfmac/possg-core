# possg-core

[日本語](./README-JP.md)

A simple SSG core for blogs.

## Features

- Article ingestion via a zip file or a folder
- Outputs HTML from markdown with front matter (EJS templates)
- Uses a lightweight JSON DB ([@seald-io/nedb](https://github.com/seald/nedb)) — no dedicated DB server needed
- Two-state management: staging (draft) / content (published)
- Automatic tag-based index pages, driven by frontmatter `tags`
- Syntax highlighting for code blocks (at build time, via [highlight.js](https://highlightjs.org/))
- For `possg genviewer`: generates HTML that lets you preview a zip file or folder article via drag-and-drop, in the browser alone
- For `possg geneditor`: generates a self-contained article editor with a live preview, using the same rendering engine

## API

Load it with `import PossgCore from "possg-core";` and instantiate it with `new PossgCore(config)` (see [possg's config.example.mjs](https://github.com/tadfmac/possg/blob/main/config.example.mjs) for details on config).

### `async init()`

Connects to the DB, builds the MarkdownIt instance, and loads `customfunc.mjs`. Always call this once before calling any method other than `genViewer()`.

### `async import(sourcePath)`

Registers a single article. `sourcePath` can be **a zip file or a folder**.

- For a zip file: the filename (minus `.zip`) becomes the record's key
- For a folder: the folder name itself becomes the record's key
- Either way, it's expected to contain `index.md` (markdown with front matter) plus assets like images directly underneath it
- Importing with a key that's already registered overwrites the existing record
- An imported article is always placed into **staging (draft) state**
- Detects the first image referenced from the markdown body or the frontmatter's `images`, and automatically generates a thumbnail at the size configured in `THUMBNAIL`

### `async publish(key, isRelease)`

Toggles an article's publication state. If `isRelease` is `true`, moves the article's HTML and assets from staging to content (published); if `false`, moves them back from content to staging. The article's actual files always live in exactly one of the two folders (it's a move, not a copy).

### `async remove(key)`

Deletes the article with the given key (deleted whether it's currently in staging or content).

### `async removeAll()`

Deletes every registered article.

### `async buildAll()`

Regenerates article HTML, nav, index, and tag indexes all at once, based on what's in the DB. Useful for propagating changes after editing a template.

### `async genViewer()`

Used by the `possg genviewer` command. Reads the app's `config.mjs`, `template/`, and `customfunc.mjs`, and generates a self-contained HTML file (`viewer.html`), directly under the app's root directory, that lets you preview a zip file or folder article via drag-and-drop using nothing but the browser. `init()` is not required (it's lighter weight, since it skips DB connection and MarkdownIt initialization). See "genviewer (Article Preview)" below for details.

### `async genEditor()`

Used by the `possg geneditor` command. Shares most of its setup with `genViewer()` (same config/template/customFunc reading, same `{static}` option), but generates a self-contained article editor (`editor.html`) instead of a viewer. `init()` is not required here either. See "geneditor (Article Editor)" below for details.

## Tag Feature

Specify tags in `meta.tags` of an article's frontmatter (defined via `frontmatter.meta.tags` in config.mjs), and index pages filtered by tag are generated automatically.

- Output location: `contents/tags/<tag name>/`, `staging/tags/<tag name>/` (configurable via `TAGS_DIR` in config.mjs; default `"tags"`)
- On the staging side, the tag index and tag list aggregate and display every article across the board, drafts included. On the content side, only published articles are counted
- Right after the description text on each index page, a tag list is shown (with counts, and the currently selected tag highlighted). An "All" entry is always shown first, linking back to the unfiltered article list
- Tag pages no longer referenced by any article are automatically deleted the next time content is regenerated
- On apps that don't define the `frontmatter.meta.tags` schema at all, the entire tag feature is disabled (neither the tag list nor any tag pages are generated)

## Staging/Release Model

- An article's HTML always physically exists in exactly one of staging or content (`import` → generated into staging, `publish` → moved to content, `unpublish` → moved back to staging; the source folder's files are deleted on each move)
- On the other hand, **the sidebar (nav to other articles) and the article list (index) show drafts and published articles together, across the board, while in staging**. Even when a published article shows up in the staging-side list, its link automatically points to its real URL on the content side, so the article's files are never duplicated

## Syntax Highlighting

Only when a language is specified on a code fence (` ```language `) is it colorized at build time (server-side) with highlight.js. Unspecified or unsupported languages are output as plain (uncolored) code. The theme itself is managed on the CSS side (via `.hljs-*` classes).

## genviewer (Article Preview)

`viewer.html`, generated by the `possg genviewer` command, is a single self-contained HTML file: drag and drop the same zip file or folder article used by `possg import` onto it, and it previews on the spot how the article would render with the real template and CSS. Node.js isn't required — it works in the browser alone.

Dropping a folder (rather than a zip file) has one extra benefit: clicking "Reload" re-scans the folder on disk from scratch, so edits to `index.md` or its images show up immediately, with no need to re-zip and re-drop. (Folder drag-and-drop relies on the File System Access API, so — like "Reload" itself — it's Chromium-only.)

That said, if the template uses Apache SSI (`<!--#include virtual="...">`), opening it directly as `file:///` leaves just the SSI part unresolved (details below). If you want to fully verify a template that uses SSI, host `viewer.html` on a web server and access it that way. For templates that don't use SSI, `file:///` is fine as-is.

**Extending via customFunc.mjs (app-specific settings)**

If your template depends on an external CDN library (jQuery, a carousel library, etc.), implementing the following methods in `customfunc.mjs` causes them to be called automatically when `genViewer()` runs.

```js
class customFunc {
  // ...

  // Called (on the Node side) when genViewer() runs. Return an array of CDN URLs
  getViewerExternalScripts() {
    return ["https://cdn.jsdelivr.net/npm/some-lib/dist/lib.min.js"];
  }
  getViewerExternalStyles() {
    return ["https://cdn.jsdelivr.net/npm/some-lib/dist/lib.min.css"];
  }
}
```

If your template uses Apache SSI (`<!--#include virtual="/path/to/x.html">`), no handling on the customFunc side is needed. `viewer.html` automatically detects every SSI directive in the template and resolves its content by `fetch()`-ing the virtual path as-is (Apache SSI's `virtual=` and a browser's absolute-path fetch resolve the same way). **This only works when hosted on the same origin, and is not resolved under `file:///`** (if the fetch fails, it's only logged to the console as an error, and rendering of the article itself continues regardless).

The `customFunc.mjs` class definition itself is also embedded into `viewer.html`, and used in the browser as the `func` for template rendering. Because of that, these methods should **avoid depending on Node-only APIs such as fs/path, and should just return plain values (arrays)**.

**`possg genviewer -static`: resolving SSI at build time instead**

`fetch()`-based SSI resolution never works under `file:///` (this is a browser-level restriction on the `file://` scheme, not something specific to `fetch()` — switching to `XMLHttpRequest` doesn't help either). If you need a fully self-contained preview that also works offline/under `file:///`, run:

```
possg genviewer -static
```

This generates a separate `viewer-static.html` instead of `viewer.html`. Instead of resolving SSI directives at view time in the browser, `genViewer()` resolves them once, at generation time in Node, and bakes the resolved content directly into the template — so the browser-side engine has nothing left to `fetch()` at all.

To use this, add a `getViewerSiteBaseUrl()` method to `customfunc.mjs`, returning your real site's origin:

```js
class customFunc {
  // ...

  // Called (on the Node side) whenever genViewer() runs, static or not. Return your real site's origin
  getViewerSiteBaseUrl() {
    return "https://your-real-site.example.com";
  }
}
```

`getViewerSiteBaseUrl()` is used for two things: resolving SSI `virtual=` paths (build time, `-static` only), and — for both `viewer.html` and `viewer-static.html` alike — rewriting any root-relative `src`/`href` in the rendered article (e.g. `href="/css/site.css"`, `src="/images/logo.png"`, or whatever a template's own `func.getIconUrl()`/`func.getFaceUrl()`-style customFunc calls happen to return) into fully-qualified URLs anchored at that origin. This rewrite runs in the browser, after rendering, so it catches root-relative URLs regardless of where they came from — SSI-included content, or a customFunc method invoked directly from the template. It matters because under `file:///`, a root-relative path doesn't resolve against your real site at all — it resolves against the local filesystem root, so without this rewrite those assets simply fail to load (protocol-relative URLs starting with `//` are left alone).

If `getViewerSiteBaseUrl()` isn't defined, or a given SSI include fails to fetch, `genviewer -static` doesn't abort — it logs an error to the console and leaves that particular directive's literal text embedded in `viewer-static.html`, the same graceful-degradation behavior as the regular runtime path.

The trade-off (as the name implies): `viewer-static.html` is a snapshot. If the real content behind an SSI include changes later, it won't be reflected until you run `possg genviewer -static` again. Use the regular `viewer.html` when you want SSI content to always be current (and can host it), and `viewer-static.html` when you need it to work fully offline/under `file:///`.

## geneditor (Article Editor)

```
possg geneditor [-static] [-title <title>]
```

Generates `editor.html` (or `editor-static.html` with `-static`, same SSI/root-relative-URL trade-off as `genviewer -static`): a self-contained article editor with a live preview, built on the same rendering engine as `genviewer`. The text editor itself is [CodeMirror 6](https://codemirror.net/) (with a custom `StreamLanguage` mode highlighting the YAML frontmatter and Markdown body), bundled once at build time into `libs/codemirror.bundle.js` via esbuild (`npm run build:cm`) and embedded exactly like the other UMD assets — no build tool is required at runtime, only to regenerate that bundle file after touching `build-tools/cm-entry.mjs`. The starting YAML frontmatter is generated from your app's `frontmatter` schema (`core`/`meta` fields, with placeholders matching each field's type), instead of a generic hardcoded template. The "YAML image list" side panel (for a `meta.images` array of `{name, alt, ...}` objects) is shown automatically when your schema defines that field — no extra configuration needed. `-title <title>` overrides the page's `<title>` and header text (defaults to `possg editor` / `possg editor (static)`).

As you type, the preview re-renders using the exact same template, CSS, and customFunc as the real site. Uploaded images (via the sidebar buttons, or by dropping image files directly onto the editor) are inserted as `![name](name)` markdown tags (or, for YAML images, as an `images:` entry) and immediately available in the preview via blob URLs, the same mechanism `genviewer` uses for dropped articles.

All icons (header buttons, dropdown menu items, and the per-image trim/delete buttons in the sidebar lists) are single-color inline SVGs from [Material Design Icons](https://pictogrammers.com/library/mdi/) (path data embedded at generation time — no CDN/runtime dependency), each colored for clear contrast against its own background.

The header has a row of icon buttons on the right (hover each for a tooltip), in order: a folder-open icon for loading an existing article (described next), an eye icon that switches to a full-screen preview (hiding the editor and image-list sidebar; click again to go back to editing — the preview always re-renders fresh the moment you switch to it), the save-as/save/download icons described below, and — at the far right — a gear icon opening a settings menu with "Trim size" (the image crop tool's target dimensions, described further down) and "Save as template" (saves the current content as your default starting template, a separate feature from the article save described below). Save-related actions (template save, save, save-as) show a brief confirmation message at the bottom of the screen that fades out after 3 seconds, instead of a popup dialog.

**Loading an existing article**: a folder-open icon in the header opens a menu to pick a folder or a ZIP file via the File System Access API, or you can still drag and drop an existing zip file or folder (the same format `possg import` accepts) directly onto the editor area — either way, the text and its images (categorized into the YAML/MD image lists based on your `meta.images` schema) are populated automatically and the preview updates immediately.

**Saving**:
- "Save As" opens a small menu letting you pick a destination via the File System Access API (Chromium-only): "Save to folder" (`showDirectoryPicker`, writes `index.md` and images directly into the chosen folder) or "Save as ZIP file" (`showSaveFilePicker`, writes a `.zip` directly to the chosen location instead of going through the browser's automatic Downloads folder). Either way works for a brand-new article as well as one you're already editing (e.g. to save a copy elsewhere), and afterward the article is treated as "loaded" from that location — the "Save" button appears for quick subsequent saves.
- "Save" (hidden until an article has a save location — either loaded via drag-and-drop or via "Save As") writes back to that exact same file or folder, in the same format (folder stays a folder, zip stays a zip) — no re-download-and-replace step needed.
- Both "Save As" and "Save" rely on the File System Access API; the **first** write to a given file/folder triggers a one-time native browser permission prompt asking to allow write access — this can't be skipped or pre-approved, so make sure to accept it.
- "Download ZIP" remains available as a simple, no-picker fallback (works in any browser): it always triggers a plain browser download of a `.zip` to your default Downloads location, without remembering a save location or enabling the "Save" button.

The footer always reads "Generated by possg (c)2026 TripArts Music" (linking to [the possg package on npm](https://www.npmjs.com/package/possg) and [mz4u.net](https://mz4u.net) respectively) — this is a fixed tool credit, independent of your app's own `FOOTERTEXT` config (which is only used by `genviewer`'s generated site pages).

**Image trimming (crop tool)**: each entry in the YAML/MD image lists has a crop icon before its filename (kept apart from the delete icon, to avoid accidental clicks). Its background color tells you the image's trim status at a glance: **blue** means either the image has already been trimmed, or its original dimensions already exactly match the configured trim size; **red** means it hasn't been trimmed and its dimensions don't match. Clicking it opens a modal floating window (not a new tab/window) — based on the same canvas positioning logic as `possg/tools/image-cropper/` — showing the original image behind a fixed-aspect-ratio crop frame sized to your trim settings; drag the image to reposition it behind the frame, then click "OK" to generate the trimmed image or "Cancel" to discard. While the modal is open, clicking any other image's crop icon does nothing — only one trim session can be active at a time. The gear menu's "Trim size" item lets you set the crop's target width/height (defaulting to `DEFAULT_TRIM` below); this value is stored per-browser only and never touches `possg import` or your app's config.

The trimmed output is saved as `<original-name>-trim.<original-extension>` (overwriting any existing file with that name), format-matched to the original extension (JPEG output gets a white background fill, since JPEG has no transparency; PNG/WebP keep transparency). Both the original and the trimmed image end up in the saved folder/zip — this is intentional, not a bug. Once a trim exists, `index.md` (the Markdown image tag or the YAML `images:` entry's `name`) is updated to reference the trimmed filename instead of the original, but the sidebar image list always displays the original filename regardless. Deleting an image from the list removes both the original and its trim (if any) from the working set and from any text reference. Re-trimming always starts from the original image, not a previous trim result — the crop icon stays clickable (blue) even after trimming, precisely so you can redo it.

Clicking an image's delete icon always asks for confirmation first (a native confirm dialog) — unlike editing a brand-new article, when you're editing one loaded from an existing folder or ZIP, saving afterward can genuinely remove the original file (a folder save leaves an orphaned file behind, but overwriting a loaded ZIP regenerates it from scratch, so anything removed from the list is gone from the saved ZIP too). After you respond, a "deleted" or "cancelled" message appears at the bottom for 3 seconds, the same as other actions.

**Language**: the interface defaults to English, unless your `config.mjs` sets `LANG` to `"JP"` (see the config key table below). The gear menu's "Language" section lets any visitor switch to Japanese (and back) regardless of that default; the choice is saved to `localStorage` in their browser and is remembered the next time they open the editor — it's independent per browser/profile, not part of the saved article, and once set it takes priority over `config.mjs`'s `LANG` on that browser. Hovering any icon button shows a custom tooltip that appears immediately, instead of the browser's native `title` tooltip (which has an unavoidable OS-level delay).

## Main config.mjs Keys

| Key | Description |
|---|---|
| `WWW_DIR` / `CONTENT_DIR` / `STAGING_DIR` | Output directory layout |
| `TAGS_DIR` | Output folder name for tag-based indexes (defaults to `"tags"` if omitted) |
| `TEMPLATE_DIR` / `TEMPLATE_FILE_NAME` / `IDX_TEMPLATE_FILE_NAME` | Location and filenames of the templates |
| `CUSTOMFUNC_DIR` / `CUSTOMFUNC_FILE_NAME` | Location of customfunc.mjs |
| `CONTENT_URL_BASE` / `STAGING_URL_BASE` | URL base for published/draft pages |
| `ICON_URL` / `CSS_URL` / `JS_URL` | URLs for the favicon, possg.css, and possg.js (all optional — if omitted, the corresponding tag simply isn't output on the template side) |
| `frontmatter` | The frontmatter schema definition (`core` holds required fields, `meta` holds optional ones; defining `meta.tags` turns on the tag feature) |
| `INDEX_PAGE_SIZE` | Number of articles per page in the article list |
| `THUMBNAIL` | Thumbnail generation size (`width`/`height`) |
| `DEFAULT_TRIM` | Default crop size for geneditor's image trim tool (`width`/`height`); falls back to `1280`x`720` if missing or invalid |
| `LANG` | geneditor's default UI language: `"JP"` for Japanese, `"EN"` or omitted for English. This only sets the initial default — if a visitor has already switched languages in their own browser (saved to `localStorage`), that choice still takes priority |
| `RELEASE_FEATURE` | Setting this to `false` disables `publish()` |

## Dependencies

`fs-extra` / `unzipper` / `gray-matter` / `markdown-it` / `markdown-it-image-figures` / `highlight.js` / `ejs` / `sharp` / `@seald-io/nedb` / `js-yaml` / `jszip`

Dev-only (used solely to produce the pre-built `libs/codemirror.bundle.js`, not needed at runtime): `codemirror` / `@codemirror/state` / `@codemirror/view` / `@codemirror/commands` / `@codemirror/language` / `@lezer/highlight` / `esbuild`

## License

MIT
