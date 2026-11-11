import { DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME, DEFAULT_KEYS, STATE_KEY } from "./constants";
import { canon, gv, isRecord, isTouchPrimary, newId, sv } from "./utils";

/* Per-puppet authorization: NS's own form tokens (hidden `chk` + `localid` inputs), stored as the
 * puppet's POST-body authorization. `updatedAt` = Date.now() of the last harvest/import. */
export interface BouquetAuth {
  chk: string;
  localid: string;
  updatedAt: number;
}

export type Theme = "dark" | "light";

/* Global keybinds, KeyboardEvent.code values (Settings page). Bare codes only: every press handler
 * drops modifier presses, so a combo could never fire. */
export interface Keybinds {
  action: string;
  nextActor: string;
}

const PIPELINE_ACTION_TYPES = [
  "login",
  "move-region",
  "reauth",
  "apply-wa",
  "change-wfe",
  "embassy",
  "nation-setting",
  "vote-poll",
  "clear-dossier",
  "add-dossier",
  "create-region",
  "upload-region-file",
  "set-region-flag",
  "sync-embassies",
  "suppress-rmb",
  "remove-dispatches",
  "sync-tags",
  "check-region-powers",
  "eject-nation",
  "banject-nation",
  "change-nation-flag",
  "custom-postcard",
  "clear-private-info",
  "telegram-filters",
] as const;

export type PipelineActionType = (typeof PIPELINE_ACTION_TYPES)[number];

export interface PipelineStep {
  id: string;
  type: PipelineActionType;
  settings: Record<string, string>;
}

export interface ActionPreset {
  id: string;
  name: string;
  steps: Array<{ type: PipelineActionType; settings: Record<string, string> }>;
}

const WALKTHROUGH_STAGES = [
  "global-password",
  "import",
  "login-all",
  "run",
  "pipeline",
  "presets",
  "done",
] as const;

export type WalkthroughStage = (typeof WALKTHROUGH_STAGES)[number];

export type RosterFolder = { id: string; name: string };

export interface AppState {
  mainNation: string;
  /* `locked` = skipped by runs until unlocked. `folder` = the RosterFolder id it
   * belongs to, always an existing one. */
  nations: Record<string, { addedAt: number; locked: boolean; folder: string }>;
  /* Roster folders in display order; the Default folder (DEFAULT_FOLDER_ID) is always first and
   * cannot be deleted. */
  folders: RosterFolder[];
  /* Folders Manage shows and runs: a non-empty list of existing folder ids in folder-bar order.
   * Their puppets are listed and run folder by folder, in that order. */
  activeFolders: string[];
  /* Canonical nation → its canonical region, as last seen (login sidebar or a completed move);
   * absent = unknown. */
  regions: Record<string, string>;
  /* Canonical roster nation → population in millions from the dump identified by
   * `dump.lastModified`; null = not in that dump; absent = not looked up yet. */
  populations: Record<string, number | null>;
  /* `lastModified` = Last-Modified header of the nations dump the populations came from ("" = none);
   * `checkedAt` = Date.now() of the last download attempt. */
  dump: { lastModified: string; checkedAt: number };
  /* Settings toggle: Manage downloads a new nations dump on load (dump.ts). */
  dumpAuto: boolean;
  /* Raw Settings textarea: regions Clean Up Embassies keeps. */
  embassyWhitelist: string;
  auth: Record<string, BouquetAuth>;
  pipeline: PipelineStep[];
  presets: ActionPreset[];
  passwords: Record<string, string>;
  globalPassword: string;
  theme: Theme;
  colorScheme: string;
  keys: Keybinds;
  /* Settings toggle: silence the in-flight-guard "busy — dropped, press again" toasts (presses
   * still drop). */
  suppressBusyDrop: boolean;
  /* Settings toggle: Manage shows the on-screen Action button and the page-action keybind is
   * inert (never both). A fresh install on a touch-primary device starts with it on (loadState). */
  actionButton: boolean;
  /* Settings toggle: native NS pages get a Login button after each roster nation's name (ui/native-login.ts). */
  nativeLoginButtons: boolean;
  /* Ids of collapsible page sections the user collapsed (collapsibleSection in ui/dom.ts, a native <details>). */
  collapsedSections: string[];
  /* Manage toggle: step 1 restores a puppet missing from the world nation list instead of logging in. */
  reviveMissing: boolean;
  /* First-run setup tour position (ui/walkthrough.ts); `done` = finished or skipped. */
  walkthrough: WalkthroughStage;
}

