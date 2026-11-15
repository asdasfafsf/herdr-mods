// usage-bar (herdr-mods): Claude Code's and Codex's plan limits at the left end of the
// bottom bar, as Orca shows them, all in one pill: "[Claude] 5h ▓░ 45% resets in 2h 10m · 7d … |
// [Codex] 7d …", and a Refresh button at the end.
//
// The numbers come from usage.py next to this file: Claude's structured usage (including
// Fable) and Codex's limits, asked every 5 minutes or on Refresh, plus Claude's status-line
// snapshots and Codex's session rollouts. Numbers dim once they're over an hour old, and
// a window whose reset time has passed says "reset" (how much is used since is unknown
// until that agent's numbers move again). Each window says how long until it resets
// ("4h 12m", "6d 14h"). Used 80% or more shows in the working color, all of it in the
// blocked color. Hover: each reset's clock time (weekday this week, else the date) and how
// old the numbers are. Click: the same, with bars.
//
// It sits before the shipped workspace-status in a row of the layout (see README), drawn
// with the same background and border so the two read as one bar.

import { View, div, image, svg } from "gpui-kit";
import { v_flex, h_flex, Accordion, AccordionItem, AccordionHeader, AccordionTrigger, AccordionPanel } from "gpui-base";
import { exec, appHome, theme, props, openOverlay, closeOverlay } from "herdr";
import { agoText, button } from "./ui.js";

const EVERY = 30000;
const AGENTS = [["claude", "Claude", "icons/claude.svg"], ["codex", "Codex", "icons/codex.svg"]];
const P = () => props() ?? {};
const resetCount = (summary) => Number.isInteger(summary?.availableCount) && summary.availableCount >= 0 ? summary.availableCount : null;
const resetCountLabel = (count) => count === null ? "Unavailable" : `${count} available`;
const resetCreditTip = (summary) => `Reset credits: ${resetCountLabel(resetCount(summary))}${resetCount(summary) !== null && Number.isFinite(summary?.updated) ? ` (as of ${agoText(summary.updated)})` : ""}`;

// Leave room for expanded details without sizing the popup to the credit list.
// GPUI's drawable viewport is in logical pixels, like overlay dimensions.
const detailSize = (usage) => {
  const parts = AGENTS.filter(([key]) => usage[key]);
  const count = parts.reduce((n, [key]) => n + usage[key].windows.length, 0);
  const viewport = window.viewport_size();
  const height = Math.max(620, Math.min(800, 192 + parts.length * 56 + count * 76 + (usage.codex ? 72 : 0)));
  return {
    width: Math.min(480, Math.max(1, viewport.width - 32)),
    height: Math.min(height, Math.max(1, viewport.height - 32)),
  };
};

const when = (s) => {
  if (!s) return "";
  const d = new Date(s * 1000), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return d.toDateString() === now.toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};
const passed = (w) => Boolean(w.resets) && w.resets * 1000 < Date.now();
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
// When a window resets, as the bar says it: "18:00" today, "Fri 22:49" within six days
// (a weekday that can't mean this week's), else "11/10 10:00".
const at = (s) => {
  const d = new Date(s * 1000), now = new Date();
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (d.toDateString() === now.toDateString()) return hm;
  const days = Math.round((new Date(d.toDateString()) - new Date(now.toDateString())) / 86400000);
  return days < 7 && days > 0 && d.getDay() !== now.getDay() ? `${DAYS[d.getDay()]} ${hm}` : `${d.getMonth() + 1}/${d.getDate()} ${hm}`;
};
// How long until a reset, as the bar says it: "38m", "4h 12m", "6d 14h" (the clock time,
// at(), is on hover and in the detail). Down to the minute: the bar reads every 30 s.
const until = (s) => {
  const mins = Math.max(1, Math.floor((s - Date.now() / 1000) / 60));
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return m ? `${h}h ${m}m` : `${h}h`;
  const d = Math.floor(h / 24), hh = h % 24;
  return hh ? `${d}d ${hh}h` : `${d}d`;
};

