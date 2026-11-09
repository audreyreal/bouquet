/* Settings tab: global password, main nation, embassy whitelist, the daily dump (auto-download toggle, status, manual check), keybinds, the Action button toggle, the busy-toast toggle, the native Login buttons toggle and the walkthrough restart. */

import { DEFAULT_KEYS } from "../constants";
import { hasCachedDump, outcomeText, populationStatus, refreshPopulations } from "../dump";
import { type Keybinds, persist, state } from "../state";
import { keyLabel, registerSkip } from "../ui/actions";
import { btn, card, el, hint, refreshStatus, row, section } from "../ui/dom";
import { toast } from "../ui/mdui";
import { startWalkthrough, walkthroughRefresh } from "../ui/walkthrough";
import { canon } from "../utils";

/* One active key-recording at a time: a new Record click cancels the previous one (restores its
 * button, detaches its listener). Like the other page slots, the page renders once per load. */
let cancelRecording: (() => void) | null = null;

export function renderSettings(main: HTMLElement): void {
  const mainNation = el("mdui-text-field", {
    label: "Main nation",
    placeholder: "nation name",
    helper: "Required by NationStates rules",
  });
  mainNation.value = state.mainNation;
  mainNation.addEventListener("change", () => {
    /* Never empty: boot() refuses to mount without it, so an empty save is rejected here too. */
    const next = canon(mainNation.value.trim());
    if (!next) {
      mainNation.value = state.mainNation;
      toast("Main nation can't be empty — required by NationStates rules", "error");
      return;
    }
    state.mainNation = next;
    mainNation.value = next;
    persist();
    refreshStatus();
    toast(`Main nation set to ${next}`);
  });
  const gp = el("mdui-text-field", {
    type: "password",
    "toggle-password": "",
    label: "Global password",
    helper:
      "Used for every puppet without its own nation:password override. Stored as plaintext in userscript storage.",
    clearable: "",
    "data-bq-walk": "global-password",
  });
  gp.value = state.globalPassword;
  gp.addEventListener("change", () => {
    state.globalPassword = gp.value.trim();
    persist();
    toast("Global password saved");
    walkthroughRefresh("global-password");
  });
  main.appendChild(
    section(
      "Account",
      card(
        mainNation,
        gp,
        row(
          btn(
            "Restart walkthrough",
            "Start the first-run tour again from step 1",
            () => {
              state.walkthrough = "global-password";
              persist();
              startWalkthrough("settings");
            },
            "text",
          ),
        ),
      ),
      "Changes save automatically.",
    ),
  );
  const whitelistField = el("mdui-text-field", {
    rows: 4,
    label: "Embassy whitelist",
    helper:
      "One region per line or comma-separated. Clean Up Embassies never closes these and cancels their closure.",
  });
  whitelistField.value = state.embassyWhitelist;
  whitelistField.addEventListener("change", () => {
    state.embassyWhitelist = whitelistField.value;
    persist();
    toast("Embassy whitelist saved");
  });
  main.appendChild(section("Region tools", card(whitelistField), "Changes save automatically."));
  const dumpBox = el(
    "mdui-checkbox",
    null,
    " Download the nations daily dump automatically when Manage opens (~61 MB, once per new dump)",
  );
  dumpBox.checked = state.dumpAuto;
  dumpBox.addEventListener("change", () => {
    state.dumpAuto = dumpBox.checked;
    persist();
  });
  const dumpStatus = hint("");
  function paintDump(): void {
    dumpStatus.textContent = populationStatus();
    void hasCachedDump().then((kept) => {
      dumpStatus.textContent = `${populationStatus()}${kept ? " · dump file kept in browser storage" : state.dump.lastModified ? " · dump file not stored" : ""}`;
    });
  }
  const checkBtn = btn(
    "Check for new dump",
    "Download the nations daily dump if a newer one is out, then look up roster populations",
    async () => {
      if (checkBtn.hasAttribute("disabled")) return;
      checkBtn.setAttribute("disabled", "");
      const out = await refreshPopulations("manual", (t) => {
        dumpStatus.textContent = t;
      });
      const { text, error } = outcomeText(out);
      toast(text, error ? "error" : undefined);
      checkBtn.removeAttribute("disabled");
      paintDump();
    },
    "tonal",
  );
  paintDump();
  main.appendChild(
    section(
      "Daily dump",
      card(row(dumpBox), dumpStatus, row(checkBtn)),
      "Roster populations come from NationStates' nations daily dump. They gate Classification changes (500 million) and custom postcard slots.",
    ),
  );
  /* Global keybinds: each row shows the live binding and a Record button. Recording captures the
   * next keydown at window capture phase, so it can never reach a page's own keydown handler. */
  const KEYBIND_ROWS: Array<[keyof Keybinds, string]> = [
    ["action", "Page action"],
    ["nextActor", "Next puppet fallback"],
  ];
  const keyFields: Array<{
    id: keyof Keybinds;
    field: HTMLElementTagNameMap["mdui-text-field"];
  }> = [];
  function paintKeys(): void {
    keyFields.forEach(({ id, field }) => {
      field.value = keyLabel(state.keys[id]);
    });
  }
  const actionBox = el("mdui-checkbox", null, " Use on-screen Action button instead (mobile)");
  actionBox.checked = state.actionButton;
  /* The Page action field + Record button: disabled while the Action button replaces the key. */
  const actionLocked: HTMLElement[] = [];
  function paintActionLock(): void {
    for (const n of actionLocked) n.toggleAttribute("disabled", state.actionButton);
  }
  const keyRows: HTMLElement[] = [];
  KEYBIND_ROWS.forEach(([id, label]) => {
    const field = el("mdui-text-field", { label: label, readonly: "" });
    field.value = keyLabel(state.keys[id]);
    keyFields.push({ id, field });
    const rec = btn(
      "Record",
      `Record a new key for ${label}`,
      () => {
        if (id === "action" && state.actionButton) return;
        cancelRecording?.();
        const stop = (): void => {
          window.removeEventListener("keydown", onKey, true);
          rec.textContent = "Record";
          rec.setAttribute("variant", "outlined");
          if (cancelRecording === stop) cancelRecording = null;
        };
        const onKey = (e: KeyboardEvent): void => {
          if (e.repeat) return;
          /* Modifier combos are unsupported (every page handler drops them, so a bound combo could
           * never fire) — leave them to the browser (reload, devtools). */
          if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
          if (e.code === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            stop();
            return;
          }
          /* Modifier-only codes are not a binding either. */
          if (/^(Shift|Control|Alt|Meta)(Left|Right)$/.test(e.code)) return;
          const taken = KEYBIND_ROWS.find(([k]) => k !== id && state.keys[k] === e.code);
          e.preventDefault();
          e.stopPropagation();
          if (taken) {
            toast(`${taken[1]} already uses ${keyLabel(e.code)}`, "error");
            return;
          }
          state.keys[id] = e.code;
          persist();
          paintKeys();
          stop();
        };
        cancelRecording = stop;
        window.addEventListener("keydown", onKey, true);
        rec.textContent = "Press a key… (Esc cancels)";
        rec.setAttribute("variant", "filled");
      },
      "outlined",
    );
    if (id === "action") {
      actionLocked.push(field, rec);
      keyRows.push(row(field, rec, actionBox));
    } else {
      keyRows.push(row(field, rec));
    }
  });
  paintActionLock();
  actionBox.addEventListener("change", () => {
    cancelRecording?.();
    state.actionButton = actionBox.checked;
    persist();
    paintActionLock();
  });
  main.appendChild(
    section(
      "Keybinds",
      card(
        ...keyRows,
        row(
          btn(
            "Reset to defaults",
            "Restore default keybinds and turn off the on-screen Action button",
            () => {
              cancelRecording?.();
              state.keys = { ...DEFAULT_KEYS };
              state.actionButton = false;
              actionBox.checked = false;
              persist();
              paintKeys();
              paintActionLock();
              toast("Keybinds reset");
            },
            "text",
          ),
        ),
      ),
      "Keybinds apply on the next press — no reload needed on tabs opened after saving.",
    ),
  );
  const busyBox = el(
    "mdui-checkbox",
    null,
    " Suppress 'busy — dropped, press again' toasts (presses still drop silently)",
  );
  busyBox.checked = state.suppressBusyDrop;
  busyBox.addEventListener("change", () => {
    state.suppressBusyDrop = busyBox.checked;
    persist();
  });
  main.appendChild(section("Notifications", card(row(busyBox))));
  const nativeLoginBox = el(
    "mdui-checkbox",
    null,
    " Add a Login button after each imported nation's name on native pages",
  );
  nativeLoginBox.checked = state.nativeLoginButtons;
  nativeLoginBox.addEventListener("change", () => {
    state.nativeLoginButtons = nativeLoginBox.checked;
    persist();
  });
  main.appendChild(
    section(
      "Native enhancement",
      card(row(nativeLoginBox)),
      "Changes to native NationStates pages.",
    ),
  );
  /* Settings has no queue: the shell button stays visible but disabled. */
  registerSkip(null);
}
