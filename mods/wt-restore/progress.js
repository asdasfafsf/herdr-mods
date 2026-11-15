// Queue presentation only. No terminal discovery, commands, timers or agent status.
import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

const ACTIVE = new Set(["checking", "waiting", "restoring"]);
const FINAL = new Set(["complete", "partial", "failed", "interrupted", "cancelled"]);
export const activeProgress = (state) => ACTIVE.has(state?.phase);
export const finalProgress = (state) => FINAL.has(state?.phase);
export const RESULT_MS = 10000;

// One controller per script build; every copy (including the dialog) uses it.
// Shared snapshots survive layout/app refresh. A new build never replays a queue
// from that snapshot, and an old async completion cannot overwrite its replacement.
export class RestoreProgress {
  constructor(read, write, now = () => Date.now()) {
    this.read = read;
    this.write = write;
    this.now = now;
    this.owner = `${now()}-${Math.random()}`;
    this.sequence = 0;
  }

  startup() {
    if (this.started) return ["checking", "waiting"].includes(this.read()?.phase) ? this.read().id : null;
    this.started = true;
    const previous = this.read();
    if (["restoring", "ready"].includes(previous?.phase)) {
      this.write({ ...previous, owner: this.owner, phase: "interrupted", inFlight: 0,
        uncertain: previous.inFlight || 0, ended: this.now(),
        detail: "Restore was interrupted. Check the sessions before trying again." });
      return null;
    }
    return this.begin("checking");
  }

  begin(phase, extra = {}) {
    const id = ++this.sequence;
    this.write({ owner: this.owner, id, phase, total: null, processed: 0,
      sent: 0, dispatched: 0, failed: 0, unknown: 0, inFlight: 0, ended: null,
      offeredCore: this.read()?.offeredCore ?? null, ...extra });
    return id;
  }

  owns(id) { const s = this.read(); return s?.owner === this.owner && s.id === id; }
  current() { const s = this.read(); return !s || s.owner === this.owner; }

  update(id, extra) {
    if (!this.owns(id)) return false;
    this.write({ ...this.read(), ...extra });
    return true;
  }

  finish(id, phase, extra = {}) {
    return this.update(id, { phase, inFlight: 0, ended: this.now(), ...extra });
  }

  interrupt() {
    const s = this.read();
    if (s?.owner !== this.owner || !activeProgress(s)) return;
    // Invalidate the token before any suspended request returns. That request may
    // already have reached the shell; it must neither be replayed nor counted done.
    this.finish(s.id, "interrupted", { id: ++this.sequence, uncertain: s.inFlight,
      detail: "Restore was interrupted. Check the sessions before trying again." });
  }

  expire() {
    const s = this.read();
    if (finalProgress(s) && this.now() - s.ended >= RESULT_MS && !s.hidden)
      this.write({ ...s, hidden: true });
  }
}

export function progressText(s) {
  const pending = Math.max(0, (s.total ?? 0) - s.processed - s.inFlight - (s.uncertain || 0));
  const count = s.total === null ? "" : `${s.processed}/${s.total} processed`;
  let title, detail;
  switch (s.phase) {
    case "checking": title = "Checking sessions…"; detail = "Looking for sessions to restore"; break;
    case "waiting": title = "Waiting for startup…"; detail = "Waiting for Herdr to finish starting"; break;
    case "ready": title = "Session restore ready"; detail = `${s.total} session${s.total === 1 ? "" : "s"} awaiting your choice`; break;
    case "restoring": title = `Restoring sessions · ${count}`; detail = `${s.inFlight} opening now · ${pending} waiting to open`; break;
    case "complete": title = s.total ? `Restore requests finished · ${count}` : s.candidatesChecked ? "Session check complete" : "Startup check finished";
      detail = s.total ? "Requests sent; agents may still be opening" : s.candidatesChecked ? "No stopped sessions found" : ""; break;
    case "partial": title = `Restore incomplete · ${count}`; break;
    case "failed": title = s.total === null ? "Session check failed" : `Restore failed · ${count}`; break;
    case "interrupted": title = "Session restore interrupted"; break;
    case "cancelled": title = "Session restore skipped"; detail = "No restore requests sent"; break;
    default: return null;
  }
  const requested = s.sent + s.dispatched;
  const outcomes = s.total ? [requested ? `${requested} opening requested` : "",
    s.failed - (s.unknown || 0) > 0 ? `${s.failed - (s.unknown || 0)} failed` : "", s.unknown ? `${s.unknown} needs checking` : "",
    finalProgress(s) && pending ? `${pending} not attempted` : "",
    s.uncertain ? `${s.uncertain} outcome unknown` : ""].filter(Boolean).join(" · ") : "";
  detail = [detail, outcomes, s.detail].filter(Boolean).join(" · ");
  return { title, detail, active: activeProgress(s), attention: ["partial", "failed", "interrupted"].includes(s.phase) };
}

export function renderProgress(s, t, dismiss) {
  const text = s && !s.hidden && progressText(s);
  if (!text) return div().id("wt-restore");
  const color = text.attention ? t.blocked : text.active ? t.accent : t.muted;
  return h_flex().id("wt-restore-progress").w(360).m(10).px(12).py(10).gap(10)
    .items_center().rounded(8).border(1).border_color(t.border).bg(t.popover)
    .tooltip("Progress counts opening requests. Agents may still be opening after a request finishes.")
    .when(text.active, el => el.child(svg("mods/workspace-chrome/spinner.svg").size(14).flex_none().text_color(color).spin(900)))
    .when(!text.active, el => el.child(div().size(7).flex_none().rounded(4).bg(color)))
    .child(v_flex().flex_1().min_w(0).gap(3)
      .child(div().text_size(12).font_semibold().text_color(t.foreground).child(text.title))
      .child(div().text_size(11).text_color(t.muted).child(text.detail)))
    .when(finalProgress(s) && Boolean(dismiss), el => el.child(div().id("restore-progress-dismiss")
      .flex_none().px(4).py(2).rounded(4).text_size(12).text_color(t.muted).cursor_pointer()
      .hover(el => el.bg(t.hover)).tooltip("Dismiss restore status")
      .on_click((_e, cx) => { cx.stop_propagation(); dismiss(); }).child("×")));
}
