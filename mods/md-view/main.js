// md-view (herdr-mods): a Markdown file drawn as it reads (headings, lists, tables, code,
// quotes, links), in a pane beside the terminals. Herdr's Files panel shows a .md as its
// source only, so a plan or a README an agent wrote meant leaving the app to read it.
//
// Props: { file (absolute path), on (its machine, null here) }. It follows the file: an
// agent writing it shows as it writes (a folder watch here, a read every few seconds on
// another machine). A link to another Markdown file opens it in this pane (← goes back), a
// web link opens in the browser, a link to any other file shows it in Finder. The pane's
// header (Herdr's) splits, zooms and closes it like any pane.
//
// Opened by ⌘P's Docs view (picker-plus) and by an agent (`hm md <file>`), both through
// lib/docs.js's openDoc, so they open the same way. What each pane shows goes to shared
// DOC_PANES, so a file one already shows isn't opened twice.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, TextView } from "gpui-base";
import { props, panes, readTextFile, watchFolder, exec, theme, home, window, shared, setShared } from "herdr";
import { DOC_PANES } from "./state.js";
import { MARKDOWN } from "./docs.js";
import { agoText } from "./ui.js";

const POLL = 3000; // ms between reads of a file on another machine (no folder watch there)
const BIG = 1024 * 1024; // readTextFile reads up to 1 MiB