export default class UsageBar extends View {
  init(_props, cx) {
    this.usage = P().usage ?? null; // the detail popup starts with what the bar read
    this.resetCreditsExpanded = false; // local to this popup; reopening starts with the count
    if (P().mode === "detail") this.resetCreditsFocus = cx.focus_handle();
    // ...and reads on as the bar does, so one left open doesn't show numbers from when it opened.
    this.read(cx);
    cx.timer.every(EVERY, (cx) => this.read(cx));
  }

  // Manual refresh reports direct-query outcomes, even when cached limits are usable.
  read(cx, now = false) {
    if (this.reading || this.resetting) return;
    this.reading = true;
    if (now) { this.refreshing = true; this.refreshed = 0; cx.notify(); }
    cx.spawn(async (cx) => {
      try {
        const r = await exec("python3", ["-I", `${appHome()}/mods/usage-bar/usage.py`, ...(now ? ["--now"] : [])]);
        if (r.code !== 0) throw new Error(`Usage reader exited ${r.code}`);
        const data = JSON.parse(r.stdout);
        if (!data || Array.isArray(data) || !AGENTS.every(([key]) => Object.prototype.hasOwnProperty.call(data, key) && (data[key] === null || (Array.isArray(data[key]?.windows) && data[key].windows.every((w) => w && typeof w.name === "string" && Number.isFinite(w.used)))))) throw new Error("Invalid usage response");
        this.usage = data;
        if (now) {
          const succeeded = AGENTS.filter(([key]) => data.refresh?.[key]?.ok === true).length;
          this.refreshResult = succeeded === AGENTS.length ? "Updated" : succeeded ? "Partial" : "Failed";
          this.readError = AGENTS.filter(([key]) => data.refresh?.[key]?.ok !== true).map(([key, name]) => `${name}: ${data.refresh?.[key]?.error || "No fresh reading"}`).join("; ");
        } else if (this.refreshResult !== "Failed" && this.refreshResult !== "Partial") this.readError = null;
      } catch (error) {
        this.readError = String(error.message ?? error);
        if (now) this.refreshResult = "Failed";
      } finally {
        this.reading = false;
        if (now) {
          this.refreshing = false;
          this.refreshed = Date.now();
          cx.timer.after(2500, (cx) => cx.notify());
        }
        cx.notify();
      }
    });
  }

  // A window's color: the accent while there's room, the working color from 80%, the
  // blocked color when it's used up; dim once it has reset.
  tone(w, t) {
    if (passed(w)) return t.dim;
    return w.used >= 100 ? t.blocked : w.used >= 80 ? t.working : t.accent;
  }

  tip(name, u) {
    const lines = u.windows.map((w) => `${w.name}: ${passed(w) ? "reset since" : `${Math.round(w.used)}% used`}${w.resets ? `, ${passed(w) ? `reset at ${when(w.resets)}` : `resets in ${until(w.resets)} (${at(w.resets)})`}` : ""}`);
    if (name === "Codex") lines.push(resetCreditTip(u.resetCredits));
    return `${name}${u.plan ? ` (${u.plan})` : ""}\n${lines.join("\n")}\nas of ${agoText(u.updated)}`;
  }

  // One agent in the bar, all of it in view: its icon, then per window its name, a small
  // bar, the share used and how long until it resets ("5h ▓░ 45% resets in 2h 10m"); a window past its
  // reset says "reset". Numbers older than an hour are dimmed (how old shows on hover).
  item(key, name, icon, u, t, compact = false, narrow = false) {
    const old = Date.now() / 1000 - u.updated > 3600;
    const win = (w) => {
      const pct = passed(w) ? 0 : Math.max(0, Math.min(100, w.used));
      return h_flex().gap(6).items_center()
        .child(div().text_color(t.muted).child(w.name))
        .when(!narrow, (el) => el.child(div().w(28).h(5).flex_none().rounded(3).bg(t.border).child(div().h_full().w(`${pct}%`).rounded(3).bg(this.tone(w, t)))))
        .child(div().font_semibold().text_color(passed(w) ? t.dim : w.used >= 80 ? this.tone(w, t) : t.foreground).child(passed(w) ? "reset" : `${Math.round(w.used)}%`))
        .when(!narrow && Boolean(w.resets) && !passed(w), (el) => el.child(h_flex().gap(4).items_center()
          .when(!compact, (el) => el.child(div().text_color(t.dim).child("resets in")))
          .child(div().text_color(t.foreground).child(until(w.resets)))));
    };
    // One agent's part of the pill (see pill): its icon, then its windows; its own hover.
    return h_flex().id(`usage-${key}`).flex_none().gap(9).items_center().tooltip(this.tip(name, u))
      .child(image(icon).size(12).flex_none())
      .children(u.windows.flatMap((w, i) => [...(i ? [div().text_color(t.dim).child("·")] : []), win(w)]))
      .when(old, (el) => el.opacity(0.55));
  }

