/* Action infrastructure every page shares: SPACE handlers and the skip controls. Split out of
 * ui/dom.ts (which stays builders and layout) because these need net.ts and page-wide mutable
 * slots. One-way import (actions → dom), so no cycle. */

import { isPostInFlight } from "../net";
import { state } from "../state";
import { btn, busyDropToast, dialogOpen, el } from "./dom";

/* Display label for a KeyboardEvent.code binding: "Space", `KeyG` → "G", `Digit1` → "1", anything
 * else the raw code. One helper, so page hints, skip-button titles and the Settings editor can
 * never drift apart. */
export function keyLabel(code: string): string {
  if (code === "Space") return "Space";
  const key = /^Key([A-Z0-9])$/.exec(code);
  if (key) return key[1];
  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1];
  return code;
}

/* The page-action trigger's display label: the bound key, or "Action button" while the on-screen
 * button replaces it. Every hint/toast/note that names the press goes through this, so none of
 * them can hardcode SPACE while the key is rebound or replaced. */
export function actionKey(): string {
  return state.actionButton ? "Action button" : keyLabel(state.keys.action);
}

/* "<msg> — next: <what> (press <key>)" */
export function nextHint(msg: string, next: string): string {
  return `${msg} — next: ${next} (press ${actionKey()})`;
}

/* Global puppet-queue failsafe. One button for the status row, owned here (not in ui/shell, which
 * imports pages/index — a page importing it would be a cycle): mountShell renders it, each page
 * calls registerSkip with what advancing its own puppet cursor means (null = no such queue).
 * Page navigations are full document loads, so nothing ever needs unregistering. */
const NO_ACTOR_QUEUE = "No puppet queue on this page";
let onSkipActor: (() => void) | null = null;
let skipActorBtn: HTMLElementTagNameMap["mdui-button"] | null = null;

export function mountSkipButton(): HTMLElementTagNameMap["mdui-button"] {
  /* Stays enabled while a POST is in flight: a skip only moves a cursor, never cancels a request. */
  const actor = btn("Next puppet ▸", NO_ACTOR_QUEUE, () => onSkipActor?.());
  actor.id = "bq-skip-actor";
  actor.disabled = true;
  skipActorBtn = actor;
  /* `A` = the same failsafe as the button, with the page-action key's guards. */
  bindKey(
    () => state.keys.nextActor,
    () => onSkipActor?.(),
    () => onSkipActor !== null,
  );
  return actor;
}

export function registerSkip(actor: (() => void) | null): void {
  onSkipActor = actor;
  if (skipActorBtn) {
    skipActorBtn.disabled = !actor;
    skipActorBtn.setAttribute(
      "title",
      actor ? `Skip the current puppet (${keyLabel(state.keys.nextActor)})` : NO_ACTOR_QUEUE,
    );
  }
}

/* Keydown target inside an editable control: MDUI web components retarget shadow-root events to
 * the host, so composedPath()[0] is the real target. */
function isEditableTarget(t: EventTarget | null | undefined): boolean {
  return !!(
    t instanceof Element &&
    (t.closest("input,textarea,select,mdui-text-field,mdui-select,mdui-checkbox") ||
      /^MDUI-/.test(t.tagName))
  );
}

/* Page-wide shortcuts stand down inside editable controls and while a dialog is open. */
function shortcutAllowed(e: KeyboardEvent): boolean {
  const path = e.composedPath();
  return !isEditableTarget(path.length ? path[0] : e.target) && !dialogOpen();
}

/* One bare-key page shortcut: no repeat/modifiers, bound code read live, stands down in editable
 * controls and while a dialog is open. `enabled` is checked before preventDefault. */
function bindKey(
  code: () => string,
  fn: () => void | Promise<void>,
  enabled: () => boolean = () => true,
): void {
  document.addEventListener("keydown", (e) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if (e.code !== code() || !enabled() || !shortcutAllowed(e)) return;
    e.preventDefault();
    void fn();
  });
}

/* One page-action press, from the key or the Action button: drops while a POST is in flight. */
async function press(fn: () => void | Promise<void>): Promise<void> {
  if (isPostInFlight()) {
    busyDropToast();
    return;
  }
  await fn();
}

/* One page-action handler per page, on the bound key — or, when `state.actionButton`, on an
 * on-screen button prepended to `host`; never both. The key path ignores inputs/repeat/modifiers/
 * open dialogs; both drop while a POST is in flight. Async because a page's action may await its own
 * reads. MDUI controls are web components, so keydown from inside their shadow roots retargets to
 * the host (MDUI-TEXT-FIELD etc.); composedPath()[0] is the real target. Returns the on-screen
 * button, or null on the key path. */
export function onSpace(fn: () => void | Promise<void>, host: HTMLElement): HTMLElement | null {
  if (state.actionButton) {
    /* A non-focusable div, not a <button>: a focused button is activated by Space/Enter, which
     * would let the keyboard drive the action again. */
    const button = el(
      "div",
      {
        class: "bq-action-btn",
        role: "button",
        "aria-label": "Action",
        title: "Page action: send the next request",
        onclick: () => {
          if (dialogOpen()) return;
          void press(fn);
        },
      },
      "ACTION",
    );
    host.prepend(button);
    return button;
  }
  bindKey(
    () => state.keys.action,
    () => press(fn),
  );
  return null;
}
