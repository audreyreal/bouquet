/* The per-press step engine: one press sends one request (or consumes one skip) of a puppet's run.
 * Page-agnostic: Manage (pages/manage/run.ts) and the founded-nation popup (ui/founded-run.ts) drive
 * it through a PressHost. */

import { authFor } from "../auth";
import {
  type ApiRead,
  NS_BUSY_MSG,
  type RegionInfo,
  type RegionShard,
  readRegionInfo,
} from "../net";
import { type PipelineStep, state } from "../state";
import { actionKey, nextHint } from "../ui/actions";
import { busyDropToast } from "../ui/dom";
import { toast } from "../ui/mdui";
import { actionDef, actionTitle } from "./catalog";
import { executeRequest, executeStep, type StepResult } from "./execute";
import { missingPowers } from "./region/region-info";
import type { ActionDef, RunContext, StepRequest } from "./types";

/* Where the run's current step stands. `send`: the next press sends step `stepIndex` (an expand
 * step is expanded first). `requests`: an expanded step (ActionDef.expand or fromRegion), one press per request;
 * the next press sends list[pos]; `tolerant` = a failed request is counted in `failed` and the step
 * goes on. `skip-upload`: the step's upload came back empty; the next press skips the step. */
export type StepProgress =
  | { kind: "send" }
  | { kind: "requests"; list: StepRequest[]; pos: number; failed: number; tolerant: boolean }
  | { kind: "skip-upload" };
/* The puppet's one background region API read (prefetchRegion): the `region` it read;
 * `result` null while in flight. */
export type RegionRead = { region: string; result: ApiRead<RegionInfo> | null };
/* One puppet's run in progress; `uploads` = IDs Upload Region File returned earlier in this run;
 * `startedAt` feeds the run bar ETA; `regionRead` = its background region read (null = none yet). */
export type PuppetRun = {
  actor: string;
  /* the step list this run walks, fixed at start; Manage resets the run whenever its pipeline changes */
  steps: PipelineStep[];
  stepIndex: number;
  progress: StepProgress;
  uploads: { flag: string; banner: string };
  startedAt: number; // Date.now() at the press that started this puppet's run
  regionRead: RegionRead | null;
};

/* Appends a response's own p.error/p.info text (StepResult/RestoreResult `notice`) to a toast line. */
export function withNotice(text: string, notice: string): string {
  return notice ? `${text} — ${notice}` : text;
}

export function newRun(actor: string, steps: PipelineStep[]): PuppetRun {
  return {
    actor,
    steps,
    stepIndex: 0,
    progress: { kind: "send" },
    uploads: { flag: "", banner: "" },
    startedAt: Date.now(),
    regionRead: null,
  };
}

/* What the page around a run supplies. */
export interface PressHost {
  isCurrent(run: PuppetRun): boolean; // the page still runs `run` (an await may outlive a reset)
  setSending(on: boolean): void; // a press is awaiting a request/read (true) / its await returned (false)
  complete(run: PuppetRun, completion?: string, notice?: string): void; // run over; completion = failure text, undefined = success
  regionReadLanded(run: PuppetRun): void; // background region read finished
}

export function runContext(run: PuppetRun): RunContext {
  return { actor: run.actor, region: state.regions[run.actor] ?? "", uploads: run.uploads };
}

/* Marks the run's current step done: next press sends the following step, or the run completes. */
export function advanceAfter(host: PressHost, run: PuppetRun, doneText: string, notice = ""): void {
  run.stepIndex++;
  run.progress = { kind: "send" };
  if (run.stepIndex >= run.steps.length) {
    host.complete(run, undefined, notice);
    return;
  }
  const nextStep = run.steps[run.stepIndex];
  toast(nextHint(withNotice(`${run.actor}: ${doneText}`, notice), actionTitle(nextStep.type)));
}

/* Starts the puppet's one region API read, autonomous with no press: once step 0 (login/restore)
 * has reported the region, when a step from `stepIndex` on needs powers or region data, and no read
 * of that region exists yet. A completed Move Region changes the region and so triggers a fresh
 * read. Shards = those of the remaining fromRegion steps. */
