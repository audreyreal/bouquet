import { stepSetting } from "../spec";
import type { ActionDef } from "../types";
import { regionRequests } from "./region-info";

const ALL_POWERS = "XWSABCEP";

/* Required power letters, uppercased, spaces dropped; blank = ACE (what tagging needs). */
function requiredPowers(raw: string): string {
  return raw.replace(/\s/g, "").toUpperCase() || "ACE";
}

export const checkRegionPowersAction: Omit<ActionDef, "group"> = {
  type: "check-region-powers",
  title: "Check Officer Powers",
  blurb:
    "Stop this puppet's run unless it holds the listed regional powers (officer, delegate or governor).",
  fields: [{ key: "powers", label: "Required powers", placeholder: "ACE — letters from XWSABCEP" }],
  setupIssue: (step) =>
    /^[XWSABCEP]*$/.test(requiredPowers(stepSetting(step, "powers")))
      ? ""
      : "powers must be letters from XWSABCEP",
  expand: (step, ctx) =>
    regionRequests(ctx, (info, region) => {
      const required = requiredPowers(stepSetting(step, "powers"));
      let held = info.officers.find((o) => o.nation === ctx.actor)?.authority ?? "";
      if (info.delegate === ctx.actor) held = `${held}${info.delegateAuth}`;
      if (info.governor === ctx.actor) held = `${held}${ALL_POWERS}`;
      const missing = [...required].filter((p) => !held.includes(p)).join("");
      return missing
        ? { error: `missing powers ${missing} in ${region}` }
        : { requests: [], note: `has ${required}` };
    }),
  summary: (step) => `Requires ${requiredPowers(stepSetting(step, "powers"))}`,
};