  // Every agent's numbers in one pill, a thin line between agents, so they read as one
  // item apart from the bar's others. Click: the detail popup.
  pill(u, t) {
    const parts = AGENTS.filter(([k]) => u[k]);
    if (!parts.length) return null;
    // Budget against the actual block width, including icons, gaps and Refresh. Four
    // windows already overflow a 720px block with full countdown labels. On narrower
    // blocks keep names and percentages; reset times remain on hover and in detail.
    const count = parts.reduce((n, [k]) => n + u[k].windows.length, 0);
    const width = (this.width ?? 720) - (u.codex ? 45 : 0);
    const compact = width < 120 + count * 180;
    const narrow = width < 120 + count * 125;
    // Bound the pill so Refresh stays visible. Limits can scroll horizontally;
    // the reset count stays pinned at the trailing edge, even in a narrow block.
    return h_flex().id("usage-pill").min_w(0).max_w(Math.max(100, (this.width ?? 720) - 116)).h(20).px(9).rounded(6).bg(t.hover).hover((s) => s.bg(t.selected)).gap(10).items_center().cursor_pointer()
      // Size for the collapsed summary, never for a potentially long credit list.
      .on_click(() => openOverlay({ mod: "usage-bar", kind: "popup", ...detailSize(this.usage ?? {}), props: { mode: "detail", usage: this.usage } }))
      .child(h_flex().id("usage-limits").min_w(0).overflow_x_scroll().gap(10).items_center()
        .tooltip("Scroll horizontally for more limits; click for details")
        .children(parts.flatMap(([k, name, icon], i) => [...(i ? [div().w(1).h(12).flex_none().bg(t.border)] : []), this.item(k, name, icon, u[k], t, compact, narrow)])))
      .when(Boolean(u.codex), (el) => el.child(div().id("usage-reset-count").flex_none().pl(8).border_l(1).border_color(t.border)
        .text_color(resetCount(u.codex.resetCredits) > 0 ? t.accent : t.muted)
        .tooltip(`Codex · ${resetCreditTip(u.codex.resetCredits)}`)
        .child(`↺ ${resetCount(u.codex.resetCredits) ?? "—"}`)));
  }

