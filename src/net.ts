import { harvestAuth } from "./auth";
import {
  API_FALLBACK_GAP_MS,
  API_LOCKOUT_FALLBACK_MS,
  API_RATE_RESERVE,
  NATIONS_DUMP_PATH,
  RELOAD_GAP_MS,
  SCRIPT_TAG,
} from "./constants";
import { state } from "./state";
import { canon, parseHtml, sleep } from "./utils";

let postInFlight = false;
let busyBar: HTMLElement | null = null;

/* NS's front end answers 502 Bad Gateway, or an empty body, when the site is overloaded. Neither is
 * an NS verdict, so it is never parsed as a page. Press-driven requests hold their queue and the
 * next press re-sends; background reads re-send on their own, RELOAD_GAP_MS apart. */
function nsBusy(status: number, body: string): boolean {
  return status === 502 || body.trim() === "";
}
export const NS_BUSY_MSG = "NS busy (502/empty) — press again to retry";

/* Console busy bar (mountShell owns the element); null on native-only pages. */
export function setBusyBar(bar: HTMLElement | null): void {
  busyBar = bar;
}

export function isPostInFlight(): boolean {
  return postInFlight;
}

function setBusy(on: boolean): void {
  document.body?.classList.toggle("bq-busy", on);
  if (busyBar) busyBar.hidden = !on;
  const els = document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
    "form button, form input[type=submit]",
  );
  for (let i = 0; i < els.length; i++) {
    const node = els[i];
    if (on) {
      if (node.disabled) continue;
      node.setAttribute("disabled", "true");
      node.classList.add("disabledForSimultaneity");
    } else if (node.classList.contains("disabledForSimultaneity")) {
      node.removeAttribute("disabled");
      node.classList.remove("disabledForSimultaneity");
    }
  }
}

/* Live identity tag: must stay string-equal to script= in withIdent/apiUrl. */
function generatedByValue(): string {
  return `${SCRIPT_TAG}__usedBy_${state.mainNation || "unknown"}`;
}

/* `template` = false keeps NS's full themed page (login: its sidebar reports the region). */
function withIdent(path: string, template = true): string {
  const u = new URL(path, location.origin);
  u.searchParams.set("script", generatedByValue());
  u.searchParams.set("userclick", String(Date.now()));
  if (template) u.searchParams.set("template-overall", "none");
  return u.toString();
}

/* Autonomous API URL: script identity only, no userclick. */
function apiUrl(params: Record<string, string>): URL {
  const url = new URL("/cgi-bin/api.cgi", location.origin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  url.searchParams.set("script", generatedByValue());
  return url;
}

/* Clickable-link identity: tags script-generated navigations with the same value as script=.
 * External, fragment and scheme URLs are left byte-identical. */
export function withGeneratedBy(href: string): string {
  if (!href || href.charAt(0) === "#" || href.indexOf("//") === 0) return href;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) return href;
  try {
    const u = new URL(href, location.origin);
    u.searchParams.set("generated_by", generatedByValue());
    return `${u.pathname}${u.search}${u.hash}`;
  } catch {
    return href;
  }
}

/* A Bouquet tab's chromeless URL, identity-tagged (tabs, native top-bar button, walkthrough). */
export function pageHref(page: string): string {
  return withGeneratedBy(`/page=blank?bouquet=${page}&template-overall=none`);
}

/* A real browser navigation, not fetch: POSTs a hidden form to `path`, identity-tagged like every
 * other request (script + userclick) and keeping the themed page. The browser replaces this
 * document with the response. Attributes are set before the inputs and submit() is called off the
 * prototype, since an input named `submit` (the login body has one) shadows form.submit. */
