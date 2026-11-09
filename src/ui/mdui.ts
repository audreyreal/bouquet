/* MDUI global access + toast. Leaf module: imports nothing else from src, so every layer can report. */

import { MAX_TOASTS, TOAST_MS } from "../constants";

export function mduiGlobal(): MduiGlobal | null {
  return window.mdui ?? (typeof mdui !== "undefined" ? mdui : null);
}

/* Per-row bookkeeping for coalescing; WeakMap so dismissed/evicted rows drop out on their own. */
const toastMeta = new WeakMap<
  Element,
  { key: string; count: number; badge: HTMLSpanElement; timer: number }
>();

/* Optional inline button on a toast row. Built with raw DOM (this module stays a leaf: it must not
 * import dom.ts/auth.ts, so the click behavior arrives as a caller-supplied callback). */
export interface ToastAction {
  label: string;
  key?: string;
  act: () => void;
}

export type ToastKind = "error" | "info";

/* Fixed bottom-end stack, newest on top, oldest evicted past MAX_TOASTS. Bypasses m.snackbar so
 * rapid SPACE-mashing shows up to MAX_TOASTS messages at once instead of serializing in a queue.
 * A message identical (text + kind + action) to a visible row does not add a row: that row moves to
 * the top, shows a ×N count and restarts its dismiss timer, so repeated "busy — dropped" presses
 * occupy one slot, and a reused row keeps its existing button. Every row auto-dismisses after
 * TOAST_MS. */
export function toast(msg: string, kind?: ToastKind, action?: ToastAction): void {
  const box = ensureToastBox();
  const text = msg,
    cls = kind === "error" ? "sf-toast sf-toast-error" : "sf-toast",
    key = `${cls}\n${text}${action ? `\n${action.label}\n${action.key ?? ""}` : ""}`;
  let item: HTMLElement | null = null;
  for (const child of Array.from(box.children)) {
    const meta = toastMeta.get(child);
    if (meta && meta.key === key) {
      meta.count++;
      meta.badge.textContent = `×${meta.count}`;
      clearTimeout(meta.timer);
      item = child as HTMLElement;
      break;
    }
  }
  if (!item) {
    const row = document.createElement("div");
    row.className = cls;
    row.textContent = text; /* textContent-only: messages embed nation names */
    if (action) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "sf-toast-action";
      button.textContent = action.label;
      button.title = `${action.label}: ${text}`;
      /* stopPropagation: row.onclick dismisses the toast, so the click must not reach it. */
      button.onclick = (ev) => {
        ev.stopPropagation();
        action.act();
        row.remove();
      };
      row.appendChild(button);
    }
    const badge = document.createElement("span");
    badge.className = "sf-toast-count";
    row.appendChild(badge);
    row.onclick = () => row.remove();
    toastMeta.set(row, { key, count: 1, badge, timer: 0 });
    item = row;
  }
  box.insertBefore(item, box.firstChild);
  while (box.children.length > MAX_TOASTS) box.lastElementChild?.remove();
  const shown = item,
    meta = toastMeta.get(shown);
  if (meta) meta.timer = window.setTimeout(() => shown.remove(), TOAST_MS);
}

/* Lazy singleton. */
function ensureToastBox(): HTMLElement {
  const existing = document.getElementById("sf-toasts");
  if (existing) return existing;
  const box = document.createElement("div");
  box.id = "sf-toasts";
  box.className = "sf-toasts";
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  document.body.appendChild(box);
  return box;
}
