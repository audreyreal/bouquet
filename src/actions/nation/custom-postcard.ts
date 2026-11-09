import { dumpDateText, formatPopulation } from "../../dump";
import { readPage } from "../../net";
import { type PipelineStep, populationOf } from "../../state";
import { hint, selectField } from "../../ui/dom";
import { canon } from "../../utils";
import { fileMissingText, joinFields, renderStepFields } from "../fields";
import { storedImage, val } from "../spec";
import type { ActionDef, StepField, StepRequest } from "../types";

/* Custom postcard slots on /page=banners: the radio-group/upload id and the population (millions)
 * that unlocks each. */
const SLOTS: Record<string, { id: string; minPop: number }> = {
  "1": { id: "_0", minPop: 50 },
  "2": { id: "_1", minPop: 200 },
  "3": { id: "_2", minPop: 1000 },
  "4": { id: "_3", minPop: 10_000 },
  "5": { id: "_4", minPop: 20_000 },
};
const DISPLAY: Array<[string, string]> = [
  ["", "No change"],
  ["primary", "Primary"],
  ["only", "Only this postcard"],
  ["on", "On"],
  ["off", "Off"],
];
const IMAGE_FIELD: StepField = {
  key: "postcardFile",
  label: "Postcard image (max 1200×400, ~4:1)",
  kind: "file",
  accept: "image/*",
  dataKey: "postcardFileData",
  maxSize: [1200, 400],
};
const BANNERS_PATH = "/page=banners";
const UPLOAD_PATH = "/cgi-bin/upload.cgi";

function slotKey(step: PipelineStep): string {
  return val(step, "slot") || "1";
}

function displayLabel(display: string): string {
  return DISPLAY.find(([k]) => k === display)?.[1] ?? display;
}

/* Actor-independent setup error ("" = OK); expand re-checks it at run time. */
function postcardIssue(step: PipelineStep): string {
  if (!SLOTS[slotKey(step)]) return "slot must be 1–5";
  const display = val(step, "display");
  if (!DISPLAY.some(([k]) => k === display)) return "unknown display mode";
  if (val(step, "postcardFile")) {
    const file = storedImage(step, "postcardFile", "postcardFileData");
    if ("error" in file) return file.error;
  } else if (display === "") return "choose an image, a display mode, or both";
  return "";
}

