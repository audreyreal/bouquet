import {
  FEEDBACK_URL,
  MDUI_CSS_URL,
  MDUI_ICONS_URL,
  ROBOTO_URL,
  SCRIPT_VERSION,
} from "../constants";
import { pageHref, setBusyBar, withGeneratedBy } from "../net";
import { LABEL, PAGES } from "../pages/index";
import { persist, state, type Theme } from "../state";
import { mountSkipButton } from "./actions";
import { BASE_CSS, COLOR_SCHEMES, DARK_PREPAINT_CSS, FONT_CSS, FOUC_CSS } from "./css";
import { bindStatusLine, btn, el } from "./dom";
import { mountLoginAllButton } from "./login-all";
import { mduiGlobal } from "./mdui";

/* Chromeless pages ship an empty <head>: without this, phones lay Bouquet out at desktop width. */
export function injectViewportMeta(): void {
  if (document.querySelector('meta[name="viewport"]')) return;
  document.head.appendChild(
    el("meta", { name: "viewport", content: "width=device-width, initial-scale=1" }),
  );
}

/* Dark theme: paint the canvas dark before the lock wait and mdui.css load (see DARK_PREPAINT_CSS). */
export function injectDarkPrepaint(): void {
  if (state.theme !== "dark" || document.getElementById("bq-prepaint")) return;
  document.head.appendChild(el("style", { id: "bq-prepaint" }, DARK_PREPAINT_CSS));
}

/* Script mount: base CSS + MDUI stylesheet + Outlined icon font + Roboto + FOUC guard. Returns the MDUI global or null. */
export function loadMduiAssets(): MduiGlobal | null {
  document.head.append(
    el("style", { id: "sf-base-css" }, BASE_CSS),
    ...[MDUI_CSS_URL, MDUI_ICONS_URL, ROBOTO_URL].map((href) =>
      el("link", { rel: "stylesheet", href }),
    ),
    el("style", null, `${FOUC_CSS}${FONT_CSS}`),
  );
  return mduiGlobal();
}

/* The page's mount point, emptied. boot() runs at document-idle, so body exists; template-none
 * may strip div#content. */
function clearContent(): HTMLElement {
  const content = document.querySelector<HTMLElement>("div#content") ?? document.body;
  content.innerHTML = "";
  return content;
}

/* Bouquet cannot mount (CDN failure, no main nation): show why, do not fake a console. */
export function mountBootError(message: string): void {
  clearContent().appendChild(el("div", { style: "padding:16px" }, message));
}

/* Theme + color scheme live in GM state (MDUI persists nothing); re-applied on every boot. */
function applyStoredTheme(m: MduiGlobal): void {
  m.setTheme(state.theme === "light" ? "light" : "dark");
  if (state.colorScheme) m.setColorScheme(state.colorScheme);
  else m.removeColorScheme();
}

export function paintThemeToggle(btn: HTMLElement): void {
  const light = state.theme === "light";
  btn.setAttribute("icon", light ? "light_mode--outlined" : "dark_mode--outlined");
  const label = light ? "Switch to dark theme" : "Switch to light theme";
  btn.setAttribute("title", label);
  btn.setAttribute("aria-label", label);
}

export interface Shell {
  main: HTMLElement;
  bar: HTMLElement;
}

