import { harvestAuth } from "./auth";
import { BOUQUET_ORIGIN, RETURN_KEY, TAB_LOCK } from "./constants";
import { BOUQUET_RE, RENDER } from "./pages/index";
import { ensureMainNation } from "./state";
import { refreshStatus } from "./ui/dom";
import { addNativeLoginButtons } from "./ui/native-login";
import {
  injectDarkPrepaint,
  injectViewportMeta,
  loadMduiAssets,
  mountBootError,
  mountShell,
} from "./ui/shell";
import { addTopBarButton } from "./ui/top-bar";
import { startWalkthrough } from "./ui/walkthrough";
import { gv, sleep, sv } from "./utils";

export function isTemplateNone(href = location.href): boolean {
  /* Chromeless URL marker, query form (?/&) or path form (/), same parse the helper uses. */
  return /(?:[?&/])template-overall=none(?:[&#/]|$)/.test(href);
}

function bouquetPageOf(u: URL): string | null {
  if (u.pathname.indexOf("page=blank") < 0) return null;
  const m = u.search.match(BOUQUET_RE);
  if (!m || !isTemplateNone(u.href)) return null;
  return m[1];
}

export function bouquetPage(): string | null {
  return bouquetPageOf(new URL(location.href));
}

/* The NS page this Bouquet visit started from. A non-Bouquet *.nationstates.net referrer starts
 * a new visit; a Bouquet referrer (Manage↔Settings, walkthrough, reload) keeps the stored one;
 * no referrer or another site clears it. "" = unknown. */
function rememberReturnUrl(): string {
  const ref = document.referrer ? new URL(document.referrer) : null;
  const nsRef =
    ref &&
    (ref.protocol === "https:" || ref.protocol === "http:") &&
    /(^|\.)nationstates\.net$/.test(ref.hostname)
      ? ref
      : null;
  if (nsRef && bouquetPageOf(nsRef)) return gv(RETURN_KEY, "");
  const next = nsRef ? nsRef.href : "";
  sv(RETURN_KEY, next);
  return next;
}

/* One Bouquet tab at a time: an exclusive Web Lock held for this document's lifetime. A second try
 * a second later covers in-tab Manage↔Settings navigation, where the previous document may still
 * be releasing it. */
async function acquireTabLock(): Promise<boolean> {
  const tryOnce = (): Promise<boolean> => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    void navigator.locks.request(TAB_LOCK, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      /* A granted lock stays held while this never-settling promise is pending. */
      return lock === null ? undefined : Promise.withResolvers<never>().promise;
    });
    return promise;
  };
  if (await tryOnce()) return true;
  await sleep(1000);
  return tryOnce();
}

export async function boot(): Promise<void> {
  const page = bouquetPage();
  if (!page) {
    addTopBarButton();
    addNativeLoginButtons();
    return;
  }
  if (location.origin !== BOUQUET_ORIGIN) {
    location.replace(`${BOUQUET_ORIGIN}${location.pathname}${location.search}${location.hash}`);
    return;
  }
  injectViewportMeta();
  injectDarkPrepaint();
  if (typeof navigator.locks === "undefined") {
    mountBootError("Bouquet needs a browser with Web Locks support.");
    return;
  }
  if (!(await acquireTabLock())) {
    mountBootError(
      "Bouquet is already open in another tab — use that tab, or close it and reload this one.",
    );
    return;
  }
  const returnUrl = rememberReturnUrl();
  /* This document is itself a first-class harvest source: NS renders the acting session's
   * `chk`/`localid` on its own pages, so a tab load that carries them keeps the roster fresh. The
   * main nation comes from the stored value, else a prompt pre-filled with the harvested one. */
  const harvested = harvestAuth(document) ?? "";
  if (!ensureMainNation(harvested)) {
    mountBootError("Bouquet needs your main nation — reload this page to enter it.");
    return;
  }
  const m = loadMduiAssets();
  if (!m) {
    mountBootError("MDUI failed to load — check CDN");
    return;
  }
  const shell = mountShell(page, returnUrl, m);
  RENDER[page](shell.main, shell.bar);
  refreshStatus();
  startWalkthrough(page);
}
