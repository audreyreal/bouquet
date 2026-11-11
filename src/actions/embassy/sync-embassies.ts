import { state } from "../../state";
import { canon, lines, regionList } from "../../utils";
import { stepSetting } from "../spec";
import type { ActionDef, StepRequest } from "../types";
import { type EmbassyVerb, embassyVerbSpec } from "./embassy-control";

/* Regions Clean Up Embassies keeps: the Settings whitelist plus every Send Embassy Request target
 * in the pipeline. */
function keptRegions(): Set<string> {
  const kept = new Set(regionList(state.embassyWhitelist));
  for (const step of state.pipeline) {
    if (step.type !== "embassy") continue;
    for (const target of lines(stepSetting(step, "embassies"))) kept.add(canon(target));
  }
  return kept;
}

const REMOVE_VERB: Record<"established" | "invited" | "pending" | "requested", EmbassyVerb> = {
  established: "close",
  invited: "reject",
  pending: "abort",
  requested: "withdraw",
};

export const syncEmbassiesAction: Omit<ActionDef, "group"> = {
  type: "sync-embassies",
  title: "Clean Up Embassies",
  blurb:
    "Close, reject, abort or withdraw every embassy not on the Settings whitelist or a Send Embassy Request list, and cancel closure of kept ones.",
  fields: [],
  powers: "E",
  fromRegion: {
    shards: ["embassies"],
    requests: (_step, info) => {
      const kept = keptRegions();
      const requests: StepRequest[] = [];
      for (const { name, kind } of info.embassies) {
        const keep = kept.has(canon(name));
        const verb: EmbassyVerb | null =
          kind === "closing" ? (keep ? "cancelClosure" : null) : keep ? null : REMOVE_VERB[kind];
        if (verb) requests.push({ label: `${verb}: ${name}`, spec: embassyVerbSpec(verb, name) });
      }
      return requests.length
        ? { tolerant: true, requests }
        : { requests: [], note: "embassies already match the whitelist" };
    },
  },
  summary: () => "Keep the Settings whitelist",
};
