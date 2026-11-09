import { specError, stepSetting } from "../spec";
import type { ActionDef } from "../types";

export const votePollAction: Omit<ActionDef, "group"> = {
  type: "vote-poll",
  title: "Vote in Poll",
  blurb: "Vote the nation on an NS poll.",
  fields: [
    { key: "pollId", label: "ID", placeholder: "e.g. 199747" },
    { key: "option", label: "Option", placeholder: "e.g. 0" },
  ],
  buildSpec(step) {
    const pollId = stepSetting(step, "pollId");
    const option = stepSetting(step, "option");
    if (!pollId.trim() || !option.trim()) return specError("poll ID and option required");
    return {
      kind: "text",
      path: `/template-overall=none/page=poll/p=${pollId}`,
      body: { pollid: pollId, q1: option, poll_submit: "1" },
      needle: "Your vote has been lodged.",
    };
  },
  summary(step) {
    const pollId = step.settings.pollId ?? "";
    const option = step.settings.option ?? "";
    return pollId && option ? `Poll ${pollId} option ${option}` : "No poll set";
  },
};
