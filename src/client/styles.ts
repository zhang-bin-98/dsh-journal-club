/**
 * Client workbench styles, embedded as a TS string.
 *
 * dsh client bundles are CJS closure factories; a CSS `import` at artifact top
 * level is a syntax error inside the factory and blocks the whole web boot.
 * Keeping the stylesheet as a tagged <style> injection avoids any CSS pipeline
 * in the bundle while still following the host `--dsw-alias-*` theme tokens.
 */

const STYLE_ID = 'dsh-journal-club-styles'

const css = `
.jc-root *, .jc-root *::before, .jc-root *::after { box-sizing: border-box; }
.jc-root [hidden] { display: none !important; }
.jc-root :is(input,select,textarea) { font: inherit; color: var(--jc-text); background: var(--jc-surface); border: 1px solid var(--jc-border); border-radius: 6px; padding: 4px 7px; max-width: 100%; }
.jc-root button { transition: background-color .12s; }
.jc-root button:not(:disabled):hover { background-color: var(--dsw-alias-interactive-bg-hover, #80808014); }
.jc-root .jc-action:not(:disabled):hover { background-color: #1d4ed8; }
.jc-root :is(button,input,select,summary,a,[tabindex]):focus-visible { outline: 2px solid var(--jc-accent); outline-offset: 2px; }
.jc-composeBoard:focus:not(:focus-visible), .jc-pageStage:focus:not(:focus-visible) { outline: none; }
.jc-shell { background: var(--jc-surface); }
.jc-projectHeader { display: flex; align-items: center; gap: 12px; padding: 10px 14px 6px; flex: none; }
.jc-projectName { font-weight: 600; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.jc-projectHeader button { flex: none; }
.jc-workspaceBody { display: flex; flex-direction: column; min-height: 0; flex: 1; }
.jc-tabs { display: flex; gap: 18px; padding: 0 14px; border-bottom: 1px solid var(--jc-border); flex: none; }
.jc-tabs button { background: none; border: 0; border-bottom: 2px solid transparent; padding: 10px 0; color: var(--jc-muted); cursor: pointer; font: inherit; }
.jc-tabs button[aria-current=page] { border-bottom-color: var(--jc-accent); color: var(--jc-accent); font-weight: 600; }
.jc-root .jc-tabs button:not(:disabled):hover { background: transparent; color: var(--jc-accent); }
.jc-view { display: flex; flex-direction: column; flex: 1; min-height: 0; overflow: auto; }
.jc-view > .jc-root { flex: 1; }
.jc-projectPicker, .jc-overview { padding: 20px; overflow: auto; min-height: 0; }
.jc-projectPicker { flex: 1; }
.jc-projectPicker > .jc-inlineActions { justify-content: space-between; }
.jc-projectItem { width: 100%; text-align: left; display: flex; flex-direction: column; gap: 3px; padding: 16px 10px; margin-top: 8px; border: 0; border-bottom: 1px solid var(--jc-border); background: transparent; color: inherit; font: inherit; cursor: pointer; border-radius: 6px; overflow-wrap: anywhere; }
.jc-projectFacts { color: var(--jc-muted); font-size: 12px; }
.jc-overview { container: jc-overview / inline-size; }
.jc-overview > * { max-width: 760px; margin-inline: auto; }
.jc-overview > h1 { font-size: 15px; line-height: 1.5; overflow-wrap: anywhere; margin: 0 auto 18px; }
.jc-overviewFocus { padding: 20px; border: 1px solid color-mix(in srgb, var(--jc-accent) 22%, var(--jc-border)); border-left: 3px solid var(--jc-accent); border-radius: 10px; background: color-mix(in srgb, var(--jc-accent) 5%, var(--jc-surface)); }
.jc-overviewFocus[data-warning=true] { border-left-color: var(--jc-warning); background: color-mix(in srgb, var(--jc-warning) 5%, var(--jc-surface)); }
.jc-overviewFocus h2 { margin: 4px 0 8px; font-size: 20px; line-height: 1.4; }
.jc-overviewFocus p { margin: 0; overflow-wrap: anywhere; }
.jc-overviewFocus .jc-inlineActions { margin-top: 16px; }
.jc-stageSummary { display: grid; grid-template-columns: repeat(4,minmax(0,1fr)); list-style: none; padding: 0; margin-top: 20px; margin-bottom: 24px; gap: 10px; font-size: 12px; }
.jc-stageSummary li { min-width: 0; }
.jc-stageSummary strong { display: block; font-weight: 500; margin-bottom: 3px; }
.jc-stageSummary span { color: var(--jc-muted); }
.jc-stageSummary [data-state=confirmed] span { color: var(--jc-accent); }
.jc-stageSummary [data-state=stale] span { color: var(--jc-warning); }
.jc-featured { margin-top: 22px; margin-bottom: 24px; }
.jc-featured h2 { font-size: 13px; margin: 0 0 10px; }
.jc-featuredGrid { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 8px; }
.jc-featuredGrid button { min-width: 0; text-align: left; padding: 12px; }
.jc-featuredGrid strong, .jc-featuredGrid small { display: block; overflow-wrap: anywhere; }
.jc-featuredGrid strong { font-size: 13px; font-weight: 500; }
.jc-featuredGrid small { color: var(--jc-muted); margin-top: 5px; }
.jc-overviewDetails { border-top: 1px solid var(--jc-border); padding: 12px 0; font-size: 12px; }
.jc-overviewDetails > summary { color: var(--jc-muted); cursor: pointer; }
.jc-overviewDetails .jc-steps { margin: 6px 0; }
@container jc-overview (max-width: 520px) { .jc-featuredGrid { grid-template-columns: 1fr; } .jc-overviewFocus { padding: 16px; } .jc-overviewFocus h2 { font-size: 18px; } }
.jc-steps { margin: 20px 0 24px; padding: 0; list-style: none; }
.jc-steps > li { padding: 12px 0; border-bottom: 1px solid var(--jc-border); }
.jc-steps strong { font-size: 13px; color: var(--jc-text); }
.jc-localSummary { margin: 24px 0; }
.jc-artifacts { display: flex; flex-wrap: wrap; gap: 8px; margin: 12px 0; }
.jc-artifacts button { overflow-wrap: anywhere; text-align: left; }
.jc-overview > .jc-inlineActions { margin-top: 20px; }
.jc-compose .jc-header { justify-content: flex-start; gap: 6px; }
.jc-compose .jc-header > span { min-width: 0; margin-right: auto; overflow: hidden; text-overflow: ellipsis; max-width: 160px; white-space: nowrap; }
.jc-composeMissingPreview { min-height: 200px; height: 50dvh; background: #fff; padding: 12px; }

.jc-composeContainer { container: jc-compose / inline-size; min-width: 0; }
.jc-composeDialog { box-sizing: border-box; color: inherit; font: inherit; }
.jc-composeDialogInline { border: 0; margin: 0; padding: 0; position: static; width: 100%; max-width: none; display: block; background: transparent; }
.jc-composeDialogOpen { width: calc(100vw - 48px); max-width: 1600px; height: calc(100dvh - 48px); max-height: none; padding: 0; border: 1px solid var(--jc-border); border-radius: 12px; background: var(--dsw-alias-bg-layer-1, #fff); }
.jc-composeDialogOpen::backdrop { background: #0008; }
.jc-compose { display: flex; flex-direction: column; min-width: 0; height: 100%; }
.jc-compose .jc-header select { max-width: 210px; min-width: 80px; }
.jc-composeStatus { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 8px 12px; font-size: 12px; }
.jc-composeWarning { color: var(--jc-warning); font-size: 12px; line-height: 1.5; padding: 4px 12px; margin: 0; }
.jc-composeBody { display: grid; grid-template-columns: 112px minmax(0, 1fr) 230px; gap: 12px; padding: 12px; min-height: 0; flex: 1; }
.jc-composeBodySolo { grid-template-columns: 112px minmax(0, 1fr); }
.jc-composeNav { display: flex; flex-direction: column; gap: 6px; min-width: 0; min-height: 0; max-height: 70dvh; font-size: 12px; }
.jc-composeGroupList { position: relative; overflow: auto; overscroll-behavior: contain; min-height: 0; flex: 1; padding: 2px; }
.jc-composeGroup { display: flex; flex-direction: column; gap: 4px; width: 100%; margin-bottom: 8px; padding: 5px; border: 1px solid var(--jc-border); border-radius: 6px; background: var(--jc-surface); color: inherit; cursor: pointer; overflow-wrap: anywhere; text-align: left; }
.jc-composeGroup[aria-current=true] { border-color: var(--jc-accent); box-shadow: 0 0 0 1px var(--jc-accent); background: var(--jc-accent-tint); }
.jc-composeGroup small { color: var(--jc-warning); }
.jc-composeGroupImage { display: block; height: 70px; width: 100%; background: white; color: #333; }
.jc-composeGroupImage .jc-materialImage { font-size: 10px; }
.jc-composeMain { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.jc-composeControls { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding-bottom: 8px; font-size: 12px; }
.jc-composeViewport { overflow: auto; background: var(--jc-canvas-well); border: 1px solid var(--jc-border); border-radius: 8px; box-shadow: inset 0 1px 2px #0f172a0f; min-height: 240px; height: min(65dvh, 700px); flex: 1; padding: 16px; }
.jc-composeExport { fill: #fff; stroke: #94a3b8; stroke-width: 1px; filter: drop-shadow(0 1px 3px #0f172a14); }
.jc-composeBoardWrap { margin: 0 auto; box-sizing: border-box; }
.jc-composeBoard { width: 100%; display: block; background: transparent; touch-action: none; user-select: none; }
.jc-composeBoard g[data-member] { cursor: move; }
.jc-composeInspector { display: flex; flex-direction: column; gap: 10px; overflow: hidden; max-height: 70dvh; min-height: 0; min-width: 0; font-size: 12px; }
.jc-composeInspectorTabs { display: flex; flex: none; gap: 6px; }
.jc-composeInspectorTabs button { flex: 1; }
.jc-composeInspectorTabs button[aria-selected=true] { color: var(--jc-accent); border-color: var(--jc-accent); }
.jc-composeTabPanel { display: flex; flex-direction: column; gap: 10px; min-height: 0; overflow: auto; }
.jc-composeMaterialPanel { flex: 1; overflow: hidden; }
.jc-composeInspector[hidden], .jc-composeTabPanel[hidden] { display: none; }
.jc-materialBrowser { display: flex; flex-direction: column; gap: 8px; min-height: 0; flex: 1; }
.jc-materialBrowser > input { min-width: 0; width: 100%; box-sizing: border-box; flex: none; }
.jc-materialList { overflow: auto; min-height: 0; flex: 1; padding: 2px; }
.jc-materialGroupTitle { font-size: 12px; margin: 8px 0; }
.jc-materialCard { border: 1px solid var(--jc-border); border-radius: 8px; overflow: hidden; margin-bottom: 10px; }
.jc-materialCard[data-selected=true] { border-color: var(--jc-accent); box-shadow: 0 0 0 1px var(--jc-accent); }
.jc-materialThumbnail { display: block; width: 100%; height: 126px; padding: 6px; border: 0; background: white; color: #333; cursor: zoom-in; }
.jc-materialThumbnail:focus-visible { outline: 2px solid var(--jc-accent); outline-offset: -2px; }
.jc-materialImage { display: grid; place-items: center; width: 100%; height: 100%; }
.jc-materialImage img { display: block; width: 100%; height: 100%; min-height: 0; min-width: 0; object-fit: contain; }
.jc-materialCaption { display: flex; align-items: center; justify-content: space-between; gap: 6px; padding: 7px; }
.jc-materialCaption > span { overflow-wrap: anywhere; min-width: 0; }
.jc-materialCaption button { flex: none; }
.jc-materialPreview { width: min(1100px, calc(100vw - 32px)); height: min(820px, calc(100dvh - 48px)); max-width: none; max-height: none; box-sizing: border-box; padding: 0; border: 1px solid var(--jc-border); border-radius: 10px; background: var(--dsw-alias-bg-layer-1, #fff); color: var(--jc-text); }
.jc-materialPreview::backdrop { background: #0008; }
.jc-materialPreviewBody { overflow: auto; min-height: 0; flex: 1; background: white; color: #333; padding: 12px; }
.jc-materialPreviewBody .jc-materialImageOriginal { width: max-content; height: max-content; }
.jc-composeNumber { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.jc-composeNumber input { width: 130px; min-width: 0; }
.jc-composeMembers { display: flex; flex-direction: column; gap: 5px; max-height: 220px; overflow: auto; flex-shrink: 0; }
.jc-composeMembers button { text-align: left; overflow-wrap: anywhere; }
.jc-composeMembers button[aria-pressed=true] { outline: 2px solid var(--jc-accent); outline-offset: -2px; }
@container jc-compose (max-width: 860px) {
  .jc-composeDialogInline .jc-composeBody { grid-template-columns: 82px minmax(0, 1fr); gap: 8px; padding: 8px; }
  .jc-composeDialogInline .jc-composeNav { grid-row: 1 / 3; }
  .jc-composeDialogInline .jc-composeInspector { grid-column: 2; max-height: 320px; }
  .jc-composeDialogInline .jc-composeControls { flex-wrap: wrap; }
}
@media (max-width: 680px) {
  .jc-composeDialogOpen .jc-composeBody { grid-template-columns: 82px minmax(0, 1fr); gap: 8px; padding: 8px; }
  .jc-composeDialogOpen .jc-composeNav { grid-row: 1 / 3; }
  .jc-composeDialogOpen .jc-composeInspector { grid-column: 2; max-height: 320px; }
  .jc-composeDialogOpen .jc-composeControls { flex-wrap: wrap; }
}

.jc-root {
  --jc-border: var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.22));
  --jc-surface: var(--dsw-alias-bg-layer-1, #fff);
  --jc-surface-raised: var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  --jc-text: var(--dsw-alias-label-primary, #25272d);
  --jc-muted: var(--dsw-alias-label-secondary, #737780);
  --jc-warning: var(--dsw-alias-state-warn-label, #b45309);
  --jc-accent: var(--dsw-alias-link, #2563eb);
  --jc-accent-tint: color-mix(in srgb, var(--jc-accent) 8%, var(--jc-surface));
  --jc-canvas-well: color-mix(in srgb, var(--jc-surface) 86%, #64748b);
  color: var(--jc-text);
  display: flex;
  flex-direction: column;
  font: var(--dsh-content-font-size, 14px)/1.5 var(--dsw-font-family, system-ui, -apple-system, "Segoe UI", sans-serif);
  min-height: 0;
  overflow: hidden;
}
.jc-header { align-items: center; border-bottom: 1px solid var(--jc-border); display: flex; flex: none; flex-wrap: wrap; gap: 8px; justify-content: space-between; padding: 10px 12px; }
.jc-eyebrow { color: var(--jc-muted); font-size: 11px; letter-spacing: .04em; margin: 0 0 3px; text-transform: uppercase; }
.jc-title { font-size: 16px; font-weight: 650; margin: 0; }
.jc-subtitle { color: var(--jc-muted); font-size: 12px; line-height: 1.45; margin: 4px 0 0; }
.jc-content { min-height: 0; overflow: auto; padding: 12px; }
.jc-stack { display: grid; gap: 10px; }
.jc-card { background: var(--jc-surface); border: 1px solid var(--jc-border); border-radius: 10px; padding: 12px; }
.jc-empty { display: grid; gap: 12px; justify-items: start; padding: 28px 8px; text-align: left; }
.jc-emptyIcon { align-items: center; background: var(--jc-surface-raised); border-radius: 12px; color: var(--jc-accent); display: flex; font-size: 22px; height: 42px; justify-content: center; width: 42px; }
.jc-action, .jc-secondaryAction, .jc-dangerAction { border: 1px solid var(--jc-border); border-radius: 7px; cursor: pointer; font: inherit; font-size: 12px; padding: 7px 10px; }
.jc-action { background: #2563eb; border-color: transparent; color: #fff; }
.jc-secondaryAction { background: transparent; color: var(--jc-text); }
.jc-dangerAction { background: transparent; color: var(--jc-warning); }
.jc-action:disabled, .jc-secondaryAction:disabled, .jc-dangerAction:disabled { cursor: default; opacity: .55; }
.jc-inlineActions, .jc-statusLine, .jc-figureMeta, .jc-panelChips { align-items: center; display: flex; flex-wrap: wrap; gap: 7px; }
.jc-statusLine { color: var(--jc-muted); font-size: 12px; justify-content: space-between; }
.jc-progress { background: var(--jc-surface-raised); border-radius: 999px; height: 5px; overflow: hidden; }
.jc-progressValue { background: var(--jc-accent); height: 100%; transition: width 180ms ease; }
.jc-figure { border: 1px solid var(--jc-border); border-radius: 8px; min-width: 0; }
.jc-figureChanged { animation: jc-changed 2.8s ease-out; border-color: var(--jc-accent); }
@keyframes jc-changed {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  15% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--jc-accent) 25%, transparent); }
}
.jc-figureHeader { align-items: flex-start; background: var(--jc-surface-raised); display: flex; gap: 8px; justify-content: space-between; padding: 10px; }
.jc-figureLabel { font-size: 13px; font-weight: 650; }
.jc-figureMeta { color: var(--jc-muted); font-size: 11px; margin-top: 3px; }
.jc-badge, .jc-warningBadge, .jc-changedBadge { border: 1px solid var(--jc-border); border-radius: 999px; color: var(--jc-muted); font-size: 10px; padding: 2px 6px; }
.jc-warningBadge { border-color: color-mix(in srgb, var(--jc-warning) 45%, var(--jc-border)); color: var(--jc-warning); }
.jc-changedBadge { border-color: color-mix(in srgb, var(--jc-accent) 45%, var(--jc-border)); color: var(--jc-accent); }
.jc-figureBody { --jc-editor-height: clamp(140px, calc(100dvh - 400px), 260px); display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; min-width: 0; padding: 10px; }
.jc-editorContainer { container: jc-editor / inline-size; min-width: 0; }
.jc-editorToolbar { align-items: center; background: var(--dsw-alias-bg-layer-1, #fff); display: flex; flex-wrap: wrap; gap: 8px; justify-content: space-between; position: relative; z-index: 3; padding: 4px 0; }
.jc-editorToolbar > .jc-inlineActions { flex: none; }
.jc-moreActions { position: relative; font-size: 12px; }
.jc-moreActions > summary { border: 1px solid var(--jc-border); border-radius: 7px; padding: 7px 10px; white-space: nowrap; }
.jc-moreMenu { background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--jc-border); border-radius: 7px; box-shadow: 0 4px 16px rgba(0,0,0,.15); display: grid; gap: 6px; min-width: 170px; padding: 8px; position: absolute; right: 0; top: 100%; z-index: 4; }
.jc-moreMenu button { text-align: left; }
.jc-regionLayout { display: grid; gap: 12px; min-width: 0; }
.jc-columnDivider { display: none; }
.jc-canvasColumn { min-width: 0; }
.jc-canvasToolbar { align-items: center; display: flex; flex-wrap: wrap; gap: 6px; justify-content: space-between; margin-bottom: 6px; }
.jc-canvasToolbar > span { min-width: 0; overflow-wrap: anywhere; }
.jc-canvasToolbar label { flex: none; }
.jc-pageFrame { background: var(--jc-canvas-well); border-radius: 8px; min-height: 180px; overflow: hidden; position: relative; }
.jc-pageStage { margin: 0 auto; max-width: 100%; position: relative; background: #fff; box-shadow: 0 1px 3px #0f172a22; }
.jc-pageImage { display: block; height: 100%; width: 100%; }
.jc-pagePlaceholder { align-items: center; color: var(--jc-muted); display: flex; font-size: 11px; inset: 0; justify-content: center; min-height: 180px; padding: 12px; position: absolute; text-align: center; }
.jc-panelBox { background: transparent; border: 1.5px solid color-mix(in srgb, var(--jc-accent) 70%, transparent); box-sizing: border-box; cursor: pointer; position: absolute; }
.jc-panelBoxFlagged { border-color: var(--jc-warning); border-style: dashed; }
.jc-panelBoxSelected { border: 2px solid var(--jc-accent); background: color-mix(in srgb, var(--jc-accent) 5%, transparent); box-shadow: 0 0 0 2px color-mix(in srgb, var(--jc-accent) 22%, transparent); z-index: 1; }
.jc-panelBoxChanged { animation: jc-changed 2.8s ease-out; }
.jc-panelTag { background: #2563eb; border: 0; border-radius: 3px; color: #fff; cursor: pointer; font: inherit; font-size: 10px; left: -2px; min-width: 18px; padding: 2px 4px; position: absolute; top: -2px; }
.jc-panelBoxSelected .jc-panelTag { left: 8px; pointer-events: none; }
.jc-handle { background: #fff; border: 2px solid var(--jc-accent); border-radius: 50%; height: 12px; padding: 0; position: absolute; width: 12px; z-index: 2; }
.jc-handleNw { cursor: nwse-resize; left: -5px; top: -5px; }
.jc-handleNe { cursor: nesw-resize; right: -5px; top: -5px; }
.jc-handleSw { cursor: nesw-resize; bottom: -5px; left: -5px; }
.jc-handleSe { bottom: -5px; cursor: nwse-resize; right: -5px; }
.jc-panelsHeader { align-items: center; display: flex; flex: 1 1 300px; gap: 8px; min-width: 0; }
.jc-panelsHeader > button { flex: none; white-space: nowrap; }
.jc-panelChips { flex: 1; flex-wrap: nowrap; min-width: 0; overflow-x: auto; padding: 3px; overscroll-behavior-x: contain; }
.jc-panelChips > button { flex: none; white-space: nowrap; }
.jc-panelChip { background: transparent; border: 1px solid var(--jc-border); border-radius: 999px; color: var(--jc-text); cursor: pointer; font: inherit; font-size: 11px; padding: 4px 8px; }
.jc-panelChipSelected { background: color-mix(in srgb, var(--jc-accent) 14%, transparent); border-color: var(--jc-accent); }
.jc-caption { border-top: 1px solid var(--jc-border); color: var(--jc-muted); font-size: 12px; line-height: 1.5; padding-top: 9px; }
.jc-captionLine { display: block; padding: 2px 4px; }
.jc-captionLineSelected { background: color-mix(in srgb, var(--jc-warning) 14%, transparent); border-radius: 4px; color: var(--jc-text); }
.jc-assetPreview { background: var(--jc-surface-raised); border-radius: 7px; display: block; max-height: 180px; max-width: 100%; object-fit: contain; }
.jc-error, .jc-conflict { border: 1px solid color-mix(in srgb, var(--jc-warning) 55%, var(--jc-border)); border-radius: 8px; color: var(--jc-warning); font-size: 12px; line-height: 1.5; padding: 9px; }
.jc-inlineDialog { position: static; margin: 0; width: auto; max-width: none; max-height: none; padding: 0; border: 0; background: transparent; color: inherit; }
.jc-modal::backdrop { background: color-mix(in srgb, #000 45%, transparent); }
.jc-modal { background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--jc-border); border-radius: 11px; box-shadow: var(--dsw-alias-elevation-overlay, 0 8px 30px rgba(0, 0, 0, .2)); box-sizing: border-box; max-height: calc(100dvh - 24px); color: var(--jc-text); max-width: 1240px; overflow: auto; overscroll-behavior: contain; padding: 8px; width: calc(100vw - 32px); }
.jc-workbench { flex: 1; min-height: 160px; }
.jc-figureList { flex: 1; }
.jc-toolbar, .jc-confirmBar { flex: none; padding: 8px 12px; }
.jc-confirmBar { border-top: 1px solid var(--jc-border); display: grid; gap: 8px; }
.jc-figureHeader { flex-wrap: wrap; }
.jc-figureToggle { background: transparent; border: 0; color: inherit; cursor: pointer; font: inherit; font-weight: 650; padding: 4px 0; text-align: left; }
.jc-panelDetail { display: flex; flex-direction: column; gap: 8px; min-width: 0; border-top: 1px solid var(--jc-border); padding-top: 8px; }
.jc-panelTools { display: grid; flex: none; gap: 8px; }
.jc-panelTools label { align-items: center; display: flex; flex: 1; gap: 4px; min-width: 100px; font-size: 12px; white-space: nowrap; }
.jc-panelTools input { box-sizing: border-box; min-width: 0; width: 100%; }
.jc-panelEvidence { font-size: 12px; line-height: 1.5; min-height: 0; overflow-wrap: anywhere; }
.jc-cropPreview { background: var(--jc-surface-raised); display: block; height: min(120px, 20dvh); width: 100%; overflow: hidden; margin-bottom: 8px; }
.jc-warningText { color: var(--jc-warning); }
.jc-zoomFrame { box-sizing: content-box; min-height: 0; max-height: var(--jc-editor-height); overflow: auto; padding: 12px; overscroll-behavior: contain; }
@container jc-editor (min-width: 700px) {
  .jc-figureBody { --jc-editor-height: clamp(160px, calc(100dvh - 350px), 620px); }
  .jc-regionLayout { grid-template-columns: var(--jc-columns); gap: 8px; }
  .jc-columnDivider { display: block; position: relative; cursor: col-resize; touch-action: none; border-radius: 5px; }
  .jc-columnDivider::after { content: ''; position: absolute; top: 0; bottom: 0; left: 4px; width: 2px; background: var(--jc-border); }
  .jc-columnDivider:hover, .jc-columnDivider:focus-visible { background: color-mix(in srgb, var(--jc-accent) 18%, transparent); outline: 2px solid var(--jc-accent); outline-offset: -2px; }
  .jc-panelDetail { border-top: 0; padding: 0; max-height: calc(var(--jc-editor-height) + 36px); }
  .jc-panelEvidence { overflow-y: auto; overscroll-behavior: contain; }
  .jc-cropPreview { height: auto; }
  .jc-modal .jc-figureBody { --jc-editor-height: clamp(180px, calc(100dvh - 240px), 740px); }
}
.jc-projectSummary { flex: none; max-height: 45%; overflow: auto; padding: 8px 12px; border-bottom: 1px solid var(--jc-border); }
.jc-root summary { cursor: pointer; }
.jc-root button:focus-visible, .jc-root summary:focus-visible, .jc-root select:focus-visible, .jc-root input:focus-visible { outline: 2px solid var(--jc-accent); outline-offset: 2px; }
@media (max-width: 460px) {
  .jc-content { padding: 8px; }
  .jc-header { padding: 10px 8px; }
  .jc-pageFrame { min-height: 150px; }
}
`

