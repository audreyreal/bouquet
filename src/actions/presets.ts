import { type ActionPreset, loginStep, persist, state } from "../state";
import { newId } from "../utils";
import { newStep } from "./catalog";

function currentSteps(): ActionPreset["steps"] {
  return state.pipeline.slice(1).map(({ type, settings }) => ({
    type,
    settings: { ...settings },
  }));
}

export function savePreset(name: string): ActionPreset {
  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("Preset name is required");
  if (state.presets.some((preset) => preset.name.toLowerCase() === trimmedName.toLowerCase()))
    throw new Error("Preset already exists");

  const preset = {
    id: newId(),
    name: trimmedName,
    steps: currentSteps(),
  };
  state.presets.push(preset);
  persist();
  return preset;
}

export function applyPreset(id: string): void {
  const preset = state.presets.find((item) => item.id === id);
  if (!preset) return;

  state.pipeline = [
    loginStep(),
    ...preset.steps.map((step) => ({
      ...newStep(step.type),
      settings: { ...step.settings },
    })),
  ];
  persist();
}

export function deletePreset(id: string): void {
  const index = state.presets.findIndex((item) => item.id === id);
  if (index < 0) return;
  state.presets.splice(index, 1);
  persist();
}

export function overwritePreset(id: string): void {
  const preset = state.presets.find((item) => item.id === id);
  if (!preset) return;
  preset.steps = currentSteps();
  persist();
}
