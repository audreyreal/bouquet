/* Newly founded nations. Founding itself stays manual (NS's own create-nation form); Bouquet only
 * records the form's name/password on submit, and on the `founded=new` landing page mounts a small
 * panel that files the nation into the Founded folder and runs a pipeline on it, one request per
 * press, through the shared step engine (actions/run-press.ts). Step 1 is always Re-Authenticate. */

import { actionTitle, newStep } from "../actions/catalog";
import { askRegion, needsRegion, withRegion } from "../actions/nation/move-region";
import {
  newRun,
  type PressHost,
  type PuppetRun,
  prefetchRegion,
  pressRun,
  withNotice,
} from "../actions/run-press";
import { harvestAuth, sidebarRegion } from "../auth";
import {
  BOUQUET_ORIGIN,
  FOUNDED_FOLDER_ID,
  FOUNDED_FOLDER_NAME,
  FOUNDING_KEY,
  FOUNDING_TTL_MS,
} from "../constants";
import {
  ensureMainNation,
  foundedChoice,
  nextAddedAt,
  type PipelineStep,
  persist,
  state,
} from "../state";
import { acquireTabLock } from "../tab-lock";
import { canon, gv, isRecord, sv } from "../utils";
import { actionKey, onNativeAction } from "./actions";
import { busyDropToast, el, iconButton, injectNativeCss, selectField } from "./dom";
import { mduiGlobal, toast } from "./mdui";
import { mduiStylesheets } from "./shell";

/* A pending founding submit: the form's name (canon) and password, `at` = submit time (ms). */
type FoundingSubmit = { name: string; password: string; at: number };

function pendingFounding(): FoundingSubmit | null {
  let rec: unknown;
  try {
    rec = JSON.parse(gv(FOUNDING_KEY, ""));
  } catch {
    return null;
  }
  if (
    !isRecord(rec) ||
    typeof rec.name !== "string" ||
    typeof rec.password !== "string" ||
    typeof rec.at !== "number"
  )
    return null;
  return { name: rec.name, password: rec.password, at: rec.at };
}

/* Holds the create-nation form's name/password from its submit (after the browser's own `required`
 * validation; the request is never touched) until the success redirect consumes it
 * (takeFoundingPassword). Every other outcome discards it: a page showing the form again (a failed
 * submit re-renders it) clears it at once, and any native page load clears it once FOUNDING_TTL_MS
 * has passed. Bouquet's state never sees it before a founding succeeds. */
export function trackFounding(): void {
  const form = document.querySelector<HTMLFormElement>('form[action*="build_nation.cgi"]');
  if (!form) {
    const rec = pendingFounding();
    if (gv(FOUNDING_KEY, "") !== "" && (!rec || Date.now() - rec.at >= FOUNDING_TTL_MS))
      sv(FOUNDING_KEY, "");
    return;
  }
  sv(FOUNDING_KEY, "");
  form.addEventListener("submit", () => {
    const nameInput = form.querySelector<HTMLInputElement>('input[name="name"]');
    const pwInput = form.querySelector<HTMLInputElement>('input[name="password"]');
    const name = nameInput?.value.trim() ?? "";
    if (!name) return;
    const rec: FoundingSubmit = {
      name: canon(name),
      password: pwInput?.value ?? "",
      at: Date.now(),
    };
    sv(FOUNDING_KEY, JSON.stringify(rec));
  });
}

/* The nation of NS's founding success redirect, `/nation=<canon name>?founded=new`, when this page is
 * it and is logged in as that nation; "" otherwise. */
