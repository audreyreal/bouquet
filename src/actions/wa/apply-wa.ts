import { fixedAction } from "../spec";

export const applyWaAction = fixedAction({
  type: "apply-wa",
  title: "Apply to WA",
  blurb: "Apply the nation to the World Assembly.",
  spec: {
    kind: "text",
    path: "/template-overall=none/page=UN_status",
    body: { action: "join_UN", resend: "1" },
    needle: "Your application to join the World Assembly has been received!",
  },
});
