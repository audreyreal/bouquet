import { lines } from "../../utils";
import { REGION_CONTROL_PATH, stepSetting } from "../spec";
import type { ActionDef } from "../types";

export const embassyAction: Omit<ActionDef, "group"> = {
  type: "embassy",
  title: "Send Embassy Request",
  blurb: "Request embassies with the listed regions.",
  fields: [
    {
      key: "embassies",
      label: "Embassies (one region per line)",
      placeholder: "region_one\nregion_two",
      rows: 4,
    },
  ],
  setupIssue: (step) => (lines(stepSetting(step, "embassies")).length ? "" : "embassies required"),
  async expand(step) {
    const targets = lines(stepSetting(step, "embassies"));
    if (!targets.length) return { error: "no embassy targets" };
    return {
      requests: targets.map((t) => ({
        label: `embassy: ${t}`,
        spec: {
          kind: "text",
          path: REGION_CONTROL_PATH,
          body: { requestembassyregion: t, requestembassy: "1" },
          needle: "Your proposal for the construction of embassies with",
        },
      })),
    };
  },
  summary(step) {
    const count = lines(stepSetting(step, "embassies")).length;
    return count ? `${count} embassies` : "No embassies set";
  },
};
