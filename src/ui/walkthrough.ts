/* First-run setup tour: a click-through spotlight ring plus a tip card, walking a fresh install
 * through Settings → Global password, then Manage → Import puppets, Login to all,
 * How a run works, Pipeline, Presets. The position is persisted (`state.walkthrough`), so the tour survives tab
 * switches. Pages anchor their targets with `data-bq-walk="<stage>"` and report edits through
 * walkthroughRefresh(). Must not import ../pages/* (pages import this module). */

import { pageHref } from "../net";
import { nationNames, persist, state, type WalkthroughStage } from "../state";
import { btn, dialogOpen, el } from "./dom";
import { toast } from "./mdui";

interface WalkStep {
  stage: Exclude<WalkthroughStage, "done">;
  page: "settings" | "manage";
  pageLabel: string;
  title: string;
  text: string | (() => string);
  ready: () => boolean;
}

const STEPS: WalkStep[] = [
  {
    stage: "global-password",
    page: "settings",
    pageLabel: "Settings",
    title: "Global password",
    text: "The password your puppets share. A puppet with a different one gets its own nation:password line when you import it. Press Enter or click away to save.",
    ready: () => state.globalPassword !== "",
  },
  {
    stage: "import",
    page: "manage",
    pageLabel: "Manage",
    title: "Import puppets",
    text: "Click Import puppets and paste one nation per line (nation:password for a puppet with its own password).",
    /* The harvest auto-adds the logged-in nation, so a non-empty roster is not enough. */
    ready: () => nationNames().some((n) => n !== state.mainNation),
  },
  {
    stage: "login-all",
    page: "manage",
    pageLabel: "Manage",
    title: "Login to all",
    text: "Login to all pings every roster puppet through the NS API, one at a time and paced to the rate limit, so each one counts as logged in. Run it regularly as your login script to keep your puppets alive.",
    ready: () => true,
  },
  {
    stage: "run",
    page: "manage",
    pageLabel: "Manage",
    title: "How a run works",
    text: () =>
      state.actionButton
        ? "The pipeline is a list of actions that runs once for every puppet in your roster. Each tap of this Action button sends one request: a run starts with the ▸ puppet shown in the run bar and sends its steps top to bottom. After its last step, ▸ moves to the next roster puppet and the same pipeline runs again, until the end of the roster. Locked puppets are skipped, and so are unselected ones while a selection is active."
        : "The pipeline is a list of actions that runs once for every puppet in your roster. A run starts with the ▸ puppet shown here and sends its steps top to bottom, one request per press of your Page action key (Space by default). After its last step, ▸ moves to the next roster puppet and the same pipeline runs again, until the end of the roster. Locked puppets are skipped, and so are unselected ones while a selection is active.",
    ready: () => true,
  },
  {
    stage: "pipeline",
    page: "manage",
    pageLabel: "Manage",
    title: "Pipeline",
    text: "These are the steps every puppet runs, in order; Log Into Nation always stays first. To build your own, open Add actions below and drag a card into the pipeline or press Add. Click a step to edit its settings.",
    ready: () => true,
  },
  {
    stage: "presets",
    page: "manage",
    pageLabel: "Manage",
    title: "Presets",
    text: "Or start from the default: press Apply on Standard Prep (Apply to WA, then Move to Region → Neck) to load it as your pipeline. Apply replaces the current pipeline; save your own builds here with Save current as preset.",
    ready: () => true,
  },
];

let page = "";
let ring: HTMLDivElement | null = null;
let tip: HTMLElement | null = null;
let rafId = 0;
let target: Element | null = null;
/* Last written geometry/visibility; styles are only touched when it changes. */
let lastKey = "";
/* paint() requested a scroll to the on-page target; loop() runs it once the target has a rect. */
let scrollPending = false;

function currentIndex(): number {
  return STEPS.findIndex((s) => s.stage === state.walkthrough);
}

function findTarget(step: WalkStep): Element | null {
  return step.page === page
    ? document.querySelector(`[data-bq-walk="${step.stage}"]`)
    : document.querySelector(`mdui-tab[value="${step.page}"]`);
}

/* Mounts the tour for the current page (also used by Settings' Restart button). */
export function startWalkthrough(current: string): void {
  page = current;
  teardown();
  if (currentIndex() < 0) return;
  ring = el("div", { class: "bq-walk-ring" });
  tip = el("mdui-card", { variant: "elevated", class: "bq-walk-tip" });
  document.body.appendChild(ring);
  document.body.appendChild(tip);
  paint();
  rafId = requestAnimationFrame(loop);
}

