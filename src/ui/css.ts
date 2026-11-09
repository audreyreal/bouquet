/* Userscript CSS plus the theme color schemes. Split out of constants.ts, which keeps tuning numbers
 * and URLs. NATIVE_CSS is injected on native NationStates pages (ui/dom.ts injectNativeCss);
 * everything else only on Bouquet pages (ui/shell.ts). MDUI's own stylesheet covers the components;
 * these rules are the only custom CSS. */
export const NATIVE_CSS = `
    #page_welcome #bq-topbar a.bellink{background:rgba(255,255,255,0.7);padding:4px 18px;color:#000}
    #bq-topbar.bq-topbar-m{position:absolute;right:10px;top:50%;transform:translateY(-50%);z-index:2}
    #bq-topbar.bq-topbar-m a{display:inline-flex;align-items:center;gap:4px;background:rgba(0,0,0,.3);border:1px solid #999;border-radius:3px;padding:7px 10px;color:#fff;font-weight:bold;font-size:13px;text-decoration:none;text-shadow:0 0 1px #444;-webkit-tap-highlight-color:transparent}
    #bq-topbar.bq-topbar-m a:active{background:rgba(0,0,0,.6)}
    .bq-nlogin{margin-left:6px;vertical-align:middle}
`;

export const BASE_CSS = `
    body.bq-busy{cursor:wait}
    .sf-shell{max-width:960px;margin:0 auto}
    /* MDUI's top app bar is position:fixed and 4rem tall for the default variant; stick tabs, live
     * status, busy bar and the page bar right below it so they survive scrolling. */
    .sf-sticky{position:sticky;top:4rem;z-index:1000;background-color:rgb(var(--mdui-color-surface))}
    .sf-sticky mdui-linear-progress{display:block}
    .sf-sticky mdui-linear-progress[hidden]{visibility:hidden}
    .sf-pagebar{padding:0 16px 8px}
    .sf-pagebar:empty{display:none}
    .sf-grow{flex-grow:1}
    .sf-main{display:flex;flex-direction:column;gap:12px;padding:16px;max-width:960px;margin:0 auto}
    .sf-hint{font-size:13px;line-height:1.45;opacity:.72}
    .sf-statusrow{display:flex;align-items:center;gap:8px;padding:8px 16px}
    .sf-status{font-size:13px;opacity:.72;flex:1 1 auto;min-width:0}
    .sf-version{font-size:12px;opacity:.72;white-space:nowrap;margin:0 12px}
    .sf-feedback{font-size:12px;color:inherit;text-decoration:underline;white-space:nowrap}
    .sf-row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
    mdui-button[hidden]{display:none}
    .bq-nation-link{color:inherit;text-decoration:underline}
    mdui-text-field{max-width:520px}
    mdui-text-field[rows]{max-width:100%}
    mdui-select{max-width:520px}
    .sf-main mdui-card{padding:12px}
    div.mdui-table{overflow-x:auto;border-radius:8px}
    .sf-toasts{position:fixed;right:16px;bottom:16px;z-index:9999;display:flex;flex-direction:column;gap:8px;max-width:min(420px,92vw)}
    .sf-toast{background:rgb(var(--mdui-color-inverse-surface,50,50,50));color:rgb(var(--mdui-color-inverse-on-surface,255,255,255));padding:10px 14px;border-radius:8px;font-size:13px;line-height:1.4;box-shadow:0 2px 8px rgba(0,0,0,.4);cursor:pointer}
    .sf-toast-error{background:rgb(var(--mdui-color-error-container,92,21,18));color:rgb(var(--mdui-color-on-error-container,255,255,255))}
    .sf-toast-count{margin-left:8px;font-weight:700;opacity:.85}
    .sf-toast-count:empty{display:none}
    .sf-toast-action{margin-left:8px;padding:2px 10px;border-radius:6px;border:1px solid currentColor;background:transparent;color:inherit;font:inherit;font-size:12px;cursor:pointer}
    .bq-section{display:flex;flex-direction:column;gap:8px}
    .bq-section-title{margin:8px 0 0;font-size:16px;font-weight:500}
    .bq-section-body{display:flex;flex-direction:column;gap:8px}
    .bq-disclosure>summary{cursor:pointer}
    .bq-disclosure[open]>summary{margin-bottom:8px}
    .bq-collapsible>summary{margin-top:8px;font-size:16px;font-weight:500}
    .bq-revive-out{display:flex;flex-direction:column;gap:12px}
    .bq-revive-out[hidden]{display:none}
    .bq-card{display:flex;flex-direction:column;gap:12px}
    .bq-pool{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px}
    .bq-pool-group{grid-column:1/-1;margin:8px 0 0;font-size:14px;font-weight:600}
    .bq-pool .sf-hint{grid-column:1/-1}
    .bq-pipeline{display:flex;flex-direction:column;gap:8px}
    .bq-step{display:flex;align-items:center;gap:8px;padding:8px 12px}
    .bq-step-pending{outline:2px solid rgb(var(--mdui-color-primary));outline-offset:2px}
    .bq-step-locked{opacity:.85}
    .bq-step-dragging{opacity:.45}
    .bq-drop-before{border-top:2px solid rgb(var(--mdui-color-primary))}
    .bq-drop-after{border-bottom:2px solid rgb(var(--mdui-color-primary))}
    .bq-drop-folder{outline:2px solid rgb(var(--mdui-color-primary));outline-offset:2px}
    .bq-step-body{display:flex;flex-direction:column;gap:2px;flex:1 1 auto;min-width:0}
    .bq-step-body-clickable{cursor:pointer}
    .bq-step-meta{font-size:13px;opacity:.72}
    .bq-step-num{min-width:1.5em;font-weight:600;opacity:.72;text-align:right}
    .bq-step-icon{opacity:.6}
    .bq-drag-handle{cursor:grab}
    .bq-step-invalid{border-left:3px solid rgb(var(--mdui-color-error))}
    .bq-step-issue{display:flex;align-items:center;gap:4px;font-size:13px;color:rgb(var(--mdui-color-error))}
    .bq-step-controls{display:flex;gap:4px;align-items:center}
    .bq-runbar{display:flex;flex-direction:column;gap:2px;padding:10px 14px}
    .bq-runbar-title{font-size:16px;font-weight:500}
    .bq-runbar-detail{font-size:14px}
    .bq-runbar-eta{font-size:14px;font-variant-numeric:tabular-nums}
    .bq-action-btn{display:flex;align-items:center;justify-content:center;width:100%;height:60vh;height:60dvh;min-height:240px;box-sizing:border-box;border-radius:24px;background:rgb(var(--mdui-color-primary));color:rgb(var(--mdui-color-on-primary));font-size:clamp(32px,10vw,72px);font-weight:600;letter-spacing:.08em;cursor:pointer;user-select:none;-webkit-user-select:none;touch-action:manipulation;-webkit-tap-highlight-color:transparent}
    .bq-action-btn:active{filter:brightness(.85)}
    /* Roster: cells skip off-screen rendering. Containment does not apply to <tr>, so it sits on the
     * cells, and Chromium ignores contain-intrinsic-size on cells; the row height (today's default:
     * 40px icon buttons + MDUI cell padding) is the skipped-row placeholder, so long strings only grow
     * their own row while it renders. Fixed layout takes column widths from the header instead of
     * measuring every cell, which skipped cells could not report anyway. min-width keeps the old
     * horizontal scroll on narrow screens instead of squeezing the columns. */
    .bq-roster table{table-layout:fixed;min-width:760px}
    .bq-pop{white-space:nowrap}
    .bq-roster th:last-child{width:200px}
    .bq-roster td{overflow-wrap:anywhere}
    .bq-roster-row{cursor:pointer;height:74px}
    .bq-roster-row>td{content-visibility:auto}
    .bq-row-current{background:rgba(var(--mdui-color-primary),.12)}
    .bq-row-locked,.bq-row-excluded{opacity:.55}
    .bq-lock-tag{margin-left:8px;font-size:12px;white-space:nowrap}
    tr.bq-drop-before td{border-top:2px solid rgb(var(--mdui-color-primary))}
    tr.bq-drop-after td{border-bottom:2px solid rgb(var(--mdui-color-primary))}
    .bq-auth mdui-icon{font-size:18px;vertical-align:middle;margin-right:6px}
    .bq-auth-missing{color:rgb(var(--mdui-color-error))}
    .bq-row-actions{white-space:nowrap;text-align:right}
    .bq-empty{padding:16px;opacity:.72;text-align:center}
    .bq-folder-head>td{font-weight:600;padding:12px 16px 6px;border-bottom:1px solid rgba(var(--mdui-color-primary),.4)}
    .bq-dialog-fields{display:flex;flex-direction:column;gap:12px}
    .bq-dialog-fields mdui-text-field,.bq-dialog-fields mdui-select{max-width:none}
    .bq-login-list{max-height:50vh;overflow-y:auto}
    #bq-login-all{white-space:nowrap;margin:0 4px}
    .bq-file-field{display:flex;flex-direction:column;align-items:flex-start;gap:4px}
    .bq-file-label{font-size:14px;font-weight:500}
    .bq-ns-fields{display:flex;flex-direction:column;gap:10px;max-height:62vh;overflow-y:auto;padding-right:4px}
    /* First-run walkthrough (ui/walkthrough.ts): above the 2000 top app bar and 1000 sticky bar,
     * below MDUI dialogs (2300) and toasts (9999). The ring is click-through. */
    .bq-walk-ring{position:fixed;z-index:2100;pointer-events:none;border-radius:8px;outline:2px solid rgb(var(--mdui-color-primary));box-shadow:0 0 0 9999px rgba(0,0,0,.5)}
    .bq-walk-ring[hidden]{display:none}
    .bq-walk-tip{position:fixed;z-index:2101;width:min(340px,calc(100vw - 32px));padding:12px;display:flex;flex-direction:column;gap:8px}
    .bq-walk-tip[hidden]{display:none}
    .bq-walk-title{font-size:15px;font-weight:600}
    .bq-walk-actions{display:flex;justify-content:flex-end;gap:8px}
`;

/* Hides unregistered web components until MDUI's script registers them (FOUC guard). */
export const FOUC_CSS = ":not(:defined){visibility:hidden}";

/* Dark-theme canvas painted before mdui.css arrives, so a Bouquet page load (every Manage↔Settings
 * switch) never shows the browser's white default. mdui.css's `:root` / `.mdui-theme-dark` rules
 * out-specify this `html` rule once loaded, so the light toggle and color schemes still win. */
export const DARK_PREPAINT_CSS = "html{color-scheme:dark;background-color:rgb(20,18,24)}";

/* mdui.css sets no font stack, so components inherit this; body also covers body-portaled overlays
 * (dropdown menu, snackbar). Injected on script pages only. */
export const FONT_CSS = 'body{font-family:Roboto,system-ui,-apple-system,"Segoe UI",sans-serif}';

export const COLOR_SCHEMES: Array<[string, string]> = [
  ["", "Default"],
  ["#0061a4", "Blue"],
  ["#006d3b", "Green"],
  ["#6750a4", "Purple"],
  ["#984061", "Terracotta"],
  ["#ba1a1a", "Red"],
];
