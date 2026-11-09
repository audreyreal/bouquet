import { fixedAction } from "../spec";

export const reauthAction = fixedAction({
  type: "reauth",
  title: "Re-Authenticate",
  blurb: "Refresh stored session tokens.",
  spec: { kind: "reauth" },
});
