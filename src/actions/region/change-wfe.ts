import { ncrEncode } from "../../utils";
import { REGION_CONTROL_PATH, specError, val } from "../spec";
import type { ActionDef } from "../types";

export const changeWfeAction: Omit<ActionDef, "group"> = {
  type: "change-wfe",
  title: "Change WFE",
  blurb: "Set the region's World Factbook Entry.",
  fields: [{ key: "wfe", label: "WFE", placeholder: "Factbook text…", rows: 4 }],
  buildSpec(step) {
    const message = val(step, "wfe");
    if (!message) return specError("WFE required");
    return {
      kind: "text",
      path: REGION_CONTROL_PATH,
      body: { message: ncrEncode(message), setwfebutton: "1" },
      needle: "World Factbook Entry updated!",
    };
  },
  summary(step) {
    const wfe = step.settings.wfe ?? "";
    return wfe ? wfe.slice(0, 60) : "No WFE set";
  },
};