/** One stylesheet per page; replace stale rules when a client bundle reloads. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const element = document.createElement('style')
  element.id = STYLE_ID
  element.textContent = css
  document.head.append(element)
}

export const styles = {
  root: 'jc-root',
  workbench: 'jc-workbench',
  figureList: 'jc-figureList',
  toolbar: 'jc-toolbar',
  confirmBar: 'jc-confirmBar',
  figureToggle: 'jc-figureToggle',
  panelDetail: 'jc-panelDetail',
  panelTools: 'jc-panelTools',
  panelEvidence: 'jc-panelEvidence',
  cropPreview: 'jc-cropPreview',
  warningText: 'jc-warningText',
  editorContainer: 'jc-editorContainer',
  editorToolbar: 'jc-editorToolbar',
  regionLayout: 'jc-regionLayout',
  columnDivider: 'jc-columnDivider',
  canvasColumn: 'jc-canvasColumn',
  canvasToolbar: 'jc-canvasToolbar',
  moreActions: 'jc-moreActions',
  moreMenu: 'jc-moreMenu',
  panelBoxFlagged: 'jc-panelBoxFlagged',
  zoomFrame: 'jc-zoomFrame',
  projectSummary: 'jc-projectSummary',
  header: 'jc-header',
  eyebrow: 'jc-eyebrow',
  title: 'jc-title',
  subtitle: 'jc-subtitle',
  content: 'jc-content',
  stack: 'jc-stack',
  card: 'jc-card',
  empty: 'jc-empty',
  emptyIcon: 'jc-emptyIcon',
  action: 'jc-action',
  secondaryAction: 'jc-secondaryAction',
  dangerAction: 'jc-dangerAction',
  inlineActions: 'jc-inlineActions',
  statusLine: 'jc-statusLine',
  progress: 'jc-progress',
  progressValue: 'jc-progressValue',
  figure: 'jc-figure',
  figureChanged: 'jc-figureChanged',
  figureHeader: 'jc-figureHeader',
  figureLabel: 'jc-figureLabel',
  figureMeta: 'jc-figureMeta',
  badge: 'jc-badge',
  warningBadge: 'jc-warningBadge',
  changedBadge: 'jc-changedBadge',
  figureBody: 'jc-figureBody',
  pageFrame: 'jc-pageFrame',
  pageStage: 'jc-pageStage',
  pageImage: 'jc-pageImage',
  pagePlaceholder: 'jc-pagePlaceholder',
  panelBox: 'jc-panelBox',
  panelBoxSelected: 'jc-panelBoxSelected',
  panelBoxChanged: 'jc-panelBoxChanged',
  panelTag: 'jc-panelTag',
  handle: 'jc-handle',
  handleNw: 'jc-handleNw',
  handleNe: 'jc-handleNe',
  handleSw: 'jc-handleSw',
  handleSe: 'jc-handleSe',
  panelsHeader: 'jc-panelsHeader',
  panelChips: 'jc-panelChips',
  panelChip: 'jc-panelChip',
  panelChipSelected: 'jc-panelChipSelected',
  caption: 'jc-caption',
  captionLine: 'jc-captionLine',
  captionLineSelected: 'jc-captionLineSelected',
  assetPreview: 'jc-assetPreview',
  error: 'jc-error',
  conflict: 'jc-conflict',
  modalBackdrop: 'jc-modalBackdrop',
  modal: 'jc-modal',
  inlineDialog: 'jc-inlineDialog',
} as const
