import { CUSTOM_PRETITLE_MIN_POP } from "../../constants";
import { dumpDateText, formatPopulation } from "../../dump";
import { type PipelineStep, populationOf } from "../../state";
import { el, hint, selectField } from "../../ui/dom";
import { specError } from "../spec";
import type { ActionDef } from "../types";

/* One control of the static Nation Setting dialog. `text` renders an mdui-text-field (inputType
 * only for the email/password inputs), `select` a dropdown, `tristate` a dropdown over the native
 * checkbox whose live value is the control's own `value` attribute (`"on"` when it has none). */
type NsControl =
  | { kind: "text"; key: string; label: string; placeholder?: string; inputType?: string }
  | { kind: "select"; key: string; label: string; options: Array<[string, string]> }
  | { kind: "tristate"; key: string; label: string; checkedValue: string };

/* The dialog's controls, grouped, hardcoded from the native settings form's own fields. A static
 * descriptor, not a template read: NS adds a setting rarely, and text/select/tristate covers every
 * one of them. Excluded on purpose: the legacy OpenID pair, the hidden `oldemail` mirror and
 * `update` submit, the unlockable text-only rows (capital/leader/religion) that have no input, and
 * the flag text field (flags are set by the Change Nation Flag upload action). */
const NATION_DIALOG_GROUPS: Array<{ title: string; controls: NsControl[] }> = [
  {
    title: "Identity",
    controls: [
      { kind: "text", key: "type", label: "Classification", placeholder: "No change" },
      { kind: "text", key: "slogan", label: "Motto", placeholder: "No change" },
      { kind: "text", key: "currency", label: "Currency", placeholder: "No change" },
      { kind: "text", key: "animal", label: "National Animal", placeholder: "No change" },
      { kind: "text", key: "demonym2", label: "Demonym (noun)", placeholder: "No change" },
      {
        kind: "text",
        key: "demonym",
        label: "Demonym (adjective)",
        placeholder: "No change",
      },
      {
        kind: "text",
        key: "demonym2pl",
        label: "Demonym (plural)",
        placeholder: "No change",
      },
    ],
  },
  {
    title: "Appearance",
    controls: [
      { kind: "tristate", key: "ripple", label: "Ripple effect", checkedValue: "on" },
      {
        kind: "select",
        key: "newtheme",
        label: "Theme",
        options: [
          ["default", "Rift (default)"],
          ["dark", "Dark"],
          ["century", "Century"],
          ["century.dark", "Century: Dark"],
          ["century.wide", "Century: Wide RMB"],
          ["antiquity", "Antiquity"],
          ["m", "Mobile"],
          ["liberal", "Liberal"],
          ["conservative", "Conservative"],
        ],
      },
    ],
  },
  {
    title: "Issues & cards",
    controls: [
      {
        kind: "select",
        key: "issue_throttle",
        label: "Issues throttle",
        options: [
          ["0", "No throttle"],
          ["12", "12 hours between issues"],
          ["24", "24 hours between issues"],
          ["48", "48 hours between issues"],
        ],
      },
      { kind: "tristate", key: "confirm_issues", label: "Confirm issues", checkedValue: "1" },
      { kind: "tristate", key: "vacation_mode", label: "Vacation mode", checkedValue: "1" },
      { kind: "tristate", key: "show_stats", label: "Show more stats", checkedValue: "1" },
      { kind: "tristate", key: "no_cards", label: "No cards", checkedValue: "1" },
    ],
  },
  {
    title: "Contact & login",
    controls: [
      { kind: "text", key: "email", label: "E-mail", inputType: "email" },
      {
        kind: "tristate",
        key: "email_notify",
        label: "E-mail warnings",
        checkedValue: "on",
      },
      {
        kind: "select",
        key: "autologin",
        label: "Log in automatically",
        options: [
          ["yes", "Yes"],
          ["no", "No"],
        ],
      },
      { kind: "text", key: "password", label: "Change Password", inputType: "password" },
      {
        kind: "text",
        key: "confirm_password",
        label: "Confirm New Password",
        inputType: "password",
      },
    ],
  },
];
/* Keys the dialog can set; a saved step's other keys (e.g. a stale `flag`) are never sent or shown. */
const NATION_SETTING_KEYS = new Set(
  NATION_DIALOG_GROUPS.flatMap((group) => group.controls.map((control) => control.key)),
);
const CHECKBOX_SETTING_FIELDS = new Set([
  "ripple",
  "email_notify",
  "confirm_issues",
  "vacation_mode",
  "show_stats",
  "no_cards",
]);

function nationSettingLabel(field: string): string {
  for (const group of NATION_DIALOG_GROUPS) {
    for (const control of group.controls) {
      if (control.key === field) return control.label;
    }
  }
  return field;
}

