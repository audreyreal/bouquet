/* Bouquet tuning numbers and CDN endpoints. */
/* Userscript version, injected at build time from src/userscript-header.txt @version
 * (scripts/build.ts define); the header is the single source of truth. Falls back to a
 * dev marker when src/ is loaded without the build (typecheck, throwaway scripts). */
export const SCRIPT_VERSION: string =
  typeof __BOUQUET_VERSION__ === "string" && __BOUQUET_VERSION__
    ? __BOUQUET_VERSION__
    : "0.0.0-dev";
export const SCRIPT_TAG = `bouquet_${SCRIPT_VERSION.replace(/\./g, "_")}_devvedBy_audrey_lily`;
export const STATE_KEY = "bouquet";
/* The roster folder that always exists: harvested nations land here, and Import defaults to it. */
export const DEFAULT_FOLDER_ID = "default";
export const DEFAULT_FOLDER_NAME = "Default";
/* Every Bouquet page lives on this origin: Web Locks are per-origin, so one origin lets the
 * single-tab lock see every Bouquet tab. */
export const BOUQUET_ORIGIN = "https://www.nationstates.net";
export const TAB_LOCK = "bouquet-tab";
/* Absolute URL of the NS page the current Bouquet visit started from ("" = unknown). Stored via
 * gv/sv, not in AppState: it is navigation state, not settings. */
export const RETURN_KEY = "bouquet-return";
/* Feedback form linked from the top bar next to the version badge. */
export const FEEDBACK_URL = "https://forms.gle/NuiQgQFFtZsmVVnJ8";
/* Global keybinds (Settings page, KeyboardEvent.code values): the page action (SPACE) and the
 * skip-puppet button. Bare codes only — modifier presses are dropped by every handler. */
export const DEFAULT_KEYS = {
  action: "Space",
  nextActor: "KeyA",
} as const;
/* Automatic reads are spaced RELOAD_GAP_MS apart (max 10/min). */
export const RELOAD_GAP_MS = 6200;
export const ETA_SAMPLES = 5; // run bar ETA: rolling window of finished-puppet durations
/* API pacing (Login to all): when RateLimit-Remaining drops to this, wait out RateLimit-Reset. */
export const API_RATE_RESERVE = 1;
/* Gap between API requests only when a response carries no RateLimit-* headers: the docs'
 * "well below the maximum, e.g. 1 request per second". */
export const API_FALLBACK_GAP_MS = 1000;
/* 429 carrying neither Retry-After nor RateLimit-Reset: wait one 30 s window (RateLimit-Policy w=30). */
export const API_LOCKOUT_FALLBACK_MS = 30_000;
export const MAX_UPLOAD_BYTES = 2_000_000;
/* One wording for every in-flight-guard press drop, so the toast coalescer merges them into one row. */
export const BUSY_DROP_MSG = "busy — dropped, press again";
export const MAX_TOASTS = 5; /* visible stack slots; a 6th evicts the oldest */
export const TOAST_MS = 8000; /* auto-dismiss delay; click dismisses sooner */
/* Nations daily dump (API docs "Daily Data Dumps"): path, the root api_version Bouquet parses, the
 * Cache Storage bucket holding the downloaded file, and the schedule: a new dump is expected
 * 24h after the previous Last-Modified; wait DUMP_GRACE_MS past that, and DUMP_RECHECK_MS between
 * automatic attempts that found nothing new. */
export const NATIONS_DUMP_PATH = "/pages/nations.xml.gz";
export const NATIONS_DUMP_API_VERSION = "13";
export const DUMP_CACHE_NAME = "bouquet-dump";
export const DUMP_INTERVAL_MS = 24 * 3600_000;
export const DUMP_GRACE_MS = 90 * 60_000;
export const DUMP_RECHECK_MS = 3600_000;
/* Population thresholds, in millions (dump/API unit). */
export const CUSTOM_PRETITLE_MIN_POP = 500;

export const MDUI_CSS_URL = "https://unpkg.com/mdui@2/mdui.css";
export const MDUI_ICONS_URL = "https://fonts.googleapis.com/icon?family=Material+Icons+Outlined";
export const ROBOTO_URL =
  "https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap";
