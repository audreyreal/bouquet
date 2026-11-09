import { type PipelineStep, persist, state } from "../../state";
import { disclosure, hint } from "../../ui/dom";
import { canon } from "../../utils";
import { joinFields, renderStepFields } from "../fields";
import { specError, stepSetting, val } from "../spec";
import type { ActionDef, StepField } from "../types";

const fields = [
  { key: "region", label: "Region", placeholder: "e.g. the_west_pacific" },
  {
    key: "password",
    label: "Region password",
    placeholder: "empty unless the region is passworded",
  },
];

const regionMapField: StepField = {
  key: "regionMap",
  label: "Nation → region list",
  placeholder: "nation,region\nnation2;region2",
  rows: 6,
};

/* "nation<sep>region" lines, <sep> = ":", ";" or ",". Split on the FIRST separator (nation names
 * never contain any of them). Nation keys are canon()'d; regions are trimmed as typed, matching the
 * Region field. Later lines for the same nation win. Non-blank lines without a separator, or with an
 * empty nation/region, are reported by 1-based line number. */
export function parseRegionMap(text: string): {
  regions: Record<string, string>;
  badLines: number[];
} {
  const regions: Record<string, string> = {};
  const badLines: number[] = [];
  text.split("\n").forEach((line, index) => {
    const t = line.trim();
    if (!t) return;
    const i = t.search(/[:;,]/);
    if (i === -1) {
      badLines.push(index + 1);
      return;
    }
    const name = canon(t.slice(0, i).trim());
    const region = t.slice(i + 1).trim();
    if (!name || !region) {
      badLines.push(index + 1);
      return;
    }
    regions[name] = region;
  });
  return { regions, badLines };
}

function badLinesMessage(lines: number[]): string {
  return lines.length === 1
    ? `region list line ${lines[0]} needs nation,region`
    : `region list lines ${lines.join(", ")} need nation,region`;
}

function moveRegionSetupIssue(step: PipelineStep): string {
  const { regions, badLines } = parseRegionMap(stepSetting(step, "regionMap"));
  if (badLines.length) return badLinesMessage(badLines);
  if (!val(step, "region") && Object.keys(regions).length === 0) return "region required";
  return "";
}

/* Where this step moves `actor`: its line in the nation → region list, else the Region field
 * ("" = neither). */
function moveTarget(step: PipelineStep, actor: string): string {
  const { regions } = parseRegionMap(stepSetting(step, "regionMap"));
  return regions[canon(actor.trim())] ?? val(step, "region");
}

export const moveRegionAction: Omit<ActionDef, "group"> = {
  type: "move-region",
  title: "Move to Region",
  blurb:
    "Move the nation to the configured region, or to its own region from an optional per-nation list.",
  fields,
  setupIssue: moveRegionSetupIssue,
  skip(step, ctx) {
    const target = canon(moveTarget(step, ctx.actor));
    return target && target === ctx.region ? `already in ${target} — move skipped` : "";
  },
  onSuccess(step, ctx) {
    state.regions[ctx.actor] = canon(moveTarget(step, ctx.actor));
    persist();
  },
  buildSpec(step, actor) {
    const { regions, badLines } = parseRegionMap(stepSetting(step, "regionMap"));
    if (badLines.length) return specError(badLinesMessage(badLines));
    const nation = canon(actor.trim());
    const region = moveTarget(step, actor);
    if (!region) {
      return specError(
        Object.keys(regions).length
          ? `no region listed for ${nation} and no default Region set`
          : "region required",
      );
    }
    const password = stepSetting(step, "password");
    return {
      kind: "text",
      path: "/template-overall=none/page=change_region",
      body: {
        region_name: region,
        move_region: "1",
        confirm_move: "1",
        ...(password ? { password } : {}),
      },
      needle: "Success!",
    };
  },
  summary(step) {
    const region = (step.settings.region ?? "").trim();
    const n = Object.keys(parseRegionMap(step.settings.regionMap ?? "").regions).length;
    const parts: string[] = [];
    if (region) parts.push(`Region: ${region}`);
    if (n) parts.push(`${n}${n === 1 ? " nation" : " nations"} mapped`);
    const summary = parts.length ? parts.join(" · ") : "No region set";
    return `${summary}${step.settings.password ? " · passworded" : ""}`;
  },
  renderBody(step, body) {
    const main = renderStepFields(step, body, fields);
    const { root, panel } = disclosure(
      "Per-nation regions (optional)",
      (step.settings.regionMap ?? "").trim() !== "",
    );
    panel.appendChild(
      hint(
        "One per line: nation,region (separator may be : ; or ,). Listed nations move to their own region; every other nation uses Region above. The region password is sent for every move.",
      ),
    );
    const map = renderStepFields(step, panel, [regionMapField]);
    body.append(root);
    return joinFields(main, map);
  },
};
