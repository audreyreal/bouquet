import { type RegionInfo, readRegionInfo } from "../../net";
import type { ExpandResult, RunContext } from "../types";

/* A tag as region_control's add_tag/remove_tag value (Henson TagToRequest). */
export function tagKey(tag: string): string {
  return tag.replace(/:/g, "").replace(/ /g, "_").toLowerCase();
}

/* Tags NS assigns itself; region_control cannot remove them (Henson's list). */
export const UNREMOVABLE_TAGS: Record<string, true> = {
  commended: true,
  condemned: true,
  liberated: true,
  injuncted: true,
  minuscule: true,
  small: true,
  medium: true,
  large: true,
  enormous: true,
  gargantuan: true,
  featured: true,
  founderless: true,
  governorless: true,
  new: true,
  frontier: true,
};

/* Region-tool expansion: read the acting puppet's region off the API, then build its requests. */
export async function regionRequests(
  ctx: RunContext,
  build: (info: RegionInfo, region: string) => ExpandResult,
): Promise<ExpandResult> {
  if (!ctx.region)
    return { error: "puppet's region unknown — log in first (the login page reports it)" };
  const res = await readRegionInfo(ctx.region);
  if (!res.ok) return res.busy ? { busy: true } : { error: res.message };
  return build(res.value, ctx.region);
}
