import type { RegionInfo } from "../../net";

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

const ALL_POWERS = "XWSABCEP";

/* Letters of `required` that `actor` does not hold in the read region: its officer authority, plus
 * the delegate's authority when it is the delegate, plus every power when it is the governor.
 * "" = holds them all. */
export function missingPowers(info: RegionInfo, actor: string, required: string): string {
  let held = info.officers.find((o) => o.nation === actor)?.authority ?? "";
  if (info.delegate === actor) held = `${held}${info.delegateAuth}`;
  if (info.governor === actor) held = `${held}${ALL_POWERS}`;
  return [...required].filter((p) => !held.includes(p)).join("");
}
