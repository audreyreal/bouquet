import { canon, lines } from "../../utils";
import { specError, stepSetting } from "../spec";
import type { ActionDef } from "../types";

export const addDossierAction: Omit<ActionDef, "group"> = {
  type: "add-dossier",
  title: "Add to Dossier",
  blurb: "Append nations to the dossier.",
  fields: [
    {
      key: "nations",
      label: "Nations (one per line)",
      placeholder: "nation_one\nnation_two",
      rows: 4,
    },
  ],
  buildSpec(step, actor) {
    const nations = lines(stepSetting(step, "nations"));
    if (!nations.length) return specError("nations required");
    return {
      kind: "multipart-location",
      path: "/dossier.cgi",
      fields: {
        currentnation: canon(actor.trim()),
        action_append: "Upload Nation Dossier File",
      },
      files: {
        file: {
          blob: new Blob([nations.join("\n")], { type: "text/plain" }),
          filename: "dossier.txt",
        },
      },
      needle: "appended=",
    };
  },
  summary(step) {
    const count = lines(stepSetting(step, "nations")).length;
    return count ? `${count} nations` : "No nations set";
  },
};
