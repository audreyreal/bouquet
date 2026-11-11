import { REGION_CONTROL_PATH, specError, stepSetting, val } from "../spec";
import type { ActionDef } from "../types";

export const setRegionFlagAction: Omit<ActionDef, "group"> = {
  type: "set-region-flag",
  title: "Set Region Flag/Banner",
  blurb: "Apply uploaded flag/banner IDs.",
  fields: [
    { key: "flagId", label: "Flag ID", placeholder: "blank = this run's upload" },
    { key: "bannerId", label: "Banner ID", placeholder: "blank = this run's upload" },
    {
      key: "flagMode",
      label: "Mode",
      placeholder: "flag, logo, or empty for no change",
    },
  ],
  runSettings: (step, ctx) => ({
    ...(val(step, "flagId") ? {} : { flagId: ctx.uploads.flag }),
    ...(val(step, "bannerId") ? {} : { bannerId: ctx.uploads.banner }),
  }),
  setupIssue(step) {
    const flagMode = val(step, "flagMode").toLowerCase();
    return flagMode && flagMode !== "flag" && flagMode !== "logo"
      ? "flag mode must be flag, logo, or empty"
      : "";
  },
  powers: "A",
  buildSpec(step) {
    const flagId = stepSetting(step, "flagId");
    const bannerId = stepSetting(step, "bannerId");
    const flagMode = val(step, "flagMode").toLowerCase();
    if (flagMode && flagMode !== "flag" && flagMode !== "logo")
      return specError("flag mode must be flag, logo, or empty");
    if (!flagId && !bannerId && !flagMode) return specError("flag, banner, or mode required");
    return {
      kind: "text",
      path: REGION_CONTROL_PATH,
      body: {
        ...(flagId ? { newflag: flagId } : {}),
        ...(bannerId ? { newbanner: bannerId } : {}),
        ...(flagMode ? { flagmode: flagMode } : {}),
        saveflagandbannerchanges: "1",
      },
      needle: "Regional banner/flag updated!",
    };
  },
  summary(step) {
    const id = step.settings.flagId || step.settings.bannerId || "";
    return id ? `Flag/banner: ${id}` : "Nothing set";
  },
};
