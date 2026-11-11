import type { PipelineStep } from "../../state";
import { hint, selectField } from "../../ui/dom";
import { specError } from "../spec";
import type { ActionDef } from "../types";

/* The Filter table of /page=tgsettings, in the page's row order: radio-group name + label. */
const CATEGORIES: Array<[string, string]> = [
  ["C1", "Recruitment"],
  ["C2", "WA Legislation"],
  ["C5", "WASec Election"],
  ["C3", "Region (official)"],
  ["C4", "External"],
];
/* Radio values; "Some" = one telegram of the type per week, "Most" = one per day. */
const LEVELS: Array<[string, string]> = [
  ["3", "Block All"],
  ["2", "Allow Some"],
  ["1", "Allow Most"],
  ["0", "Allow All"],
];

/* The step's valid category settings in page order; a missing or unknown value = no change. */
function chosen(step: PipelineStep): Array<[string, string, string]> {
  const out: Array<[string, string, string]> = [];
  for (const [key, label] of CATEGORIES) {
    const level = LEVELS.find(([v]) => v === step.settings[key]);
    if (level) out.push([key, label, level[0]]);
  }
  return out;
}

/* One POST of only the set categories: NS leaves an omitted category unchanged, so no page read. */
export const telegramFiltersAction: Omit<ActionDef, "group"> = {
  type: "telegram-filters",
  title: "Set Telegram Filters",
  blurb: "Block or limit incoming telegrams by type.",
  fields: [],
  buildSpec(step) {
    const set = chosen(step);
    if (!set.length) return specError("no telegram filter category set");
    return {
      kind: "text",
      path: "/template-overall=none/page=tgsettings",
      body: {
        ...Object.fromEntries(set.map(([key, , value]) => [key, value])),
        update_filter: "1",
      },
      /* NS's success text for this form is unknown; the re-rendered radio of the first sent
       * category confirms the update. */
      needle: `name="${set[0][0]}" value="${set[0][2]}" checked`,
    };
  },
  summary(step) {
    const set = chosen(step);
    if (!set.length) return "No categories set";
    const render = ([, label, value]: [string, string, string]): string =>
      `${label}: ${LEVELS.find(([v]) => v === value)?.[1]}`;
    if (set.length <= 3) return set.map(render).join(", ");
    return `${render(set[0])}, ${render(set[1])} +${set.length - 2} more`;
  },
  renderBody(step, body) {
    body.appendChild(
      hint(
        'Empty / (no change) = leave that category untouched. "Allow Most" accepts one telegram of the type per day, "Allow Some" one per week.',
      ),
    );
    const pairs: Array<[string, HTMLElementTagNameMap["mdui-select"]]> = [];
    for (const [key, label] of CATEGORIES) {
      const node = selectField(label, [["", "(no change)"], ...LEVELS], step.settings[key] ?? "");
      body.appendChild(node);
      pairs.push([key, node]);
    }
    return {
      collect(s) {
        const settings: Record<string, string> = {};
        for (const [key, node] of pairs) {
          const value = node.value;
          if (typeof value === "string" && value) settings[key] = value;
        }
        s.settings = settings;
      },
    };
  },
};