function validateNationSetting(key: string, value: string): string | null {
  const limits: Record<string, { label: string; max: number }> = {
    type: { label: "pretitle", max: 28 },
    slogan: { label: "slogan", max: 55 },
    currency: { label: "currency", max: 40 },
    animal: { label: "animal", max: 40 },
    demonym2: { label: "demonym2", max: 44 },
    demonym: { label: "demonym", max: 44 },
    demonym2pl: { label: "demonym2pl", max: 44 },
  };
  const limit = limits[key];
  if (!limit) return null;
  const length = Array.from(value).length;
  if (length > limit.max) return `${limit.label} is too long, max length is ${limit.max}`;
  if (length < 2 && key !== "slogan")
    return `${limit.label} should have a minimum length of 2 characters.`;
  if (key === "type" && !/^[\p{L}\p{N} ]+$/u.test(value.replace(/ /g, ""))) {
    return "Pretitle should only contain alphanumeric characters or spaces.";
  }
  return null;
}

/* Why `actor` can't set a custom Classification (pretitle), from its cached dump population; "" =
 * no Classification in the step, or not known to be below the minimum (unknown never blocks; NS decides). */
function pretitleBlock(step: PipelineStep, actor: string): string {
  if ((step.settings.type ?? "").trim() === "") return "";
  const pop = populationOf(actor);
  if (typeof pop !== "number" || pop >= CUSTOM_PRETITLE_MIN_POP) return "";
  return `needs ${formatPopulation(CUSTOM_PRETITLE_MIN_POP)} citizens (${formatPopulation(pop)} in the ${dumpDateText()} dump)`;
}

export const nationSettingAction: Omit<ActionDef, "group"> = {
  type: "nation-setting",
  title: "Apply Nation Setting",
  blurb: "Set any number of nation settings fields at once.",
  fields: [],
  buildSpec(step) {
    const body: Record<string, string> = {};
    for (const [key, value] of Object.entries(step.settings)) {
      if (!value || !NATION_SETTING_KEYS.has(key)) continue;
      const validation = validateNationSetting(key, value);
      if (validation) return specError(validation);
      body[key] = value;
    }
    if (body.password && body.confirm_password !== body.password)
      return specError("confirm_password must match password");
    body.update = " Update ";
    return {
      kind: "text",
      path: "/template-overall=none/page=settings",
      body,
      needle: "Your settings have been successfully updated.",
    };
  },
  /* Below the custom-pretitle population, Classification is dropped from the request; a step with
   * nothing else left is skipped. */
  skip(step, ctx) {
    const block = pretitleBlock(step, ctx.actor);
    if (!block) return "";
    const rest = Object.entries(step.settings).some(
      ([key, value]) => key !== "type" && value && NATION_SETTING_KEYS.has(key),
    );
    return rest ? "" : `Classification skipped — ${block}`;
  },
  runSettings(step, ctx): Record<string, string> {
    return pretitleBlock(step, ctx.actor) ? { type: "" } : {};
  },
  runNote(step, ctx) {
    const block = pretitleBlock(step, ctx.actor);
    return block ? `Classification dropped — ${block}` : "";
  },
  summary(step) {
    const entries = Object.entries(step.settings).filter(([field]) =>
      NATION_SETTING_KEYS.has(field),
    );
    if (!entries.length) return "No fields set";
    const render = ([field, value]: [string, string]): string => {
      const label = nationSettingLabel(field);
      if (CHECKBOX_SETTING_FIELDS.has(field))
        return `${label}: ${value === "0" ? "unchecked" : "checked"}`;
      return `${label}: ${value.slice(0, 60)}`;
    };
    if (entries.length === 1) return render(entries[0]);
    if (entries.length <= 3) return entries.map(render).join(", ");
    return `${render(entries[0])}, ${render(entries[1])} +${entries.length - 2} more`;
  },
  renderBody(step, body) {
    body.appendChild(hint("Empty / (no change) = leave that field untouched."));
    const fields = el("div", { class: "bq-ns-fields" });
    const reads: Array<[string, () => string]> = [];
    for (const group of NATION_DIALOG_GROUPS) {
      fields.appendChild(hint(group.title));
      for (const control of group.controls) {
        let node: HTMLElementTagNameMap["mdui-select"] | HTMLElementTagNameMap["mdui-text-field"];
        if (control.kind === "select") {
          node = selectField(
            control.label,
            [["", "(no change)"], ...control.options],
            step.settings[control.key] ?? "",
          );
        } else if (control.kind === "tristate") {
          node = selectField(
            control.label,
            [
              ["", "(no change)"],
              [control.checkedValue, "Checked"],
              ["0", "Unchecked"],
            ],
            step.settings[control.key] ?? "",
          );
        } else {
          node = el("mdui-text-field", {
            label: control.label,
            placeholder: control.placeholder,
            type: control.inputType,
          });
          node.value = step.settings[control.key] ?? "";
        }
        fields.appendChild(node);
        reads.push([control.key, () => node.value]);
      }
    }
    body.appendChild(fields);
    return {
      collect(step) {
        const settings: Record<string, string> = {};
        for (const [key, read] of reads) {
          const v = read();
          if (v.trim() !== "") settings[key] = v;
        }
        step.settings = settings;
      },
    };
  },
};
