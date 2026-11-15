import { loginBody } from "../actions/nation/login";
import { navigatePost } from "../net";
import { nationNames, passwordFor, state } from "../state";
import { canon } from "../utils";
import { el, injectNativeCss } from "./dom";

/* A native Login button after every roster nation's name block or nation-page title link on native
 * pages (including content added later, e.g. live activity feeds), naming the nation by the link's
 * `nation=` path (else the `.nname` text) and submitting a real form POST via navigatePost that
 * reloads this page (the front page when this is a nation page) as that nation. Not in the telegram
 * UI (telegram pages and the `#tgcompose` box). */

const done = new WeakSet<Element>();

/* Path of a nation page link (`nation=x`, `/nation=x`, `/nation=x/detail=…`), resolved via <base>. */
const NATION_PATH = /^\/nation=([^/]+)/;
/* Name blocks (inside a.nlink in happenings, lists, RMB) and the nation page title link. */
const TARGETS = ".nnameblock, .newtitlename > a";
/* Telegram pages, by NS's <html id="page_<page name>">: inbox, single telegram, compose. */
const TELEGRAM_PAGES: Record<string, true> = {
  page_telegrams: true,
  page_tg: true,
  page_compose_telegram: true,
};
/* The telegram compose box (other nations' pages), incl. its ajax-loaded recipients #tgtoloaded. */
const TELEGRAM_COMPOSE = "#tgcompose";

function nationOf(target: Element): string {
  const link = target.closest("a");
  const m = link ? NATION_PATH.exec(link.pathname) : null;
  if (m) return canon(m[1]);
  return canon((target.querySelector(":scope > .nname")?.textContent ?? "").trim());
}

/* NS logs in to the URL's nation, not the form's, when a login POSTs to a nation page; those go to
 * the front page instead. */
function loginTarget(): string {
  return /(^|\/)nation=/.test(location.pathname) ? "/" : `${location.pathname}${location.search}`;
}

function decorate(target: Element, self: string): void {
  if (done.has(target)) return;
  done.add(target);
  if (target.closest(TELEGRAM_COMPOSE)) return;
  const n = nationOf(target);
  if (!n || n === self || !state.nations[n]) return;
  injectNativeCss();
  const password = passwordFor(n);
  const button = el(
    "button",
    {
      type: "button",
      class: "button small bq-nlogin",
      title: password ? `Log in as ${n} (Bouquet)` : "No password stored — set one in Bouquet",
      onclick: (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        button.disabled = true;
        navigatePost(loginTarget(), loginBody(n, password));
      },
    },
    "Login",
  );
  button.disabled = !password;
  /* After the enclosing a.nlink (or the title link itself), so a click doesn't follow the link. */
  (target.closest("a") ?? target).after(button);
}

function scan(root: ParentNode, self: string): void {
  if (root instanceof Element && root.matches(TARGETS)) decorate(root, self);
  root.querySelectorAll(TARGETS).forEach((block) => {
    decorate(block, self);
  });
}

export function addNativeLoginButtons(): void {
  if (
    !state.nativeLoginButtons ||
    !document.body ||
    nationNames().length === 0 ||
    TELEGRAM_PAGES[document.documentElement.id] === true
  )
    return;
  const self = canon(document.body.getAttribute("data-nname") ?? "");
  scan(document.body, self);
  new MutationObserver((records) => {
    for (const r of records)
      r.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node, self);
      });
  }).observe(document.body, { childList: true, subtree: true });
}