export function defaultState(): AppState {
  return {
    mainNation: "",
    nations: {},
    folders: [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }],
    activeFolders: [DEFAULT_FOLDER_ID],
    regions: {},
    populations: {},
    dump: { lastModified: "", checkedAt: 0 },
    dumpAuto: true,
    embassyWhitelist: "",
    pipeline: [loginStep()],
    auth: {},
    passwords: {},
    globalPassword: "",
    theme: "dark",
    colorScheme: "",
    keys: { ...DEFAULT_KEYS },
    suppressBusyDrop: false,
    actionButton: false,
    nativeLoginButtons: true,
    collapsedSections: [],
    reviveMissing: false,
    walkthrough: "global-password",
    presets: [
      {
        id: "standard-prep",
        name: "Standard Prep",
        steps: [
          { type: "apply-wa", settings: {} },
          { type: "move-region", settings: { region: "Neck" } },
        ],
      },
    ],
  };
}

export function loginStep(): PipelineStep {
  return { id: "login", type: "login", settings: {} };
}

function stringSettings(value: unknown): Record<string, string> {
  const settings: Record<string, string> = {};
  if (isRecord(value)) {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof entry === "string") settings[key] = entry;
    }
  }
  return settings;
}

/* A stored step type the pipeline accepts; login is never stored (it is always step 0). */
function storedActionType(type: unknown): Exclude<PipelineActionType, "login"> | null {
  if (type === "login" || !(PIPELINE_ACTION_TYPES as readonly unknown[]).includes(type))
    return null;
  return type as Exclude<PipelineActionType, "login">;
}

function storedId(id: unknown): string {
  return typeof id === "string" && id.trim() ? id : newId();
}

const str = (v: unknown, d: string): string => (typeof v === "string" ? v : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === "boolean" ? v : d);
const rec = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});

