import { ncrEncode } from "../../utils";
import { labelled, specError, stepSetting, val } from "../spec";
import type { ActionDef } from "../types";

export const createRegionAction: Omit<ActionDef, "group"> = {
  type: "create-region",
  title: "Create Region",
  blurb: "Found a new region.",
  fields: [
    { key: "regionName", label: "Region name" },
    { key: "wfe", label: "WFE", rows: 4 },
    { key: "password", label: "Password" },
    {
      key: "frontier",
      label: "Frontier",
      placeholder: "1 for frontier, empty otherwise",
    },
    {
      key: "executive",
      label: "Executive delegacy",
      placeholder: "1 for executive delegacy, empty otherwise",
    },
  ],
  buildSpec(step) {
    const regionName = val(step, "regionName");
    const desc = val(step, "wfe");
    if (!regionName || !desc) return specError("region name and WFE required");
    const password = stepSetting(step, "password");
    const frontier = stepSetting(step, "frontier");
    const executive = stepSetting(step, "executive");
    return {
      kind: "text",
      path: "/template-overall=none/page=create_region",
      body: {
        page: "create_region",
        region_name: regionName,
        desc: ncrEncode(desc),
        create_region: "1",
        ...(password ? { pw: "1", rpassword: password } : {}),
        ...(frontier === "1"
          ? { is_frontier: "1" }
          : executive === "1"
            ? { delegate_control: "1" }
            : {}),
      },
      needle: "Success! You have founded ",
    };
  },
  summary: (step) => labelled("Region: ", step, "regionName", "No region set"),
};
