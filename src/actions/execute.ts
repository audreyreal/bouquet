import { authFor } from "../auth";
import { BUSY_DROP_MSG } from "../constants";
import {
  fetchNationExists,
  NS_BUSY_MSG,
  type PostOpts,
  type PostResult,
  readPage,
  send,
} from "../net";
import { type BouquetAuth, type PipelineStep, passwordFor } from "../state";
import { canon, isRecord, parseHtml, sleep } from "../utils";
import { actionDef, specFor } from "./catalog";
import type { ActionSpec } from "./spec";
import type { RunContext } from "./types";

export interface StepResult {
  ok: boolean;
  dropped: boolean;
  busy: boolean;
  message: string;
  /* Success only: the response's p.error/p.info text (PostResult.notice); "" otherwise. Failures already carry it in message. */
  notice: string;
  emptyUpload?: boolean;
}

const EMPTY_AUTH: BouquetAuth = { chk: "", localid: "", updatedAt: 0 };

type BodySpec = Exclude<PostSpec, { kind: "get-text" }>;
/* chk+localid ride beside the action fields — that pair is what makes the request act as that puppet. */
function urlBody(fields: Record<string, string>, auth: BouquetAuth): URLSearchParams {
  return new URLSearchParams({ ...fields, chk: auth.chk, localid: auth.localid });
}
function requestBody(spec: BodySpec, auth: BouquetAuth): BodyInit {
  if ("body" in spec) return urlBody(spec.body, auth);
  const form = new FormData();
  for (const [name, value] of Object.entries(spec.fields)) form.append(name, value);
  form.append("chk", auth.chk);
  form.append("localid", auth.localid);
  for (const [name, file] of Object.entries(spec.files))
    form.append(name, file.blob, file.filename);
  return form;
}

const DROPPED: StepResult = {
  ok: false,
  dropped: true,
  busy: false,
  message: BUSY_DROP_MSG,
  notice: "",
};

function ok(message: string, notice = ""): StepResult {
  return { ok: true, dropped: false, busy: false, message, notice };
}

function fail(message: string): StepResult {
  return { ok: false, dropped: false, busy: false, message, notice: "" };
}

function busyResult(emptyUpload: boolean): StepResult {
  const res: StepResult = {
    ok: false,
    dropped: false,
    busy: true,
    message: NS_BUSY_MSG,
    notice: "",
  };
  if (emptyUpload) res.emptyUpload = true;
  return res;
}

type PostSpec = Exclude<ActionSpec, { kind: "error" | "reauth" }>;

/* Login/status requests act as no stored session: they send no tokens and never attribute response tokens to the actor. */
function isAnonymous(spec: ActionSpec): boolean {
  return spec.kind === "login" || spec.kind === "status";
}

/* The spec's success test: `hit` = the success message, or null; `miss` = the fallback failure
 * text when the server gave no error/info of its own. */
function verdict(
  spec: PostSpec,
  res: PostResult,
  actor: string,
): { hit: string | null; miss: string } {
  switch (spec.kind) {
    case "login":
      return {
        hit:
          parseHtml(res.html).body?.getAttribute("data-nname") === canon(actor)
            ? "logged in"
            : null,
        miss: "login response did not identify the nation",
      };
    case "server-verdict":
      return { hit: res.ok ? res.info : null, miss: "expected server verdict not found" };
    case "text":
    case "get-text":
    case "multipart-text":
      return {
        hit: res.html.includes(spec.needle) ? res.info || spec.needle : null,
        miss: "expected response text not found",
      };
    case "location":
    case "multipart-location":
      return {
        hit: res.location.includes(spec.needle) ? res.info || spec.needle : null,
        miss: "expected response location not found",
      };
    case "multipart-follow":
      return {
        hit: res.url.includes(spec.needle) && res.error === "" ? res.info || spec.needle : null,
        miss: `upload did not return to ${spec.needle}`,
      };
    case "status":
      return {
        hit: res.status === spec.status ? `HTTP ${spec.status}` : null,
        miss: `expected HTTP ${spec.status}`,
      };
    case "json-id": {
      const id = isRecord(res.json) ? res.json.id : undefined;
      return {
        hit: typeof id === "string" && id.trim() ? id : null,
        miss: "upload response did not contain an ID",
      };
    }
  }
}

