/**
 * Client workbench styles, embedded as a TS string.
 *
 * dsh client bundles are CJS closure factories; a CSS `import` at artifact top
 * level is a syntax error inside the factory and blocks the whole web boot.
 * Keeping the stylesheet as a tagged <style> injection avoids any CSS pipeline
 * in the bundle while still following the host `--dsh-alias-*` theme tokens.
 */

const STYLE_ID = 'dsh-journal-club-styles'

const css = `
.jc-root {
  --jc-border: var(--dsh-alias-border-l2, rgba(128, 128, 128, 0.22));
  --jc-surface: var(--dsh-alias-bg-layer-1, transparent);
  --jc-surface-raised: var(--dsh-alias-bg-layer-2, rgba(128, 128, 128, 0.08));
  --jc-text: var(--dsh-alias-label-primary, inherit);
  --jc-muted: var(--dsh-alias-label-secondary, currentColor);
  --jc-warning: var(--dsh-alias-state-warn-label, #b45309);
  --jc-accent: var(--dsh-alias-interactive-label-normal, #2563eb);
  color: var(--jc-text);
  display: flex;
  flex-direction: column;
  font: inherit;
  min-height: 0;
  overflow: hidden;
}
.jc-header { align-items: flex-start; border-bottom: 1px solid var(--jc-border); display: flex; flex: none; gap: 10px; justify-content: space-between; padding: 12px; }
.jc-eyebrow { color: var(--jc-muted); font-size: 11px; letter-spacing: .04em; margin: 0 0 3px; text-transform: uppercase; }
.jc-title { font-size: 16px; font-weight: 650; margin: 0; }
.jc-subtitle { color: var(--jc-muted); font-size: 12px; line-height: 1.45; margin: 4px 0 0; }
.jc-content { min-height: 0; overflow: auto; padding: 12px; }
.jc-stack { display: grid; gap: 10px; }
.jc-card { background: var(--jc-surface); border: 1px solid var(--jc-border); border-radius: 10px; padding: 12px; }
.jc-empty { display: grid; gap: 12px; justify-items: start; padding: 28px 8px; text-align: left; }
.jc-emptyIcon { align-items: center; background: var(--jc-surface-raised); border-radius: 12px; color: var(--jc-accent); display: flex; font-size: 22px; height: 42px; justify-content: center; width: 42px; }
.jc-action, .jc-secondaryAction, .jc-dangerAction { border: 1px solid var(--jc-border); border-radius: 7px; cursor: pointer; font: inherit; font-size: 12px; padding: 7px 10px; }
.jc-action { background: var(--jc-accent); border-color: var(--jc-accent); color: var(--dsh-alias-label-on-interactive, #fff); }
.jc-secondaryAction { background: var(--jc-surface-raised); color: var(--jc-text); }
.jc-dangerAction { background: transparent; color: var(--jc-warning); }
.jc-action:disabled, .jc-secondaryAction:disabled, .jc-dangerAction:disabled { cursor: default; opacity: .55; }
.jc-inlineActions, .jc-statusLine, .jc-figureMeta, .jc-panelChips { align-items: center; display: flex; flex-wrap: wrap; gap: 7px; }
.jc-statusLine { color: var(--jc-muted); font-size: 12px; justify-content: space-between; }
.jc-progress { background: var(--jc-surface-raised); border-radius: 999px; height: 5px; overflow: hidden; }
.jc-progressValue { background: var(--jc-accent); height: 100%; transition: width 180ms ease; }
.jc-figure { border: 1px solid var(--jc-border); border-radius: 10px; overflow: hidden; }
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
.jc-figureBody { display: grid; gap: 10px; padding: 10px; }
.jc-pageFrame { background: var(--jc-surface-raised); min-height: 180px; overflow: hidden; position: relative; }
.jc-pageStage { margin: 0 auto; max-width: 100%; position: relative; }
.jc-pageImage { display: block; height: 100%; width: 100%; }
.jc-pagePlaceholder { align-items: center; color: var(--jc-muted); display: flex; font-size: 11px; inset: 0; justify-content: center; min-height: 180px; padding: 12px; position: absolute; text-align: center; }
.jc-panelBox { background: color-mix(in srgb, var(--jc-accent) 10%, transparent); border: 2px solid var(--jc-accent); box-sizing: border-box; cursor: pointer; position: absolute; }
.jc-panelBoxFlagged { border-color: var(--jc-warning); border-style: dashed; }
.jc-panelBoxSelected { border-color: var(--jc-accent); border-style: solid; box-shadow: 0 0 0 2px color-mix(in srgb, var(--jc-accent) 40%, transparent); z-index: 1; }
.jc-panelBoxChanged { animation: jc-changed 2.8s ease-out; }
.jc-panelTag { background: var(--jc-accent); border: 0; border-radius: 3px; color: var(--dsh-alias-label-on-interactive, #fff); cursor: pointer; font: inherit; font-size: 10px; left: -2px; min-width: 18px; padding: 2px 4px; position: absolute; top: -2px; }
.jc-panelBoxSelected .jc-panelTag { left: 8px; pointer-events: none; }
.jc-handle { background: var(--dsh-alias-bg-layer-1, #fff); border: 1px solid var(--jc-accent); border-radius: 50%; height: 12px; padding: 0; position: absolute; width: 12px; z-index: 2; }
.jc-handleNw { cursor: nwse-resize; left: -5px; top: -5px; }
.jc-handleNe { cursor: nesw-resize; right: -5px; top: -5px; }
.jc-handleSw { cursor: nesw-resize; bottom: -5px; left: -5px; }
.jc-handleSe { bottom: -5px; cursor: nwse-resize; right: -5px; }
.jc-panelsHeader { align-items: center; display: flex; gap: 8px; justify-content: space-between; }
.jc-panelChip { background: transparent; border: 1px solid var(--jc-border); border-radius: 999px; color: var(--jc-text); cursor: pointer; font: inherit; font-size: 11px; padding: 4px 8px; }
.jc-panelChipSelected { background: color-mix(in srgb, var(--jc-accent) 14%, transparent); border-color: var(--jc-accent); }
.jc-caption { border-top: 1px solid var(--jc-border); color: var(--jc-muted); font-size: 12px; line-height: 1.5; padding-top: 9px; }
.jc-captionLine { display: block; padding: 2px 4px; }
.jc-captionLineSelected { background: color-mix(in srgb, var(--jc-warning) 14%, transparent); border-radius: 4px; color: var(--jc-text); }
.jc-assetPreview { background: var(--jc-surface-raised); border-radius: 7px; display: block; max-height: 180px; max-width: 100%; object-fit: contain; }
.jc-error, .jc-conflict { border: 1px solid color-mix(in srgb, var(--jc-warning) 55%, var(--jc-border)); border-radius: 8px; color: var(--jc-warning); font-size: 12px; line-height: 1.5; padding: 9px; }
.jc-inlineDialog { position: static; margin: 0; width: auto; max-width: none; max-height: none; padding: 0; border: 0; background: transparent; color: inherit; }
.jc-modal::backdrop { background: color-mix(in srgb, #000 45%, transparent); }
.jc-modal { background: var(--dsh-alias-bg-layer-1, #fff); border: 1px solid var(--jc-border); border-radius: 11px; box-shadow: var(--dsh-alias-elevation-overlay, 0 8px 30px rgba(0, 0, 0, .2)); max-height: 90vh; color: var(--jc-text); max-width: 960px; overflow: auto; padding: 12px; width: calc(100vw - 48px); }
.jc-workbench { flex: 1; min-height: 160px; }
.jc-figureList { flex: 1; }
.jc-toolbar, .jc-confirmBar { flex: none; padding: 8px 12px; }
.jc-confirmBar { border-top: 1px solid var(--jc-border); display: grid; gap: 8px; }
.jc-figureHeader { flex-wrap: wrap; }
.jc-figureToggle { background: transparent; border: 0; color: inherit; cursor: pointer; font: inherit; font-weight: 650; padding: 4px 0; text-align: left; }
.jc-panelDetail { display: grid; gap: 8px; border-top: 1px solid var(--jc-border); padding-top: 8px; }
.jc-zoomFrame { max-height: 55vh; overflow: auto; padding: 8px; }
.jc-projectSummary { flex: none; max-height: 45%; overflow: auto; padding: 8px 12px; border-bottom: 1px solid var(--jc-border); }
.jc-root summary { cursor: pointer; }
.jc-root button:focus-visible, .jc-root summary:focus-visible, .jc-root select:focus-visible, .jc-root input:focus-visible { outline: 2px solid var(--jc-accent); outline-offset: 2px; }
@media (max-width: 460px) {
  .jc-content { padding: 8px; }
  .jc-header { padding: 10px 8px; }
  .jc-pageFrame { min-height: 150px; }
}
`

/** One injection per page; safe to call from every apply. */
export function ensureStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById(STYLE_ID) !== null) return
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
