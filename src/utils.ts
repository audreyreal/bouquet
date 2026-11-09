/* Tiny shared utils. */

export function canon(name: string | null | undefined): string {
  return String(name || "")
    .toLowerCase()
    .replace(/ /g, "_");
}

export function newId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `s${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* Trimmed non-empty lines of a textarea value. */
export function lines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/* Region names from a textarea: one per line or comma-separated, canonical, blanks dropped. */
export function regionList(text: string): string[] {
  return text
    .split(/[\n,]/)
    .map((r) => canon(r.trim()))
    .filter(Boolean);
}

/* Non-ASCII → numeric character references, so text survives NS's ISO-8859-1 forms. */
export function ncrEncode(text: string): string {
  return text.replace(/[\u0080-\u{10FFFF}]/gu, (c) => `&#${c.codePointAt(0)};`);
}

export function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

/* GM storage with a localStorage fallback for sandboxes without GM_* grants. */
export function gv(k: string, d: string): string {
  try {
    const v = GM_getValue(k);
    return v === undefined ? d : v;
  } catch {
    try {
      const w = localStorage.getItem(k);
      return w == null ? d : w;
    } catch {
      return d;
    }
  }
}

export function sv(k: string, v: string): void {
  try {
    GM_setValue(k, v);
  } catch {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* storage unavailable: state stays in memory for this page */
    }
  }
}

export function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/* Primary input is touch (phones/tablets): no hover, coarse pointer. */
export function isTouchPrimary(): boolean {
  return matchMedia("(hover: none) and (pointer: coarse)").matches;
}
