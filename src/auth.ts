/* Per-puppet authorization tokens. A puppet's POST authorization is the pair of hidden form values
 * NS renders on its own pages (`chk` + `localid`), which every Restricted POST here appends to its
 * body; harvesting reads them off the live document. This module never touches cookies and never
 * issues a request. */

import { DEFAULT_FOLDER_ID } from "./constants";
import { type BouquetAuth, nextAddedAt, persist, state } from "./state";
import { canon } from "./utils";

/* The acting nation's region off a themed page's sidebar: Rift `li#panelregionbar > a`, Century
 * `a.STANDOUT` (Century's nation link is also STANDOUT, hence the href test). "" = no sidebar
 * (template-overall=none pages) or no region link. */
function sidebarRegion(doc: Document): string {
  const links = doc.querySelectorAll<HTMLAnchorElement>(
    "li#panelregionbar > a[href], #panel ul.menu > li > a.STANDOUT[href]",
  );
  for (let i = 0; i < links.length; i++) {
    const m = /(?:^|\/)region=([^/?#]+)/.exec(links[i].getAttribute("href") ?? "");
    if (!m) continue;
    try {
      return canon(decodeURIComponent(m[1]));
    } catch {
      return canon(m[1]);
    }
  }
  return "";
}

function tokenValue(doc: Document, name: "chk" | "localid"): string {
  return doc.querySelector<HTMLInputElement>(`input[name="${name}"]`)?.value.trim() ?? "";
}

/* Harvest `chk`/`localid` off a rendered NS document (the console document itself, or any followed
 * response). Each token found updates the stored value on its own; a missing one keeps the stored
 * value. The nation is body[data-nname] (the page was rendered for that session), else `actor`:
 * template-overall=none pages have no <body> and carry one or both tokens. A nation with no stored
 * pair is written only once both tokens are known; a new nation is auto-added to the roster. A
 * themed page also reports the nation's region in its sidebar, which is recorded too. Persists only
 * when something changed (unchanged tokens just refresh updatedAt in memory). Returns the nation
 * written, or null. */
export function harvestAuth(doc: Document, actor?: string): string | null {
  const n = canon(doc.body?.getAttribute("data-nname") || actor || "");
  if (!n) return null;
  const chk = tokenValue(doc, "chk");
  const localid = tokenValue(doc, "localid");
  if (chk === "" && localid === "") return null;
  const prev = state.auth[n];
  const next = { chk: chk || prev?.chk || "", localid: localid || prev?.localid || "" };
  if (next.chk === "" || next.localid === "") return null;
  const isNew = !state.nations[n];
  const region = sidebarRegion(doc);
  const changed =
    isNew ||
    !prev ||
    prev.chk !== next.chk ||
    prev.localid !== next.localid ||
    (region !== "" && state.regions[n] !== region);
  if (isNew)
    state.nations[n] = { addedAt: nextAddedAt(), locked: false, folder: DEFAULT_FOLDER_ID };
  state.auth[n] = { ...next, updatedAt: Date.now() };
  if (region !== "") state.regions[n] = region;
  if (changed) persist();
  return n;
}

export function authFor(name: string): BouquetAuth | null {
  return state.auth[canon(name)] ?? null;
}

export function needsAuth(name: string): boolean {
  return authFor(name) === null;
}
