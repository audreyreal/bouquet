import { fixedAction } from "../spec";

export const clearDossierAction = fixedAction({
  type: "clear-dossier",
  title: "Clear Dossier",
  blurb: "Empty the nation's dossier.",
  spec: {
    kind: "text",
    path: "/template-overall=none/page=dossier",
    body: { clear_dossier: "1" },
    needle: "Dossier cleared of nations.",
  },
});
