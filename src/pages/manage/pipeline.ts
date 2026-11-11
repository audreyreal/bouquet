/* Manage pipeline: the step list, the action pool ("Add actions") and presets. */
import {
  ACTION_CATALOG,
  ACTION_GROUPS,
  type ActionDef,
  actionDef,
  actionTitle,
  applyPreset,
  deletePreset,
  isConfigurable,
  LOGIN_BLURB,
  LOGIN_TITLE,
  newStep,
  openStepSettings,
  overwritePreset,
  SETTING_SUMMARY,
  savePreset,
  specFor,
} from "../../actions";
import { type PipelineStep, passwordFor, persist, state, viewNames } from "../../state";
import { btn, card, collapsibleSection, el, hint, iconButton, row, section } from "../../ui/dom";
import { toast } from "../../ui/mdui";
import { type Ctx, cancelRun, resetRun, undoToast } from "./ctx";
import {
  activeDrag,
  allowDrop,
  clearMarksOnLeave,
  type Dragging,
  endDrag,
  isAfter,
  makeDraggable,
  markDrop,
} from "./drag";

export interface Pipeline {
  sections: HTMLElement[]; // pipeline, "Add actions", presets — in page order
  paintBoard(): void;
  paintPool(): void;
  loginIssue(name: string | undefined): string;
}

type StepCardOpts = {
  title: string;
  meta: string;
  className?: string; // appended verbatim after "bq-step", with leading space
  num?: number; // 1-based position badge
  icon?: string; // leading mdui-icon name
  issue?: string; // "Needs setup — …" line
  draggable?: Dragging;
  onBody?: () => void; // body becomes a click target (bq-step-body-clickable)
  controls?: HTMLElement[]; // div.bq-step-controls; undefined = none
};
function stepCard(o: StepCardOpts): HTMLElementTagNameMap["mdui-card"] {
  const body = el(
    "div",
    { class: `bq-step-body${o.onBody ? " bq-step-body-clickable" : ""}`, onclick: o.onBody },
    el("strong", null, o.title),
    el("div", { class: "bq-step-meta" }, o.meta),
    o.issue
      ? el(
          "div",
          { class: "bq-step-issue" },
          el("mdui-icon", { name: "warning--outlined" }),
          `Needs setup — ${o.issue}`,
        )
      : null,
  );
  const card = el(
    "mdui-card",
    { class: `bq-step${o.className ?? ""}` },
    o.num != null ? el("span", { class: "bq-step-num" }, String(o.num)) : null,
    o.icon
      ? el("mdui-icon", {
          name: o.icon,
          class: `bq-step-icon${o.draggable ? " bq-drag-handle" : ""}`,
        })
      : null,
    body,
    o.controls ? el("div", { class: "bq-step-controls" }, ...o.controls) : null,
  );
  if (o.draggable) makeDraggable(card, o.draggable);
  return card;
}

function loginIssue(name: string | undefined): string {
  if (!name || passwordFor(name)) return "";
  return `No password for ${name} — set a global password in Settings, or use the edit button on its roster row`;
}

