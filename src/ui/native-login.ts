import { loginBody } from "../actions/nation/login";
import { navigatePost } from "../net";
import { nationNames, passwordFor, state } from "../state";
import { canon } from "../utils";
import { el, injectNativeCss } from "./dom";

/* A native Login button after every roster nation's name block on native pages (including names
 * added later), submitting a real form POST via navigatePost that reloads this page (the front page
 * when this is a nation page) as that nation. */

const done = new WeakSet<Element>();

/* NS logs in to the URL's nation, not the form's, when a login POSTs to a nation page; those go to
 * the front page instead. */
function loginTarget(): string {
  return /(^|\/)nation=/.test(location.pathname) ? "/" : `${location.pathname}${location.search}`;
}

function decorate(block: Element, self: string): void {
  if (done.has(block)) return;
  done.add(block);
  const nameEl = block.querySelector(":scope > .nname");
  if (!nameEl) return;
  const n = canon((nameEl.textContent ?? "").trim());
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
  /* After the enclosing a.nlink, so a click doesn't follow the nation link. */
  (block.closest("a") ?? block).after(button);
}

function scan(root: ParentNode, self: string): void {
  if (root instanceof Element && root.matches(".nnameblock")) decorate(root, self);
  root.querySelectorAll(".nnameblock").forEach((block) => {
    decorate(block, self);
  });
}

export function addNativeLoginButtons(): void {
  if (!state.nativeLoginButtons || !document.body || nationNames().length === 0) return;
  const self = canon(document.body.getAttribute("data-nname") ?? "");
  scan(document.body, self);
  new MutationObserver((records) => {
    for (const r of records)
      r.addedNodes.forEach((node) => {
        if (node instanceof Element) scan(node, self);
      });
  }).observe(document.body, { childList: true, subtree: true });
}