export function loadState(): AppState {
  const base = defaultState();
  try {
    const raw = gv(STATE_KEY, "");
    if (!raw) return { ...base, actionButton: isTouchPrimary() };
    /* GM key bouquet (STATE_KEY) is written only by this script, so the blob is its own
     * AppState JSON; every field is still re-validated, and unknown keys are dropped. */
    const parsed: unknown = JSON.parse(raw);
    if (parsed == null) return base;
    const p = rec(parsed);
    const folders: RosterFolder[] = [{ id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME }];
    for (const item of Array.isArray(p.folders) ? p.folders : []) {
      if (!isRecord(item)) continue;
      const { id, name } = item;
      if (typeof id !== "string" || !id || typeof name !== "string" || !name.trim()) continue;
      if (id === DEFAULT_FOLDER_ID) folders[0].name = name.trim();
      else if (!folders.some((f) => f.id === id)) folders.push({ id, name: name.trim() });
    }
    const folderIds = new Set(folders.map((f) => f.id));
    /* Older blobs store `activeFolder` (an id, or "" = All folders); unknown keys are dropped on
     * load, so it is never written again. Empty or all-invalid = every folder shown. */
    const storedShown: unknown[] = Array.isArray(p.activeFolders)
      ? p.activeFolders
      : typeof p.activeFolder === "string" && p.activeFolder
        ? [p.activeFolder]
        : [];
    const shownIds = new Set(storedShown.filter((x): x is string => typeof x === "string"));
    let activeFolders = folders.filter((f) => shownIds.has(f.id)).map((f) => f.id);
    if (!activeFolders.length) activeFolders = folders.map((f) => f.id);
    const nations: AppState["nations"] = {};
    for (const [name, entry] of Object.entries(rec(p.nations))) {
      const e = rec(entry);
      nations[name] = {
        addedAt: typeof e.addedAt === "number" && Number.isFinite(e.addedAt) ? e.addedAt : 0,
        locked: e.locked === true,
        folder:
          typeof e.folder === "string" && folderIds.has(e.folder) ? e.folder : DEFAULT_FOLDER_ID,
      };
    }
    const regions: Record<string, string> = {};
    for (const [name, region] of Object.entries(rec(p.regions))) {
      if (typeof region === "string" && region && nations[name]) regions[name] = region;
    }
    const populations: AppState["populations"] = {};
    for (const [name, pop] of Object.entries(rec(p.populations))) {
      if (!nations[name]) continue;
      if (pop === null || (typeof pop === "number" && Number.isFinite(pop) && pop >= 0))
        populations[name] = pop;
    }
    const d = rec(p.dump);
    const passwords: Record<string, string> = {};
    for (const [name, pw] of Object.entries(rec(p.passwords))) {
      if (typeof pw === "string") passwords[name] = pw;
    }
    const pipeline: PipelineStep[] = [loginStep()];
    for (const item of Array.isArray(p.pipeline) ? p.pipeline : []) {
      if (!isRecord(item)) continue;
      const type = storedActionType(item.type);
      if (type)
        pipeline.push({
          id: storedId(item.id),
          type,
          settings: stringSettings(item.settings),
        });
    }
    const presets: ActionPreset[] = [];
    for (const item of Array.isArray(p.presets) ? p.presets : []) {
      if (!isRecord(item)) continue;
      const { name, steps: rawSteps } = item;
      if (typeof name !== "string" || !name.trim() || !Array.isArray(rawSteps)) continue;
      const steps: ActionPreset["steps"] = [];
      for (const rawStep of rawSteps) {
        if (!isRecord(rawStep)) continue;
        const type = storedActionType(rawStep.type);
        if (type) steps.push({ type, settings: stringSettings(rawStep.settings) });
      }
      presets.push({ id: storedId(item.id), name: name.trim(), steps });
      if (presets.length === 50) break;
    }
    /* An auth entry without both tokens could only ever send garbage in a POST body; drop it and
     * let the puppet show as missing (re-harvest/import repairs it). */
    const auth: Record<string, BouquetAuth> = {};
    for (const [name, entry] of Object.entries(rec(p.auth))) {
      const a = rec(entry);
      if (typeof a.chk !== "string" || typeof a.localid !== "string") continue;
      auth[name] = {
        chk: a.chk,
        localid: a.localid,
        updatedAt: typeof a.updatedAt === "number" ? a.updatedAt : 0,
      };
    }
    /* Keybinds: per-key fallback, so a partial/foreign `keys` blob can never blank one binding. */
    const keys = rec(p.keys);
    return {
      mainNation: str(p.mainNation, base.mainNation),
      nations,
      folders,
      activeFolders,
      regions,
      populations,
      dump: {
        lastModified: str(d.lastModified, ""),
        checkedAt:
          typeof d.checkedAt === "number" && Number.isFinite(d.checkedAt) ? d.checkedAt : 0,
      },
      dumpAuto: bool(p.dumpAuto, base.dumpAuto),
      embassyWhitelist: str(p.embassyWhitelist, base.embassyWhitelist),
      auth,
      pipeline,
      presets,
      passwords,
      globalPassword: str(p.globalPassword, base.globalPassword),
      theme: p.theme === "light" ? "light" : "dark",
      colorScheme: str(p.colorScheme, base.colorScheme),
      keys: {
        action: str(keys.action, "") || DEFAULT_KEYS.action,
        nextActor: str(keys.nextActor, "") || DEFAULT_KEYS.nextActor,
      },
      suppressBusyDrop: bool(p.suppressBusyDrop, base.suppressBusyDrop),
      actionButton: bool(p.actionButton, base.actionButton),
      nativeLoginButtons: bool(p.nativeLoginButtons, base.nativeLoginButtons),
      collapsedSections: Array.isArray(p.collapsedSections)
        ? [
            ...new Set(
              p.collapsedSections.filter((x): x is string => typeof x === "string" && x !== ""),
            ),
          ]
        : [],
      reviveMissing: bool(p.reviveMissing, base.reviveMissing),
      /* Missing/unknown stage = done; only a fresh install (no blob) starts the tour. */
      walkthrough: WALKTHROUGH_STAGES.find((stage) => stage === p.walkthrough) ?? "done",
    };
  } catch {
    return base;
  }
}

export const state: AppState = loadState();

export function persist(): void {
  sv(STATE_KEY, JSON.stringify(state));
}

/* Every request's __usedBy_ tag (and every generated Bouquet link) needs the main nation, so no
 * Bouquet page mounts or is linked to without one. Stored value, else a prompt pre-filled with
 * `prefill` (the nation the current document is logged in as, when NS exposes it). No re-prompt
 * loop: a browser "suppress dialogs" makes prompt() return null instantly. */
