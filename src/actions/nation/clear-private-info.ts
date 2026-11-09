import { fixedAction } from "../spec";

export const clearPrivateInfoAction = fixedAction({
  type: "clear-private-info",
  title: "Clear Nation Private Info",
  blurb: "Delete the nation's stored private information.",
  spec: {
    kind: "server-verdict",
    path: "/template-overall=none/page=private_info",
    body: { delete_private_info: "1" },
  },
});
