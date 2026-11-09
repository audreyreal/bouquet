import { canon } from "../../utils";
import { fileMissingText } from "../fields";
import { specError, storedImage } from "../spec";
import type { ActionDef } from "../types";

export const changeNationFlagAction: Omit<ActionDef, "group"> = {
  type: "change-nation-flag",
  title: "Change Nation Flag",
  blurb: "Upload a new nation flag image.",
  fields: [
    {
      key: "flagFile",
      label: "Flag image",
      kind: "file",
      accept: "image/*",
      dataKey: "flagFileData",
    },
  ],
  buildSpec(step, actor) {
    const file = storedImage(step, "flagFile", "flagFileData");
    if ("error" in file) return specError(file.error);
    return {
      kind: "multipart-follow",
      path: "/cgi-bin/upload.cgi",
      fields: { nationname: canon(actor.trim()) },
      files: { file },
      needle: "page=settings",
    };
  },
  summary(step) {
    const flagFile = step.settings.flagFile ?? "";
    if (step.settings.flagFileData) return `Flag image: ${flagFile}`;
    return fileMissingText(flagFile);
  },
};
