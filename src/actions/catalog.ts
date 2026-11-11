import type { PipelineActionType, PipelineStep } from "../state";
import { newId } from "../utils";
import { embassyAction } from "./embassy/embassy";
import { syncEmbassiesAction } from "./embassy/sync-embassies";
import { changeNationFlagAction } from "./nation/change-nation-flag";
import { clearPrivateInfoAction } from "./nation/clear-private-info";
import { customPostcardAction } from "./nation/custom-postcard";
import { buildLoginSpec } from "./nation/login";
import { moveRegionAction } from "./nation/move-region";
import { nationSettingAction } from "./nation/nation-setting";
import { reauthAction } from "./nation/reauth";
import { telegramFiltersAction } from "./nation/telegram-filters";
import { votePollAction } from "./nation/vote-poll";
import { changeWfeAction } from "./region/change-wfe";
import { checkRegionPowersAction } from "./region/check-region-powers";
import { createRegionAction } from "./region/create-region";
import { banjectNationAction, ejectNationAction } from "./region/eject";
import { removeDispatchesAction } from "./region/remove-dispatches";
import { setRegionFlagAction } from "./region/set-region-flag";
import { suppressRmbAction } from "./region/suppress-rmb";
import { syncTagsAction } from "./region/sync-tags";
import { uploadRegionFileAction } from "./region/upload-region-file";
import { type ActionSpec, specError } from "./spec";
import type { ActionDef } from "./types";
import { addDossierAction } from "./wa/add-dossier";
import { applyWaAction } from "./wa/apply-wa";
import { clearDossierAction } from "./wa/clear-dossier";

export const ACTION_CATALOG: ActionDef[] = [
  { ...moveRegionAction, group: "nation" },
  { ...reauthAction, group: "nation" },
  { ...applyWaAction, group: "wa" },
  { ...changeWfeAction, group: "region" },
  { ...embassyAction, group: "embassy" },
  { ...nationSettingAction, group: "nation" },
  { ...votePollAction, group: "nation" },
  { ...clearDossierAction, group: "wa" },
  { ...addDossierAction, group: "wa" },
  { ...createRegionAction, group: "region" },
  { ...uploadRegionFileAction, group: "region" },
  { ...setRegionFlagAction, group: "region" },
  { ...syncEmbassiesAction, group: "embassy" },
  { ...checkRegionPowersAction, group: "region" },
  { ...syncTagsAction, group: "region" },
  { ...suppressRmbAction, group: "region" },
  { ...removeDispatchesAction, group: "region" },
  { ...ejectNationAction, group: "region" },
  { ...banjectNationAction, group: "region" },
  { ...changeNationFlagAction, group: "nation" },
  { ...customPostcardAction, group: "nation" },
  { ...clearPrivateInfoAction, group: "nation" },
  { ...telegramFiltersAction, group: "nation" },
];

const BY_TYPE = new Map<string, ActionDef>(ACTION_CATALOG.map((d) => [d.type, d]));

export function actionDef(type: string): ActionDef | undefined {
  return BY_TYPE.get(type);
}

export const LOGIN_TITLE = "Log Into Nation";
export const LOGIN_BLURB = "Always first. Runs before every other action.";

export function actionTitle(type: PipelineActionType): string {
  return type === "login" ? LOGIN_TITLE : (actionDef(type)?.title ?? type);
}

/* Opens a settings dialog: has fields, or renders its own body. */
export function isConfigurable(def: ActionDef): boolean {
  return def.fields.length > 0 || def.renderBody !== undefined;
}

export function specFor(step: PipelineStep, actor: string): ActionSpec {
  if (step.type === "login") return buildLoginSpec(actor);
  const def = actionDef(step.type);
  if (!def) return specError(`unknown action: ${step.type}`);
  if (!def.buildSpec) return specError(`${def.title} has no single request`);
  return def.buildSpec(step, actor);
}

export function newStep(type: PipelineActionType): PipelineStep {
  return { id: newId(), type, settings: {} };
}

export function SETTING_SUMMARY(step: PipelineStep): string {
  return actionDef(step.type)?.summary?.(step) ?? "";
}
