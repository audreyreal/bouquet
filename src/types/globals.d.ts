/* MDUI global build (@require) — the subset of the API this script calls. */
interface MduiGlobal {
  setTheme(theme: string, target?: string | HTMLElement): void;
  getTheme(): string;
  setColorScheme(color: string, options?: { target?: string | HTMLElement }): void;
  removeColorScheme(options?: { target?: string | HTMLElement }): void;
}

/* Components this script reads state off: values live on the host element. */
interface MduiValueElement extends HTMLElement {
  value: string;
}
interface MduiCheckedElement extends HTMLElement {
  checked: boolean;
}
interface MduiButtonElement extends HTMLElement {
  disabled: boolean;
  loading: boolean;
}
interface MduiDialogElement extends HTMLElement {
  open: boolean;
}

interface HTMLElementTagNameMap {
  "mdui-button": MduiButtonElement;
  "mdui-button-icon": HTMLElement;
  "mdui-card": HTMLElement;
  "mdui-checkbox": MduiCheckedElement;
  "mdui-dialog": MduiDialogElement;
  "mdui-dropdown": HTMLElement;
  "mdui-icon": HTMLElement;
  "mdui-linear-progress": HTMLElement;
  "mdui-list": HTMLElement;
  "mdui-list-item": HTMLElement;
  "mdui-menu": MduiValueElement;
  "mdui-menu-item": MduiValueElement;
  "mdui-segmented-button": MduiValueElement;
  "mdui-segmented-button-group": MduiValueElement;
  "mdui-select": MduiValueElement;
  "mdui-tab": MduiValueElement;
  "mdui-tabs": MduiValueElement;
  "mdui-text-field": MduiValueElement;
  "mdui-top-app-bar": HTMLElement;
  "mdui-top-app-bar-title": HTMLElement;
}

interface Window {
  mdui?: MduiGlobal;
}

declare function GM_getValue(key: string, defaultValue?: string): string | undefined;
declare function GM_setValue(key: string, value: string): void;

/* Userscript storage API (@grant GM_getValue/GM_setValue). */

/* Some userscript sandboxes expose the MDUI global on the sandbox global rather than window. */
declare const mdui: MduiGlobal;
/* Build-injected userscript version (scripts/build.ts define, parsed from
 * src/userscript-header.txt @version); undefined outside the built bundle. */
declare const __BOUQUET_VERSION__: string | undefined;