export function mountShell(active: string, returnUrl: string, m: MduiGlobal): Shell {
  applyStoredTheme(m);
  /* Browser tab title names the open tab; full document navigation per tab switch re-runs this. */
  document.title = `Bouquet - ${LABEL[active] ?? active}`;
  const content = clearContent();
  const themeBtn = el("mdui-button-icon", {
    id: "sf-theme-toggle",
    onclick: () => {
      const next: Theme = m.getTheme() === "dark" ? "light" : "dark";
      m.setTheme(next);
      state.theme = next;
      persist();
      paintThemeToggle(themeBtn);
    },
  });
  paintThemeToggle(themeBtn);
  const colorMenu = el(
    "mdui-menu",
    { selects: "single" },
    ...COLOR_SCHEMES.map((cs) =>
      /* An empty string is not a selectable menu value, so Default is "default" here only. */
      el(
        "mdui-menu-item",
        {
          value: cs[0] || "default",
          onclick: () => {
            if (cs[0]) m.setColorScheme(cs[0]);
            else m.removeColorScheme();
            state.colorScheme = cs[0];
            persist();
          },
        },
        cs[1],
      ),
    ),
  );
  colorMenu.value = state.colorScheme || "default";
  const colorDrop = el(
    "mdui-dropdown",
    { placement: "bottom-end" },
    el("mdui-button-icon", {
      slot: "trigger",
      icon: "palette--outlined",
      title: "Color scheme",
      "aria-label": "Color scheme",
    }),
    colorMenu,
  );
  /* Exit: back to the NS page this visit started from (router.rememberReturnUrl), else the home
   * page. Bouquet always runs on BOUQUET_ORIGIN, so "/" is the www home page. */
  const back = returnUrl ? new URL(returnUrl) : null;
  const exitHref = !back
    ? withGeneratedBy("/")
    : back.origin === location.origin
      ? withGeneratedBy(`${back.pathname}${back.search}${back.hash}`)
      : back.href;
  const exitTitle = back
    ? `Leave Bouquet and go back to ${back.host === location.host ? back.pathname : `${back.host}${back.pathname}`}`
    : "Leave Bouquet for the NationStates home page";
  const exitBtn = btn("Exit", exitTitle, () => location.assign(exitHref), "text");
  exitBtn.id = "bq-exit";
  exitBtn.setAttribute("icon", "exit_to_app--outlined");
  const topBar = el(
    "mdui-top-app-bar",
    { "scroll-behavior": "elevate" },
    el("mdui-top-app-bar-title", null, "Bouquet"),
    el("div", { class: "sf-grow" }),
    /* Feedback link before the badge; target=_blank so the console tab keeps its state. */
    el(
      "a",
      {
        class: "sf-feedback",
        href: FEEDBACK_URL,
        target: "_blank",
        rel: "noopener noreferrer",
        title: "Send feedback (opens a form in a new tab)",
      },
      "Feedback",
    ),
    /* Version badge: the header @version is the only place it is edited (scripts/build.ts
     * injects __BOUQUET_VERSION__; unbundled src/ imports fall back to 0.0.0-dev). */
    el("span", { class: "sf-version" }, `v${SCRIPT_VERSION}`),
    mountLoginAllButton(),
    themeBtn,
    colorDrop,
    exitBtn,
  );
  const tabs = el(
    "mdui-tabs",
    {
      class: "sf-tabs",
      value: active,
      variant: "primary",
      "full-width": "",
    },
    ...PAGES.map((p) => el("mdui-tab", { value: p[0], icon: p[3], title: `Go to ${p[1]}` }, p[1])),
  );
  tabs.addEventListener("change", () => {
    location.href = pageHref(tabs.value);
  });
  const statusLine = el("div", { class: "sf-status" });
  bindStatusLine(statusLine);
  /* Global queue failsafe (src/ui/actions.ts): one button + its key, disabled until a page
   * registers a puppet queue. */
  const statusRow = el("div", { class: "sf-statusrow" }, statusLine, mountSkipButton());
  const progress = el("mdui-linear-progress", null);
  progress.hidden = true;
  setBusyBar(progress);
  /* Page-specific controls that stay visible while scrolling (Manage's run panel). */
  const bar = el("div", { class: "sf-pagebar" });
  const sticky = el("div", { class: "sf-sticky" }, tabs, statusRow, progress, bar);
  const main = el("div", { class: "sf-main" });
  content.appendChild(el("div", { class: "sf-shell" }, topBar, sticky, main));
  return { main, bar };
}