function landingNation(): string {
  const m = /^\/nation=([^/?#]+)\/?$/.exec(location.pathname);
  if (!m || new URLSearchParams(location.search).get("founded") !== "new") return "";
  const nation = canon(m[1]);
  return nation !== "" && canon(document.body?.getAttribute("data-nname")) === nation ? nation : "";
}

export function isFoundedLanding(): boolean {
  return landingNation() !== "";
}

/* The Founded folder (by id, else by name), created on demand and switched into Manage's view. */
function foundedFolder(): string {
  let folder =
    state.folders.find((f) => f.id === FOUNDED_FOLDER_ID) ??
    state.folders.find((f) => f.name.toLowerCase() === FOUNDED_FOLDER_NAME.toLowerCase());
  if (!folder) {
    folder = { id: FOUNDED_FOLDER_ID, name: FOUNDED_FOLDER_NAME };
    state.folders.push(folder);
  }
  const id = folder.id;
  if (!state.activeFolders.includes(id))
    state.activeFolders = state.folders
      .filter((f) => f.id === id || state.activeFolders.includes(f.id))
      .map((f) => f.id);
  return id;
}

/* The founding form's password, when the pending submit is for `nation` and fresh: stored as the
 * nation's override unless empty or equal to the global password, then the submit is cleared. A
 * submit for another nation is left to expire (trackFounding). */
function takeFoundingPassword(nation: string): void {
  const rec = pendingFounding();
  if (!rec || rec.name !== nation || Date.now() - rec.at >= FOUNDING_TTL_MS) return;
  if (rec.password !== "" && rec.password !== state.globalPassword)
    state.passwords[nation] = rec.password;
  else delete state.passwords[nation];
  sv(FOUNDING_KEY, "");
}

/* Files the landing page's nation into the Founded folder with its tokens, region and password. */
function registerFounded(nation: string): void {
  const folder = foundedFolder();
  const entry = state.nations[nation];
  if (entry) entry.folder = folder;
  else state.nations[nation] = { addedAt: nextAddedAt(), locked: false, folder };
  /* After the roster add, so harvesting never files the nation in Default. */
  harvestAuth(document);
  const region = sidebarRegion(document);
  if (region) state.regions[nation] = region;
  takeFoundingPassword(nation);
  persist();
}

/* mdui-select can't pick an empty-valued item: "current" stands in for "" (the current pipeline), as in Settings. */
const CURRENT = "current";

/* The steps a choice runs: Re-Authenticate, then the current pipeline minus its login step ("")
 * or a preset's steps (copied the way applyPreset does). */
function stepsFor(value: string): PipelineStep[] {
  let rest: PipelineStep[];
  if (value === "")
    rest = state.pipeline.slice(1).map((s) => ({ ...s, settings: { ...s.settings } }));
  else
    rest = (state.presets.find((p) => p.id === value)?.steps ?? []).map((s) => ({
      ...newStep(s.type),
      settings: { ...s.settings },
    }));
  return [newStep("reauth"), ...rest];
}

export async function mountFoundedRun(): Promise<void> {
  /* Web Locks are per-origin: run only where Bouquet pages live. */
  if (location.origin !== BOUQUET_ORIGIN) {
    location.replace(`${BOUQUET_ORIGIN}${location.pathname}${location.search}${location.hash}`);
    return;
  }
  const nation = landingNation();
  /* Toggle off: no panel and no request, but the nation is still filed with its password. */
  if (!state.foundedRun) {
    if (typeof navigator.locks === "undefined") return;
    const release = await acquireTabLock();
    if (!release) {
      toast(`Bouquet is open in another tab — ${nation} wasn't added to the roster`, "error");
      return;
    }
    registerFounded(nation);
    release();
    toast(`${nation}: added to the Founded folder`);
    return;
  }
  injectNativeCss();
  const sheets = mduiStylesheets();
  document.head.append(...sheets);
  let open = true;
  const panel = el(
    "mdui-card",
    {
      id: "bq-founded",
      variant: "elevated",
      class: `bq-founded-loading mdui-theme-${state.theme === "light" ? "light" : "dark"}`,
    },
    el(
      "div",
      { class: "bq-founded-head" },
      el("span", null, `Bouquet · ${nation}`),
      iconButton("close--outlined", "Close", () => {
        open = false;
        panel.remove();
      }),
    ),
  );
  document.body.appendChild(panel);
  if (state.colorScheme) mduiGlobal()?.setColorScheme(state.colorScheme, { target: panel });
  /* Hidden until mdui.css has loaded (or failed), so the card never flashes without its colors. */
  const reveal = (): void => panel.classList.remove("bq-founded-loading");
  sheets[0].addEventListener("load", reveal);
  sheets[0].addEventListener("error", reveal);

  if (typeof navigator.locks === "undefined") {
    panel.append(el("p", null, "Bouquet needs a browser with Web Locks support."));
    return;
  }
  /* No lock ⇒ write nothing (an open Manage tab would overwrite it); FOUNDING_KEY stays for a reload.
   * A granted lock is held until this page is left, like a Bouquet page holds it. */
  if (!(await acquireTabLock())) {
    panel.append(
      el(
        "p",
        null,
        "Bouquet is open in another tab — close it, then reload this page to run a pipeline here.",
      ),
    );
    return;
  }
  /* Request identity (__usedBy_) needs the main nation. */
  if (!ensureMainNation("")) {
    panel.append(el("p", null, "Bouquet needs your main nation — reload this page to enter it."));
    return;
  }
  registerFounded(nation);

  let armed = true;
  let sending = false;
  let run: PuppetRun | null = null;
  let outcome = "";

  const select = selectField(
    "Pipeline",
    [
      [CURRENT, `Current pipeline (${state.pipeline.length} steps)`],
      ...state.presets.map((p): [string, string] => [
        p.id,
        `${p.name} (${p.steps.length + 1} steps)`,
      ]),
    ],
    foundedChoice() || CURRENT,
  );
  /* The shown choice as a state value: "" = the current pipeline. */
  const choice = (): string => (select.value === CURRENT ? "" : select.value);
  select.addEventListener("change", () => {
    if (!select.value) {
      // re-clicking the picked item deselects it; restore the shown choice
      select.value = foundedChoice() || CURRENT;
      return;
    }
    armed = true;
    state.foundedPipeline = choice(); // remembered for the next founded nation
    persist();
    select.blur(); // a focused MDUI control blocks the key shortcut (isEditableTarget)
    paint();
  });
  const list = el("ol", { class: "bq-founded-steps" });
  const status = el("p", { class: "bq-founded-status" });
  const goButton = el("mdui-button", { variant: "filled" }, "Send next request");
  const againButton = el(
    "mdui-button",
    {
      variant: "tonal",
      onclick: () => {
        armed = true;
        againButton.blur();
        paint();
      },
    },
    "Run again",
  );
  panel.append(
    select,
    list,
    status,
    el("div", { class: "bq-founded-actions" }, goButton, againButton),
    el(
      "p",
      { class: "bq-founded-note" },
      "While this page is open, Bouquet Manage can't open in another tab.",
    ),
  );

  function paint(): void {
    const cur = run;
    const at = cur ? cur.stepIndex : -1;
    list.replaceChildren(
      ...(cur ? cur.steps : stepsFor(choice())).map((s, i) =>
        el("li", { class: i < at ? "bq-done" : i === at ? "bq-now" : null }, actionTitle(s.type)),
      ),
    );
    againButton.hidden = cur !== null || armed;
    if (!cur) {
      status.textContent = armed ? `Ready · press ${actionKey()} to start` : outcome;
      return;
    }
    const step = cur.steps[at];
    const p = cur.progress.kind === "requests" ? cur.progress : null;
    let label = step ? actionTitle(step.type) : "";
    if (p) label = `${p.list[p.pos]?.label ?? ""} (${p.pos + 1}/${p.list.length})`;
    status.textContent = sending
      ? `Sending: ${label}…`
      : `Step ${at + 1} of ${cur.steps.length} · next: ${label} — press ${actionKey()}`;
  }

  const host: PressHost = {
    isCurrent: (r) => run === r,
    setSending: (on) => {
      sending = on;
      paint();
    },
    complete: (r, completion, notice = "") => {
      run = null;
      armed = false;
      select.disabled = false;
      outcome = completion ?? withNotice(`${r.actor}: pipeline complete`, notice);
      toast(outcome, completion === undefined ? undefined : "error");
    },
    regionReadLanded: (r) => {
      if (run === r) paint();
    },
  };

  /* One press: starts a run when armed, else continues the current one. Closing the panel abandons
   * the run: `open` turns false, so no further presses fire. */
  async function onPress(): Promise<void> {
    if (sending) {
      busyDropToast();
      return;
    }
    if (!run) {
      if (!armed) {
        toast("Pick a pipeline or press Run again to start another run");
        return;
      }
      const steps = stepsFor(choice());
      if (steps.some(needsRegion)) {
        const id = choice();
        const preset = id ? state.presets.find((p) => p.id === id) : undefined;
        askRegion(
          `${preset ? `"${preset.name}"` : "The current pipeline"} moves nations to a region, but none is set. Which region?`,
          (region) => {
            const fix = <T extends Pick<PipelineStep, "type" | "settings">>(s: T): T =>
              needsRegion(s) ? withRegion(s, region) : s;
            if (preset) preset.steps = preset.steps.map(fix);
            else state.pipeline = state.pipeline.map(fix);
            persist();
            paint();
            toast(`Region set to ${region} — press ${actionKey()} to start`);
          },
          panel,
        );
        return;
      }
      run = newRun(nation, steps);
      select.disabled = true;
      outcome = "";
    }
    try {
      await pressRun(host, run);
    } finally {
      if (run) prefetchRegion(host, run);
      paint();
    }
  }
  onNativeAction(onPress, goButton, () => open);

  paint();
}
