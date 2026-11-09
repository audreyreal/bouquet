/* Manage drag-and-drop: one in-memory payload for pool cards, pipeline cards and roster rows. */
import type { ActionDef } from "../../actions";

export type Dragging =
  | { from: "pool"; type: ActionDef["type"] }
  | { from: "pipeline"; index: number }
  | { from: "roster"; name: string };

const DRAG_MIME = "text/bouquet-drag";
let dragging: Dragging | null = null;

/* Makes `node` a drag source for `what`. */
export function makeDraggable(node: HTMLElement, what: Dragging): void {
  node.draggable = true;
  node.addEventListener("dragstart", (event: DragEvent) => {
    if (!event.dataTransfer) return;
    event.dataTransfer.setData(
      DRAG_MIME,
      "1",
    ); /* Firefox starts no drag without data; a custom MIME never lands in text fields */
    event.dataTransfer.effectAllowed = what.from === "pool" ? "copy" : "move";
    dragging = what;
    if (what.from === "pipeline") node.classList.add("bq-step-dragging");
  });
  node.addEventListener("dragend", endDrag);
}
/* The drag in progress, only if it is ours (a stale `dragging` must not accept a file drag). */
export function activeDrag(event: DragEvent): Dragging | null {
  return event.dataTransfer?.types.includes(DRAG_MIME) ? dragging : null;
}
/* dragover body for a target that accepts the drag. */
export function allowDrop(event: DragEvent): void {
  event.preventDefault();
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = dragging?.from === "pool" ? "copy" : "move";
}
export function isAfter(event: DragEvent, node: HTMLElement): boolean {
  const r = node.getBoundingClientRect();
  return event.clientY >= r.top + r.height / 2;
}
function clearMarks(root: ParentNode): void {
  root.querySelectorAll(".bq-drop-before,.bq-drop-after").forEach((n) => {
    n.classList.remove("bq-drop-before", "bq-drop-after");
  });
}
/* Moves the single drop indicator inside `list` onto `node`. */
export function markDrop(list: HTMLElement, node: HTMLElement, after: boolean): void {
  clearMarks(list);
  node.classList.add(after ? "bq-drop-after" : "bq-drop-before");
}
/* Dragging out of `list` (not into a child) clears its indicator. */
export function clearMarksOnLeave(list: HTMLElement): void {
  list.addEventListener("dragleave", (e: DragEvent) => {
    if (!(e.relatedTarget instanceof Node) || !list.contains(e.relatedTarget)) clearMarks(list);
  });
}
/* Drop and dragend both call this: paintBoard() replaces the dragged card, which may never get dragend. */
export function endDrag(): void {
  dragging = null;
  document
    .querySelectorAll(".bq-step-dragging,.bq-drop-before,.bq-drop-after,.bq-drop-folder")
    .forEach((n) => {
      n.classList.remove("bq-step-dragging", "bq-drop-before", "bq-drop-after", "bq-drop-folder");
    });
}
