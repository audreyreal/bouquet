/* Nations daily dump: download (via net.ts), the Cache Storage copy (this module is the only owner
 * of DUMP_CACHE_NAME, like gv/sv for GM storage), the streaming scan and the roster population
 * cache in state.populations. */
import {
  DUMP_CACHE_NAME,
  DUMP_GRACE_MS,
  DUMP_INTERVAL_MS,
  DUMP_RECHECK_MS,
  NATIONS_DUMP_API_VERSION,
  NATIONS_DUMP_PATH,
} from "./constants";
import { fetchNationsDump } from "./net";
import { nationNames, persist, populationOf, state } from "./state";
import { canon } from "./utils";

export type PopulationOutcome =
  | { kind: "updated"; found: number; total: number; kept: boolean }
  | { kind: "scanned"; found: number; total: number }
  | { kind: "idle"; message: string }
  | { kind: "busy" }
  | { kind: "failed"; message: string };

/* Millions → "512 million" / "1.234 billion". */
export function formatPopulation(millions: number): string {
  return millions >= 1000
    ? `${Number((millions / 1000).toFixed(3))} billion`
    : `${Number(millions.toFixed(3))} million`;
}

/* Roster cell text: "—" = not looked up yet. */
export function populationText(name: string): string {
  const pop = populationOf(name);
  if (pop === undefined) return "—";
  if (pop === null) return "not in dump";
  return formatPopulation(pop);
}

/* Short date of the dump the populations came from; "" = none/unparseable. */
export function dumpDateText(): string {
  const lm = state.dump.lastModified;
  if (!lm) return "";
  const d = new Date(lm);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/* Settings status line. */
export function populationStatus(): string {
  if (!state.dump.lastModified) return "No nations dump downloaded yet";
  const names = nationNames();
  let known = 0;
  let unscanned = 0;
  for (const n of names) {
    const pop = state.populations[n];
    if (typeof pop === "number") known++;
    else if (pop === undefined) unscanned++;
  }
  return `Populations from the ${dumpDateText()} dump · ${known} of ${names.length} roster nations found${unscanned > 0 ? ` · ${unscanned} not looked up yet` : ""}`;
}

function cacheKey(): string {
  return new URL(NATIONS_DUMP_PATH, location.origin).href;
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === "undefined") return null;
  try {
    return await caches.open(DUMP_CACHE_NAME);
  } catch {
    return null;
  }
}

/* The stored dump file, only when it is the dump state.populations came from. */
async function cachedResponse(): Promise<Response | null> {
  const lm = state.dump.lastModified;
  if (!lm) return null;
  const cache = await openCache();
  if (!cache) return null;
  const resp = await cache.match(cacheKey());
  return resp && resp.headers.get("last-modified") === lm ? resp : null;
}