export function createPipeline(ctx: Ctx): Pipeline {
  const pipelineList = el("div", { class: "bq-pipeline" });

  const presetList = el("div", { class: "bq-pipeline" });
  const presetName = el("mdui-text-field", {
    label: "Preset name",
    placeholder: "e.g. WA prep",
  });
  function saveCurrentPreset(): void {
    try {
      savePreset(presetName.value);
      presetName.value = "";
      paintBoard();
      toast("Preset saved");
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error");
    }
  }
  presetName.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") saveCurrentPreset();
  });
  const savePresetBtn = btn(
    "Save current as preset",
    "Save the current pipeline under the preset name",
    saveCurrentPreset,
  );

  const poolFilter = el("mdui-text-field", {
    label: "Filter actions",
    icon: "search--outlined",
    clearable: "",
  });
  poolFilter.addEventListener("input", () => paintPool());
  poolFilter.addEventListener("clear", () => paintPool());
  const poolList = el("div", { class: "bq-pool" });

  const pipelineSection = section(
    "Pipeline",
    card(pipelineList),
    "Runs top to bottom for each roster puppet in turn, starting at ▸.",
  );
  pipelineSection.setAttribute("data-bq-walk", "pipeline");
  const presetsSection = section(
    "Presets",
    card(row(presetName, savePresetBtn), presetList),
    "Apply replaces the pipeline; login always stays first.",
  );
  presetsSection.setAttribute("data-bq-walk", "presets");
  const addActionsSection = collapsibleSection(
    "manage-add-actions",
    "Add actions",
    card(poolFilter, poolList),
    "Drag a card into the pipeline, or press Add.",
  );

  const issueCache = new WeakMap<PipelineStep, string>();
  /* specFor is pure; cached per step object because upload steps decode their stored image.
   * Actions with expand/fromRegion and no setupIssue have no setup issue; other actions without setupIssue are
   * checked by building the spec for the main nation. */
  function stepIssue(step: PipelineStep): string {
    let issue = issueCache.get(step);
    if (issue === undefined) {
      const def = actionDef(step.type);
      if (def?.setupIssue) issue = def.setupIssue(step);
      else if (def?.expand || def?.fromRegion) issue = "";
      else {
        const spec = specFor(step, state.mainNation);
        issue = spec.kind === "error" ? spec.message : "";
      }
      issueCache.set(step, issue);
    }
    return issue;
  }
  function editStep(step: PipelineStep): void {
    openStepSettings(step, () => {
      issueCache.delete(step);
      resetRun(ctx);
    });
  }
  function openIfConfigurable(step: PipelineStep): void {
    const def = actionDef(step.type);
    if (def && isConfigurable(def)) editStep(step);
  }
  function addAction(type: ActionDef["type"], at = state.pipeline.length): void {
    resetRun(ctx);
    const step = newStep(type);
    state.pipeline.splice(Math.max(1, at), 0, step);
    persist();
    paintBoard();
    openIfConfigurable(step);
  }
  function moveStep(index: number, delta: number): void {
    const target = Math.max(1, Math.min(state.pipeline.length - 1, index + delta));
    if (target === index) return;
    resetRun(ctx);
    const [step] = state.pipeline.splice(index, 1);
    state.pipeline.splice(target, 0, step);
    persist();
    paintBoard();
  }
  function removeStep(index: number): void {
    if (index < 1 || index >= state.pipeline.length) return;
    resetRun(ctx);
    const [step] = state.pipeline.splice(index, 1);
    persist();
    paintBoard();
    undoToast(
      ctx,
      `${actionTitle(step.type)} removed`,
      () => {
        if (state.pipeline.some((s) => s.id === step.id)) return false;
        state.pipeline.splice(Math.max(1, Math.min(index, state.pipeline.length)), 0, step);
        cancelRun(ctx);
      },
      `${actionTitle(step.type)} restored`,
    );
  }

  /* Pipeline + presets. The pool never depends on state, so it has its own painter. */
  function paintBoard(): void {
    pipelineList.replaceChildren();
    presetList.replaceChildren();
    const names = viewNames();
    const run = ctx.active;
    const pendingStepIndex = run && run.actor === names[ctx.hl] ? run.stepIndex : -1;

    state.pipeline.forEach((step, index) => {
      const issue = index === 0 ? loginIssue(names[ctx.hl]) : stepIssue(step);
      const stateClasses = `${pendingStepIndex === index ? " bq-step-pending" : ""}${issue ? " bq-step-invalid" : ""}`;
      if (index === 0) {
        pipelineList.appendChild(
          stepCard({
            title: LOGIN_TITLE,
            meta: LOGIN_BLURB,
            className: ` bq-step-locked${stateClasses}`,
            num: index + 1,
            icon: "lock--outlined",
            issue,
          }),
        );
        return;
      }
      const action = actionDef(step.type);
      const configurable = action !== undefined && isConfigurable(action);
      pipelineList.appendChild(
        stepCard({
          title: actionTitle(step.type),
          meta: SETTING_SUMMARY(step),
          className: stateClasses,
          num: index + 1,
          icon: "drag_indicator--outlined",
          issue,
          draggable: { from: "pipeline", index },
          onBody: configurable ? () => editStep(step) : undefined,
          controls: [
            ...(configurable
              ? [iconButton("settings--outlined", "Settings", () => editStep(step))]
              : []),
            iconButton("arrow_upward--outlined", "Move up", () => moveStep(index, -1), index <= 1),
            iconButton(
              "arrow_downward--outlined",
              "Move down",
              () => moveStep(index, 1),
              index >= state.pipeline.length - 1,
            ),
            iconButton("delete--outlined", "Remove", () => removeStep(index)),
          ],
        }),
      );
    });
    if (state.pipeline.length === 1) {
      pipelineList.appendChild(hint("No actions added yet. Add actions from the section below."));
    }
    if (state.presets.length === 0) {
      presetList.appendChild(hint("No presets yet. Build actions above, name them, Save."));
      return;
    }
    for (const preset of state.presets) {
      const titles = preset.steps.slice(0, 3).map((s) => actionTitle(s.type));
      const restored = `"${preset.name}" restored`;
      presetList.appendChild(
        stepCard({
          title: preset.name,
          meta: `${preset.steps.length} actions${titles.length ? ` · ${titles.join(" → ")}` : ""}`,
          controls: [
            btn(
              "Apply",
              "Replace the pipeline with this preset",
              () => {
                /* Applying a preset replaces the full pipeline, keeping login locked at the front. */
                const prev = state.pipeline;
                applyPreset(preset.id);
                resetRun(ctx);
                undoToast(
                  ctx,
                  `Applied "${preset.name}"`,
                  () => {
                    state.pipeline = prev;
                    cancelRun(ctx);
                  },
                  "Pipeline restored",
                );
              },
              "tonal",
            ),
            iconButton("save--outlined", "Overwrite with current actions", () => {
              const prevSteps = preset.steps;
              overwritePreset(preset.id);
              paintBoard();
              undoToast(
                ctx,
                `"${preset.name}" overwritten`,
                () => {
                  const live = state.presets.find((p) => p.id === preset.id);
                  if (!live) {
                    toast("Preset no longer exists", "error");
                    return false;
                  }
                  live.steps = prevSteps;
                },
                restored,
              );
            }),
            iconButton("delete--outlined", "Delete", () => {
              const index = state.presets.indexOf(preset);
              deletePreset(preset.id);
              paintBoard();
              undoToast(
                ctx,
                `"${preset.name}" deleted`,
                () => {
                  if (state.presets.some((p) => p.id === preset.id)) return false;
                  state.presets.splice(Math.min(index, state.presets.length), 0, preset);
                },
                restored,
              );
            }),
          ],
        }),
      );
    }
  }

  function paintPool(): void {
    poolList.replaceChildren();
    const q = poolFilter.value.trim().toLowerCase();
    let shown = 0;
    for (const group of ACTION_GROUPS) {
      const actions = ACTION_CATALOG.filter(
        (action) =>
          action.group === group.id &&
          (!q || `${action.title} ${action.blurb}`.toLowerCase().includes(q)),
      );
      if (!actions.length) continue;
      shown += actions.length;
      poolList.appendChild(el("h4", { class: "bq-pool-group" }, group.title));
      for (const action of actions) {
        const add = btn(
          "Add",
          "Append this action to the end of the pipeline",
          () => addAction(action.type),
          "tonal",
        );
        add.prepend(el("mdui-icon", { name: "add--outlined", slot: "icon" }));
        poolList.appendChild(
          stepCard({
            title: action.title,
            meta: action.blurb,
            draggable: { from: "pool", type: action.type },
            controls: [add],
          }),
        );
      }
    }
    if (!shown) poolList.appendChild(hint(`No actions match "${q}"`));
  }

  function cardAt(event: DragEvent): HTMLElement | null {
    return event.target instanceof Element ? event.target.closest<HTMLElement>(".bq-step") : null;
  }
  /* Cards come first in pipelineList, so a card's child index equals its state.pipeline index. */
  function dropOnPipeline(d: Dragging | null, target: number): void {
    endDrag();
    if (d?.from === "pool") addAction(d.type, target);
    else if (d?.from === "pipeline")
      moveStep(d.index, target - d.index - (d.index < target ? 1 : 0));
  }
  pipelineList.addEventListener("dragover", (event: DragEvent) => {
    const d = activeDrag(event);
    if (!d || d.from === "roster") return;
    allowDrop(event);
    const card = cardAt(event);
    const cards = pipelineList.querySelectorAll<HTMLElement>(".bq-step");
    markDrop(pipelineList, card ?? cards[cards.length - 1], card ? isAfter(event, card) : true);
  });
  clearMarksOnLeave(pipelineList);
  pipelineList.addEventListener("drop", (event: DragEvent) => {
    event.preventDefault();
    const card = cardAt(event);
    const at = card
      ? Array.from(pipelineList.children).indexOf(card) + (isAfter(event, card) ? 1 : 0)
      : state.pipeline.length;
    dropOnPipeline(activeDrag(event), at);
  });
  poolList.addEventListener("dragover", (event: DragEvent) => {
    if (activeDrag(event)?.from === "pipeline") allowDrop(event);
  });
  poolList.addEventListener("drop", (event: DragEvent) => {
    event.preventDefault();
    const d = activeDrag(event);
    endDrag();
    if (d?.from === "pipeline") removeStep(d.index);
  });

  return {
    sections: [pipelineSection, addActionsSection, presetsSection],
    paintBoard,
    paintPool,
    loginIssue,
  };
}