async function executePost(
  spec: PostSpec,
  actor: string,
  auth: BouquetAuth,
  paceMs: number,
): Promise<StepResult> {
  const manualRedirect =
    spec.kind === "location" || spec.kind === "status" || spec.kind === "multipart-location";
  const opts: PostOpts = {
    manualRedirect,
    fullPage: spec.kind === "login",
    actor: isAnonymous(spec) ? undefined : actor,
  };
  let dropped = false;
  try {
    const res =
      spec.kind === "get-text"
        ? await send(spec.path, null, opts)
        : await send(spec.path, () => requestBody(spec, auth), opts);
    if (res === null) {
      dropped = true;
      return DROPPED;
    }
    const { hit, miss } = verdict(spec, res, actor);
    if (hit !== null) return ok(hit, res.notice);
    if (res.busy)
      return busyResult(
        spec.kind === "multipart-location" && res.status !== 502 && res.html.trim() === "",
      );
    return fail(res.notice || miss);
  } catch (err) {
    return fail(String(err));
  } finally {
    if (!dropped && paceMs > 0) await sleep(paceMs);
  }
}

async function reauth(actor: string): Promise<StepResult> {
  try {
    const page = await readPage("/page=display_region/region=rwby", actor);
    if (page === "busy") return busyResult(false);
    if (page === null) return fail("fetch failed");
    if (authFor(actor)) return ok("reauthenticated");
    return fail("response did not contain auth for actor");
  } catch (err) {
    return fail(String(err));
  }
}

/* The one missing-auth gate: login/status POSTs are anonymous, reauth harvests its own tokens. */
async function runSpec(spec: ActionSpec, actor: string, paceMs: number): Promise<StepResult> {
  const auth = authFor(actor);
  const anonymous = isAnonymous(spec);
  if (auth === null && !anonymous && spec.kind !== "reauth")
    return fail(`missing auth for ${actor} — harvest first`);
  if (spec.kind === "error") return fail(spec.message);
  if (spec.kind === "reauth") return reauth(actor);
  return executePost(spec, actor, anonymous ? EMPTY_AUTH : (auth ?? EMPTY_AUTH), paceMs);
}

/* One request of an expanded step (ActionDef.expand), already built. */
export function executeRequest(spec: ActionSpec, actor: string): Promise<StepResult> {
  return runSpec(spec, actor, 0);
}

export function executeStep(
  step: PipelineStep,
  actor: string,
  ctx: RunContext,
): Promise<StepResult> {
  const def = actionDef(step.type);
  const run = def?.runSettings
    ? { ...step, settings: { ...step.settings, ...def.runSettings(step, ctx) } }
    : step;
  return runSpec(specFor(run, actor), actor, def?.paceMs ?? 0);
}

export type RestoreResult =
  | { kind: "dropped" }
  | { kind: "busy" }
  | { kind: "revived"; notice: string }
  | { kind: "needs-reset"; notice: string }
  | { kind: "failed"; message: string };

/* One restore POST for `actor` (the body the old Revive tab sent), using its roster password
 * override, else the global password. "revived" = the response page is logged in as the nation
 * and shows no password form. Otherwise the nation API decides: it exists now → "needs-reset"
 * (restored, but NS wants a new password), else "failed". */
export async function executeRestore(actor: string): Promise<RestoreResult> {
  const name = canon(actor.trim());
  let res: PostResult | null;
  try {
    res = await send("/", () =>
      urlBody(
        {
          logging_in: "1",
          nation: name,
          restore_nation: ` Restore ${name} `,
          restore_password: passwordFor(name),
        },
        EMPTY_AUTH,
      ),
    );
  } catch (err) {
    return { kind: "failed", message: String(err) };
  }
  if (res === null) return { kind: "dropped" };
  if (res.busy) return { kind: "busy" };
  const doc = parseHtml(res.html);
  if (doc.body?.getAttribute("data-nname") === name && !doc.querySelector('input[type="password"]'))
    return { kind: "revived", notice: res.notice };
  const reason = res.notice || "no confirmation";
  const exists = await fetchNationExists(name);
  if (exists === true) return { kind: "needs-reset", notice: res.notice };
  if (exists === null)
    return { kind: "failed", message: `${reason} — couldn't check the nation API` };
  return { kind: "failed", message: reason };
}
