import { pageHref } from "../net";
import { ensureMainNation, state } from "../state";
import { canon } from "../utils";
import { el, injectNativeCss } from "./dom";

/* One BOUQUET button linking to the Manage page. Rift top bar: placed right of the spacer before
 * SWITCH/LOGIN/LOGOUT (after nsdotjs addTopBarButton). Mobile: a button pinned to the right of
 * div#banner, above the #summarybar menu toggle. Antiquity and template-overall=none get nothing. */
export function addTopBarButton(): void {
  if (document.getElementById("bq-topbar")) return;
  const spacer = document.querySelector("#banner div.belspacer.belspacermain");
  if (spacer) {
    injectNativeCss();
    const button = el(
      "div",
      { class: "bel", id: "bq-topbar" },
      el("div", { class: "belcontent" }, bouquetLink("bellink")),
    );
    /* Insert before the direct spacer child that holds SWITCH/LOGIN, else LOGOUT, else append. */
    let before: Element | null =
      spacer.querySelector("#loginswitcher") ?? spacer.querySelector("#logoutbox");
    while (before && before.parentElement !== spacer) before = before.parentElement;
    spacer.insertBefore(button, before);
    return;
  }
  const banner = document.querySelector("#banner");
  const summary = banner?.querySelector(":scope > #summarybar");
  if (!banner || !summary) return;
  injectNativeCss();
  banner.appendChild(el("div", { id: "bq-topbar", class: "bq-topbar-m" }, bouquetLink(null)));
}

function bouquetLink(cls: string | null): HTMLAnchorElement {
  const link = el(
    "a",
    {
      class: cls,
      href: pageHref("manage"),
      title: "Open Bouquet (puppet roster and action pipeline)",
      /* First run: the href above carries __usedBy_unknown. Ask for the main nation first, then
       * rebuild the tagged URL and navigate; a cancelled prompt stays on this page. */
      onclick: (e: MouseEvent) => {
        if (state.mainNation) return;
        e.preventDefault();
        if (!ensureMainNation(canon(document.body?.getAttribute("data-nname") ?? ""))) return;
        link.href = pageHref("manage");
        location.assign(link.href);
      },
    },
    el("i", { class: "icon-heart" }),
    "BOUQUET",
  );
  return link;
}
