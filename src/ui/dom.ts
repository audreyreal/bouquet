/* DOM builders and layout helpers. Action infrastructure (SPACE handlers, skip controls, POST
 * verdict toasts) lives in ./actions.ts; this module stays the builder/layout layer and imports
 * nothing from it. */

import { BUSY_DROP_MSG } from "../constants";
import { withGeneratedBy } from "../net";
import { persist, state } from "../state";
import { canon } from "../utils";
import { NATIVE_CSS } from "./css";
import { toast } from "./mdui";

/* Small builders; MDUI tags are ordinary elements with plain-string attributes. */
export type Child = Node | string | null | undefined | false;
/* Function values are on* handlers, assigned as properties (setAttribute would stringify them). */
type Attrs = Record<string, string | number | null | undefined | ((event: never) => void)>;

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs | null = null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v == null) continue;
      if (typeof v === "function") (node as unknown as Record<string, unknown>)[k] = v;
      else if (k === "style") node.style.cssText = String(v);
      else node.setAttribute(k, String(v));
    }
  }
  for (const c of children) if (c != null && c !== false && c !== "") node.append(c);
  return node;
}

/* The few rules the BOUQUET top-bar button and native Login buttons need on NationStates' own pages. */
export function injectNativeCss(): void {
  if (document.getElementById("bq-native-css")) return;
  document.head.appendChild(el("style", { id: "bq-native-css" }, NATIVE_CSS));
}

export function btn(
  label: string,
  title: string,
  onClick?: ((e: MouseEvent) => void) | null,
  variant?: string,
): HTMLElementTagNameMap["mdui-button"] {
  return el("mdui-button", { variant, title, onclick: onClick }, label);
}

export function iconButton(
  icon: string,
  label: string,
  onClick: (event: MouseEvent) => void,
  disabled = false,
): HTMLElement {
  return el("mdui-button-icon", {
    icon,
    title: label,
    "aria-label": label,
    disabled: disabled ? "" : null,
    onclick: onClick,
  });
}

/* Modal dialog appended to <body>: `content` then each action button (slot="action") in order.
 * Esc and overlay clicks close it. */
export function modal(
  attrs: Record<string, string>,
  content: HTMLElement | null,
  ...actions: HTMLElement[]
): HTMLElementTagNameMap["mdui-dialog"] {
  for (const action of actions) action.setAttribute("slot", "action");
  const dlg = el(
    "mdui-dialog",
    { ...attrs, "close-on-esc": "", "close-on-overlay-click": "" },
    content,
    ...actions,
  );
  document.body.appendChild(dlg);
  return dlg;
}

/* In-flight-guard drop notification, gated by the Settings toggle. Every BUSY_DROP_MSG site calls
 * this instead of toast() directly, so one flag silences all of them; the drop itself is unchanged. */
export function busyDropToast(): void {
  if (state.suppressBusyDrop) return;
  toast(BUSY_DROP_MSG, "error");
}

/* True while any MDUI dialog is open (page shortcuts and the tour stand down). */
export function dialogOpen(): boolean {
  return Array.from(document.querySelectorAll("mdui-dialog")).some((d) => d.open);
}

/* The puppet's own native page, tagged with the script identity and opened in a new tab. It loads
 * as whatever the browser session is signed in as — putting a puppet's page next to the roster is a
 * navigation, not an authentication step. */
export function nationLink(name: string): HTMLAnchorElement {
  return el(
    "a",
    {
      class: "bq-nation-link",
      href: withGeneratedBy(`/nation=${canon(name)}`),
      target: "_blank",
      rel: "noopener",
    },
    name,
  );
}

/* Table cell for a nation-name column. */
export function nationCell(name: string): HTMLTableCellElement {
  return el("td", null, nationLink(name));
}

/* List row whose headline starts with the nation name (MDUI renders default-slot children as the
 * headline; the `headline` attribute would be plain text only). `suffix` = status/cursor text. */
export function nationListItem(name: string, suffix = ""): HTMLElementTagNameMap["mdui-list-item"] {
  return el("mdui-list-item", null, nationLink(name), suffix);
}

/* Layout helpers; spacing/width live in BASE_CSS, never per-node inline styles. */
export function hint(text: string): HTMLDivElement {
  return el("div", { class: "sf-hint" }, text);
}