const dirOf = (p) => p.replace(/\/[^/]*$/, "") || "/";
const nameOf = (p) => p.split("/").pop();
function tilde(p) {
  const h = home();
  return p === h ? "~" : p.startsWith(h + "/") ? "~" + p.slice(h.length) : p;
}
// "a/./b/../c" as "a/c".
function normal(p) {
  const out = [];
  for (const part of p.split("/")) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return "/" + out.join("/");
}
// Where a link goes: { web } (http, https, mailto), { file } (relative to this file or
// absolute; its #part and ?query dropped), or null (a #part of this page, or nothing).
function target(url, from) {
  const u = String(url ?? "").trim();
  if (/^(https?|mailto):/i.test(u)) return { web: u };
  let p = u.replace(/^file:\/\//i, "").replace(/[?#].*$/, "");
  if (!p || /^[a-z][a-z0-9+.-]*:/i.test(p)) return null;
  try { p = decodeURIComponent(p); } catch {}
  return { file: p.startsWith("/") ? normal(p) : normal(`${dirOf(from)}/${p}`) };
}
// The system's way to open a web address, or to show a file in its folder (never to run it).
function systemOpen(args) {
  const platform = window()?.platform;
  if (platform === "macos") return exec("open", args);
  if (platform === "linux") return exec("xdg-open", args.filter((a) => a !== "-R"));
  return exec("cmd", ["/c", "start", "", ...args.filter((a) => a !== "-R")]);
}

export default class MdView extends View {
  init(_props, cx) {
    const p = props() ?? {};
    // This pane's id, when Herdr gives it (it does for a pane's header); else the md-view
    // pane noted for this file (lib/docs.js's noteOpened), else the one md-view pane no copy
    // has noted yet, or the focused one of those.
    const mine = panes().filter((x) => x.mod === "md-view");
    const noted = shared(DOC_PANES) ?? {};
    const unnoted = mine.filter((x) => !noted[x.pane]);
    this.pane = p.pane
      ?? mine.find((x) => noted[x.pane]?.file === p.file && (noted[x.pane]?.on ?? null) === (p.on ?? null))?.pane
      ?? (unnoted.length === 1 ? unnoted[0].pane : mine.find((x) => x.focused && !noted[x.pane])?.pane) ?? null;
    this.on = p.on ?? null;
    this.back = []; // files this pane showed before, for ←
    this.show(p.file ?? null, cx);
    // On another machine, or where the folder can't be watched: read again every few seconds.
    this.poll = false;
    cx.timer.every(POLL, (cx) => { if ((this.on || this.poll) && this.file) this.load(cx); });
    // "updated 3m ago" keeps counting.
    cx.timer.every(30000, (cx) => { if (this.changed) cx.notify(); });
  }

  // Shows a file (from a link: remembering the one before for ←).
  show(file, cx, { remember = false } = {}) {
    if (remember && this.file) this.back.push(this.file);
    this.file = file;
    this.text = null;
    this.error = file ? null : "No file to show.";
    this.changed = null;
    this.poll = false;
    this.gen = (this.gen ?? 0) + 1;
    this.publish();
    if (!file) return;
    this.load(cx);
    this.follow(cx);
  }

  // Reads the file; redraws only when it changed.
  load(cx) {
    const file = this.file, gen = this.gen;
    cx.spawn(async (cx) => {
      let text = null, error = null;
      try {
        text = await readTextFile(file, { on: this.on });
        if (text === null) error = `${nameOf(file)} isn't there (moved or deleted?).`;
        else if (text.includes("\0")) { text = null; error = `${nameOf(file)} isn't text.`; }
      } catch (e) {
        error = `Couldn't read ${nameOf(file)}: ${String(e?.message ?? e)}`;
      }
      if (gen !== this.gen || (text === this.text && error === this.error)) return;
      if (this.text !== null && text !== null) this.changed = Date.now();
      this.text = text;
      this.error = error;
      cx.notify();
    });
  }

  // Reads again when something changes in the file's folder (here; see init for elsewhere).
  // One watch per file shown: it ends when another file is shown.
  follow(cx) {
    if (this.on) return;
    const file = this.file, gen = this.gen, dir = dirOf(file);
    cx.spawn(async (cx) => {
      try {
        while (gen === this.gen) {
          const paths = await watchFolder(dir);
          if (gen !== this.gen) return;
          if (paths.some((p) => p === file || p === dir)) this.load(cx);
        }
      } catch {
        if (gen === this.gen) this.poll = true; // no watch (too many folders on Linux): see init
      }
    });
  }

  // What this pane shows, for openDoc; panes that are gone are dropped.
  publish() {
    if (!this.pane) return;
    const live = new Set(panes().filter((p) => p.mod === "md-view").map((p) => p.pane));
    const kept = Object.fromEntries(Object.entries(shared(DOC_PANES) ?? {}).filter(([pane]) => live.has(pane) && pane !== this.pane));
    setShared(DOC_PANES, this.file ? { ...kept, [this.pane]: { file: this.file, on: this.on } } : kept);
  }

  link(url, cx) {
    const to = target(url, this.file);
    if (!to) return;
    if (to.web) return void systemOpen([to.web]).catch(() => {});
    if (MARKDOWN.test(to.file)) return this.show(to.file, cx, { remember: true });
    if (!this.on) systemOpen(["-R", to.file]).catch(() => {});
  }

  goBack(cx) {
    const file = this.back.pop();
    if (file) this.show(file, cx);
    cx.notify();
  }

  header(t) {
    const file = this.file;
    return h_flex().id("md-head").flex_none().h(30).px(12).gap(8).items_center().border_b(1).border_color(t.border).text_size(12)
      .when(this.back.length > 0, (el) => el.child(div().id("md-back").flex_none().px(6).py(1).rounded(4).cursor_pointer().text_color(t.muted)
        .hover((s) => s.bg(t.hover).text_color(t.foreground))
        .on_click((_e, cx) => this.goBack(cx))
        .child(`← ${nameOf(this.back[this.back.length - 1])}`)))
      .child(div().flex_none().truncate().max_w(300).font_medium().text_color(t.foreground).child(file ? nameOf(file) : "Markdown"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(file ? `${this.on ? `${this.on}:` : ""}${tilde(dirOf(file))}` : ""))
      .when(Boolean(this.changed), (el) => el.child(div().flex_none().text_color(t.dim).child(`updated ${agoText(this.changed)}`)));
  }

  render() {
    const t = theme();
    const body = this.error
      ? div().p(20).text_color(t.muted).child(this.error)
      : this.text === null
        ? div().p(20).text_color(t.dim).child("Loading…")
        : div().size_full().px(24).pt(12)
          .child(TextView.markdown(`md-${this.file}`, this.text.length >= BIG ? `${this.text}\n\n…` : this.text)
            .selectable(true).scrollable(true).size_full()
            .on_link_click((url, cx) => this.link(url, cx)));
    return v_flex().id("md-view").size_full().bg(t.background)
      .child(this.header(t))
      .child(div().flex_1().min_h(0).child(body));
  }
}
