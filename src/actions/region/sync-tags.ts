import { lines } from "../../utils";
import { REGION_CONTROL_PATH, stepSetting } from "../spec";
import type { ActionDef, StepRequest } from "../types";
import { tagKey, UNREMOVABLE_TAGS } from "./region-info";

function tagRequest(field: "add_tag" | "remove_tag", key: string): StepRequest {
  return {
    label: `${field === "add_tag" ? "add tag: " : "remove tag: "}${key}`,
    spec: {
      kind: "text",
      path: REGION_CONTROL_PATH,
      body: { [field]: key, updatetagsbutton: "1" },
      needle: "Region Tags updated!",
    },
  };
}

export const syncTagsAction: Omit<ActionDef, "group"> = {
  type: "sync-tags",
  title: "Set Region Tags",
  blurb:
    "Make the region's tags exactly the listed ones: remove the others, then add what is missing.",
  fields: [
    {
      key: "tags",
      label: "Tags (one per line)",
      placeholder: "anti-fascist\nmagical",
      rows: 6,
    },
  ],
  powers: "A",
  fromRegion: {
    shards: ["tags"],
    requests: (step, info) => {
      const wanted = new Set(lines(stepSetting(step, "tags")).map(tagKey));
      const current = new Set(info.tags.map(tagKey));
      const requests = [
        ...[...current]
          .filter((k) => !wanted.has(k) && UNREMOVABLE_TAGS[k] !== true)
          .map((k) => tagRequest("remove_tag", k)),
        ...[...wanted].filter((k) => !current.has(k)).map((k) => tagRequest("add_tag", k)),
      ];
      return requests.length
        ? { tolerant: true, requests }
        : { requests: [], note: "tags already match" };
    },
  },
  summary(step) {
    const n = lines(stepSetting(step, "tags")).length;
    return n ? `${n}${n === 1 ? " tag" : " tags"}` : "Remove every removable tag";
  },
};