/* A page field/action tied to `stage` changed: advance when it is the current, on-page, now
 * satisfied step; otherwise repaint so Next's disabled state is current. */
export function walkthroughRefresh(stage: WalkthroughStage): void {
  if (!tip) return;
  const i = currentIndex();
  if (i < 0) return;
  const step = STEPS[i];
  if (stage === state.walkthrough && step.page === page && step.ready()) advance();
  else paint();
}

function paint(): void {
  if (!tip) return;
  const i = currentIndex();
  if (i < 0) return;
  const step = STEPS[i];
  const onPage = step.page === page;
  const text = typeof step.text === "function" ? step.text() : step.text;
  const titleEl = el(
    "div",
    { class: "bq-walk-title" },
    `Step ${i + 1} of ${STEPS.length} · ${step.title}`,
  );
  const bodyEl = el("div", null, onPage ? text : `Open the ${step.pageLabel} tab to continue.`);
  let primary: HTMLElementTagNameMap["mdui-button"];
  if (onPage) {
    primary = btn(
      i === STEPS.length - 1 ? "Finish" : "Next",
      i === STEPS.length - 1 ? "Finish the tour" : "Go to the next tour step",
      advance,
      "filled",
    );
    primary.disabled = !step.ready();
  } else {
    primary = btn(
      `Open ${step.pageLabel}`,
      `Go to the ${step.pageLabel} tab`,
      () => {
        location.href = pageHref(step.page);
      },
      "filled",
    );
  }
  const actions = el(
    "div",
    { class: "bq-walk-actions" },
    btn("Skip tour", "End the tour now (restart it from Settings)", skip, "text"),
    primary,
  );
  tip.replaceChildren(titleEl, bodyEl, actions);
  target = findTarget(step);
  lastKey = "";
  /* Off-page targets are the sticky tabs: no scroll needed. Deferred to loop(): at boot the page
   * is not laid out yet (MDUI renders async), so scrolling now would be a no-op. */
  scrollPending = onPage;
}

function advance(): void {
  const i = currentIndex();
  if (i < 0) return;
  const next = STEPS[i + 1];
  state.walkthrough = next ? next.stage : "done";
  persist();
  if (!next) {
    teardown();
    toast("Setup complete — Bouquet is ready");
  } else paint();
}

function skip(): void {
  state.walkthrough = "done";
  persist();
  teardown();
  toast("Walkthrough skipped — restart it from Settings");
}

function teardown(): void {
  cancelAnimationFrame(rafId);
  ring?.remove();
  tip?.remove();
  ring = null;
  tip = null;
  target = null;
}

/* Follows the target every frame (scroll, resize, re-render); runs only while mounted. */
function loop(): void {
  if (!ring || !tip) return;
  rafId = requestAnimationFrame(loop);
  const i = currentIndex();
  if (i < 0) return;
  if (!target?.isConnected) target = findTarget(STEPS[i]);
  /* MDUI dialogs sit above the tour (z-index 2300): get out of the way while one is up. */
  if (dialogOpen()) {
    write("dialog", true, true, "", "");
    return;
  }
  /* A target inside a closed <details> still reports a rect, so it counts as hidden too. */
  const rect = target?.closest("details:not([open])") ? undefined : target?.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) {
    /* No target or not rendered (e.g. collapsed section): dock the tip bottom-center. */
    const left = (innerWidth - tip.offsetWidth) / 2;
    const top = innerHeight - tip.offsetHeight - 16;
    write(`dock|${left}|${top}`, true, false, "", `left:${left}px;top:${top}px`);
    return;
  }
  if (scrollPending) {
    scrollPending = false;
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const ringCss = `left:${rect.left - 4}px;top:${rect.top - 4}px;width:${rect.width + 8}px;height:${rect.height + 8}px`;
  let top = rect.bottom + 12;
  if (top + tip.offsetHeight > innerHeight - 8) top = rect.top - 12 - tip.offsetHeight;
  top = Math.max(8, Math.min(top, innerHeight - tip.offsetHeight - 8));
  const left = Math.min(Math.max(rect.left, 16), innerWidth - tip.offsetWidth - 16);
  write(`${ringCss}|${left}|${top}`, false, false, ringCss, `left:${left}px;top:${top}px`);
}

function write(
  key: string,
  ringHidden: boolean,
  tipHidden: boolean,
  ringCss: string,
  tipCss: string,
): void {
  if (!ring || !tip || key === lastKey) return;
  lastKey = key;
  ring.hidden = ringHidden;
  tip.hidden = tipHidden;
  if (!ringHidden) ring.style.cssText = ringCss;
  if (!tipHidden) tip.style.cssText = tipCss;
}
