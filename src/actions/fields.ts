import { MAX_UPLOAD_BYTES } from "../constants";
import type { PipelineStep } from "../state";
import { btn, el } from "../ui/dom";
import { blobToDataUrl, fitImageUnder } from "./image-fit";
import type { FieldsHandle, StepField } from "./types";

function selectedFileStatus(name: string, size?: number): string {
  return size == null ? name : `${name} (${size} bytes)`;
}

/* File-field status when the stored bytes are absent. */
export function fileMissingText(name: string): string {
  return name ? `${name} — reselect file (bytes missing)` : "No file selected";
}

function storedFileStatus(step: PipelineStep, field: StepField): string {
  const name = step.settings[field.key] ?? "";
  if (!name || !field.dataKey || !step.settings[field.dataKey]) return fileMissingText(name);
  const dataUrl = step.settings[field.dataKey];
  const payload = /^data:[^,]*;base64,([A-Za-z0-9+/]*={0,2})$/.exec(dataUrl)?.[1];
  if (!payload) return name;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  return selectedFileStatus(name, Math.floor((payload.length * 3) / 4) - padding);
}

function renderFileField(step: PipelineStep, body: HTMLDivElement, field: StepField): FieldsHandle {
  const input = el("input", {
    id: `bq-file-${field.key}`,
    type: "file",
    accept: field.accept,
    hidden: "",
  });
  const status = el("span", { "data-file-status": field.key }, storedFileStatus(step, field));
  /* The status text to fall back to when a pick is rejected or fails. */
  let stable = status.textContent ?? "No file selected";
  let pending: { name: string; data: string } | null = null;
  let cleared = false;
  let reading = false;
  /* Bumped on every pick/Clear; stale async fits check it and drop their result. */
  let generation = 0;

  const onChange = async (): Promise<void> => {
    const mine = ++generation;
    reading = false;
    const file = input.files?.[0];
    if (!file) return;

    const previousStatus = stable;
    if (file.type && !file.type.toLowerCase().startsWith("image/")) {
      input.value = "";
      status.textContent = `${previousStatus} — rejected: file must be an image`;
      return;
    }

    reading = true;
    const verb = file.size > MAX_UPLOAD_BYTES ? "Shrinking" : "Reading";
    status.textContent = `${verb} ${selectedFileStatus(file.name, file.size)}…`;
    try {
      const fitted = await fitImageUnder(file, MAX_UPLOAD_BYTES, field.maxSize);
      const dataUrl = await blobToDataUrl(fitted.blob);
      if (mine !== generation) return;
      pending = { name: fitted.name, data: dataUrl };
      cleared = false;
      reading = false;
      let stableStatus = selectedFileStatus(fitted.name, fitted.blob.size);
      if (fitted.resized) stableStatus = `${stableStatus} — resized from ${file.size} bytes`;
      stable = stableStatus;
      status.textContent = stableStatus;
    } catch (err) {
      if (mine !== generation) return;
      reading = false;
      input.value = "";
      status.textContent = `${previousStatus} — ${err instanceof Error ? err.message : "could not read file"}`;
    }
  };
  input.addEventListener("change", () => {
    void onChange();
  });

  const clear = btn(
    "Clear",
    "Remove the selected file",
    () => {
      generation++;
      input.value = "";
      pending = null;
      reading = false;
      cleared = true;
      stable = "No file selected";
      status.textContent = "No file selected";
    },
    "text",
  );
  const choose = btn("Choose file", "Pick a file from your computer", () => input.click(), "tonal");
  body.appendChild(
    el(
      "div",
      { class: "bq-file-field" },
      el("div", { class: "bq-file-label" }, field.label),
      input,
      choose,
      status,
      clear,
    ),
  );
  return {
    collect(s) {
      if (cleared) {
        s.settings[field.key] = "";
        if (field.dataKey) s.settings[field.dataKey] = "";
      } else if (pending && field.dataKey) {
        s.settings[field.key] = pending.name;
        s.settings[field.dataKey] = pending.data;
      }
    },
    busy: () => reading,
  };
}

export function renderStepFields(
  step: PipelineStep,
  body: HTMLDivElement,
  fields: StepField[],
): FieldsHandle {
  const handles: FieldsHandle[] = [];
  for (const field of fields) {
    if (field.kind === "file") {
      handles.push(renderFileField(step, body, field));
      continue;
    }
    const input = el("mdui-text-field", {
      label: field.label,
      placeholder: field.placeholder,
      rows: field.rows,
    });
    input.value = step.settings[field.key] ?? "";
    body.appendChild(input);
    handles.push({
      collect(s) {
        s.settings[field.key] = field.key === "region" ? input.value.trim() : input.value;
      },
    });
  }
  return joinFields(...handles);
}

export function joinFields(...handles: FieldsHandle[]): FieldsHandle {
  return {
    collect: (step) => {
      for (const h of handles) h.collect(step);
    },
    busy: () => handles.some((h) => h.busy?.() === true),
  };
}
