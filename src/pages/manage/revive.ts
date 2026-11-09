/* Revive toggle: step 1 restores a ▸ puppet missing from the world nation list instead of logging in. */
import { fetchExistingNations } from "../../net";
import { nationNames, persist, state } from "../../state";
import { el, hint } from "../../ui/dom";
import { toast } from "../../ui/mdui";
import type { Ctx } from "./ctx";

export interface Revive {
  modeControl: HTMLElement; // segmented control for the roster toolbar
  output: HTMLElement; // restore note + revived lists, below the roster table
  paint(): void;
  ensure(): void; // one world-nation-list fetch per page load
  willRestore(name: string): boolean;
  isLoading(): boolean;
  needsPasswordReset(name: string): boolean;
  record(name: string, outcome: "revived" | "needs-reset" | "failed"): void;
}

export function createRevive(ctx: Ctx): Revive {
  /* Bookkeeping is page-local (nothing here persists). `existing` is the world nation list, fetched
   * at most once per page load. */
  let existing: Set<string> | null = null;
  let existingState: "idle" | "loading" | "ready" | "failed" = "idle";
  const restoreAttempted = new Set<string>(); // one restore POST per nation per page load
  const revived: string[] = [];
  const needsReset: string[] = [];

  /* Step-1 mode (state.reviveMissing); the change handler keeps one segment selected. */
  const modeControl = el(
    "mdui-segmented-button-group",
    {
      selects: "single",
      value: state.reviveMissing ? "revive" : "login",
    },
    el(
      "mdui-segmented-button",
      {
        value: "login",
        title: "Step 1 always logs in, even for puppets missing from the world nation list",
      },
      "Login only",
    ),
    el(
      "mdui-segmented-button",
      {
        value: "revive",
        title:
          "Step 1 restores a ▸ puppet missing from the world nation list instead of logging in",
      },
      "Revive dead nations",
    ),
  );
  const note = hint("");
  const revivedField = el("mdui-text-field", {
    rows: 6,
    label: "Revived",
    readonly: "",
  });
  const resetField = el("mdui-text-field", {
    rows: 6,
    label: "Revived — need password reset",
    readonly: "",
  });
  const output = el(
    "div",
    { class: "bq-revive-out" },
    hint(
      "Step 1 restores a ▸ puppet missing from the world nation list (once per nation) instead of logging in.",
    ),
    note,
    revivedField,
    resetField,
  );

  function paint(): void {
    output.hidden = !state.reviveMissing;
    revivedField.value = revived.join("\n");
    resetField.value = needsReset.join("\n");
    if (existingState === "failed") {
      note.textContent =
        "Couldn't load the nation list — nations won't be restored (reload to retry)";
    } else if (existingState === "ready" && existing !== null) {
      const set = existing;
      const names = nationNames();
      const m = names.filter((n) => !set.has(n) && !restoreAttempted.has(n)).length;
      note.textContent = `${m} of ${names.length} roster puppet(s) don't exist; each is restored at most once`;
    }
  }

  /* A failure stays final until reload. */
  function ensure(): void {
    if (existingState !== "idle") return;
    existingState = "loading";
    note.textContent = "Checking which roster puppets exist…";
    fetchExistingNations((n) => {
      note.textContent = `NS busy — retrying the nation list (${n})…`;
    }).then((set) => {
      if (set) {
        existing = set;
        existingState = "ready";
      } else {
        existingState = "failed";
        toast("Couldn't load the nation list — nations won't be restored", "error");
      }
      ctx.paint();
    });
  }

  modeControl.addEventListener("change", () => {
    /* Re-clicking the selected segment clears the value; put the current mode back instead of
     * treating it as a switch. */
    if (!modeControl.value) {
      modeControl.value = state.reviveMissing ? "revive" : "login";
      return;
    }
    state.reviveMissing = modeControl.value === "revive";
    persist();
    if (state.reviveMissing) ensure();
    ctx.paint();
  });

  return {
    modeControl,
    output,
    paint,
    ensure,
    /* Step 1 sends a restore instead of a login: toggle on, list loaded, nation missing, not yet tried. */
    willRestore: (name) =>
      state.reviveMissing &&
      existing !== null &&
      !existing.has(name) &&
      !restoreAttempted.has(name),
    isLoading: () => existingState === "loading",
    needsPasswordReset: (name) => needsReset.includes(name),
    /* A restore POST went out (dropped/busy aren't attempts); revived/needs-reset nations exist now. */
    record(name, outcome) {
      restoreAttempted.add(name);
      if (outcome === "revived" || outcome === "needs-reset") {
        const list = outcome === "revived" ? revived : needsReset;
        if (!list.includes(name)) list.push(name);
        existing?.add(name);
      }
    },
  };
}
