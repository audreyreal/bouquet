/* Manage run: the sticky run panel and the page-action press that sends one request per press. */

import { actionDef, actionTitle, askRegion, needsRegion, withRegion } from "../../actions";
import { executeRestore, type RestoreResult } from "../../actions/execute";
import {
  advanceAfter,
  newRun,
  type PressHost,
  type PuppetRun,
  prefetchRegion,
  pressRun,
  withNotice,
} from "../../actions/run-press";
import { authFor } from "../../auth";
import { ETA_SAMPLES } from "../../constants";
import { NS_BUSY_MSG } from "../../net";
import { folderName, nationNames, persist, state, viewNames } from "../../state";
import { actionKey, keyLabel, nextHint, onSpace, registerSkip } from "../../ui/actions";
import { busyDropToast, el, hint } from "../../ui/dom";
import { toast } from "../../ui/mdui";
import {
  beginSend,
  type Ctx,
  inRunSet,
  NO_PUPPETS,
  nextRunIndex,
  rosterOrToast,
  settle,
  viewScope,
} from "./ctx";
import type { Pipeline } from "./pipeline";
import type { Revive } from "./revive";
import type { Roster } from "./roster";

export function createRun(
  ctx: Ctx,
  deps: {
    main: HTMLElement;
    bar: HTMLElement;
    revive: Revive;
    roster: Roster;
    pipeline: Pipeline;
  },
): { paintRunBar(): void } {
  const { revive, roster, pipeline } = deps;

  /* Sticky run panel (the shell's page bar): which puppet is ▸, which request the next press sends. */
  const runTitle = el("div", { class: "bq-runbar-title" });
  const runDetail = el("div", { class: "bq-runbar-detail" });
  const runEta = el("div", { class: "bq-runbar-eta" });
  const runKeys = hint("");
  const runBar = el(
    "mdui-card",
    { variant: "filled", class: "bq-runbar" },
    runTitle,
    runDetail,
    runEta,
    runKeys,
  );
  deps.bar.appendChild(runBar);

  /* Run bar ETA (page-local): durations in ms of the last ETA_SAMPLES successfully finished puppets,
   * newest last; `lastFinished` = the actor most recently passed to completeAndAdvance (any outcome). */
  const samples: number[] = [];
  let lastFinished: string | null = null;

  function runStepLabel(actor: string, index: number): string {
    return index === 0 && revive.willRestore(actor)
      ? "Restore nation"
      : actionTitle(state.pipeline[index].type);
  }

  function formatLeft(ms: number): string {
    if (ms < 60_000) return "<1 min left";
    const min = Math.round(ms / 60_000);
    if (min < 60) return `~${min} min left`;
    return `~${Math.floor(min / 60)} h ${min % 60} min left`;
  }

  /* Progress over the run set (inRunSet) of the shown folders: the ▸ puppet counts by its finished
   * steps; ETA = remaining puppets × the average of `samples`. */
  function paintEta(names: string[], run: PuppetRun | null): void {
    const pipeLen = state.pipeline.length;
    const total = names.filter((n) => inRunSet(ctx, n)).length;
    if (total === 0 || pipeLen === 0) {
      runEta.hidden = true;
      return;
    }
    runEta.hidden = false;
    let pos = run ? names.indexOf(run.actor) : ctx.hl;
    if (pos === -1) pos = ctx.hl;
    const before = names.slice(0, pos).filter((n) => inRunSet(ctx, n)).length;
    const currentIn = pos < names.length && inRunSet(ctx, names[pos]);
    /* End of the view: after the last puppet finishes, `hl` stays on it. */
    const currentDone = !run && currentIn && lastFinished === names[pos];
    const fraction = currentDone ? 1 : run && currentIn ? Math.min(1, run.stepIndex / pipeLen) : 0;
    const doneUnits = before + fraction;
    const remaining = total - doneUnits;
    const pct = Math.floor((doneUnits / total) * 100);
    const donePuppets = before + (currentDone ? 1 : 0);
    let text = `${pct}% · ${donePuppets} of ${total} puppets`;
    if (remaining <= 0) text = `${text} · finished`;
    else if (!samples.length) text = `${text} · ETA after the first puppet`;
    else {
      const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
      const ms = remaining * avg;
      text = `${text} · ETA ${new Date(Date.now() + ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} (${formatLeft(ms)})`;
    }
    runEta.textContent = text;
  }

  function paintRunBar(): void {
    runKeys.textContent = `${actionKey()}: send next request (1 press = 1 request) · ${keyLabel(state.keys.nextActor)}: next puppet fallback`;
    const names = viewNames();
    if (!names.length) {
      const elsewhere = nationNames().length > 0;
      runTitle.textContent = elsewhere ? `No puppets in ${viewScope()}` : NO_PUPPETS;
      runDetail.textContent = elsewhere
        ? "Show another folder or move puppets here."
        : "Import puppets to start.";
      runEta.hidden = true;
      return;
    }
    const run = ctx.active;
    paintEta(names, run);
    const step = run ? state.pipeline[run.stepIndex] : undefined;
    const selected = ctx.selection === null ? "" : ` · selection: ${ctx.selection.size}`;
    const actor = run ? run.actor : names[ctx.hl];
    runTitle.textContent = `▸ ${actor}${state.activeFolders.length > 1 ? ` · ${folderName(state.nations[actor]?.folder ?? "")}` : ""}${selected}`;
    if (!run) {
      runDetail.textContent = `Ready · first: ${runStepLabel(names[ctx.hl], 0)} · ${state.pipeline.length} step(s)`;
      return;
    }
    if (!step) {
      runDetail.textContent = `All steps sent · press ${actionKey()} to finish`;
      return;
    }

    const p = run.progress.kind === "requests" ? run.progress : null;
    const pendingLabel = p
      ? `${p.list[p.pos]?.label ?? ""} (${p.pos + 1}/${p.list.length})`
      : runStepLabel(run.actor, run.stepIndex);
    if (ctx.sending) {
      runDetail.textContent = `Sending: ${pendingLabel}…`;
      return;
    }
    const remaining =
      state.pipeline.length - run.stepIndex - 1 + (p ? Math.max(0, p.list.length - p.pos) : 1);
    const def = run.progress.kind === "send" ? actionDef(step.type) : undefined;
    const readPending =
      (def?.powers || def?.fromRegion) && run.regionRead !== null && run.regionRead.result === null;
    runDetail.textContent = `Step ${run.stepIndex + 1} of ${state.pipeline.length} · next: ${pendingLabel} · ${remaining} request(s) remaining${run.progress.kind === "skip-upload" ? ` · press ${actionKey()} to skip the empty upload` : ""}${readPending ? " · region API read pending" : ""}`;
  }

  /* Ends the current nation's run and moves `hl` on. `completion` overrides the success wording
   * with a failure detail; passing it also switches the toast to error styling. `notice` (success
   * only) is the finishing response's own p.error/p.info text, appended to the success wording. */
  function completeAndAdvance(finishedActor: string, completion?: string, notice = ""): void {
    /* Only successes are ETA samples: failures and skips end early and would drag the average down. */
    const finishing = ctx.active;
    if (completion === undefined && finishing?.actor === finishedActor) {
      samples.push(Date.now() - finishing.startedAt);
      if (samples.length > ETA_SAMPLES) samples.shift();
    }
    lastFinished = finishedActor;
    const successText = state.pipeline.length <= 1 ? "auth stored" : "pipeline complete";
    const prefix = `${finishedActor}: `;
    const names = viewNames();
    const idx = names.indexOf(finishedActor);
    if (idx === -1) {
      ctx.hl = Math.max(0, names.length - 1);
      ctx.active = null;
      ctx.paint();
      toast(withNotice(`${finishedActor}: pipeline complete`, notice));
      return;
    }

    const doneMsg = completion ?? withNotice(`${prefix}${successText}`, notice);
    const kind = completion === undefined ? undefined : "error";
    ctx.active = null;
    const next = nextRunIndex(ctx, names, idx);
    if (next === -1) {
      ctx.hl = idx;
      ctx.paint();
      toast(`${doneMsg} — end of ${viewScope()}`, kind);
      return;
    }

    ctx.hl = next;
    ctx.paint();
    const nextName = names[ctx.hl];
    const crossed = state.nations[nextName].folder !== state.nations[finishedActor].folder;
    toast(
      nextHint(
        doneMsg,
        `▸ ${nextName}${crossed ? ` (folder ${folderName(state.nations[nextName].folder)})` : ""}`,
      ),
      kind,
    );
  }

  function toastRunAborted(): void {
    toast(`Run aborted — puppet removed (press ${actionKey()} to restart)`, "error");
  }

  const host: PressHost = {
    isCurrent: (r) => ctx.active === r,
    setSending: (on) => {
      if (on) beginSend(ctx);
      else ctx.sending = false;
    },
    complete: (r, completion, notice) => completeAndAdvance(r.actor, completion, notice),
    regionReadLanded: (r) => {
      if (ctx.active === r) paintRunBar();
    },
  };

  /* Each press advances one request/read step or consumes an armed empty-upload skip. */
  const actionBtn = onSpace(async () => {
    try {
      if (ctx.sending) {
        busyDropToast();
        return;
      }
      if (ctx.abortedActor !== null) {
        ctx.abortedActor = null;
        toastRunAborted();
        return;
      }

      const names = rosterOrToast();
      if (!names) return;

      let run: PuppetRun;
      if (ctx.active === null) {
        if (!state.pipeline.length) {
          toast("No actions in the pipeline", "error");
          return;
        }
        if (state.pipeline.some(needsRegion)) {
          askRegion("The pipeline's Move to Region step has no region. Which region?", (region) => {
            state.pipeline = state.pipeline.map((s) =>
              needsRegion(s) ? withRegion(s, region) : s,
            );
            persist();
            ctx.paint();
            toast(`Region set to ${region} — press ${actionKey()} to start`);
          });
          return;
        }
        if (ctx.hl > names.length - 1) ctx.hl = Math.max(0, names.length - 1);
        if (!inRunSet(ctx, names[ctx.hl])) {
          const skipped = names[ctx.hl];
          const next = nextRunIndex(ctx, names, ctx.hl);
          if (next === -1) {
            toast(`No unlocked selected puppets after ${skipped}`, "error");
            return;
          }
          ctx.hl = next;
          toast(
            `▸ ${names[ctx.hl]} — ${skipped} is locked or not selected (press ${actionKey()} to start)`,
          );
          return;
        }
        const actor = names[ctx.hl];
        if (revive.needsPasswordReset(actor)) {
          completeAndAdvance(actor, `${actor}: needs a password reset — skipped`);
          return;
        }
        if (state.reviveMissing && revive.isLoading()) {
          toast("Still loading the nation list — press again in a moment", "error");
          return;
        }
        run = newRun(actor, state.pipeline);
        ctx.active = run;
        lastFinished = null;
      } else {
        run = ctx.active;
        if (!names.includes(run.actor)) {
          ctx.active = null;
          toastRunAborted();
          return;
        }
        if (run.stepIndex >= run.steps.length) {
          completeAndAdvance(run.actor);
          return;
        }
      }

      /* Restore instead of login. dropped/busy aren't attempts (next press re-sends); any other
       * outcome is recorded even if the user jumped away, since the POST went out. */
      if (run.stepIndex === 0 && revive.willRestore(run.actor)) {
        const issue = pipeline.loginIssue(run.actor);
        if (issue) {
          completeAndAdvance(run.actor, issue);
          return;
        }
        beginSend(ctx);
        let out: RestoreResult;
        let current = false;
        try {
          out = await executeRestore(run.actor);
        } finally {
          current = settle(ctx, run);
        }
        if (out.kind === "dropped") {
          busyDropToast();
          return;
        }
        if (out.kind === "busy") {
          toast(NS_BUSY_MSG, "error");
          return;
        }
        revive.record(run.actor, out.kind);
        if (!current) return;
        if (out.kind === "revived") {
          if (!authFor(run.actor))
            completeAndAdvance(
              run.actor,
              withNotice(`${run.actor}: revived but no chk/localid in response`, out.notice),
            );
          else advanceAfter(host, run, "Restore nation done", out.notice);
        } else if (out.kind === "needs-reset") {
          completeAndAdvance(
            run.actor,
            withNotice(
              `${run.actor}: revived but needs a password reset — actions skipped`,
              out.notice,
            ),
          );
        } else {
          completeAndAdvance(run.actor, `${run.actor}: restore failed — ${out.message}`);
        }
        return;
      }

      await pressRun(host, run);
    } finally {
      if (ctx.active) prefetchRegion(host, ctx.active);
      ctx.paint();
    }
  }, deps.main);
  (actionBtn ?? runBar).setAttribute("data-bq-walk", "run");

  /* The skip button advances the roster highlight so a long list can be walked by key. */
  registerSkip(() => {
    const names = rosterOrToast();
    if (!names) return;
    const next = nextRunIndex(ctx, names, ctx.hl);
    if (next === -1) {
      toast(`End of roster — ${names[ctx.hl]}`, "error");
      return;
    }
    roster.jumpTo(names[next]);
    roster.scrollToCurrent();
  });

  return { paintRunBar };
}