export function navigatePost(path: string, body: Record<string, string>): void {
  const form = document.createElement("form");
  form.setAttribute("method", "post");
  form.setAttribute("action", withIdent(path, false));
  form.setAttribute("target", "_top");
  form.hidden = true;
  for (const [name, value] of Object.entries(body)) {
    const input = document.createElement("input");
    input.type = "hidden";
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  document.body.appendChild(form);
  HTMLFormElement.prototype.submit.call(form);
}

export interface PostResult {
  ok: boolean;
  busy: boolean;
  html: string;
  info: string;
  /* Text of every non-empty p.error, then every non-empty p.info, joined " · "; "" when none. */
  notice: string;
  status: number;
  location: string;
  /* Final response URL (after any followed redirect). */
  url: string;
  /* Text of every non-empty p.error, joined " · "; "" when none. */
  error: string;
  json: unknown | null;
}
export interface PostOpts {
  manualRedirect?: boolean;
  /* Keep the themed page (no template-overall=none). */
  fullPage?: boolean;
  /* Nation this request acts as: response tokens on a page without body[data-nname] are stored under it. Omit for anonymous requests (login, restore). */
  actor?: string;
}
export interface MultipartFile {
  blob: Blob;
  filename: string;
}

/* One response body → PostResult, plus the token re-harvest: every followed HTML response (the
 * final page after redirects), whatever its template, has its `chk`/`localid` harvested, attributed
 * as in harvestAuth (body[data-nname], else `actor`), so rotated tokens are picked up on the very
 * response that used the old pair (no dedicated re-auth pass, no stale-token accumulation). */
async function parsePost(resp: Response, actor?: string): Promise<PostResult> {
  const html = await resp.text();
  const res: PostResult = {
    ok: false,
    busy: false,
    html,
    info: "",
    notice: "",
    status: resp.status,
    location: resp.headers.get("location") ?? "",
    url: resp.url,
    error: "",
    json: null,
  };
  if (nsBusy(res.status, html)) return { ...res, busy: true };
  let json: unknown = null;
  if ((resp.headers.get("content-type") || "").includes("application/json")) {
    try {
      json = JSON.parse(html);
    } catch {
      json = null;
    }
  }
  const doc = parseHtml(html);
  harvestAuth(doc, actor);
  const text = (sel: string) =>
    Array.from(doc.querySelectorAll(sel), (p) => (p.textContent ?? "").replace(/\s+/g, " ").trim())
      .filter((t) => t !== "")
      .join(" · ");
  const info = text("p.info");
  const error = text("p.error");
  return {
    ...res,
    ok: doc.querySelector("p.info") !== null,
    info,
    notice: [error, info].filter((t) => t !== "").join(" · "),
    error,
    json,
  };
}

/* The one Restricted-request path: exactly one in flight, extra presses resolve null. `buildBody`
 * (null = GET) runs only for a request that is actually sent. */
export async function send(
  path: string,
  buildBody: (() => BodyInit) | null,
  opts?: PostOpts,
): Promise<PostResult | null> {
  if (postInFlight) return null;
  postInFlight = true;
  setBusy(true);
  try {
    const resp = await fetch(withIdent(path, !opts?.fullPage), {
      method: buildBody ? "POST" : "GET",
      credentials: "include",
      redirect: opts?.manualRedirect ? "manual" : "follow",
      body: buildBody?.(),
    });
    return await parsePost(resp, opts?.actor);
  } finally {
    postInFlight = false;
    setBusy(false);
  }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match =
    /^data:([^;,]+);base64,((?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?)$/.exec(
      dataUrl,
    );
  if (!match) throw new Error("invalid image data");
  try {
    const binary = atob(match[2]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: match[1] });
  } catch {
    throw new Error("invalid image data");
  }
}

/* Shared read fetch: never touches postInFlight, runs concurrently. */
function fetchDoc(url: string): Promise<Document | "busy" | null> {
  return fetch(url, { credentials: "include", redirect: "follow" })
    .then((resp) =>
      resp.text().then((html) => (nsBusy(resp.status, html) ? ("busy" as const) : parseHtml(html))),
    )
    .catch(() => null);
}

/* Read-only fetch with userclick: the user pressed/clicked for this one. One request per press: a
 * 502 or empty body resolves "busy" and is never re-sent here. A successful page is also a harvest
 * chance for `actor` (the nation the read acts as) — see harvestAuth. */
export function readPage(path: string, actor: string): Promise<Document | "busy" | null> {
  return fetchDoc(withIdent(path)).then((doc) => {
    if (doc && doc !== "busy") harvestAuth(doc, actor);
    return doc;
  });
}

/* One autonomous API GET. `busy` = nsBusy, except a 404 is never busy (its body may be empty). null = fetch threw. */
interface ApiResp {
  status: number;
  text: string;
  headers: Headers;
  busy: boolean;
}
async function apiGet(params: Record<string, string>, init?: RequestInit): Promise<ApiResp | null> {
  try {
    const resp = await fetch(apiUrl(params), init);
    const text = await resp.text();
    return {
      status: resp.status,
      text,
      headers: resp.headers,
      busy: resp.status !== 404 && nsBusy(resp.status, text),
    };
  } catch {
    return null;
  }
}

/* Busy responses are re-sent RELOAD_GAP_MS apart, at most `maxSends` sends (Infinity = no limit);
 * `onRetry(n)` fires before the n-th re-send. The last response is returned as-is. */
async function apiGetRetry(
  params: Record<string, string>,
  maxSends: number,
  onRetry?: (n: number) => void,
): Promise<ApiResp | null> {
  for (let n = 1; ; n++) {
    const r = await apiGet(params);
    if (!r?.busy || n >= maxSends) return r;
    onRetry?.(n);
    await sleep(RELOAD_GAP_MS);
  }
}

/* World `nations` API shard → canonical names of every existing nation. Autonomous (no userclick):
 * fetched at most once per Manage page load, when the revive toggle is on. 502/empty re-sent
 * RELOAD_GAP_MS apart, with no limit; any other non-200, fetch failure or missing <NATIONS> → null. */
export async function fetchExistingNations(
  onRetry?: (n: number) => void,
): Promise<Set<string> | null> {
  const r = await apiGetRetry({ q: "nations" }, Infinity, onRetry);
  if (r?.status !== 200) return null;
  const m = /<NATIONS>([\s\S]*?)<\/NATIONS>/.exec(r.text);
  if (!m) return null;
  return new Set(m[1].split(",").map(canon).filter(Boolean));
}

export type DumpDownload =
  | { kind: "new"; blob: Blob; lastModified: string }
  | { kind: "unchanged" }
  | { kind: "busy" }
  | { kind: "failed"; message: string };

/* Nations daily dump GET. Autonomous (script identity, no userclick). `since` = Last-Modified of
 * the copy Bouquet holds ("" = none), sent as If-Modified-Since; 304 → unchanged. cache:"no-store"
 * keeps the ~61 MB body out of the browser HTTP cache (dump.ts keeps its own copy). */
export async function fetchNationsDump(since: string): Promise<DumpDownload> {
  const url = new URL(NATIONS_DUMP_PATH, location.origin);
  url.searchParams.set("script", generatedByValue());
  try {
    const resp = await fetch(url, {
      cache: "no-store",
      credentials: "omit",
      headers: since ? { "If-Modified-Since": since } : {},
    });
    if (resp.status === 304) return { kind: "unchanged" };
    if (resp.status === 502) return { kind: "busy" };
    if (resp.status !== 200) return { kind: "failed", message: `HTTP ${resp.status}` };
    const blob = await resp.blob();
    if (blob.size === 0) return { kind: "busy" };
    return {
      kind: "new",
      blob,
      lastModified: resp.headers.get("last-modified") || new Date().toUTCString(),
    };
  } catch (err) {
    return { kind: "failed", message: String(err) };
  }
}

/* Nation API probe after a restore POST: does `name` exist now? 404 → false; 200 carrying <NATION → true.
 * Autonomous like fetchExistingNations; a 502/empty body is re-sent RELOAD_GAP_MS later, at most
 * 3 sends in all. Still busy, any other status/body, or fetch failure → null. */
export async function fetchNationExists(name: string): Promise<boolean | null> {
  const r = await apiGetRetry({ nation: canon(name), q: "name" }, 3);
  if (!r) return null;
  if (r.status === 404) return false;
  if (r.status === 200 && /<NATION\b/.test(r.text)) return true;
  return null;
}

/* Milliseconds to wait before the next API request, read off one API response's headers.
 * 429 → Retry-After (else RateLimit-Reset) + 1s, else API_LOCKOUT_FALLBACK_MS. Otherwise:
 * RateLimit-Remaining <= API_RATE_RESERVE → RateLimit-Reset + 1s; more left → 0; either header
 * missing/unparseable → API_FALLBACK_GAP_MS. The +1s absorbs whole-second rounding at the window edge. */
export function apiWaitMs(status: number, headers: Headers): number {
  function sec(name: string): number | null {
    const n = Number.parseInt(headers.get(name) ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
  }
  if (status === 429) {
    const s = sec("Retry-After") ?? sec("RateLimit-Reset");
    return s === null ? API_LOCKOUT_FALLBACK_MS : (s + 1) * 1000;
  }
  const remaining = sec("RateLimit-Remaining");
  const reset = sec("RateLimit-Reset");
  if (remaining === null || reset === null) return API_FALLBACK_GAP_MS;
  return remaining <= API_RATE_RESERVE ? (reset + 1) * 1000 : 0;
}

/* One API read: one request, no retry; `busy` = NS busy (press again). */
export type ApiRead<T> = { ok: true; value: T } | { ok: false; busy: boolean; message: string };

async function readApiXml(params: Record<string, string>): Promise<ApiRead<Document>> {
  const r = await apiGet(params);
  if (!r) return { ok: false, busy: false, message: "network error" };
  if (r.status === 404) return { ok: false, busy: false, message: "not found (404)" };
  if (r.status === 429) {
    const wait = Math.ceil(apiWaitMs(429, r.headers) / 1000);
    return { ok: false, busy: false, message: `API rate limit (429) — wait ${wait}s` };
  }
  if (r.busy) return { ok: false, busy: true, message: NS_BUSY_MSG };
  if (r.status !== 200) return { ok: false, busy: false, message: `API returned HTTP ${r.status}` };
  const doc = new DOMParser().parseFromString(r.text, "text/xml");
  if (doc.querySelector("parsererror"))
    return { ok: false, busy: false, message: "unreadable API response" };
  return { ok: true, value: doc };
}

export type EmbassyKind = "established" | "invited" | "pending" | "requested" | "closing";

export type RegionShard = "embassies" | "tags" | "messages" | "dispatches";

export interface RegionInfo {
  embassies: Array<{ name: string; kind: EmbassyKind }>;
  tags: string[];
  /* Ids of unsuppressed posts among the latest messages fetched. */
  posts: string[];
  dispatches: string[];
  officers: Array<{ nation: string; authority: string }>;
  /* Canonical names; "" = none (or the element is absent). */
  delegate: string;
  delegateAuth: string;
  governor: string;
}

const EMBASSY_TYPES: Record<string, EmbassyKind> = {
  invited: "invited",
  pending: "pending",
  requested: "requested",
  closing: "closing",
};

/* The run's one region API read per puppet (Manage prefetchRegion): officers, delegate,
 * delegateauth and governor always, plus the requested shards (messages = the latest 100 RMB
 * posts). Shards not requested parse as empty. */
export async function readRegionInfo(
  region: string,
  shards: ReadonlySet<RegionShard>,
): Promise<ApiRead<RegionInfo>> {
  const res = await readApiXml({
    region: canon(region),
    q: [...shards, "officers", "delegate", "delegateauth", "governor"].join(" "),
    ...(shards.has("messages") ? { limit: "100" } : {}),
  });
  if (!res.ok)
    return res.message === "not found (404)"
      ? { ok: false, busy: false, message: `region ${region} not found` }
      : res;
  const doc = res.value;
  const text = (el: Element | null | undefined) => el?.textContent?.trim() ?? "";
  const single = (name: string) => {
    const v = text(doc.querySelector(name));
    return v === "0" ? "" : v;
  };
  const embassies: RegionInfo["embassies"] = [];
  for (const el of Array.from(doc.querySelectorAll("EMBASSY"))) {
    const type = el.getAttribute("type");
    const kind =
      type === null
        ? "established"
        : Object.hasOwn(EMBASSY_TYPES, type)
          ? EMBASSY_TYPES[type]
          : null;
    const name = text(el);
    if (kind && name) embassies.push({ name, kind });
  }
  const posts: string[] = [];
  for (const el of Array.from(doc.querySelectorAll("POST"))) {
    const id = el.getAttribute("id");
    if (id && text(el.querySelector(":scope > STATUS")) === "0") posts.push(id);
  }
  const officers: RegionInfo["officers"] = [];
  for (const el of Array.from(doc.querySelectorAll("OFFICER"))) {
    officers.push({
      nation: canon(text(el.querySelector(":scope > NATION"))),
      authority: text(el.querySelector(":scope > AUTHORITY")),
    });
  }
  return {
    ok: true,
    value: {
      embassies,
      tags: Array.from(doc.querySelectorAll("TAG"), text).filter(Boolean),
      posts,
      dispatches: single("DISPATCHES")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean),
      officers,
      delegate: canon(single("DELEGATE")),
      delegateAuth: single("DELEGATEAUTH"),
      governor: canon(single("GOVERNOR")),
    },
  };
}

/* Canonical names of every World Assembly member. */
export async function readWaMembers(): Promise<ApiRead<Set<string>>> {
  const res = await readApiXml({ wa: "1", q: "members" });
  if (!res.ok) return res;
  const members = res.value.querySelector("MEMBERS")?.textContent ?? "";
  return { ok: true, value: new Set(members.split(",").map(canon).filter(Boolean)) };
}

/* Region `nations` shard → canonical names of the region's residents (colon-separated in the XML). */
export async function readRegionNations(region: string): Promise<ApiRead<Set<string>>> {
  const res = await readApiXml({ region: canon(region), q: "nations" });
  if (!res.ok)
    return res.message === "not found (404)"
      ? { ok: false, busy: false, message: `region ${region} not found` }
      : res;
  const list = res.value.querySelector("NATIONS");
  if (!list) return { ok: false, busy: false, message: "unreadable API response" };
  return {
    ok: true,
    value: new Set((list.textContent ?? "").split(":").map(canon).filter(Boolean)),
  };
}

export type PingKind =
  | "ok" // 200 + <PING>1</PING>
  | "recent" // 409: logged in seconds ago — the login is already registered
  | "forbidden" // 403: wrong password, MFA enabled, etc. (detail says which)
  | "not-found" // 404
  | "rate-limited" // 429
  | "busy" // 502 / empty body (nsBusy)
  | "failed"; // anything else, or fetch threw (status 0)
export interface PingResult {
  kind: PingKind;
  status: number;
  detail: string; // trimmed <h1> text of an error body ("" when none / ok)
  waitMs: number; // apiWaitMs() of this response; API_FALLBACK_GAP_MS when fetch threw
}

/* One API login for `name` via the private `ping` shard (HTTPS + X-Password, per the API docs'
 * "Authenticating For Private Shards"). Exactly one request, no retry: the caller paces/retries
 * with waitMs. The password travels only in the X-Password header, never in the URL.
 * credentials:"omit" keeps the browser's own NS session cookie out of the request and ignores
 * any Set-Cookie on the response. */
export async function pingNation(name: string, password: string): Promise<PingResult> {
  const r = await apiGet(
    { nation: canon(name), q: "ping" },
    {
      headers: { "X-Password": password, "User-Agent": generatedByValue() },
      credentials: "omit",
      cache: "no-store",
    },
  );
  if (!r) return { kind: "failed", status: 0, detail: "", waitMs: API_FALLBACK_GAP_MS };
  const { status, text } = r;
  const detail =
    status !== 200 && text.trim() !== ""
      ? (parseHtml(text).querySelector("h1")?.textContent?.trim() ?? "")
      : "";
  // explicit statuses before the busy check: their bodies may be empty
  let kind: PingKind;
  if (status === 404) kind = "not-found";
  else if (status === 403) kind = "forbidden";
  else if (status === 409) kind = "recent";
  else if (status === 429) kind = "rate-limited";
  else if (r.busy) kind = "busy";
  else if (status === 200 && /<PING>1<\/PING>/.test(text)) kind = "ok";
  else kind = "failed";
  return { kind, status, detail, waitMs: apiWaitMs(status, r.headers) };
}
