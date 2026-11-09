import type { ActionDef } from "../types";
import { regionRequests } from "./region-info";

export const suppressRmbAction: Omit<ActionDef, "group"> = {
  type: "suppress-rmb",
  title: "Suppress RMB Posts",
  blurb: "Suppress every unsuppressed post among the region's latest 100 RMB messages.",
  fields: [],
  expand: (_step, ctx) =>
    regionRequests(ctx, (info, region) =>
      info.posts.length
        ? {
            tolerant: true,
            requests: info.posts.map((id) => ({
              label: `suppress post ${id}`,
              spec: {
                kind: "get-text",
                path: `/page=ajax/a=rmbsuppress/region=${region}/postid=${id}`,
                needle: " suppressed by ",
              },
            })),
          }
        : { requests: [], note: "no unsuppressed posts among the latest 100" },
    ),
  summary: () => "Puppet's current region",
};