export function prefetchRegion(host: PressHost, run: PuppetRun): void {
  if (run.stepIndex < 1) return;
  const region = state.regions[run.actor] ?? "";
  if (!region || run.regionRead?.region === region) return;
  const shards = new Set<RegionShard>();
  let needed = false;
  for (const step of run.steps.slice(run.stepIndex)) {
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
    host.regionReadLanded(run);
  });
}

type RegionGate =
  | { kind: "ok"; info: RegionInfo; region: string }
  | { kind: "missing"; note: string }
  | { kind: "wait"; message: string } // toast; nothing sent; the next press re-checks
  | { kind: "fail"; message: string }; // ends the puppet's run
/* A region step's check against the background read. Never awaits: any HTML request this press
 * sends follows the press at once. */
function regionGate(host: PressHost, run: PuppetRun, def: ActionDef): RegionGate {
  const region = state.regions[run.actor] ?? "";
  if (!region)
    return {
      kind: "fail",
      message: "puppet's region unknown — log in first (the login page reports it)",
    };
  if (run.regionRead?.region !== region) prefetchRegion(host, run);
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

/* One press of `run`: sends its next request/read, or consumes an armed empty-upload skip. The
 * caller has checked that no press is in flight; the caller's finally prefetches the region. */
export async function pressRun(host: PressHost, run: PuppetRun): Promise<void> {
  let step = run.steps[run.stepIndex];
  if (!step) {
    host.complete(run);
    return;
  }
  if (run.progress.kind === "skip-upload") {
    advanceAfter(host, run, `${actionTitle(step.type)} skipped (empty upload)`);
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
      const gate = regionGate(host, run, sdef);
      if (gate.kind === "wait") {
        toast(`${run.actor}: ${[...skipNotes, gate.message].join(" · ")}`);
        return;
      }
      if (gate.kind === "fail") {
        host.complete(
          run,
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
    step = run.steps[run.stepIndex];
  }
  if (skipNotes.length) toast(`${run.actor}: ${skipNotes.join(" · ")}`);
  if (!step) {
    host.complete(run);
    return;
  }
  const title = actionTitle(step.type);
  const def = actionDef(step.type);
  const note =
    def && !def.expand && !def.fromRegion ? (def.runNote?.(step, runContext(run)) ?? "") : "";

  host.setSending(true);
  let current = false;
  let res: StepResult;
  let request: StepRequest | null = null;
  try {
    if (def?.expand && run.progress.kind !== "requests") {
      const out = await def.expand(step, runContext(run));
      if (!host.isCurrent(run)) return;
      if ("busy" in out) {
        toast(NS_BUSY_MSG, "error");
        return;
      }
      if ("error" in out) {
        host.complete(run, `${run.actor}: ${title} failed — ${out.error}`);
        return;
      }
      if (!out.requests.length) {
        advanceAfter(host, run, `${title}: ${out.note ?? "nothing to do"}`);
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
    host.setSending(false);
    current = host.isCurrent(run);
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
      host.complete(
        run,
        `${run.actor}: ${label} failed — ${res.message}${note ? ` · ${note}` : ""}`,
      );
      return;
    }
    /* Tolerant step: record the failure and move on to the next request. */
    run.progress.failed++;
    toast(`${run.actor}: ${label} failed — ${res.message}`, "error");
  } else if (step.type === "login" && !authFor(run.actor)) {
    host.complete(
      run,
      withNotice(`${run.actor}: logged in but no chk/localid in response`, res.notice),
    );
    return;
  } else def?.onSuccess?.(step, runContext(run), res.message);

  if (run.progress.kind === "requests") {
    const p = run.progress;
    p.pos++;
    if (p.pos < p.list.length) {
      if (res.ok)
        toast(nextHint(withNotice(`${run.actor}: ${label} done`, res.notice), p.list[p.pos].label));
      return;
    }
    /* A tolerant failure already toasted its message; StepResult.notice is "" for it. */
    advanceAfter(
      host,
      run,
      `${title} done${p.failed ? ` (${p.failed} of ${p.list.length} failed)` : ""}`,
      res.notice,
    );
    return;
  }

  advanceAfter(host, run, `${title} done`, [note, res.notice].filter((t) => t !== "").join(" · "));
}
