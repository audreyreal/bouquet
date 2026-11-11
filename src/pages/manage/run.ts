/* Manage run: the sticky run panel and the page-action press that sends one request per press. */

import {
  type ActionDef,
  actionDef,
  actionTitle,
  missingPowers,
  type RunContext,
  type StepRequest,
} from "../../actions";
import {
  executeRequest,
  executeRestore,
  executeStep,
  type RestoreResult,
  type StepResult,
} from "../../actions/execute";
import { authFor } from "../../auth";
import { ETA_SAMPLES } from "../../constants";
import { NS_BUSY_MSG, type RegionInfo, type RegionShard, readRegionInfo } from "../../net";
import { folderName, nationNames, state, viewNames } from "../../state";
import { actionKey, keyLabel, nextHint, onSpace, registerSkip } from "../../ui/actions";
import { busyDropToast, el, hint } from "../../ui/dom";
import { toast } from "../../ui/mdui";
import {
  type ActiveRun,
  beginSend,
  type Ctx,
  inRunSet,
  NO_PUPPETS,
  nextRunIndex,
  type RegionRead,
  rosterOrToast,
  settle,
  viewScope,
  withNotice,
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

  function runContext(run: ActiveRun): RunContext {
    return { actor: run.actor, region: state.regions[run.actor] ?? "", uploads: run.uploads };
  }
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
  function paintEta(names: string[], run: ActiveRun | null): void {
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

  /* Marks the run's current step done: next press sends the following step, or the run completes. */
  function advanceAfter(run: ActiveRun, doneText: string, notice = ""): void {
    run.stepIndex++;
    run.progress = { kind: "send" };
    if (run.stepIndex >= state.pipeline.length) {
      completeAndAdvance(run.actor, undefined, notice);
      return;
    }
    const nextStep = state.pipeline[run.stepIndex];
    toast(nextHint(withNotice(`${run.actor}: ${doneText}`, notice), actionTitle(nextStep.type)));
  }

  function toastRunAborted(): void {
    toast(`Run aborted — puppet removed (press ${actionKey()} to restart)`, "error");
  }

  /* Starts the puppet's one region API read, autonomous with no press: once step 0 (login/restore)
   * has reported the region, when a step from `stepIndex` on needs powers or region data, and no read
   * of that region exists yet. A completed Move Region changes the region and so triggers a fresh
   * read. Shards = those of the remaining fromRegion steps. */
  function prefetchRegion(run: ActiveRun): void {
    if (run.stepIndex < 1) return;
    const region = state.regions[run.actor] ?? "";
    if (!region || run.regionRead?.region === region) return;
    const shards = new Set<RegionShard>();
    let needed = false;
    for (const step of state.pipeline.slice(run.stepIndex)) {
      const def = actionDef(step.type);
      if (!def?.powers && !def?.fromRegion) continue;
      needed = true;
      for (const shard of def.fromRegion?.shards ?? []) shards.add(shard);
    }
    if (!needed) return; // no region-control step left in the pipeline → no region API request at all
    const read: RegionRead = { region, result: null };
    run.regionRead = read;
    void readRegionInfo(region, shards).then((result) => {
      read.result = result;
      if (ctx.active === run) paintRunBar();
    });
  }

  type RegionGate =
    | { kind: "ok"; info: RegionInfo; region: string }
    | { kind: "missing"; note: string }
    | { kind: "wait"; message: string } // toast; nothing sent; the next press re-checks
    | { kind: "fail"; message: string }; // ends the puppet's run
  /* A region step's check against the background read. Never awaits: any HTML request this press
   * sends follows the press at once. */
  function regionGate(run: ActiveRun, def: ActionDef): RegionGate {
    const region = state.regions[run.actor] ?? "";
    if (!region)
      return {
        kind: "fail",
        message: "puppet's region unknown — log in first (the login page reports it)",
      };
    if (run.regionRead?.region !== region) prefetchRegion(run);
    const result = run.regionRead?.result;
    if (!result) return { kind: "wait", message: `reading ${region} from the API — press again` };
    if (!result.ok) {
      if (!result.busy) return { kind: "fail", message: result.message };
      run.regionRead = null; // the press's finally re-reads
      return { kind: "wait", message: `${region} API read: ${NS_BUSY_MSG}` };
    }
    const missing = missingPowers(result.value, run.actor, def.powers ?? "");
    if (missing)
      return {
        kind: "missing",
        note: `${def.title} skipped — missing officer powers ${missing} in ${region}`,
      };
    return { kind: "ok", info: result.value, region };
  }

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

      let run: ActiveRun;
      if (ctx.active === null) {
        if (!state.pipeline.length) {
          toast("No actions in the pipeline", "error");
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
        run = {
          actor,
          stepIndex: 0,
          progress: { kind: "send" },
          uploads: { flag: "", banner: "" },
          startedAt: Date.now(),
          regionRead: null,
        };
        ctx.active = run;
        lastFinished = null;
      } else {
        run = ctx.active;
        if (!names.includes(run.actor)) {
          ctx.active = null;
          toastRunAborted();
          return;
        }
        if (run.stepIndex >= state.pipeline.length) {
          completeAndAdvance(run.actor);
          return;
        }
      }

      let step = state.pipeline[run.stepIndex];
      if (!step) {
        ctx.active = null;
        toast("No actions in the pipeline", "error");
        return;
      }
      if (run.progress.kind === "skip-upload") {
        advanceAfter(run, `${actionTitle(step.type)} skipped (empty upload)`);
        return;
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
          else advanceAfter(run, "Restore nation done", out.notice);
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

      /* A step whose action says it is a no-op for this puppet (e.g. a move to the region it is
       * already in), whose officer powers the puppet lacks, or whose region tool has nothing to do is
       * skipped without a request; the press goes on to the next step (or finishes the run). All of
       * it is synchronous: the press's request follows at once. */
      const skipNotes: string[] = [];
      while (step) {
        const sdef = actionDef(step.type);
        let note = sdef?.skip?.(step, runContext(run)) ?? "";
        if (!note && sdef && (sdef.powers || sdef.fromRegion) && run.progress.kind === "send") {
          const gate = regionGate(run, sdef);
          if (gate.kind === "wait") {
            toast(`${run.actor}: ${[...skipNotes, gate.message].join(" · ")}`);
            return;
          }
          if (gate.kind === "fail") {
            completeAndAdvance(
              run.actor,
              `${run.actor}: ${[...skipNotes, `${sdef.title} failed — ${gate.message}`].join(" · ")}`,
            );
            return;
          }
          if (gate.kind === "missing") note = gate.note;
          else if (sdef.fromRegion) {
            const plan = sdef.fromRegion.requests(step, gate.info, gate.region);
            if (!plan.requests.length) note = `${sdef.title}: ${plan.note ?? "nothing to do"}`;
            else
              run.progress = {
                kind: "requests",
                list: plan.requests,
                pos: 0,
                failed: 0,
                tolerant: plan.tolerant === true,
              };
          }
        }
        if (!note) break;
        skipNotes.push(note);
        run.stepIndex++;
        step = state.pipeline[run.stepIndex];
      }
      if (skipNotes.length) toast(`${run.actor}: ${skipNotes.join(" · ")}`);
      if (!step) {
        completeAndAdvance(run.actor);
        return;
      }
      const title = actionTitle(step.type);
      const def = actionDef(step.type);
      const note =
        def && !def.expand && !def.fromRegion ? (def.runNote?.(step, runContext(run)) ?? "") : "";

      beginSend(ctx);
      let current = false;
      let res: StepResult;
      let request: StepRequest | null = null;
      try {
        if (def?.expand && run.progress.kind !== "requests") {
          const out = await def.expand(step, runContext(run));
          if (ctx.active !== run) return;
          if ("busy" in out) {
            toast(NS_BUSY_MSG, "error");
            return;
          }
          if ("error" in out) {
            completeAndAdvance(run.actor, `${run.actor}: ${title} failed — ${out.error}`);
            return;
          }
          if (!out.requests.length) {
            advanceAfter(run, `${title}: ${out.note ?? "nothing to do"}`);
            return;
          }
          run.progress = {
            kind: "requests",
            list: out.requests,
            pos: 0,
            failed: 0,
            tolerant: out.tolerant === true,
          };
          if (out.pressUsed) {
            toast(nextHint(`${run.actor}: ${title} — page read`, out.requests[0].label));
            return;
          }
        }
        if (run.progress.kind === "requests") {
          request = run.progress.list[run.progress.pos];
          res = await executeRequest(request.spec, run.actor);
        } else {
          res = await executeStep(step, run.actor, runContext(run));
        }
      } finally {
        current = settle(ctx, run);
      }

      if (!current) return;
      if (res.dropped) {
        busyDropToast();
        return;
      }
      if (res.busy) {
        if (res.emptyUpload) {
          run.progress = { kind: "skip-upload" };
          toast(
            `${run.actor}: ${title} returned empty (no redirect followed) — press ${actionKey()} again to skip`,
            "error",
          );
          return;
        }
        toast(res.message, "error");
        return;
      }
      const label = request ? request.label : title;
      if (!res.ok) {
        if (!(request && run.progress.kind === "requests" && run.progress.tolerant)) {
          completeAndAdvance(
            run.actor,
            `${run.actor}: ${label} failed — ${res.message}${note ? ` · ${note}` : ""}`,
          );
          return;
        }
        /* Tolerant step: record the failure and move on to the next request. */
        run.progress.failed++;
        toast(`${run.actor}: ${label} failed — ${res.message}`, "error");
      } else if (step.type === "login" && !authFor(run.actor)) {
        completeAndAdvance(
          run.actor,
          withNotice(`${run.actor}: logged in but no chk/localid in response`, res.notice),
        );
        return;
      } else def?.onSuccess?.(step, runContext(run), res.message);

      if (run.progress.kind === "requests") {
        const p = run.progress;
        p.pos++;
        if (p.pos < p.list.length) {
          if (res.ok)
            toast(
              nextHint(withNotice(`${run.actor}: ${label} done`, res.notice), p.list[p.pos].label),
            );
          return;
        }
        /* A tolerant failure already toasted its message; StepResult.notice is "" for it. */
        advanceAfter(
          run,
          `${title} done${p.failed ? ` (${p.failed} of ${p.list.length} failed)` : ""}`,
          res.notice,
        );
        return;
      }

      advanceAfter(run, `${title} done`, [note, res.notice].filter((t) => t !== "").join(" · "));
    } finally {
      if (ctx.active) prefetchRegion(ctx.active);
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
