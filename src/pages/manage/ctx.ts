/* Manage page state shared by its subsystems (roster, pipeline, run), plus the run-state helpers. */
import type { StepRequest } from "../../actions";
import { outcomeText, refreshPopulations } from "../../dump";
import { nationNames, persist, state, viewNames } from "../../state";
import { toast } from "../../ui/mdui";

/* Where the run's current step stands. `send`: the next press sends step `stepIndex` (an expand
 * step is expanded first). `requests`: an expanded step (ActionDef.expand), one press per request;
 * the next press sends list[pos]; `tolerant` = a failed request is counted in `failed` and the step
 * goes on. `skip-upload`: the step's upload came back empty; the next press skips the step. */
export type StepProgress =
  | { kind: "send" }
  | { kind: "requests"; list: StepRequest[]; pos: number; failed: number; tolerant: boolean }
  | { kind: "skip-upload" };
/* One puppet's run in progress; `uploads` = IDs Upload Region File returned earlier in this run;
 * `startedAt` feeds the run bar ETA. */
export type ActiveRun = {
  actor: string;
  stepIndex: number;
  progress: StepProgress;
  uploads: { flag: string; banner: string };
  startedAt: number; // Date.now() at the press that started this puppet's run
};

/* Page-local; nothing here persists. Run state: `active` = the run the next press continues;
 * `sending` = a press is awaiting a request/read, so presses drop (an await outliving a reset keeps
 * `sending` true until it returns); `abortedActor` = the running puppet was removed, and the next
 * press only reports the abort. */
export type Ctx = {
  hl: number; // roster index of the ▸ puppet
  selection: Set<string> | null; // puppets picked by Select puppets (may include locked ones; runs skip those); null = every unlocked puppet runs
  active: ActiveRun | null;
  sending: boolean;
  abortedActor: string | null;
  paint(): void; // roster + status + board + run bar + revive
  paintBoard(): void;
  paintRunBar(): void;
};

export function createCtx(): Ctx {
  const noop = (): void => {};
  return {
    hl: 0,
    selection: null,
    active: null,
    sending: false,
    abortedActor: null,
    paint: noop,
    paintBoard: noop,
    paintRunBar: noop,
  };
}

export const NO_PUPPETS = "No puppets in the roster";

/* Appends a response's own p.error/p.info text (StepResult/RestoreResult `notice`) to a toast line. */
export function withNotice(text: string, notice: string): string {
  return notice ? `${text} — ${notice}` : text;
}

/* The shown folders for toasts: "the roster" (every folder shown), "this folder" or "these folders". */
export function viewScope(): string {
  if (state.activeFolders.length === state.folders.length) return "the roster";
  return state.activeFolders.length === 1 ? "this folder" : "these folders";
}

/* The folder view (viewNames: the roster limited to the shown folders), or null after toasting
 * that it is empty. */
export function rosterOrToast(): string[] | null {
  const names = viewNames();
  if (names.length) return names;
  toast(nationNames().length ? `No puppets in ${viewScope()}` : NO_PUPPETS, "error");
  return null;
}

/* Ends any run without a toast. Never touches `sending`: an in-flight await settles on its own. */
export function cancelRun(ctx: Ctx, aborted: string | null = null): void {
  ctx.active = null;
  ctx.abortedActor = aborted;
}
export function resetRun(ctx: Ctx, aborted: string | null = null): void {
  cancelRun(ctx, aborted);
  ctx.paintBoard();
  ctx.paintRunBar();
}
export function beginSend(ctx: Ctx): void {
  ctx.sending = true;
  ctx.paintRunBar();
}
/* The press's await returned. true = the run is still ours, keep handling the response. */
export function settle(ctx: Ctx, run: ActiveRun): boolean {
  ctx.sending = false;
  return ctx.active === run;
}

/* Runs, the skip key and the end-of-run advance only visit unlocked puppets in the selection. */
export function inRunSet(ctx: Ctx, n: string): boolean {
  return !state.nations[n]?.locked && (ctx.selection === null || ctx.selection.has(n));
}
/* First index after `from` whose puppet is in the run set; -1 = none. */
export function nextRunIndex(ctx: Ctx, names: string[], from: number): number {
  for (let i = from + 1; i < names.length; i++) if (inRunSet(ctx, names[i])) return i;
  return -1;
}

let undoSeq = 0;
/* Toast with an Undo button. Undo runs `restore`; false = nothing to restore (restore already said why).
 * Otherwise persist, repaint and toast `restored` (omitted = silent). */
export function undoToast(
  ctx: Ctx,
  msg: string,
  // biome-ignore lint/suspicious/noConfusingVoidType: callers pass plain void callbacks; only `false` matters.
  restore: () => boolean | void,
  restored?: string,
): void {
  toast(msg, undefined, {
    label: "Undo",
    /* unique: toast() coalesces identical rows and would keep the first closure */
    key: `undo${++undoSeq}`,
    act: () => {
      if (restore() === false) return;
      persist();
      ctx.paint();
      if (restored) toast(restored);
    },
  });
}

/* Background population refresh (dump.ts "auto"): repaints when populations changed; toasts a
 * download start, its result, and failures; a silent cache rescan/idle shows nothing. */
export function refreshRosterPopulations(ctx: Ctx): void {
  void refreshPopulations("auto", (t) => {
    if (t.startsWith("Downloading")) toast(t);
  }).then((out) => {
    if (out.kind === "updated" || out.kind === "scanned") ctx.paint();
    if (out.kind === "updated" || out.kind === "busy" || out.kind === "failed") {
      const { text, error } = outcomeText(out);
      toast(text, error ? "error" : undefined);
    }
  });
}
