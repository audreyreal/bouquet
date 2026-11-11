import type { RegionInfo, RegionShard } from "../net";
import type { PipelineActionType, PipelineStep } from "../state";
import type { ActionSpec } from "./spec";

export type ActionGroupId = "nation" | "wa" | "region" | "embassy";

export interface ActionGroup {
  id: ActionGroupId;
  title: string;
}

export const ACTION_GROUPS: ActionGroup[] = [
  { id: "nation", title: "Nation" },
  { id: "wa", title: "World Assembly" },
  { id: "region", title: "Region Control" },
  { id: "embassy", title: "Embassies" },
];

export interface StepField {
  key: string;
  label: string;
  placeholder?: string;
  rows?: number;
  kind?: "text" | "file";
  accept?: string;
  dataKey?: string;
  /* Pixel box [width, height] a picked image is scaled down to fit (aspect kept). */
  maxSize?: [number, number];
}

/* What a run knows about the acting puppet when a step executes. */
export interface RunContext {
  actor: string; // canon
  region: string; // state.regions[actor] ?? ""
  uploads: { flag: string; banner: string }; // IDs returned by Upload Region File earlier in this run
}

/* What a rendered settings body hands back to the step dialog. */
export interface FieldsHandle {
  /* Write the body's current values into step.settings. */
  collect(step: PipelineStep): void;
  /* True while a picked file is still being read/shrunk; Save is ignored meanwhile. */
  busy?(): boolean;
}

export interface StepRequest {
  label: string;
  spec: ActionSpec;
}

/* Requests a step decided at run time, one per press. `tolerant` = a failed request is recorded and
 * the step moves on to the next one; otherwise any failure ends the puppet's run. No requests = the
 * step is already satisfied (`note` says why). */
export interface RequestPlan {
  requests: StepRequest[];
  tolerant?: boolean;
  note?: string;
}

/* An expanded step. `pressUsed` = expand already spent this press on a page read (one request per
 * press), so requests start on the next press. */
export type ExpandResult =
  | (RequestPlan & { pressUsed?: boolean })
  | { error: string }
  | { busy: true };

export interface ActionDef {
  type: Exclude<PipelineActionType, "login">;
  group: ActionGroupId;
  title: string;
  blurb: string;
  fields: StepField[];
  /* Pipeline-card meta line; absent = "". */
  summary?(step: PipelineStep): string;
  /* Exactly one of buildSpec (one request), expand (requests decided at run time) and fromRegion. */
  buildSpec?(step: PipelineStep, actor: string): ActionSpec;
  expand?(step: PipelineStep, ctx: RunContext): Promise<ExpandResult>;
  /* Officer powers (letters from XWSABCEP) this step needs in the puppet's current region. The run
   * checks them against the puppet's background region read and skips the step when any is missing. */
  powers?: string;
  /* Region tool: requests built synchronously from the puppet's background region read, which
   * includes `shards`. The press never waits on the API. Pair with `powers`. */
  fromRegion?: {
    shards: RegionShard[];
    requests(step: PipelineStep, info: RegionInfo, region: string): RequestPlan;
  };
  /* Actor-independent setup error ("" = OK). When present, the pipeline's "Needs setup" check uses it
   * instead of building the spec for the main nation. */
  setupIssue?(step: PipelineStep): string;
  /* Custom settings-dialog body; absent = renderStepFields over `fields`. */
  renderBody?(step: PipelineStep, body: HTMLDivElement): FieldsHandle;
  /* Settings merged over step.settings before buildSpec at run time (blank → the run's value). */
  runSettings?(step: PipelineStep, ctx: RunContext): Record<string, string>;
  /* Wait (ms) after each request of this action before the run continues; dropped presses don't wait. */
  paceMs?: number;
  /* Non-empty = this step is a no-op for this puppet; the text is the toast note and the run steps past it. */
  skip?(step: PipelineStep, ctx: RunContext): string;
  /* Non-empty = appended to this single-request step's result toast for this puppet (e.g. a field dropped for it). */
  runNote?(step: PipelineStep, ctx: RunContext): string;
  /* After a successful single-request step: record its effect. `message` = StepResult.message. */
  onSuccess?(step: PipelineStep, ctx: RunContext, message: string): void;
}