  renderDetail(t) {
    const u = this.usage ?? {};
    const size = detailSize(u);
    const bar = (w) => {
      const pct = passed(w) ? 0 : Math.max(0, Math.min(100, w.used));
      return v_flex().flex_none().min_w(0).gap(6)
        .child(h_flex().flex_none().min_w(0).gap(10).justify_between().items_start().text_size(12)
          .child(div().flex_1().min_w(0).whitespace_normal().text_color(t.muted).child(w.name))
          .child(div().flex_none().text_color(this.tone(w, t)).child(passed(w) ? "reset since" : `${Math.round(w.used)}%`)))
        .child(div().flex_none().h(5).w_full().rounded(3).bg(t.hover).child(div().h_full().w(`${pct}%`).rounded(3).bg(this.tone(w, t))))
        .when(Boolean(w.resets), (el) => el.child(div().flex_none().min_w(0).whitespace_normal().text_size(11).text_color(t.dim).child(passed(w) ? `reset at ${when(w.resets)}` : `resets in ${until(w.resets)} · ${at(w.resets)}`)));
    };
    return v_flex().id("usage-detail").w(size.width).h(size.height).min_w(0).min_h(0).max_w_full().max_h_full().p(18).gap(18).bg(t.popover).text_size(12.5)
      .child(h_flex().flex_none().items_center().gap(8)
        .child(div().flex_1().min_w(0).whitespace_normal().font_semibold().text_color(t.foreground).child("Usage & limits"))
        .child(button("usage-close", "Close", () => closeOverlay(P().overlay), t, { disabled: this.resetting })))
      .child(v_flex().id("usage-detail-scroll").flex_1().min_w(0).min_h(0).overflow_y_scroll().gap(20)
      .children(AGENTS.filter(([k]) => u[k]).map(([k, name, icon]) => v_flex().flex_none().min_w(0).gap(12)
        .child(h_flex().flex_none().min_w(0).flex_wrap().gap(7).items_start()
          .child(h_flex().flex_1().min_w(120).max_w_full().gap(7).items_start()
            .child(image(icon).size(14).flex_none())
            .child(div().flex_1().min_w(0).whitespace_normal().font_semibold().text_color(t.foreground).child(`${name}${u[k].plan ? ` · ${u[k].plan}` : ""}`)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(agoText(u[k].updated))))
        .children(u[k].windows.map(bar))
        .when(k === "codex", (el) => el.child(this.renderResetCredits(u[k].resetCredits, t)))
        // Why these may be old: the last ask failed (offline, logged out, no answer).
        .when(Boolean(u[k].error), (el) => el.child(div().flex_none().min_w(0).whitespace_normal().text_size(11).text_color(t.blocked).child(`Couldn't ask just now: ${u[k].error}`)))))
      .when(!AGENTS.some(([k]) => u[k]), (el) => el.child(div().flex_none().min_w(0).whitespace_normal().text_color(t.dim).child("No usage seen yet: it shows once Claude Code or Codex has run."))))
      .when(Boolean(this.resetNotice), (el) => el.child(div().whitespace_normal().text_size(11).text_color(this.resetFailed ? t.working : t.accent).child(this.resetNotice)))
      .when(Boolean(this.resetLogPath), (el) => el.child(div().truncate().tooltip(this.resetLogPath).text_size(10.5).text_color(t.dim).child(`Reset log: ${this.resetLogPath}`)))
      .when(this.resetCreditsExpanded && Boolean(this.resetChoice), (el) => el.child(v_flex().p(10).gap(8).rounded(6).bg(t.hover)
        .child(div().whitespace_normal().text_size(12).text_color(t.foreground).child(`Use “${this.resetChoice.title || "Reset credit"}” to reset Codex limits?`))
        .child(h_flex().gap(6).justify_end()
          .child(button("reset-cancel", "Cancel", (cx) => { this.resetChoice = null; cx.notify(); }, t, { disabled: this.resetting }))
          .child(button("reset-confirm", this.resetting ? "Resetting…" : "Use reset credit", (cx) => this.useResetCredit(cx), t, { kind: "primary", disabled: this.resetting || this.reading })))))
      .child(h_flex().flex_none().justify_end().child(this.refreshButton(t)));
  }

  renderResetCredits(summary, t) {
    const expanded = Boolean(this.resetCreditsExpanded);
    const count = resetCount(summary);
    const action = expanded ? "Hide details" : "Show details";
    // The native trigger carries expanded semantics but its materializer does
    // not bind focus/key handlers or state styles. Put those on a plain child.
    const control = h_flex().id("reset-credits-control").w_full().min_w(0).min_h(48).px(12).py(10).flex_wrap().items_center().gap(8).rounded(8)
      .bg(t.hover).border(1).border_color(t.border).cursor_pointer()
      .hover((s) => s.bg(t.selected)).focus((s) => s.border_color(t.accent))
      .when(Boolean(this.resetCreditsFocus), (el) => el.track_focus(this.resetCreditsFocus).tab_stop(true))
      .role("group").accessibility_label(`Reset credits: ${resetCountLabel(count)}. ${expanded ? "Expanded" : "Collapsed"}. ${action}`)
      .on_key_down((event, cx) => {
        if (!["enter", "space", " "].includes(event.key) || Object.values(event.modifiers ?? {}).some(Boolean)) return;
        cx.stop_propagation();
        if (!event.is_held) this.setResetCreditsExpanded(!this.resetCreditsExpanded, cx);
      })
      .child(div().flex_1().min_w(80).max_w_full().whitespace_normal().font_semibold().text_color(t.foreground).child("Reset credits"))
      .child(div().flex_none().px(6).py(2).rounded(5).bg(t.popover).text_size(11)
        .font_medium().text_color(count > 0 ? t.accent : t.muted).child(resetCountLabel(count)))
      .child(div().flex_none().text_size(10.5).text_color(t.muted).child(action))
      .child(div().flex_none().text_color(t.muted).child(expanded ? "▾" : "▸"));
    return Accordion.new("reset-credits").w_full().flex_none().mt(4)
      .child(AccordionItem.new().open(expanded).disabled(Boolean(this.resetting)).flex().flex_col().gap(8)
        .header(AccordionHeader.new(AccordionTrigger.new("reset-credits-toggle")
          .w_full().on_change((open, cx) => {
            this.resetCreditsFocus?.focus();
            this.setResetCreditsExpanded(open, cx);
          }).child(control)).id("reset-credits-heading"))
        // Do not even describe credit details or their controls while collapsed.
        .panel(AccordionPanel.new().id("reset-credits-region").when(expanded, (el) => el.child(this.renderResetCreditDetails(count === null ? null : summary, t)))));
  }

  setResetCreditsExpanded(open, cx) {
    if (this.resetting || Boolean(this.resetCreditsExpanded) === open) return;
    this.resetCreditsExpanded = open;
    cx.notify();
  }

  renderResetCreditDetails(summary, t) {
    const credits = summary?.credits;
    const date = (s) => s ? new Date(s * 1000).toLocaleString() : "Unknown";
    const detailText = () => div().flex_none().min_w(0).whitespace_normal().text_size(11).line_height(1.4);
    return v_flex().id("reset-credits-details").flex_none().min_w(0).gap(10).pb(2)
      .when(Boolean(summary), (el) => el.child(detailText().text_color(t.dim).child(`As of ${agoText(summary.updated)}`)))
      .when(!summary, (el) => el.child(detailText().text_color(t.muted).child("Reset credit information isn't available. Try Refresh.")))
      .when(summary?.availableCount === 0, (el) => el.child(detailText().text_color(t.muted).child("No reset credits available.")))
      .children((credits ?? []).map((credit, i) => v_flex().id(`reset-credit-${credit.id}`).flex_none().min_w(0).p(14).gap(8).rounded(8).bg(t.popover).border(1).border_color(t.border)
        .child(h_flex().flex_none().min_w(0).flex_wrap().gap(8).items_start()
          .child(div().flex_1().min_w(120).max_w_full().whitespace_normal().font_medium().text_color(t.foreground).child(credit.title || `Reset credit ${i + 1}`))
          .child(div().flex_none().px(6).py(2).rounded(5).bg(t.hover).text_size(10.5).text_color(t.muted).child(({ available: "Available", redeeming: "Redeeming", redeemed: "Redeemed" })[credit.status] || "Unknown")))
        .when(Boolean(credit.description), (el) => el.child(detailText().text_color(t.muted).child(credit.description)))
        .child(detailText().text_color(t.dim).child(`Granted ${date(credit.grantedAt)}`))
        .child(detailText().text_color(credit.expiresAt && credit.expiresAt * 1000 <= Date.now() ? t.working : t.muted)
          .child(credit.expiresAt ? `${credit.expiresAt * 1000 <= Date.now() ? "Expired" : "Expires"} ${date(credit.expiresAt)}` : "No expiration"))
        .child(h_flex().flex_none().justify_end().child(button(`reset-use-${credit.id}`, this.usedCredits?.has(credit.id) ? "Used" : "Use credit", (cx) => {
          this.resetChoice = credit; this.resetNotice = null; cx.notify();
        }, t, { disabled: this.resetting || this.reading || credit.status !== "available" || this.usedCredits?.has(credit.id) || Boolean(credit.expiresAt && credit.expiresAt * 1000 <= Date.now()) })))))
      .when(Boolean(summary?.availableCount) && credits == null, (el) => el.child(detailText().text_color(t.muted).child("Individual credit details aren't available.")))
      .when(Array.isArray(credits) && credits.length < (summary?.availableCount ?? 0), (el) => el.child(detailText().text_color(t.dim).child(`Showing ${credits.length} of ${summary.availableCount} available credits.`)));
  }

  useResetCredit(cx) {
    const credit = this.resetChoice;
    if (!credit || this.resetting || this.reading) return;
    // A retry retains its key and always targets this explicit single-use credit.
    if (this.resetAttempt?.creditId !== credit.id) this.resetAttempt = { creditId: credit.id, key: `herdr-${Date.now()}-${Math.random().toString(36).slice(2)}` };
    const attempt = this.resetAttempt;
    this.resetting = true; this.resetNotice = null; cx.notify();
    cx.spawn(async (cx) => {
      try {
        const response = await exec("python3", ["-I", `${appHome()}/mods/usage-bar/usage.py`, "--use-reset-credit", attempt.creditId, attempt.key]);
        if (response.code !== 0) throw new Error("Couldn't confirm the reset. Retry the same credit to check the result.");
        const data = JSON.parse(response.stdout);
        this.resetLogPath = data.logPath ?? this.resetLogPath;
        const messages = { reset: "Codex limits reset.", nothingToReset: "No limits needed resetting.", noCredit: "This reset credit is no longer available.", alreadyRedeemed: "This credit was already used." };
        if (data.reset?.ok !== true || !messages[data.reset.outcome]) throw new Error(data.reset?.error || "Couldn't confirm the reset. Retry the same credit.");
        if (data.codex && Array.isArray(data.codex.windows)) this.usage = { ...this.usage, codex: data.codex };
        if (["reset", "alreadyRedeemed", "noCredit"].includes(data.reset.outcome)) (this.usedCredits ??= new Set()).add(credit.id);
        this.resetNotice = messages[data.reset.outcome] + (data.refresh?.ok === true ? "" : " Usage couldn't refresh yet; press Refresh to check the latest limits.") + (data.logError ? ` ${data.logError}` : "");
        this.resetFailed = false; this.resetChoice = null; this.resetAttempt = null;
      } catch (error) {
        this.resetNotice = String(error.message ?? error); this.resetFailed = true;
      } finally { this.resetting = false; cx.notify(); }
    });
  }

  render(cx) {
    const t = theme();
    if (P().mode === "detail") return this.renderDetail(t);
    const u = this.usage ?? {};
    // At the bar's left end (the layout puts this block first), before the shipped items.
    return h_flex().id("usage-bar").size_full().pl(10).pr(6).gap(8).items_center()
      .on_size_change((size, cx) => {
        if (this.width !== size.width) { this.width = size.width; cx.notify(); }
      })
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(12).text_color(t.muted)
      .when(AGENTS.some(([k]) => u[k]), (el) => el.child(this.pill(u, t)))
      .child(div().flex_1())
      .child(this.refreshButton(t));
  }

  // At the end: read the numbers again now (both agents asked afresh). While it does, the icon
  // spins; success says Updated briefly, failure/partial remains until another refresh.
  // Last known numbers and their original timestamps stay available on failure.
  refreshButton(t) {
    const busy = Boolean(this.refreshing || this.resetting);
    const failed = !busy && Boolean(this.readError);
    const done = !busy && !failed && this.refreshResult === "Updated" && Date.now() - (this.refreshed ?? 0) < 2400;
    return h_flex().id("usage-refresh").h(20).px(8).gap(5).flex_none().items_center().rounded(6).cursor_pointer()
      .text_color(busy ? t.dim : t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(busy ? "Reading the limits again…" : this.readError ? `${this.readError}. Unavailable services keep their last known readings and timestamps.` : "Read Claude's and Codex's limits again now")
      .on_click((_e, cx) => this.read(cx, true))
      .child(svg("mods/usage-bar/refresh.svg").size(12).flex_none().when(busy, (el) => el.spin(900)))
      .when(done, (el) => el.text_color(t.ansi2))
      .when(failed, (el) => el.text_color(t.working))
      .child(div().flex_none().child(failed ? (this.refreshResult === "Partial" ? "Partial" : "Failed") : done ? "Updated" : "Refresh"));
  }
}
