import { fileMissingText } from "../fields";
import { specError, storedImage, val } from "../spec";
import type { ActionDef } from "../types";

export const uploadRegionFileAction: Omit<ActionDef, "group"> = {
  type: "upload-region-file",
  title: "Upload Region File",
  blurb: "Upload a flag/banner, returning its ID for the next action.",
  fields: [
    { key: "fileType", label: "Type", placeholder: "flag or banner" },
    {
      key: "filename",
      label: "Image file",
      kind: "file",
      accept: "image/*",
      dataKey: "fileData",
    },
    { key: "region", label: "Region", placeholder: "blank = the puppet's current region" },
  ],
  runSettings: (step, ctx): Record<string, string> =>
    val(step, "region") ? {} : { region: ctx.region },
  onSuccess(step, ctx, message) {
    const type = val(step, "fileType").toLowerCase();
    if (type === "flag" || type === "banner") ctx.uploads[type] = message;
  },
  setupIssue(step) {
    const type = val(step, "fileType").toLowerCase();
    if (type !== "flag" && type !== "banner") return "type must be 'flag' or 'banner'";
    const file = storedImage(step, "filename", "fileData");
    return "error" in file ? file.error : "";
  },
  buildSpec(step) {
    const region = val(step, "region");
    if (!region)
      return specError(
        "region unknown — set Region, or log in first so Bouquet learns the puppet's region",
      );
    const type = val(step, "fileType").toLowerCase();
    if (type !== "flag" && type !== "banner") return specError("type must be 'flag' or 'banner'");
    const file = storedImage(step, "filename", "fileData");
    if ("error" in file) return specError(file.error);
    return {
      kind: "json-id",
      path: "/cgi-bin/upload.cgi",
      fields: {
        uploadtype: `r${type}`,
        page: "region_control",
        region,
        expect: "json",
      },
      files: { [`file_upload_r${type}`]: file },
    };
  },
  summary(step) {
    const region = step.settings.region ?? "";
    const prefix = region ? `${region} — ` : "";
    const fileType = step.settings.fileType ?? "";
    const filename = step.settings.filename ?? "";
    if (step.settings.fileData) return `${prefix}${fileType || "file"}: ${filename}`;
    return `${prefix}${fileMissingText(filename)}`;
  },
};