/* false = no Cache Storage or the put failed (quota); the caller reports it (`kept: false`). */
async function storeDump(blob: Blob, lastModified: string): Promise<boolean> {
  const cache = await openCache();
  if (!cache) return false;
  try {
    await cache.put(
      cacheKey(),
      new Response(blob, {
        headers: { "content-type": "application/x-gzip", "last-modified": lastModified },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function hasCachedDump(): Promise<boolean> {
  return (await cachedResponse()) !== null;
}

/* Text between the first `open` and the following `close` in `s`; null = absent. */
function between(s: string, open: string, close: string): string | null {
  const a = s.indexOf(open);
  if (a < 0) return null;
  const b = s.indexOf(close, a + open.length);
  return b < 0 ? null : s.slice(a + open.length, b);
}

/* Stream a nations dump (gzip or plain XML, sniffed by magic bytes) and return population
 * (millions) for each canonical name in `wanted` found in it. Stops reading once all are found.
 * Throws on an api_version other than NATIONS_DUMP_API_VERSION or a non-dump body. */
export async function scanDump(blob: Blob, wanted: Set<string>): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (!wanted.size) return found;
  if (typeof DecompressionStream === "undefined" || typeof TextDecoderStream === "undefined")
    throw new Error("browser lacks DecompressionStream — update the browser");
  const h = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
  const gz = h[0] === 0x1f && h[1] === 0x8b;
  let bytes: ReadableStream<BufferSource> = blob.stream();
  if (gz) bytes = bytes.pipeThrough(new DecompressionStream("gzip"));
  const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  let versionOk = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf = `${buf}${value}`;
    if (!versionOk) {
      const m = /<NATIONS\s+api_version="(\d+)"/.exec(buf);
      if (m) {
        if (m[1] !== NATIONS_DUMP_API_VERSION) {
          await reader.cancel();
          throw new Error(
            `nations dump is API version ${m[1]}, Bouquet expects ${NATIONS_DUMP_API_VERSION} — update Bouquet`,
          );
        }
        versionOk = true;
      } else if (buf.length > 4096) {
        await reader.cancel();
        throw new Error("not a nations dump");
      } else continue;
    }
    let pos = 0;
    for (let end = buf.indexOf("</NATION>", pos); end >= 0; end = buf.indexOf("</NATION>", pos)) {
      const block = buf.slice(pos, end);
      const name = between(block, "<NAME>", "</NAME>");
      if (name !== null) {
        const c = canon(name);
        if (wanted.has(c)) {
          const raw = between(block, "<POPULATION>", "</POPULATION>");
          const pop = raw === null ? Number.NaN : Number(raw);
          if (raw !== null && raw.trim() !== "" && Number.isFinite(pop)) found.set(c, pop);
        }
      }
      pos = end + 9;
    }
    buf = buf.slice(pos);
    if (found.size === wanted.size) {
      await reader.cancel();
      return found;
    }
  }
  if (!versionOk) throw new Error("not a nations dump");
  return found;
}

let chain: Promise<unknown> = Promise.resolve();

/* Download a new dump when one is due (mode "auto" honors state.dumpAuto and DUMP_RECHECK_MS),
 * else look up roster nations missing from state.populations in the stored dump file. Calls are
 * serialized: a second call runs after the first and sees the names added meanwhile. */
export function refreshPopulations(
  mode: "auto" | "manual",
  onProgress?: (text: string) => void,
): Promise<PopulationOutcome> {
  const p = chain.then(() => doRefresh(mode, onProgress));
  chain = p.catch(() => undefined);
  return p;
}

async function doRefresh(
  mode: "auto" | "manual",
  onProgress?: (text: string) => void,
): Promise<PopulationOutcome> {
  try {
    const names = nationNames();
    if (!names.length) return { kind: "idle", message: "Roster is empty" };
    const now = Date.now();
    const lm = Date.parse(state.dump.lastModified);
    const nextAt = Number.isFinite(lm) ? lm + DUMP_INTERVAL_MS + DUMP_GRACE_MS : 0;
    const allowed = mode === "manual" || state.dumpAuto;
    const rested = mode === "manual" || now - state.dump.checkedAt >= DUMP_RECHECK_MS;
    if (allowed && now >= nextAt && rested) {
      onProgress?.("Downloading the nations daily dump (~61 MB) for roster populations…");
      /* With no file kept, a 304 would leave nothing to scan: download unconditionally. */
      const since = (await hasCachedDump()) ? state.dump.lastModified : "";
      const r = await fetchNationsDump(since);
      state.dump.checkedAt = Date.now();
      persist();
      if (r.kind === "busy" || r.kind === "failed") return r;
      if (r.kind === "new") {
        onProgress?.("Reading the nations dump…");
        let found: Map<string, number>;
        try {
          found = await scanDump(r.blob, new Set(names));
        } catch (err) {
          /* Not re-downloaded until the next dump; populations stay untouched. */
          state.dump.lastModified = r.lastModified;
          persist();
          return {
            kind: "failed",
            message: err instanceof Error ? err.message : String(err),
          };
        }
        state.populations = Object.fromEntries(names.map((n) => [n, found.get(n) ?? null]));
        state.dump.lastModified = r.lastModified;
        const kept = await storeDump(r.blob, r.lastModified);
        persist();
        return { kind: "updated", found: found.size, total: names.length, kept };
      }
    }
    const missing = names.filter((n) => !(n in state.populations));
    if (missing.length && state.dump.lastModified) {
      const resp = await cachedResponse();
      if (!resp)
        return {
          kind: "idle",
          message: `${missing.length} roster nation(s) not looked up — the dump file isn't stored; they fill in with the next dump`,
        };
      onProgress?.("Looking up new roster nations in the cached dump…");
      const found = await scanDump(await resp.blob(), new Set(missing));
      for (const n of missing) state.populations[n] = found.get(n) ?? null;
      persist();
      return { kind: "scanned", found: found.size, total: missing.length };
    }
    if (mode === "manual" && nextAt > now)
      return {
        kind: "idle",
        message: `Already have the latest dump — next one expected after ${new Date(nextAt).toLocaleString()}`,
      };
    if (!allowed) return { kind: "idle", message: "Automatic dump download is off" };
    return { kind: "idle", message: "Populations up to date" };
  } catch (err) {
    return { kind: "failed", message: err instanceof Error ? err.message : String(err) };
  }
}

export function outcomeText(out: PopulationOutcome): { text: string; error: boolean } {
  switch (out.kind) {
    case "updated":
      return {
        text: `Populations updated from the ${dumpDateText()} dump · ${out.found} of ${out.total} roster nations found${out.kept ? "" : " · dump file not kept (browser storage unavailable)"}`,
        error: false,
      };
    case "scanned":
      return {
        text: `${out.found} of ${out.total} new roster nation(s) found in the ${dumpDateText()} dump`,
        error: false,
      };
    case "idle":
      return { text: out.message, error: false };
    case "busy":
      return {
        text: "NS busy — nations dump not downloaded; use Settings → Check for new dump later",
        error: true,
      };
    case "failed":
      return { text: `Nations dump failed — ${out.message}`, error: true };
  }
}