/* Titled page section: h3 heading, optional one-line note, then the body (usually card()). */
export function section(title: string, body: HTMLElement, note?: string): HTMLDivElement {
  return el(
    "div",
    { class: "bq-section" },
    el("h3", { class: "bq-section-title" }, title),
    note ? hint(note) : null,
    body,
  );
}

/* Native <details>; `onToggle` fires on real user toggles only. */
export function disclosure(
  title: string,
  open: boolean,
  onToggle?: (open: boolean) => void,
): { root: HTMLDetailsElement; panel: HTMLDivElement } {
  const panel = el("div", { class: "bq-section-body" });
  const root = el("details", { class: "bq-disclosure" }, el("summary", null, title), panel);
  root.open = open;
  let last = open;
  if (onToggle)
    root.addEventListener("toggle", () => {
      if (root.open === last) return; /* setting `open` above also queues a toggle event */
      last = root.open;
      onToggle(last);
    });
  return { root, panel };
}

/* A titled section whose <summary> toggles the note + body. `id` keys the persisted collapse state
 * in state.collapsedSections, so it must be stable and unique across pages. */
export function collapsibleSection(
  id: string,
  title: string,
  body: HTMLElement,
  note?: string,
): HTMLDetailsElement {
  const { root, panel } = disclosure(title, !state.collapsedSections.includes(id), (open) => {
    if (open) state.collapsedSections = state.collapsedSections.filter((x) => x !== id);
    else if (!state.collapsedSections.includes(id)) state.collapsedSections.push(id);
    persist();
  });
  root.classList.add("bq-collapsible");
  panel.append(...(note ? [hint(note)] : []), body);
  return root;
}

export function card(...children: HTMLElement[]): HTMLElementTagNameMap["mdui-card"] {
  return el("mdui-card", { variant: "outlined", class: "bq-card" }, ...children);
}

/* Wraps consecutive controls so flex-wrap + gap space them; order preserved. */
export function row(...nodes: HTMLElement[]): HTMLDivElement {
  return el("div", { class: "sf-row" }, ...nodes);
}

export function selectField(
  label: string,
  options: Array<[string, string]>,
  value: string,
): HTMLElementTagNameMap["mdui-select"] {
  const sel = el(
    "mdui-select",
    { label },
    ...options.map((o) => el("mdui-menu-item", { value: o[0] }, o[1])),
  );
  sel.value = value;
  return sel;
}

/* Table scaffold: `div.mdui-table > table.mdui-table > thead/tr/th… + tbody`. Returns the scroller
 * (what the page appends to `main`) and the tbody (what its repaint fills); the caller keeps its own
 * row rendering, sorting and repaint logic. */
export function buildTable(heads: string[]): {
  scroll: HTMLElement;
  tbody: HTMLTableSectionElement;
} {
  const tbody = el("tbody");
  const scroll = el(
    "div",
    { class: "mdui-table" },
    el(
      "table",
      { class: "mdui-table" },
      el("thead", null, el("tr", null, ...heads.map((h) => el("th", null, h)))),
      tbody,
    ),
  );
  return { scroll: scroll, tbody: tbody };
}

/* Copy `text` to the clipboard: `okMsg` on success, the text itself (or "(empty)") when the
 * clipboard API is unavailable or the write is refused, so it can still be copied by hand. */
export function copyText(text: string, okMsg: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => {
        toast(okMsg);
      },
      () => {
        toast(text || "(empty)", "error");
      },
    );
  } else toast(text || "(empty)", "error");
}

/* mountShell hands over the status element; every roster/main-nation change calls refreshStatus. */
let statusLine: HTMLElement | null = null;

export function bindStatusLine(node: HTMLElement): void {
  statusLine = node;
  refreshStatus();
}

export function refreshStatus(): void {
  if (statusLine) statusLine.textContent = statusText();
}

function statusText(): string {
  const names = Object.keys(state.nations);
  const missing = names.filter((n) => !state.auth[n]).length;
  return `${names.length} puppets · ${names.length - missing} with auth${missing ? ` · ${missing} missing` : ""} · main ${state.mainNation || "unset"}`;
}
