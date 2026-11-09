import { renderManage } from "./manage";
import { renderSettings } from "./settings";

export type Renderer = (main: HTMLElement, bar: HTMLElement) => void;

/* One list drives the tabs, the bouquet= router regex and dispatch. [id, label, renderer, tab icon] */
export const PAGES: Array<[string, string, Renderer, string]> = [
  ["manage", "Manage", renderManage, "group--outlined"],
  ["settings", "Settings", renderSettings, "settings--outlined"],
];

export const RENDER: Record<string, Renderer> = Object.fromEntries(PAGES.map((p) => [p[0], p[2]]));

/* Tab label by id: drives the document (browser tab) title. */
export const LABEL: Record<string, string> = Object.fromEntries(PAGES.map((p) => [p[0], p[1]]));

export const BOUQUET_RE = new RegExp(`[?&]bouquet=(${PAGES.map((p) => p[0]).join("|")})`);
