/* "Login to all": one API `ping` per roster puppet (X-Password), sequential, paced by the
 * RateLimit-* headers of each response. Top-bar button + a live progress dialog. */
import { RELOAD_GAP_MS } from "../constants";
import { type PingResult, pingNation } from "../net";
import { nationNames, passwordFor } from "../state";
import { sleep } from "../utils";
import { btn, el, hint, modal, nationListItem } from "./dom";
import { toast } from "./mdui";

let running = false;
let stopRequested = false;

function finalLabel(res: PingResult): string {
  switch (res.kind) {
    case "ok":
      return "logged in";
    case "recent":
      return "already logged in moments ago (409)";
    case "forbidden":
      return "login refused (403)";
    case "not-found":
      return "nation does not exist (404)";
    case "busy":
      return "NS busy (502/empty) — not logged in";
    default:
      return res.status === 0 ? "network error" : `unexpected response (HTTP ${res.status})`;
  }
}

function guardUnload(e: BeforeUnloadEvent): void {
  e.preventDefault();
}

export function mountLoginAllButton(): HTMLElementTagNameMap["mdui-button"] {
  const button = btn(
    "Login to all",
    "Log every roster puppet in via the NS API (ping)",
    () => onClick(),
    "tonal",
  );
  button.id = "bq-login-all";
  button.setAttribute("data-bq-walk", "login-all");
  button.setAttribute("icon", "login--outlined");

  const progress = el("mdui-linear-progress", { value: 0, max: 1 });
  const summary = hint("");
  const list = el("mdui-list", { class: "bq-login-list" });
  const fields = el("div", { class: "bq-dialog-fields" }, progress, summary, list);
  const stopBtn = btn(
    "Stop",
    "Stop logging in the remaining puppets",
    () => {
      stopRequested = true;
      stopBtn.disabled = true;
    },
    "text",
  );
  stopBtn.disabled = true;
  const closeBtn = btn(
    "Close",
    "Close this dialog",
    () => {
      dlg.open = false;
    },
    "filled",
  );
  const dlg = modal({ headline: "Login to all" }, fields, stopBtn, closeBtn);

  function onClick(): void {
    if (running) {
      dlg.open = true;
      return;
    }
    if (location.protocol !== "https:") {
      toast("Login to all needs HTTPS — reopen Bouquet over https://", "error");
      return;
    }
    const names = nationNames();
    if (!names.length) {
      toast("No puppets to log in — import some first", "error");
      return;
    }
    void run(names);
  }

  async function run(names: string[]): Promise<void> {
    running = true;
    stopRequested = false;
    stopBtn.disabled = false;
    window.addEventListener("beforeunload", guardUnload);

    const rows = new Map<string, HTMLElement>();
    const finished = new Set<string>();
    list.replaceChildren();
    for (const name of names) {
      const row = nationListItem(name, " — queued");
      rows.set(name, row);
      list.appendChild(row);
    }
    function setRow(name: string, text: string): void {
      const row = nationListItem(name, ` — ${text}`);
      rows.get(name)?.replaceWith(row);
      rows.set(name, row);
    }
    progress.setAttribute("max", String(names.length));
    progress.setAttribute("value", "0");

    let done = 0;
    let ok = 0;
    let failed = 0;
    let rateHits = 0;
    let endReason = "";

    function paint(wait?: { reason: string; secs: number }): void {
      progress.setAttribute("value", String(done));
      button.textContent = running ? `Login to all ${done}/${names.length}` : "Login to all";
      summary.textContent = `${done}/${names.length} · ${ok} logged in · ${failed} failed${wait ? ` · ${wait.reason} — next request in ${wait.secs}s` : ""}`;
    }
    async function countdown(ms: number, reason: string): Promise<void> {
      while (ms > 0 && !stopRequested) {
        paint({ reason, secs: Math.ceil(ms / 1000) });
        const slice = Math.min(1000, ms);
        await sleep(slice);
        ms -= slice;
      }
      paint();
    }
    function finish(name: string, text: string, success: boolean): void {
      setRow(name, text);
      finished.add(name);
      if (success) ok++;
      else failed++;
      done++;
      paint();
    }

    paint();
    dlg.open = true;
    try {
      outer: for (let i = 0; i < names.length; i++) {
        const name = names[i];
        if (stopRequested) {
          endReason ||= "stopped";
          break;
        }
        const password = passwordFor(name);
        if (!password) {
          finish(
            name,
            `no password — set a global password in Settings or import ${name}:password`,
            false,
          );
          continue;
        }
        setRow(name, "logging in…");
        let busyRetries = 0;
        let pending = 0;
        for (;;) {
          const res = await pingNation(name, password);
          if (res.kind === "rate-limited") {
            rateHits++;
            if (rateHits >= 2) {
              finish(name, "rate limited (429) — run ended", false);
              endReason = "ended after a second 429 (avoids a 15-min API lockout)";
              stopRequested = true;
              break outer;
            }
            setRow(name, "rate limited (429) — will retry");
            await countdown(res.waitMs, "rate limited (429)");
            if (stopRequested) break outer;
            continue;
          }
          if (res.kind === "busy" && busyRetries < 2) {
            busyRetries++;
            setRow(name, `NS busy — retry ${busyRetries}/2`);
            await countdown(Math.max(res.waitMs, RELOAD_GAP_MS), "NS busy");
            if (stopRequested) break outer;
            continue;
          }
          finish(
            name,
            `${finalLabel(res)}${res.detail ? ` — ${res.detail}` : ""}`,
            res.kind === "ok" || res.kind === "recent",
          );
          pending = res.waitMs;
          break;
        }
        if (pending > 0 && i < names.length - 1 && !stopRequested) {
          await countdown(pending, "rate limit");
        }
      }
    } finally {
      for (const name of names) {
        if (!finished.has(name)) setRow(name, endReason || "stopped");
      }
      running = false;
      stopRequested = false;
      stopBtn.disabled = true;
      window.removeEventListener("beforeunload", guardUnload);
      paint();
      toast(
        `Login to all: ${ok} logged in · ${failed} failed${done < names.length ? ` · ${endReason || "stopped"} at ${done}/${names.length}` : ""}`,
        failed || done < names.length ? "error" : "info",
      );
    }
  }

  return button;
}
