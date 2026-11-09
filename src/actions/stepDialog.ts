import { type PipelineStep, persist } from "../state";
import { btn, el, modal } from "../ui/dom";
import { actionDef, isConfigurable } from "./catalog";
import { renderStepFields } from "./fields";
import type { FieldsHandle } from "./types";

let stepDialog: HTMLElementTagNameMap["mdui-dialog"] | null = null;
let dialogBody: HTMLDivElement | null = null;
let activeStep: PipelineStep | null = null;
let activeFields: FieldsHandle | null = null;
let afterSave: (() => void) | null = null;

function getStepDialog(): HTMLElementTagNameMap["mdui-dialog"] {
  if (stepDialog) return stepDialog;

  const body = el("div", { class: "bq-dialog-fields" });
  const save = btn(
    "Save",
    "Save this step's settings",
    () => {
      if (!activeStep || !activeFields || activeFields.busy?.()) return;
      activeFields.collect(activeStep);
      persist();
      afterSave?.();
      dialog.open = false;
    },
    "filled",
  );
  const cancel = btn(
    "Cancel",
    "Close without saving",
    () => {
      dialog.open = false;
    },
    "text",
  );
  const dialog = modal({ id: "bq-step-dialog" }, body, cancel, save);
  stepDialog = dialog;
  dialogBody = body;
  return dialog;
}

export function openStepSettings(step: PipelineStep, onSave: () => void): void {
  const def = actionDef(step.type);
  if (!def || !isConfigurable(def)) return;

  const dialog = getStepDialog();
  const body = dialogBody;
  if (!body) return;

  activeStep = step;
  afterSave = onSave;
  dialog.setAttribute("headline", `${def.title} settings`);
  body.replaceChildren();
  activeFields = def.renderBody
    ? def.renderBody(step, body)
    : renderStepFields(step, body, def.fields);
  dialog.open = true;
}
