/* Manage roster: the puppet table, the folder bar, the import box and the roster tools (folders,
 * select and move selection, shuffle, find WA, clear). */
import { authFor, needsAuth } from "../../auth";
import { DEFAULT_FOLDER_ID } from "../../constants";
import { populationText } from "../../dump";
import { NS_BUSY_MSG, readRegionNations, readWaMembers } from "../../net";
import {
  clearNations,
  folderExists,
  folderName,
  moveToFolder,
  nationNames,
  nextAddedAt,
  persist,
  setRegionResidents,
  setRosterOrder,
  shownFolders,
  state,
  viewNames,
} from "../../state";
import { actionKey } from "../../ui/actions";
import {
  btn,
  buildTable,
  card,
  collapsibleSection,
  copyText,
  el,
  hint,
  iconButton,
  modal,
  nationCell,
  row,
  selectField,
} from "../../ui/dom";
import { toast } from "../../ui/mdui";
import { walkthroughRefresh } from "../../ui/walkthrough";
import { canon, newId } from "../../utils";
import {
  type Ctx,
  cancelRun,
  NO_PUPPETS,
  refreshRosterPopulations,
  resetRun,
  rosterOrToast,
  undoToast,
  viewScope,
} from "./ctx";
import {
  activeDrag,
  allowDrop,
  clearMarksOnLeave,
  endDrag,
  isAfter,
  makeDraggable,
  markDrop,
} from "./drag";
import type { Revive } from "./revive";

type RosterRow = {
  tr: HTMLTableRowElement;
  marker: Text; // " ▸" when current, "" otherwise
  regionText: Text;
  popText: Text;
  authCell: HTMLTableCellElement;
  authIcon: HTMLElement; // the mdui-icon
  authText: Text;
  lockBtn: HTMLElement;
  lockTag: HTMLElement;
  current: boolean;
  hasAuth: boolean | null; // null = never painted, forces first update
  locked: boolean | null;
  excluded: boolean | null;
};

type HeadRow = { tr: HTMLTableRowElement; label: Text };

export interface Roster {
  section: HTMLElement;
  /* Clamps ctx.hl, then repaints the table and the selection button. */
  paint(names: string[]): void;
  jumpTo(name: string): void;
  scrollToCurrent(): void;
}

const LOCK_TIP = "Lock: skip this puppet in runs and Next puppet";
const UNLOCK_TIP = "Locked — skipped by runs and Next puppet. Click to unlock";
const ROSTER_NOTE = `Lock a puppet (padlock icon) to skip it: runs and Next puppet pass over locked puppets until you unlock them (Select puppets can still select them, e.g. to move them). Login to all still includes them. Folders: click folders above the table to show or hide them; the shown folders are listed and run one after another, in folder-bar order. Drag a row onto a folder to move it. Login to all still covers the whole roster.`;

/* Import lines: "nation" (uses the global password) or "nation<sep>password" (override), where
 * <sep> is ":", "," or "|". Split on the FIRST separator only (nation names never contain any of
 * them) so passwords may contain them; a missing/empty password yields `password: null`. */
function parsePuppetLines(text: string): Array<{ name: string; password: string | null }> {
  const out: Array<{ name: string; password: string | null }> = [];
  text.split("\n").forEach((line) => {
    const t = line.trim();
    if (!t) return;
    const i = t.search(/[:,|]/);
    const name = canon((i === -1 ? t : t.slice(0, i)).trim());
    if (!name) return;
    const pw = i === -1 ? "" : t.slice(i + 1).trim();
    out.push({ name: name, password: pw || null });
  });
  return out;
}

