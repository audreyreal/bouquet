import { dataUrlToBlob, type MultipartFile } from "../net";
import type { PipelineStep } from "../state";
import type { ActionDef } from "./types";

export type ActionSpec =
  | { kind: "server-verdict"; path: string; body: Record<string, string> }
  | { kind: "text"; path: string; body: Record<string, string>; needle: string }
  | { kind: "get-text"; path: string; needle: string }
  | { kind: "location"; path: string; body: Record<string, string>; needle: string }
  | { kind: "status"; path: string; body: Record<string, string>; status: number }
  | {
      kind: "multipart-location";
      path: string;
      fields: Record<string, string>;
      files: Record<string, MultipartFile>;
      needle: string;
    }
  | {
      kind: "multipart-follow";
      path: string;
      fields: Record<string, string>;
      files: Record<string, MultipartFile>;
      /* Substring of the final URL after following the redirect. */
      needle: string;
    }
  | {
      kind: "multipart-text";
      path: string;
      fields: Record<string, string>;
      files: Record<string, MultipartFile>;
      /* Substring of the response HTML that proves success. */
      needle: string;
    }
  | {
      kind: "json-id";
      path: string;
      fields: Record<string, string>;
      files: Record<string, MultipartFile>;
    }
  | { kind: "login"; path: string; body: Record<string, string> }
  | { kind: "reauth" }
  | { kind: "error"; message: string };

export const REGION_CONTROL_PATH = "/template-overall=none/page=region_control/";

export function stepSetting(step: PipelineStep, key: string): string {
  return step.settings[key] ?? "";
}

/* The setting, trimmed. */
export function val(step: PipelineStep, key: string): string {
  return stepSetting(step, key).trim();
}

/* "<prefix><value>" when the setting is non-empty, else `empty` (pipeline-card summaries). */
export function labelled(prefix: string, step: PipelineStep, key: string, empty: string): string {
  const value = stepSetting(step, key);
  return value ? `${prefix}${value}` : empty;
}

export function specError(message: string): ActionSpec {
  return { kind: "error", message };
}

/* The image a file field stored on the step (file name + base64 data URL) as an upload part. */
export function storedImage(
  step: PipelineStep,
  nameKey: string,
  dataKey: string,
): MultipartFile | { error: string } {
  const filename = stepSetting(step, nameKey);
  const dataUrl = stepSetting(step, dataKey);
  if (!filename || !dataUrl) return { error: "no image selected — choose a file" };
  try {
    return { blob: dataUrlToBlob(dataUrl), filename };
  } catch {
    return { error: "saved image is corrupt — reselect the file" };
  }
}

/* One-field region-control action (eject, banject): a nation name POSTed to region_control,
 * success = `needle` in the response; the persisted settings key is `nation`. */
export function regionControlAction(def: {
  type: ActionDef["type"];
  title: string;
  blurb: string;
  verb: string;
  needle: string;
  body: (value: string) => Record<string, string>;
}): Omit<ActionDef, "group"> {
  return {
    type: def.type,
    title: def.title,
    blurb: def.blurb,
    fields: [{ key: "nation", label: "Nation" }],
    buildSpec(step) {
      const value = val(step, "nation");
      if (!value) return specError("nation required");
      return {
        kind: "text",
        path: REGION_CONTROL_PATH,
        body: def.body(value),
        needle: def.needle,
      };
    },
    summary: (step) => labelled(`${def.verb} `, step, "nation", "No nation set"),
    paceMs: 1000 /* NS rate-limits ejections */,
  };
}

/* Fixed-request action: no fields, the same request every run. */
export function fixedAction(def: {
  type: ActionDef["type"];
  title: string;
  blurb: string;
  spec: ActionSpec;
}): Omit<ActionDef, "group"> {
  return {
    type: def.type,
    title: def.title,
    blurb: def.blurb,
    fields: [],
    buildSpec: () => def.spec,
  };
}