export function ensureMainNation(prefill: string): boolean {
  if (state.mainNation) return true;
  const entered = prompt(
    "Bouquet: enter your main nation — the nation you play as. Every request Bouquet sends is tagged __usedBy_<nation>.",
    prefill,
  );
  const name = canon((entered ?? "").trim());
  if (!name) return false;
  state.mainNation = name;
  persist();
  return true;
}

/* A puppet's login password: its override, else the global password, else "". */
export function passwordFor(name: string): string {
  return state.passwords[canon(name)] || state.globalPassword || "";
}

/* Cached dump population (millions) of a roster nation; null = not in the dump, undefined = unknown. */
export function populationOf(name: string): number | null | undefined {
  return state.populations[canon(name)];
}

/* Next roster `addedAt`: wall-clock ms, bumped past every stored value so nations added in one
 * import (same ms) or in quick succession still get strictly increasing, distinct stamps. */
export function nextAddedAt(): number {
  let max = 0;
  for (const n of Object.values(state.nations)) if (n.addedAt > max) max = n.addedAt;
  return Math.max(Date.now(), max + 1);
}

/* Roster names in add order (import line order, then later imports/harvests) — the iteration
 * order every list and queue uses. Equal stamps (rosters saved before stamps were distinct) keep
 * stored key order; Array.prototype.sort is stable. */
export function nationNames(): string[] {
  return Object.keys(state.nations).sort(
    (a, b) => state.nations[a].addedAt - state.nations[b].addedAt,
  );
}

/* A folder's display name; unknown id = the Default folder's name. */
export function folderName(id: string): string {
  return state.folders.find((f) => f.id === id)?.name ?? DEFAULT_FOLDER_NAME;
}

export function folderExists(id: string): boolean {
  return state.folders.some((f) => f.id === id);
}

/* The folders Manage shows, in folder-bar order. */
export function shownFolders(): RosterFolder[] {
  return state.folders.filter((f) => state.activeFolders.includes(f.id));
}

/* The Manage list: the shown folders one after another (folder-bar order), roster order inside
 * each. `ctx.hl` indexes this list. */
export function viewNames(): string[] {
  const buckets = new Map<string, string[]>();
  for (const f of shownFolders()) buckets.set(f.id, []);
  for (const n of nationNames()) buckets.get(state.nations[n].folder)?.push(n);
  return [...buckets.values()].flat();
}

/* Put `names` into `folder`; returns how many actually changed folder. Persists itself. */
export function moveToFolder(names: string[], folder: string): number {
  let moved = 0;
  for (const n of names) {
    const entry = state.nations[n];
    if (entry && entry.folder !== folder) {
      entry.folder = folder;
      moved++;
    }
  }
  if (moved > 0) persist();
  return moved;
}

/* Rewrite roster order: `names` in the given order get stamps 1..n. nextAddedAt stays wall-clock,
 * so later imports/harvests still append at the end. Persists itself. */
export function setRosterOrder(names: string[]): void {
  names.forEach((n, i) => {
    const entry = state.nations[n];
    if (entry) entry.addedAt = i + 1;
  });
  persist();
}

/* Wipe the roster with everything keyed by it: imports, per-puppet auth tokens, password
 * overrides, known regions and cached populations. Persists itself. The global pipeline,
 * `mainNation`, the global password, theme, color scheme, keybinds, busy-toast flag, action-button
 * toggle, section collapse state, revive toggle, walkthrough stage, embassy whitelist, roster
 * folders, the shown folders, the dump record and the dump toggle are kept — none is a roster entry. */
export function clearNations(): void {
  state.nations = {};
  state.auth = {};
  state.passwords = {};
  state.regions = {};
  state.populations = {};
  persist();
}

/* Apply one region's API resident list to the cache: roster puppets listed get `region`; roster
 * puppets cached in `region` but not listed lose their entry (unknown). Non-roster names are ignored
 * (loadState drops them anyway). Persists only on change; returns whether anything changed. */
export function setRegionResidents(region: string, residents: Set<string>): boolean {
  let changed = false;
  for (const n of Object.keys(state.nations)) {
    if (residents.has(n)) {
      if (state.regions[n] !== region) {
        state.regions[n] = region;
        changed = true;
      }
    } else if (state.regions[n] === region) {
      delete state.regions[n];
      changed = true;
    }
  }
  if (changed) persist();
  return changed;
}