/* Stored-token age, coarse on purpose (the exact second is never actionable). */
function ageText(updatedAt: number): string {
  const s = Math.max(0, Math.floor((Date.now() - updatedAt) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function createRoster(ctx: Ctx, revive: Revive): Roster {
  /* Roster import: names (+ optional per-nation password overrides) only — tokens come from a
   * harvest. Dialog, not an inline field, so the roster stays the first thing on the page. */
  const imp = el("mdui-text-field", {
    rows: 8,
    label: "Puppets",
    placeholder: "nation\nnation:password",
  });
  const impFolder = selectField("Folder", [], DEFAULT_FOLDER_ID);
  const importFields = el(
    "div",
    { class: "bq-dialog-fields" },
    hint(
      "One per line: nation, or nation:password (separator may be : , or |). A bare nation uses the global password from Settings. New puppets go into the chosen folder; puppets already in the roster keep theirs.",
    ),
    imp,
    impFolder,
  );
  const importDlg = modal(
    { headline: "Import puppets" },
    importFields,
    btn(
      "Cancel",
      "Close without importing",
      () => {
        importDlg.open = false;
      },
      "text",
    ),
    btn("Import", "Add these puppets to the roster (Ctrl+Enter)", () => doImport(), "filled"),
  );
  importDlg.addEventListener("opened", () => imp.focus());
  imp.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) doImport();
  });

  /* Per-nation password override. One shared dialog (the roster can hold thousands of rows);
   * `pwTarget` is the canonical nation it is editing. */
  let pwTarget = "";
  const pwField = el("mdui-text-field", {
    type: "password",
    "toggle-password": "",
    label: "Password",
  });
  const pwDlg = modal(
    { headline: "Set password" },
    el(
      "div",
      { class: "bq-dialog-fields" },
      hint(
        "Used to log in as this puppet instead of the global password. Leave blank to use the global password. Stored as plaintext in userscript storage.",
      ),
      pwField,
    ),
    btn(
      "Cancel",
      "Close without changing the password",
      () => {
        pwDlg.open = false;
      },
      "text",
    ),
    btn("Save", "Store this password for the puppet (Enter)", () => savePassword(), "filled"),
  );
  pwDlg.addEventListener("opened", () => pwField.focus());
  pwField.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") savePassword();
  });
  function openPasswordDialog(n: string): void {
    pwTarget = n;
    pwDlg.setAttribute("headline", `Password for ${n}`);
    pwField.value = state.passwords[n] ?? "";
    pwDlg.open = true;
  }
  /* No resetRun: buildLoginSpec reads passwordFor at press time, so a pending run picks this up. */
  function savePassword(): void {
    if (!state.nations[pwTarget]) {
      pwDlg.open = false;
      toast(`${pwTarget} is no longer in the roster`, "error");
      return;
    }
    const pw = pwField.value.trim();
    if (pw) state.passwords[pwTarget] = pw;
    else delete state.passwords[pwTarget];
    persist();
    pwDlg.open = false;
    ctx.paint();
    toast(pw ? `Password saved for ${pwTarget}` : `${pwTarget} now uses the global password`);
  }

  /* Move puppets to another folder. One shared dialog, opened by a row's Move button (one puppet)
   * or Move selection (the selection); `moveTargets` = the nations it moves. */
  let moveTargets: string[] = [];
  const moveFolder = selectField("Folder", [], DEFAULT_FOLDER_ID);
  const moveDlg = modal(
    { headline: "Move to folder" },
    el("div", { class: "bq-dialog-fields" }, moveFolder),
    btn(
      "Cancel",
      "Close without moving",
      () => {
        moveDlg.open = false;
      },
      "text",
    ),
    btn("Move", "Move into the chosen folder", () => doMove(), "filled"),
  );
  function openMoveDialog(names: string[], headline: string, folder: string): void {
    moveTargets = names;
    moveDlg.setAttribute("headline", headline);
    fillFolderSelect(moveFolder, folder);
    moveDlg.open = true;
  }
  function doMove(): void {
    const folder = folderExists(moveFolder.value) ? moveFolder.value : DEFAULT_FOLDER_ID;
    moveDlg.open = false;
    const names = moveTargets.filter((n) => state.nations[n]);
    if (moveTargets.length === 1) {
      const n = moveTargets[0];
      if (!names.length) toast(`${n} is no longer in the roster`, "error");
      else if (state.nations[n].folder === folder)
        toast(`${n} is already in ${folderName(folder)}`);
      else {
        moveNations([n], folder);
        toast(`${n} moved to ${folderName(folder)}`);
      }
      return;
    }
    if (!names.length) {
      toast("None of the selected puppets are in the roster", "error");
      return;
    }
    const toMove = names.filter((n) => state.nations[n].folder !== folder);
    if (!toMove.length) {
      toast(`All ${names.length} selected puppet(s) are already in ${folderName(folder)}`);
      return;
    }
    const prev = new Map(toMove.map((n) => [n, state.nations[n].folder]));
    moveNations(toMove, folder);
    undoToast(
      ctx,
      `${toMove.length} moved to ${folderName(folder)}${names.length > toMove.length ? ` · ${names.length - toMove.length} already there` : ""}`,
      () => {
        if (ctx.active && prev.has(ctx.active.actor)) cancelRun(ctx);
        for (const [n, f] of prev) {
          const entry = state.nations[n];
          if (entry) entry.folder = folderExists(f) ? f : DEFAULT_FOLDER_ID;
        }
      },
      "Move undone",
    );
  }

  const importBtn = btn(
    "Import puppets",
    "Paste nation names (and optional passwords) to add to the roster",
    () => {
      fillFolderSelect(impFolder, state.activeFolders[0] ?? DEFAULT_FOLDER_ID);
      importDlg.open = true;
    },
  );
  importBtn.setAttribute("data-bq-walk", "import");
  const copyMissing = btn(
    "Copy missing names",
    "Copy the names of puppets with no stored auth to the clipboard",
    null,
    "tonal",
  );
  const selectBtn = btn(
    "Select puppets",
    "Pick puppets by name and region; runs visit only the selection, and Move selection moves it into a folder",
    null,
    "tonal",
  );
  const moveSelBtn = btn("Move selection", "Move the selected puppets into a folder", null, "text");
  const clearSelBtn = btn(
    "Clear selection",
    "Let runs visit every unlocked puppet again",
    null,
    "text",
  );
  const shuffleBtn = btn("Shuffle order", "Randomize the roster order (undoable)", null, "tonal");
  const findWaBtn = btn(
    "Find WA nation",
    "Find which roster puppet is in the World Assembly",
    null,
    "tonal",
  );
  const clearBtn = btn(
    "Clear roster",
    "Remove every puppet from the roster (asks first)",
    null,
    "outlined",
  );
  const { scroll, tbody } = buildTable(["Puppet", "Region", "Population", "Auth", ""]);
  scroll.classList.add("bq-roster");
  const folderBar = el("div", { class: "sf-row bq-folder-bar" });
  const rosterCard = card(
    row(
      importBtn,
      copyMissing,
      selectBtn,
      moveSelBtn,
      clearSelBtn,
      shuffleBtn,
      findWaBtn,
      clearBtn,
      revive.modeControl,
    ),
    folderBar,
    scroll,
    revive.output,
  );

  let rosterRows = new Map<string, RosterRow>();
  let rosterOrder: string[] = [];
  let headRows = new Map<string, HeadRow>(); // folder id → its header row
  let rosterGroupKey = ""; // "" = ungrouped; else shown folder ids with their member counts

  /* Folder selects are filled when their dialog opens: folders change at run time, and
   * selectField only builds a fixed option list. */
  function fillFolderSelect(sel: HTMLElementTagNameMap["mdui-select"], value: string): void {
    sel.replaceChildren(...state.folders.map((f) => el("mdui-menu-item", { value: f.id }, f.name)));
    sel.value = value;
  }

  /* The only path that changes folder membership while the page is open (Undo restores write
   * `.folder` directly). Names leaving the shown folders drop out of the selection and end their
   * run; `hl` stays on the same puppet when it is still shown. Callers toast. */
  function moveNations(names: string[], folder: string): number {
    const current = viewNames()[ctx.hl];
    const moved = moveToFolder(names, folder);
    if (moved === 0) return 0;
    if (!state.activeFolders.includes(folder)) {
      const actor = ctx.active?.actor;
      if (actor !== undefined && names.includes(actor)) resetRun(ctx);
      if (ctx.selection) {
        for (const n of names) ctx.selection.delete(n);
        if (ctx.selection.size === 0) ctx.selection = null;
      }
    }
    const i = viewNames().indexOf(current);
    if (i !== -1) ctx.hl = i;
    ctx.paint();
    return moved;
  }

  /* Folder bar click: show or hide one folder. The ▸ puppet and its run survive when it stays
   * shown; at least one folder is always shown. */
  function toggleFolder(id: string): void {
    const current = viewNames()[ctx.hl];
    const wasShown = state.activeFolders.includes(id);
    if (wasShown && state.activeFolders.length === 1) {
      toast("At least one folder must be shown — show another folder first", "error");
      return;
    }
    state.activeFolders = state.folders
      .filter((f) => (f.id === id ? !wasShown : state.activeFolders.includes(f.id)))
      .map((f) => f.id);
    persist();
    const view = viewNames();
    const shown = new Set(view);
    if (ctx.active && !shown.has(ctx.active.actor)) resetRun(ctx);
    if (ctx.selection) {
      for (const n of ctx.selection) if (!shown.has(n)) ctx.selection.delete(n);
      if (ctx.selection.size === 0) ctx.selection = null;
    }
    const i = view.indexOf(current);
    ctx.hl = i === -1 ? 0 : i;
    ctx.paint();
  }

  /* Folder bar: rebuilt only when the folders, their counts or the shown folders change (paint
   * runs on every key press). Every folder button accepts a dragged roster row. */
  let folderSig = "";
  function paintFolders(): void {
    const counts: Record<string, number> = {};
    for (const entry of Object.values(state.nations))
      counts[entry.folder] = (counts[entry.folder] ?? 0) + 1;
    const sig = JSON.stringify([state.activeFolders, state.folders, counts]);
    if (sig === folderSig) return;
    folderSig = sig;
    const single = state.activeFolders.length === 1;
    const buttons = state.folders.map((f) => {
      const b = btn(
        `${f.name} (${counts[f.id] ?? 0})`,
        `Show or hide ${f.name} (drop a puppet here to move it)`,
        () => toggleFolder(f.id),
        state.activeFolders.includes(f.id) ? "filled" : "outlined",
      );
      b.addEventListener("dragover", (e: DragEvent) => {
        if (activeDrag(e)?.from !== "roster") return;
        allowDrop(e);
        b.classList.add("bq-drop-folder");
      });
      b.addEventListener("dragleave", (e: DragEvent) => {
        if (!(e.relatedTarget instanceof Node) || !b.contains(e.relatedTarget))
          b.classList.remove("bq-drop-folder");
      });
      b.addEventListener("drop", (e: DragEvent) => {
        const d = activeDrag(e);
        endDrag();
        if (d?.from !== "roster") return;
        e.preventDefault();
        if (!state.nations[d.name]) return;
        if (state.nations[d.name].folder === f.id) toast(`${d.name} is already in ${f.name}`);
        else {
          moveNations([d.name], f.id);
          toast(`${d.name} moved to ${f.name}`);
        }
      });
      return b;
    });
    folderBar.replaceChildren(
      ...buttons,
      iconButton("create_new_folder--outlined", "New folder", () => openFolderDialog(null)),
      iconButton(
        "drive_file_rename_outline--outlined",
        "Rename the shown folder (show only that folder)",
        () => openFolderDialog(state.activeFolders[0]),
        !single,
      ),
      iconButton(
        "folder_delete--outlined",
        "Delete the shown folder (its puppets move to Default; show only that folder)",
        () => deleteActiveFolder(),
        !single || state.activeFolders[0] === DEFAULT_FOLDER_ID,
      ),
    );
  }

  /* Folder name dialog, shared by New folder and Rename; `folderEditing` null = creating. */
  let folderEditing: string | null = null;
  const folderField = el("mdui-text-field", { label: "Folder name" });
  const folderDlg = modal(
    { headline: "New folder" },
    el("div", { class: "bq-dialog-fields" }, folderField),
    btn(
      "Cancel",
      "Close without changing folders",
      () => {
        folderDlg.open = false;
      },
      "text",
    ),
    btn("Save", "Save the folder name (Enter)", () => saveFolder(), "filled"),
  );
  folderDlg.addEventListener("opened", () => folderField.focus());
  folderField.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter") saveFolder();
  });
  function openFolderDialog(id: string | null): void {
    folderEditing = id;
    folderDlg.setAttribute("headline", id === null ? "New folder" : `Rename ${folderName(id)}`);
    folderField.value = id === null ? "" : folderName(id);
    folderDlg.open = true;
  }
  /* A new folder is not shown, so its button stays a drop target next to the rows shown. */
  function saveFolder(): void {
    const name = folderField.value.trim();
    if (!name) {
      toast("Enter a folder name", "error");
      return;
    }
    const editing = folderEditing;
    const lower = name.toLowerCase();
    if (state.folders.some((f) => f.id !== editing && f.name.toLowerCase() === lower)) {
      toast(`A folder named ${name} already exists`, "error");
      return;
    }
    if (editing === null) {
      state.folders.push({ id: newId(), name });
      toast(`Folder ${name} created`);
    } else {
      const folder = state.folders.find((f) => f.id === editing);
      if (!folder) {
        folderDlg.open = false;
        toast("That folder no longer exists", "error");
        return;
      }
      folder.name = name;
      toast(`Folder renamed to ${name}`);
    }
    persist();
    folderDlg.open = false;
    ctx.paint();
  }

  /* Deletes the shown folder; its puppets move to Default, which becomes the shown folder. */
  function deleteActiveFolder(): void {
    const id = state.activeFolders.length === 1 ? state.activeFolders[0] : "";
    if (id === "" || id === DEFAULT_FOLDER_ID) return;
    const index = state.folders.findIndex((f) => f.id === id);
    if (index === -1) return;
    const folder = state.folders[index];
    const members = nationNames().filter((n) => state.nations[n].folder === id);
    state.folders.splice(index, 1);
    for (const n of members) state.nations[n].folder = DEFAULT_FOLDER_ID;
    state.activeFolders = [DEFAULT_FOLDER_ID];
    ctx.selection = null;
    ctx.hl = 0;
    resetRun(ctx);
    persist();
    ctx.paint();
    undoToast(
      ctx,
      `Folder ${folder.name} deleted · ${members.length} puppet(s) moved to ${folderName(DEFAULT_FOLDER_ID)}`,
      () => {
        const lower = folder.name.toLowerCase();
        if (state.folders.some((f) => f.id === id || f.name.toLowerCase() === lower)) {
          toast(`Can't restore ${folder.name} — a folder with that name exists`, "error");
          return false;
        }
        state.folders.splice(Math.min(index, state.folders.length), 0, folder);
        for (const n of members) {
          const entry = state.nations[n];
          if (entry?.folder === DEFAULT_FOLDER_ID) entry.folder = id;
        }
      },
      `Folder ${folder.name} restored`,
    );
  }

  /* Moves the page-local roster highlight to `name`; a row click and the Next-puppet skip both
   * land here. Nothing persists the highlight. */
  function jumpTo(name: string): void {
    const names = rosterOrToast();
    if (!names) return;
    const idx = names.indexOf(name);
    if (idx === -1) {
      toast(`${name} is no longer in the roster`, "error");
      return;
    }
    ctx.hl = idx;
    if (ctx.active?.actor !== names[ctx.hl]) cancelRun(ctx);
    ctx.paint();
  }
  function scrollToCurrent(): void {
    rosterRows.get(rosterOrder[ctx.hl])?.tr.scrollIntoView({ block: "center" });
  }

  function buildRosterRow(n: string): RosterRow {
    const tr = el("tr", {
      class: "bq-roster-row",
      "data-puppet": n,
      onclick: (e: MouseEvent) => {
        if (e.target instanceof Element && e.target.closest("a,mdui-button-icon")) return;
        jumpTo(n);
      },
    });
    makeDraggable(tr, { from: "roster", name: n });
    const marker = document.createTextNode("");
    const lockTag = el("span", { class: "bq-lock-tag", hidden: "" }, "locked · skipped");
    const nameCell = nationCell(n);
    nameCell.append(marker, lockTag);
    const regionText = document.createTextNode("");
    const popText = document.createTextNode("");
    const authIcon = el("mdui-icon");
    const authText = document.createTextNode("");
    const authCell = el("td", { class: "bq-auth" }, authIcon, authText);
    const lockBtn = iconButton("lock_open--outlined", LOCK_TIP, () => {
      const entry = state.nations[n];
      if (!entry) return;
      entry.locked = !entry.locked;
      persist();
      if (ctx.active?.actor === n) resetRun(ctx);
      ctx.paint();
    });
    const actions = el(
      "td",
      { class: "bq-row-actions" },
      iconButton(
        "edit--outlined",
        "Set this puppet's password (overrides the global password)",
        () => openPasswordDialog(n),
      ),
      iconButton("drive_file_move--outlined", "Move to another folder", () =>
        openMoveDialog([n], `Move ${n} to folder`, state.nations[n]?.folder ?? DEFAULT_FOLDER_ID),
      ),
      lockBtn,
      iconButton("my_location--outlined", "Set current", () => jumpTo(n)),
      iconButton("person_remove--outlined", "Remove from roster", () => {
        const snap = {
          nation: state.nations[n],
          auth: state.auth[n],
          password: state.passwords[n] as string | undefined,
          region: state.regions[n] as string | undefined,
          population: state.populations[n],
        };
        resetRun(ctx, ctx.active?.actor === n ? n : null);
        delete state.nations[n];
        delete state.auth[n];
        delete state.passwords[n];
        delete state.regions[n];
        delete state.populations[n];
        if (ctx.selection?.delete(n) && ctx.selection.size === 0) ctx.selection = null;
        persist();
        ctx.paint();
        undoToast(
          ctx,
          `${n} removed`,
          () => {
            state.nations[n] ??= snap.nation;
            if (!folderExists(state.nations[n].folder)) state.nations[n].folder = DEFAULT_FOLDER_ID;
            if (snap.auth && !state.auth[n]) state.auth[n] = snap.auth;
            if (snap.password !== undefined && state.passwords[n] === undefined)
              state.passwords[n] = snap.password;
            if (snap.region !== undefined && state.regions[n] === undefined)
              state.regions[n] = snap.region;
            if (snap.population !== undefined && state.populations[n] === undefined)
              state.populations[n] = snap.population;
            if (ctx.abortedActor === n) ctx.abortedActor = null;
          },
          `${n} restored`,
        );
      }),
    );
    tr.append(
      nameCell,
      el("td", null, regionText),
      el("td", { class: "bq-pop" }, popText),
      authCell,
      actions,
    );
    return {
      tr,
      marker,
      regionText,
      popText,
      authCell,
      authIcon,
      authText,
      lockBtn,
      lockTag,
      current: false,
      hasAuth: null,
      locked: null,
      excluded: null,
    };
  }

  function updateRosterRow(row: RosterRow, n: string, current: boolean): void {
    if (row.current !== current) {
      row.current = current;
      row.tr.classList.toggle("bq-row-current", current);
      row.marker.data = current ? " ▸" : "";
    }
    const region = state.regions[n] ?? "—";
    if (row.regionText.data !== region) row.regionText.data = region;
    const pop = populationText(n);
    if (row.popText.data !== pop) row.popText.data = pop;
    const locked = state.nations[n]?.locked === true;
    if (row.locked !== locked) {
      row.locked = locked;
      row.tr.classList.toggle("bq-row-locked", locked);
      row.lockBtn.setAttribute("icon", locked ? "lock--outlined" : "lock_open--outlined");
      row.lockBtn.setAttribute("title", locked ? UNLOCK_TIP : LOCK_TIP);
      row.lockBtn.setAttribute("aria-label", locked ? UNLOCK_TIP : LOCK_TIP);
      row.lockTag.hidden = !locked;
    }
    const excluded = !locked && ctx.selection !== null && !ctx.selection.has(n);
    if (row.excluded !== excluded) {
      row.excluded = excluded;
      row.tr.classList.toggle("bq-row-excluded", excluded);
    }
    const a = authFor(n);
    const has = a !== null;
    if (row.hasAuth !== has) {
      row.hasAuth = has;
      row.authCell.classList.toggle("bq-auth-missing", !has);
      row.authIcon.setAttribute("name", has ? "check_circle--outlined" : "error--outlined");
    }
    const text = a
      ? `stored · ${ageText(a.updatedAt)}`
      : `missing — press ${actionKey()} to log in`;
    if (row.authText.data !== text) row.authText.data = text;
  }

  function buildHeadRow(): HeadRow {
    const label = document.createTextNode("");
    return {
      tr: el("tr", { class: "bq-folder-head" }, el("td", { colspan: 5 }, label)),
      label,
    };
  }

  /* Rows are keyed by name: the DOM is rebuilt only when the name set/order or the folder grouping
   * changes, and then existing rows are reused. Otherwise only marker/auth text are patched. With
   * 2+ shown folders a header row (not clickable, draggable or a drop target) precedes each
   * folder's rows; `names` is contiguous per folder in folder-bar order, so names order plus
   * `groupKey` fix the layout. */
  function paintRoster(names: string[]): void {
    if (!names.length) {
      rosterRows.clear();
      headRows.clear();
      rosterOrder = [];
      rosterGroupKey = "";
      tbody.replaceChildren(
        el(
          "tr",
          null,
          el(
            "td",
            { colspan: 5, class: "bq-empty" },
            nationNames().length
              ? `No puppets in ${viewScope()}. Import or move puppets into a shown folder.`
              : "No puppets yet. Import names, or open Bouquet while logged in as a nation to add it.",
          ),
        ),
      );
      return;
    }
    const groups = state.activeFolders.length > 1 ? shownFolders() : null;
    const counts = new Map<string, number>();
    if (groups) {
      for (const n of names) {
        const f = state.nations[n].folder;
        counts.set(f, (counts.get(f) ?? 0) + 1);
      }
    }
    const groupKey = groups ? groups.map((f) => `${f.id}:${counts.get(f.id) ?? 0}`).join(",") : "";
    if (
      groupKey !== rosterGroupKey ||
      names.length !== rosterOrder.length ||
      names.some((n, i) => n !== rosterOrder[i])
    ) {
      const rows = names.map((n) => rosterRows.get(n) ?? buildRosterRow(n));
      const next = new Map(names.map((n, i) => [n, rows[i]]));
      const nextHeads = new Map<string, HeadRow>();
      const want: HTMLTableRowElement[] = [];
      if (groups) {
        let k = 0;
        for (const f of groups) {
          const head = headRows.get(f.id) ?? buildHeadRow();
          nextHeads.set(f.id, head);
          want.push(head.tr);
          for (const end = k + (counts.get(f.id) ?? 0); k < end; k++) want.push(rows[k].tr);
        }
      } else for (const row of rows) want.push(row.tr);
      /* Drop stale rows, then insert/move only what is out of place so surviving rows are not
       * detached (re-attaching thousands of rows re-lays-out the whole table). */
      if (!rosterOrder.length) tbody.replaceChildren();
      for (const [n, row] of rosterRows) if (!next.has(n)) row.tr.remove();
      for (const [id, head] of headRows) if (!nextHeads.has(id)) head.tr.remove();
      let cur: ChildNode | null = tbody.firstChild;
      for (const tr of want) {
        if (tr === cur) cur = cur.nextSibling;
        else tbody.insertBefore(tr, cur);
      }
      rosterRows = next;
      headRows = nextHeads;
      rosterOrder = names;
      rosterGroupKey = groupKey;
    }
    if (groups) {
      for (const f of groups) {
        const head = headRows.get(f.id);
        const text = `${f.name} (${counts.get(f.id) ?? 0})`;
        if (head && head.label.data !== text) head.label.data = text;
      }
    }
    names.forEach((n, i) => {
      const row = rosterRows.get(n);
      if (row) updateRosterRow(row, n, i === ctx.hl);
    });
  }

  /* Import: new names go into the chosen folder; known ones keep their folder and only get a
   * password override when the line has one. */
  function doImport(): void {
    const entries = parsePuppetLines(imp.value);
    if (!entries.length) {
      toast("Nothing to import — enter one nation per line", "error");
      return;
    }
    const folder = folderExists(impFolder.value) ? impFolder.value : DEFAULT_FOLDER_ID;
    let added = 0;
    let addedAt = nextAddedAt();
    let alreadyIn = 0;
    entries.forEach((entry) => {
      /* null = no password on the line: keep any existing override, fall back to global. */
      if (entry.password !== null) state.passwords[entry.name] = entry.password;
      if (state.nations[entry.name]) alreadyIn++;
      else {
        state.nations[entry.name] = { addedAt: addedAt++, locked: false, folder };
        added++;
      }
    });
    resetRun(ctx);
    persist();
    ctx.paint();
    imp.value = "";
    importDlg.open = false;
    toast(
      `${added} added to ${folderName(folder)}${alreadyIn ? ` · ${alreadyIn} already in roster` : ""}`,
    );
    walkthroughRefresh("import");
    if (added) refreshRosterPopulations(ctx);
  }

  /* Roster drag reorder: order is rewritten via setRosterOrder on the whole roster (the target is a
   * shown row in the dragged puppet's folder, so inserting next to it is right in any view); `hl`
   * stays on the same puppet and a pending run is untouched. Across folders there is no drop: the
   * view is grouped by folder, so it would have no visible effect. */
  function rowAt(event: DragEvent): HTMLTableRowElement | null {
    return event.target instanceof Element
      ? event.target.closest<HTMLTableRowElement>("tr.bq-roster-row")
      : null;
  }
  tbody.addEventListener("dragover", (event: DragEvent) => {
    const d = activeDrag(event);
    const tr = rowAt(event);
    if (d?.from !== "roster" || !tr) return;
    if (
      state.nations[d.name]?.folder !== state.nations[tr.getAttribute("data-puppet") ?? ""]?.folder
    )
      return;
    allowDrop(event);
    markDrop(tbody, tr, isAfter(event, tr));
  });
  clearMarksOnLeave(tbody);
  tbody.addEventListener("drop", (event: DragEvent) => {
    const d = activeDrag(event);
    const tr = rowAt(event);
    endDrag();
    if (d?.from !== "roster" || !tr) return;
    if (
      state.nations[d.name]?.folder !== state.nations[tr.getAttribute("data-puppet") ?? ""]?.folder
    )
      return;
    event.preventDefault();
    const target = tr.getAttribute("data-puppet") ?? "";
    const names = nationNames();
    if (!names.includes(d.name) || !names.includes(target) || d.name === target) return;
    const order = names.filter((n) => n !== d.name);
    order.splice(order.indexOf(target) + (isAfter(event, tr) ? 1 : 0), 0, d.name);
    const current = viewNames()[ctx.hl];
    setRosterOrder(order);
    ctx.hl = Math.max(0, viewNames().indexOf(current));
    ctx.paint();
  });

  /* Select puppets: a fixed snapshot of the shown puppets matching a name and a region condition,
   * capped by count. Locked puppets can be selected (to move them); runs still skip them. */
  const selectName = selectField(
    "Name",
    [
      ["any", "Any name"],
      ["contains", "Name contains"],
      ["regex", "Name matches regex"],
    ],
    "any",
  );
  const selectPattern = el("mdui-text-field", { label: "Name text or regex" });
  const selectCond = selectField(
    "Region",
    [
      ["any", "Any region"],
      ["in", "In region"],
      ["not-in", "Not in region"],
    ],
    "any",
  );
  const selectRegion = el("mdui-text-field", { label: "Region name" });
  const selectCount = el("mdui-text-field", { type: "number", label: "How many (blank = all)" });
  const selectFields = el(
    "div",
    { class: "bq-dialog-fields" },
    hint(
      "Picks puppets in the shown folders whose name and region both match, in roster order, up to How many. Runs then visit only the selected puppets (locked ones are still skipped); Move selection moves them into a folder. Names are lowercase with underscores: Contains ignores case and treats spaces as underscores; a regex is case-insensitive and may match anywhere in the name (use ^ and $ to anchor). In region / Not in region first reads the region's resident list from the NationStates API and updates the Region column: listed puppets get that region, and puppets cached there but no longer listed become unknown. A puppet whose region is unknown counts as not in the region.",
    ),
    selectName,
    selectPattern,
    selectCond,
    selectRegion,
    selectCount,
  );
  const selectOkBtn = btn(
    "Select",
    "Select the matching puppets (Enter)",
    () => void applySelection(),
    "filled",
  );
  async function applySelection(): Promise<void> {
    if (selectOkBtn.hasAttribute("loading")) return;
    const match = selectName.value;
    const pattern = selectPattern.value.trim();
    if (match !== "any" && !pattern) {
      toast("Enter a name or regex", "error");
      return;
    }
    let nameOk: (n: string) => boolean;
    if (match === "regex") {
      let re: RegExp;
      try {
        re = new RegExp(pattern, "i"); /* no g flag: test() keeps no state between calls */
      } catch (e) {
        toast(`Invalid regex — ${e instanceof Error ? e.message : String(e)}`, "error");
        return;
      }
      nameOk = (n) => re.test(n);
    } else if (match === "contains") {
      const needle = canon(pattern);
      nameOk = (n) => n.includes(needle);
    } else nameOk = () => true;
    const cond = selectCond.value;
    const region = canon(selectRegion.value.trim());
    if (cond !== "any" && !region) {
      toast("Enter a region name", "error");
      return;
    }
    const countText = selectCount.value.trim();
    if (countText && !(/^\d+$/.test(countText) && Number(countText) >= 1)) {
      toast("Count must be a whole number ≥ 1", "error");
      return;
    }
    if (cond !== "any") {
      selectOkBtn.setAttribute("loading", "");
      try {
        const res = await readRegionNations(region);
        if (!res.ok) {
          toast(res.busy ? NS_BUSY_MSG : `Region lookup failed — ${res.message}`, "error");
          return;
        }
        if (setRegionResidents(region, res.value)) ctx.paint();
      } finally {
        selectOkBtn.removeAttribute("loading");
      }
      if (!selectDlg.open) return; // cancelled while the read was in flight: cache updated, selection untouched
    }
    const names = viewNames();
    const picked = names
      .filter(
        (n) =>
          nameOk(n) &&
          (cond === "in"
            ? state.regions[n] === region
            : cond === "not-in"
              ? state.regions[n] !== region
              : true),
      )
      .slice(0, countText ? Number(countText) : undefined);
    if (!picked.length) {
      toast("No puppets match", "error");
      return;
    }
    ctx.selection = new Set(picked);
    ctx.hl = names.indexOf(picked.find((n) => !state.nations[n].locked) ?? picked[0]);
    resetRun(ctx);
    selectDlg.open = false;
    ctx.paint();
    const locked = picked.filter((n) => state.nations[n].locked).length;
    toast(
      `${picked.length} puppet(s) selected${locked ? ` · ${locked} locked (runs skip them)` : ""}`,
    );
  }
  const selectDlg = modal(
    { headline: "Select puppets" },
    selectFields,
    btn(
      "Cancel",
      "Close without changing the selection",
      () => {
        selectDlg.open = false;
      },
      "text",
    ),
    selectOkBtn,
  );
  selectDlg.addEventListener("opened", () => selectPattern.focus());
  for (const field of [selectPattern, selectRegion, selectCount]) {
    field.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") void applySelection();
    });
  }
  /* Field values are kept between openings for repeated use. */
  selectBtn.onclick = () => {
    if (!rosterOrToast()) return;
    selectDlg.open = true;
  };
  moveSelBtn.onclick = () => {
    if (!ctx.selection) return;
    openMoveDialog(
      [...ctx.selection],
      `Move ${ctx.selection.size} selected puppet(s) to folder`,
      DEFAULT_FOLDER_ID,
    );
  };
  clearSelBtn.onclick = () => {
    ctx.selection = null;
    ctx.paint();
    toast("Selection cleared");
  };

  /* Shuffles the shown puppets within the slots they hold in the whole roster order, so puppets in
   * other folders keep their positions. */
  shuffleBtn.onclick = () => {
    const prevAll = nationNames();
    const view = rosterOrToast();
    if (!view) return;
    const shuffled = view.slice();
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const inView = new Set(view);
    let k = 0;
    const merged = prevAll.map((n) => (inView.has(n) ? shuffled[k++] : n));
    setRosterOrder(merged);
    ctx.hl = 0;
    resetRun(ctx);
    ctx.paint();
    undoToast(
      ctx,
      state.activeFolders.length === state.folders.length
        ? "Roster shuffled"
        : state.activeFolders.length === 1
          ? `${folderName(state.activeFolders[0])} shuffled`
          : `${state.activeFolders.length} folders shuffled`,
      () => setRosterOrder(prevAll),
    );
  };

  findWaBtn.onclick = async () => {
    if (findWaBtn.hasAttribute("loading")) return;
    if (!rosterOrToast()) return;
    findWaBtn.setAttribute("loading", "");
    try {
      const res = await readWaMembers();
      if (!res.ok) {
        toast(res.busy ? NS_BUSY_MSG : `Find WA failed — ${res.message}`, "error");
        return;
      }
      const hits = viewNames().filter((n) => res.value.has(n));
      if (!hits.length) {
        toast(`No puppet in ${viewScope()} is in the WA`);
        return;
      }
      jumpTo(hits[0]);
      scrollToCurrent();
      toast(`WA nation: ${hits.join(", ")}`);
    } finally {
      findWaBtn.removeAttribute("loading");
    }
  };

  copyMissing.onclick = () => {
    const missing = viewNames().filter(needsAuth);
    if (!missing.length) {
      toast(`Every puppet in ${viewScope()} has stored auth`);
      return;
    }
    copyText(missing.join("\n"), `${missing.length} missing puppet names copied`);
  };

  /* Destructive wipe. MDUI dialog, not window.confirm(): the shell is themed and a native dialog
   * would escape that. Built once per page load and reused — the page renders exactly once. */
  const clearDlg = modal(
    {
      headline: "Clear the whole roster?",
      description:
        "Removes every imported puppet with its stored chk/localid, password override, known region and cached population. The main nation, the global password, keybinds, theme and embassy whitelist are kept. Folders are kept. This cannot be undone.",
    },
    null,
    btn(
      "Cancel",
      "Keep the roster",
      () => {
        clearDlg.open = false;
      },
      "text",
    ),
    btn(
      "Clear roster",
      "Permanently remove every roster puppet",
      () => {
        clearDlg.open = false;
        const n = Object.keys(state.nations).length;
        resetRun(ctx);
        clearNations();
        ctx.selection = null;
        ctx.hl = 0;
        ctx.paint();
        toast(`${n} puppets cleared`);
      },
      "filled",
    ),
  );
  /* Clear always wipes the whole roster, whatever folder is shown. */
  clearBtn.onclick = () => {
    if (!nationNames().length) {
      toast(NO_PUPPETS, "error");
      return;
    }
    clearDlg.open = true;
  };

  return {
    section: collapsibleSection("manage-roster", "Roster", rosterCard, ROSTER_NOTE),
    paint(names) {
      paintFolders();
      if (ctx.hl > names.length - 1) ctx.hl = Math.max(0, names.length - 1);
      moveSelBtn.hidden = ctx.selection === null;
      clearSelBtn.hidden = ctx.selection === null;
      paintRoster(names);
    },
    jumpTo,
    scrollToCurrent,
  };
}
