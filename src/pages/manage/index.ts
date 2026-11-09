/* Manage tab: the roster, the names/passwords import box, and per-puppet pipeline runs. */
import { state, viewNames } from "../../state";
import { refreshStatus } from "../../ui/dom";
import { createCtx, refreshRosterPopulations } from "./ctx";
import { createPipeline } from "./pipeline";
import { createRevive } from "./revive";
import { createRoster } from "./roster";
import { createRun } from "./run";

export function renderManage(main: HTMLElement, bar: HTMLElement): void {
  const ctx = createCtx();
  const revive = createRevive(ctx);
  const roster = createRoster(ctx, revive);
  const pipeline = createPipeline(ctx);
  const run = createRun(ctx, { main, bar, revive, roster, pipeline });
  ctx.paintBoard = pipeline.paintBoard;
  ctx.paintRunBar = run.paintRunBar;
  /* Roster, status line, pipeline (its login warning and ▸ outline follow `hl`), run panel, revive. */
  ctx.paint = () => {
    roster.paint(viewNames());
    refreshStatus();
    pipeline.paintBoard();
    run.paintRunBar();
    revive.paint();
  };
  main.append(roster.section, ...pipeline.sections);
  pipeline.paintPool();
  ctx.paint();
  refreshRosterPopulations(ctx);
  if (state.reviveMissing) revive.ensure();
}
