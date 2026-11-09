import { REGION_CONTROL_PATH } from "../spec";
import type { ActionDef } from "../types";
import { regionRequests } from "./region-info";

export const removeDispatchesAction: Omit<ActionDef, "group"> = {
  type: "remove-dispatches",
  title: "Remove Regional Dispatches",
  blurb: "Remove every dispatch pinned to the region's World Factbook Entry.",
  fields: [],
  expand: (_step, ctx) =>
    regionRequests(ctx, (info) =>
      info.dispatches.length
        ? {
            tolerant: true,
            requests: info.dispatches.map((id) => ({
              label: `remove dispatch ${id}`,
              spec: {
                kind: "text",
                path: REGION_CONTROL_PATH,
                body: { remove_dispatch: id, confirm_dispatch: id },
                needle: " removed.",
              },
            })),
          }
        : { requests: [], note: "no regional dispatches" },
    ),
  summary: () => "Puppet's current region",
};