export const customPostcardAction: Omit<ActionDef, "group"> = {
  type: "custom-postcard",
  title: "Set Custom Postcard",
  blurb: "Upload a custom postcard image and/or set how it shows in the nation banner.",
  fields: [IMAGE_FIELD],
  renderBody(step, body) {
    const slotSel = selectField(
      "Slot",
      Object.entries(SLOTS).map(([k, s]): [string, string] => [
        k,
        `Custom #${k} (${formatPopulation(s.minPop)})`,
      ]),
      step.settings.slot || "1",
    );
    const displaySel = selectField("Display", DISPLAY, step.settings.display ?? "");
    body.append(
      hint(
        "Replaces the slot's current image when one is set. Locked slots (population below the requirement) are skipped.",
      ),
      slotSel,
      displaySel,
    );
    const files = renderStepFields(step, body, [IMAGE_FIELD]);
    return joinFields(
      {
        collect(s) {
          s.settings.slot = slotSel.value || "1";
          s.settings.display = displaySel.value;
        },
      },
      files,
    );
  },
  setupIssue: postcardIssue,
  skip(step, ctx) {
    const slot = slotKey(step);
    const s = SLOTS[slot];
    const pop = populationOf(ctx.actor);
    if (!s || typeof pop !== "number" || pop >= s.minPop) return "";
    return `Custom #${slot} skipped — needs ${formatPopulation(s.minPop)} citizens (${formatPopulation(pop)} in the ${dumpDateText()} dump)`;
  },
  summary(step) {
    let text = `Custom #${slotKey(step)}`;
    const name = step.settings.postcardFile ?? "";
    if (step.settings.postcardFileData) text = `${text} · image: ${name}`;
    else if (name) text = `${text} · ${fileMissingText(name)}`;
    const display = val(step, "display");
    if (display) text = `${text} · ${displayLabel(display)}`;
    return text;
  },
  /* One press reads /page=banners (pressUsed); then one press per request: delete the slot's image
   * (when replacing one), upload, set the display radios. Every POST resends the page's current
   * radio state so nothing else changes. The upload goes to /cgi-bin/upload.cgi, as the site's JS
   * retargets the form for the Upload button; /page=banners rejects file posts as "a large amount
   * of data". The nation API's banners shard can't replace this read: it lists only displayed
   * banners (Off ones absent, primary indistinguishable from random order), names customs by
   * upload id (uploads/<nation>_<id>) rather than slot, and has no login check or chk harvest. */
  async expand(step, ctx) {
    const issue = postcardIssue(step);
    if (issue) return { error: issue };
    const slot = slotKey(step);
    const { id, minPop } = SLOTS[slot];
    const display = val(step, "display");

    const page = await readPage(BANNERS_PATH, ctx.actor);
    if (page === "busy") return { busy: true };
    if (page === null) return { error: "could not load the postcards page" };
    const form = page.querySelector("form#bannerselectform");
    if (!form) return { error: "postcards page has no banner form — log in first" };
    const nationname =
      form.querySelector<HTMLInputElement>('input[name="nationname"]')?.value ?? "";
    if (canon(nationname) !== ctx.actor)
      return {
        error: `postcards page is for ${nationname || "nobody"}, not ${ctx.actor} — log in first`,
      };

    /* Parsed documents carry checkedness only as the attribute. */
    const radios: Record<string, string> = {};
    form.querySelectorAll<HTMLInputElement>('input[type="radio"]').forEach((r) => {
      radios[r.name] ??= "Off";
    });
    form.querySelectorAll<HTMLInputElement>('input[type="radio"][checked]').forEach((r) => {
      radios[r.name] = r.value;
    });
    const key = `banner_${id}`;
    if (!(key in radios))
      return {
        error: `Custom #${slot} is locked — needs ${formatPopulation(minPop)} citizens`,
      };
    const hasImage =
      form.querySelector(`button[name="delete_custom_banner"][value="${id}"]`) !== null;
    const canUpload = form.querySelector(`input[type="file"][name="file_${id}"]`) !== null;

    const requests: StepRequest[] = [];
    /* No page chk: requestBody appends the stored chk/localid. */
    const base = { nationname, ...radios };
    if (val(step, "postcardFile")) {
      const file = storedImage(step, "postcardFile", "postcardFileData");
      if ("error" in file) return { error: file.error };
      if (hasImage) {
        requests.push({
          label: `Delete Custom #${slot} image`,
          spec: {
            kind: "multipart-text",
            path: BANNERS_PATH,
            fields: { ...base, delete_custom_banner: id },
            files: {},
            needle: `name="file_${id}"`,
          },
        });
      } else if (!canUpload)
        return { error: `Custom #${slot} has no upload box on the postcards page` };
      requests.push({
        label: `Upload Custom #${slot} image`,
        spec: {
          kind: "multipart-text",
          path: UPLOAD_PATH,
          fields: { ...base, uploadbanner: id },
          files: { [`file_${id}`]: file },
          needle: `name="delete_custom_banner" value="${id}"`,
        },
      });
    }
    if (display) {
      const next: Record<string, string> = { ...radios };
      if (display === "primary") {
        for (const k of Object.keys(next)) if (next[k] === "Primary") next[k] = "On";
        next[key] = "Primary";
      } else if (display === "only") {
        for (const k of Object.keys(next)) next[k] = "Off";
        next[key] = "On";
      } else next[key] = display === "on" ? "On" : "Off";
      const v = next[key];
      const unchanged = Object.keys(next).every((k) => next[k] === radios[k]);
      if (requests.length || !unchanged) {
        requests.push({
          label: `Set Custom #${slot} display`,
          spec: {
            kind: "multipart-text",
            path: BANNERS_PATH,
            fields: { nationname, ...next, make_changes: "1" },
            files: {},
            needle: `value="${v}" id="banner_${id}_${v}" checked="checked"`,
          },
        });
      }
    }
    if (!requests.length)
      return {
        requests: [],
        note: `Custom #${slot} already ${displayLabel(display)}`,
        pressUsed: true,
      };
    return { requests, pressUsed: true };
  },
};
