// Go to a tab. Drops from the Terminals layout's space chip (popup, at: "top"). Spaces with
// something that needs you come first, quiet spaces (no agent running)
// fold into "earlier" (Tab or the view tabs: Agents, one row each in the sidebar's Agents
// list order, its state in its color; Recent; Name; Docs: the Markdown files of the repo
// you're in, the latest changed first, Enter shows one rendered beside the pane, md-view).
// Type to filter, ↑/↓ and Enter to go, ctrl+d to close
// a tab, Esc to leave. Last rows: new work (a tab here, a space on this
// computer or on each connected machine).
//
// picker-plus (herdr-mods): a clone of the shipped `picker` (⌘P, and ⌘J as Orca's jump
// palette). Typing also searches the worktrees, open or not, of every repo a space is in
// (shared("wt.trees"), kept by spaces-plus), by name, branch, repo, and what wt-menu stored about them (display
// name, link, PR number, comment); every word typed must match ("owl 1446"), and each row
// says what matched. Enter goes there, opening it if no space shows it. Then a New worktree
// row for what was typed or pasted (see intent: a PR, a Jira, Linear or GitHub issue).

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { agents, spaces, terminals, panes, focused, run, hc, theme, settings, props, closeOverlay, openOverlay, shared, setShared, layout } from "herdr";
// Whether a mod runs in the shown layout: lib/resume.js in the repo, copied here by install.sh.
import { runs } from "./resume.js";
import { TREES, META, SEEN, AGENT_INFO, AGENT_ORDER, repoOfSpace, option } from "./state.js";
import { inside, placeOf } from "./places.js";
import { ago, statusMark, statusPill, pill, shownStatus, repoTag, repoFill } from "./ui.js";
import { openDoc, listDocs } from "./docs.js";

// Where a space is now: its first terminal's live folder, else where it was made.

// The filter's words: each must match somewhere ("owl 1446").
const words = (f) => f.split(/\s+/).filter(Boolean);
// What a pasted link or key names, to start a worktree from it: { name, link?, pr? }.
// A pull request (#123, pr:123, …/pull/123) checks out its branch; a Jira key or URL
// (…/browse/TAXTEAM-1446), a Linear issue (…/issue/ABC-12/slug) or a GitHub issue
// (…/issues/45) names the worktree and becomes its link. Anything else: its text as name.
function intent(text) {
  const x = text.trim();
  const pr = x.match(/^(?:#|pr:)(\d+)$/i)?.[1] ?? x.match(/\/pull\/(\d+)/)?.[1];
  if (pr) return { pr, label: `PR #${pr}` };
  const linear = x.match(/linear\.app\/[^/]+\/issue\/([A-Z][A-Z0-9]*-\d+)(?:\/([a-z0-9-]+))?/i);
  if (linear) return { name: linear[2] ? `${linear[1]}-${linear[2]}`.slice(0, 60) : linear[1], link: x, label: linear[1] };
  const jira = x.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/)?.[1] ?? x.match(/^([A-Z][A-Z0-9]+-\d+)$/)?.[1];
  if (jira) return { name: jira, link: x, label: jira };
  // Any GitHub, GitHub Enterprise (kcd.codes) or GitLab-style issue URL: host/org/repo/issues/N.
  const issue = x.match(/^https?:\/\/[^/]+\/[^/]+\/[^/]+\/(?:-\/)?issues\/(\d+)/)?.[1];
  if (issue) return { name: `issue-${issue}`, link: x, label: `issue #${issue}` };
  return { name: x, label: `“${x}”` };
}
const baseName = (p) => p.replace(/\/+$/, "").split("/").pop();

// Rows the arrows and Enter go to (the rest are titles).
// What the list shows and in what order: Needs you (the shipped picker's: spaces with news
// first, quiet ones folded), Agents (one row per agent, the latest to change first), Recent
// (spaces, last shown first), Name (spaces by name), Docs (Markdown files, see docRows).
const SORTS = [["attention", "Needs you"], ["activity", "Agents"], ["recent", "Recent"], ["name", "Name"], ["docs", "Docs"]];
const PICKABLE = new Set(["ctx", "agent", "wt", "newwt", "new", "space", "doc"]);
const DOCS_SHOWN = 200; // rows the Docs view lists (type to find the rest)
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

// Space colors, kept by space id in shared "space.colors": a theme
// color name ("ansi6") or a picked #rrggbb. A space seen without one gets
// the theme color fewest spaces use, once; every mod does the same in the
// same order, so they agree, and adding or renaming spaces moves nothing.
const PROJECT_COLORS = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
function spaceColors() {
  const ids = new Set(spaces().map((p) => p.id));
  const kept = Object.fromEntries(Object.entries(shared("space.colors") ?? {}).filter(([id]) => ids.has(id)));
  let changed = Object.keys(kept).length !== Object.keys(shared("space.colors") ?? {}).length;
  for (const p of spaces()) {
    if (kept[p.id] || p.name === "~") continue;
    const uses = (c) => Object.values(kept).filter((v) => v === c).length;
    kept[p.id] = PROJECT_COLORS.reduce((best, c) => (uses(c) < uses(best) ? c : best));
    changed = true;
  }
  if (changed) setShared("space.colors", kept);
  return kept;
}
function spaceColor(t, p) {
  if (p.name === "~") return t.dim;
  const c = spaceColors()[p.id] ?? PROJECT_COLORS[0];
  return c.startsWith("#") ? c : (MARK[c] ?? t[c]);
}

export default class Picker extends View {
  init(_props, cx) {
    this.filter = "";
    this.input = InputState.new({ placeholder: "Go to a tab, space, agent or worktree…" });
    this.input.on("change", (_e, cx) => { this.filter = this.input.value(); this.at = 0; cx.notify(); });
    this.input.on("submit", () => this.go(this.rows().filter((r) => PICKABLE.has(r.kind))[this.at]));
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());
    this.at = null;
    this.scroll = 0;
    this.showEarlier = false;
    this.machines = [];
    // How the list is ordered (see SORTS), kept for next time.
    let saved = null;
    try { saved = localStorage.getItem("pk.sort"); } catch {}
    this.sort = SORTS.some(([id]) => id === saved) ? saved : "attention";
    this.docs = null; // the Docs view's list: { key, root, on, files, error }, see loadDocs
    if (this.sort === "docs") this.loadDocs(cx);
    this.handle = cx.focus_handle();
    // Tab / Shift-Tab change the view. The search field holds the keyboard, and Tab there is
    // taken as "next field" before a key handler sees it, so it's bound as an action in
    // this window's key context (PickerPlus, see render) instead.
    // The keymap is the app's, so once per app run, not each time ⌘P opens.
    if (!globalThis.__pkViewKeys) {
      globalThis.__pkViewKeys = cx.bind_keys([
        { keystroke: "tab", action: "pk_next_view", context: "PickerPlus" },
        { keystroke: "shift-tab", action: "pk_prev_view", context: "PickerPlus" },
      ]);
    }
    cx.spawn(async (cx) => {
      try {
        const r = await hc(["machine", "ls", "--json"]);
        if (r.code === 0) this.machines = (JSON.parse(r.stdout).machines ?? []).filter((m) => m.state === "connected" && !m.temporary).map((m) => m.name);
      } catch {}
      cx.notify();
    });
  }

  close() {
    closeOverlay(props().overlay);
  }

  // A space's place in the chosen order, higher first: its agents' latest change (seq:
  // higher is more recent) for "activity", when it was last shown (spaces-plus keeps
  // shared "wt.seen") for "recent"; "name" ranks all alike and sorts by name.
  ranker(all) {
    if (this.sort === "activity") {
      const last = {};
      for (const a of all) last[a.space] = Math.max(last[a.space] ?? -1, a.seq ?? -1);
      return (w) => last[w.id] ?? -1;
    }
    if (this.sort === "recent") {
      const seen = shared(SEEN) ?? {};
      return (w) => (w.active ? Infinity : seen[w.id] ?? -1);
    }
    return () => 0;
  }

  // Each space's repo and branch, "repo · branch", from spaces-plus's wt.trees.
  wheres() {
    const out = {};
    for (const r of Object.values(shared(TREES) ?? {})) for (const c of r.checkouts ?? []) if (c.space) out[c.space] = `${r.name} · ${c.branch ?? "detached"}`;
    return out;
  }

  // The next view (Tab), or one picked (its tab), kept for next time.
  nextSort(cx, step = 1) {
    const i = SORTS.findIndex(([id]) => id === this.sort);
    this.pickSort(SORTS[(i + step + SORTS.length) % SORTS.length][0], cx);
  }

  pickSort(id, cx) {
    this.sort = id;
    if (id === "docs") this.loadDocs(cx);
    try { localStorage.setItem("pk.sort", id); } catch {}
    this.at = null; // on where you are again (see render)
    this.scroll = 0;
    cx.notify();
  }

  // The Markdown files of where you are: the focused pane's folder (its repo, lib/docs.js),
  // else the shown space's. Read each time ⌘P opens on Docs or Docs is picked.
  loadDocs(cx) {
    const space = spaces().find((s) => s.active);
    const folder = focused()?.cwd || (space ? placeOf(space) : null);
    const on = space?.machine ?? null;
    const key = JSON.stringify([on, folder]);
    if (!folder || this.docs?.key === key) return;
    this.docs = { key, root: folder, on, files: null, error: null };
    cx.spawn(async (cx) => {
      try {
        const { root, files } = await listDocs(folder, on);
        if (this.docs?.key === key) this.docs = { ...this.docs, root, files };
      } catch (e) {
        if (this.docs?.key === key) this.docs = { ...this.docs, error: String(e?.message ?? e) };
      }
      cx.notify();
    });
  }

  // Docs: a title (where, how many), then each file matching what's typed (every word, in
  // its path), the latest changed first.
  docRows(f) {
    const d = this.docs;
    if (!d) return [{ kind: "dochead", text: "No folder here to look in" }];
    if (d.error) return [{ kind: "dochead", text: d.error }];
    if (!d.files) return [{ kind: "dochead", text: `Looking for Markdown files in ${baseName(d.root)}…` }];
    const hits = d.files.filter((x) => !f || words(f).every((w) => x.path.toLowerCase().includes(w)));
    const head = { kind: "dochead", text: hits.length ? `${baseName(d.root)} · ${hits.length} Markdown file${hits.length > 1 ? "s" : ""}` : f ? `No Markdown file in ${baseName(d.root)} matches` : `No Markdown files in ${baseName(d.root)}` };
    return [head, ...hits.slice(0, DOCS_SHOWN).map((x) => ({ kind: "doc", ...x, root: d.root, on: d.on }))];
  }

  rows() {
    const f = this.filter.toLowerCase();
    if (this.sort === "docs") return this.docRows(f);
    const all = agents();
    const live = terminals().filter((x) => x.state === "live");
    const teamOf = (addrs) => {
      let n = 0;
      const walk = (a) => live.filter((x) => x.parent === a).forEach((k) => (n++, walk(k.address)));
      addrs.forEach(walk);
      return n;
    };
    const groups = spaces().map((w) => {
      const ctxs = w.tabs
        .map((ctx) => {
          const mine = all.filter((a) => a.tab === ctx.id);
          return { w, ctx, mine, team: teamOf(mine.map((a) => a.address)) };
        })
        .filter((c) => { const text = [w.name, c.ctx.name, ...c.mine.map((a) => a.program?.name ?? "")].join(" ").toLowerCase(); return !f || words(f).every((x) => text.includes(x)); });
      return { w, ctxs };
    });
    const out = [];
    const add = (p) => {
      out.push({ kind: "head", w: p.w });
      for (const c of p.ctxs) out.push({ kind: "ctx", ...c });
    };
    if (this.sort === "activity") {
      // Agents: each its own row, the latest to change first (seq: higher is more recent).
      const where = this.wheres();
      const hits = all.filter((a) => {
        const text = [a.space_name, a.tab_name, a.title, a.program?.name ?? "", where[a.space] ?? ""].join(" ").toLowerCase();
        return !f || words(f).every((x) => text.includes(x));
      });
      // In the order the sidebar's Agents list shows them (agents-plus's "ag.order": pinned,
      // the tab being looked at, then needs you, done, working, idle, each latest first); one
      // not in it (no Agents list shown) after them, the latest to change first.
      const order = new Map((shared(AGENT_ORDER) ?? []).map((x, i) => [x, i]));
      hits.sort((a, b) => (order.get(a.address) ?? Infinity) - (order.get(b.address) ?? Infinity) || (b.seq ?? 0) - (a.seq ?? 0));
      // One list, no section titles; each row's state shows in its color (see row).
      const viewing = focused()?.tab;
      for (const a of hits) out.push({ kind: "agent", a, where: where[a.space] ?? null, here: a.tab === viewing });
    } else if (this.sort === "attention") {
      // Needs you: spaces with an agent's news first (blocked ones on top), quiet ones folded.
      const busy = groups.filter((p) => p.w.status && p.ctxs.length);
      const quiet = groups.filter((p) => !p.w.status && p.ctxs.length);
      busy.sort((a, b) => (b.w.status === "blocked") - (a.w.status === "blocked"));
      busy.forEach(add);
      if (quiet.length) {
        out.push({ kind: "earlier", count: quiet.length });
        if (this.showEarlier || f) quiet.forEach(add);
      }
    } else {
      // Any other order: every space in it, none folded, so ↑/↓ walk that order.
      const rank = this.ranker(all);
      const shown = groups.filter((p) => p.ctxs.length).sort((a, b) => rank(b.w) - rank(a.w) || (this.sort === "name" ? a.w.name.localeCompare(b.w.name) : 0));
      if (this.sort === "activity") for (const p of shown) p.ctxs.sort((a, b) => Math.max(-1, ...b.mine.map((x) => x.seq)) - Math.max(-1, ...a.mine.map((x) => x.seq)));
      shown.forEach(add);
    }
    // Worktrees only with the worktrees bundle shown (spaces-plus keeps their list and opens
    // them; worktree-plus makes new ones). Without it, this is the shipped picker: tabs.
    if (f && runs(layout(), "spaces-plus")) out.push(...this.worktreeRows(f, new Set(groups.filter((g) => g.ctxs.length).map((g) => g.w.id))));
    out.push({ kind: "new" });
    out.push({ kind: "space", machine: null });
    for (const m of this.machines) out.push({ kind: "space", machine: m });
    return out;
  }

  // Worktrees matching the filter, under a "Worktrees" title, except those whose space is
  // already listed above with its tabs; then New worktree for what was typed, in the repo
  // of the shown space (#123 or a PR URL: from that pull request).
  worktreeRows(f, listed) {
    const trees = shared(TREES) ?? {};
    const meta = shared(META) ?? {};
    const sp = spaces();
    // The space showing a checkout: its first terminal is in it (the deepest checkout wins).
    const all = Object.values(trees).flatMap((r) => r.checkouts.map((c) => ({ ...c, repo: r.name, machine: r.machine })));
    const spaceOf = (c) => sp.find((s) => (s.machine ?? null) === (c.machine ?? null) && inside(placeOf(s), c.path)
      && !all.some((o) => o.path !== c.path && o.path.length > c.path.length && inside(placeOf(s), o.path)));
    const found = [];
    for (const c of all) {
      const m = meta[JSON.stringify([c.machine ?? null, c.path])] ?? {};
      const name = m.name || (c.main ? c.branch ?? baseName(c.path) : baseName(c.path));
      const pr = m.pr?.number ? `#${m.pr.number}` : "";
      // What matched, shown on the row when it isn't the name itself.
      const fields = [[name, ""], [c.branch ?? "", c.branch], [c.repo, ""], [baseName(c.path), ""], [m.link ?? "", m.link], [pr, pr && `PR ${pr}`], [m.comment ?? "", "note"]];
      const hits = words(f).map((x) => fields.find(([v]) => v && v.toLowerCase().includes(x)));
      if (hits.some((h) => !h)) continue;
      const hit = hits.find((h) => h[1] && h[1] !== name) ?? hits[0];
      const s = spaceOf(c);
      if (s && listed.has(s.id)) continue;
      found.push({ kind: "wt", c, name, why: hit[1] && hit[1] !== name ? hit[1] : "", space: s ?? null, meta: m });
    }
    // In the chosen order: by their space's rank (one not open: last), else open ones first.
    const rank = this.ranker(agents());
    found.sort((a, b) => (this.sort === "attention" || this.sort === "name"
      ? Number(Boolean(b.space)) - Number(Boolean(a.space)) || a.name.localeCompare(b.name)
      : (b.space ? rank(b.space) : -2) - (a.space ? rank(a.space) : -2) || a.name.localeCompare(b.name)));
    const out = found.length ? [{ kind: "wthead", count: found.length }, ...found.slice(0, 30)] : [];
    const here = sp.find((s) => s.active);
    let repo = here && Object.values(trees).find((r) => (r.machine ?? null) === (here.machine ?? null) && r.checkouts.some((c) => inside(placeOf(here), c.path)));
    let space = repo ? here : null;
    // Not in a repo (~, a plain folder): the repo of the best match, through a space in it.
    if (!repo && found.length) {
      repo = Object.values(trees).find((r) => r.name === found[0].c.repo && (r.machine ?? null) === (found[0].c.machine ?? null));
      space = repo && sp.find((s) => repo.checkouts.some((c) => inside(placeOf(s), c.path)));
    }
    const it = intent(this.filter);
    // Offered for a pasted PR, ticket or issue, or when nothing matched: a search that
    // found its worktree doesn't need "make one called that" under it.
    if (repo && (it.pr || it.link || !found.length)) {
      out.push({ kind: "newwt", repo: repo.name, space: space?.id ?? null, folder: repo.checkouts.find((c) => c.main)?.path, machine: repo.machine, ...it });
    }
    return out;
  }

  go(r) {
    if (!r) return;
    this.close();
    if (r.kind === "wt") {
      if (r.space) run("space.select", { id: r.space.id });
      // spaces-plus opens it: a sleeping one wakes with its sessions.
      else run(`spaces-plus.open@${r.c.path}`);
      return;
    }
    if (r.kind === "newwt") {
      const where = r.space ? { space: r.space } : { folder: r.folder, machine: r.machine ?? null };
      openOverlay({ mod: "worktree-plus", kind: "dialog", width: 600, height: 640, props: { ...where, action: "new", ...(r.pr ? { base: `#${r.pr}` } : { name: r.name, ...(r.link ? { link: r.link } : {}) }) } });
      return;
    }
    if (r.kind === "agent") return run("pane.focus", { pane: r.a.pane });
    if (r.kind === "doc") return void openDoc({ file: `${r.root}/${r.path}`, on: r.on });
    if (r.kind === "ctx") run("tab.select", { id: r.ctx.id });
    else if (r.kind === "new") run("tab.new");
    else if (r.kind === "space") run("space.new", { machine: r.machine ?? "" });
  }

  // An agent's state: lib/ui.js's mark, as the sidebar and the Agents list draw it.
  glyph(t, st) {
    return statusMark(t, st) ?? div().w(12).flex_none();
  }

  render() {
    const t = theme();
    const rows = this.rows();
    const pickable = rows.filter((r) => PICKABLE.has(r.kind));
    // Opens on where you are.
    if (this.at === null) this.at = Math.max(0, pickable.findIndex((r) => (r.kind === "ctx" && r.w.active && r.ctx.active) || (r.kind === "agent" && r.a.focused)));
    this.at = Math.min(this.at, pickable.length - 1);
    const sel = pickable[this.at];
    // One continuous strip: each row (and the group title before it) at a fixed
    // y. Scrolling moves the strip only as far as it takes to keep the selected
    // row in view, so the arrows can't run the selection off the list.
    const H = { head: 29, earlier: 35, new: 36, ctx: 32, space: 32, wthead: 33, wt: 32, newwt: 32, agent: 44, dochead: 29, doc: 32 };
    const tops = [];
    let y = 0;
    rows.forEach((r) => { tops.push(y); y += H[r.kind] ?? 32; });
    const total = y;
    const height = Math.min(320, this.listHeight ?? 320);
    const fixed = total > height;
    const maxScroll = Math.max(0, total - height);
    this.scroll = Math.max(0, Math.min(this.scroll, maxScroll));
    const si = rows.indexOf(sel);
    if (si >= 0) {
      if (tops[si] < this.scroll) this.scroll = tops[si];
      if (tops[si] + (H[sel.kind] ?? 32) > this.scroll + height) this.scroll = tops[si] + (H[sel.kind] ?? 32) - height;
    }
    const place = (el, i) =>
      fixed
        ? el.absolute().left(0).right(0).top(tops[i] - this.scroll).bottom(height - (tops[i] + (H[rows[i].kind] ?? 32) - this.scroll))
        : el;
    const visible = (i) => !fixed || (tops[i] + (H[rows[i].kind] ?? 32) > this.scroll && tops[i] < this.scroll + height);

    const row = (r) => {
      if (r.kind === "head") {
        return h_flex()
          .px(10)
          .pt(10)
          .pb(3)
          .gap(8)
          .items_center()
          .text_size(11)
          .font_semibold()
          .text_color(t.dim)
          .child(h_flex().size(18).rounded(5).bg(repoOfSpace(r.w.id) ? repoFill(t, repoOfSpace(r.w.id)) : spaceColor(t, r.w)).items_center().justify_center().text_size(10.5).font_bold().text_color("#ffffff").child([...r.w.name][0]?.toUpperCase() ?? "?"))
          .child(r.w.name);
      }
      if (r.kind === "earlier") {
        return h_flex()
          .id("pk-earlier")
          .mt(6)
          .px(10)
          .py(6)
          .border_t(1)
          .border_color(t.border)
          .text_size(12)
          .text_color(t.dim)
          .cursor_pointer()
          .hover((s) => s.text_color(t.foreground))
          .on_click((_e, cx) => {
            this.showEarlier = !this.showEarlier;
            cx.notify();
          })
          .child(`earlier: ${r.count} quiet space${r.count > 1 ? "s" : ""} ${this.showEarlier ? "▴" : "▾"}`);
      }
      const on = r === sel;

      if (r.kind === "agent") {
        // As the sidebar's Agents list draws one: the program's icon, the space in full ink and
        // the title after it, how long since it changed and its state at the end; under it, its
        // repo and branch, and what it's doing or last said (agents-plus's "ag.info").
        const a = r.a, info = (shared(AGENT_INFO) ?? {})[a.address] ?? {};
        const news = !option("pickerNews") ? null : a.status === "working" ? info.doing : a.status === "blocked" ? info.doing : a.status === "done" ? info.said : null;
        const pic = a.program?.icon ? (a.program.tint ? svg(a.program.icon).size(16).flex_none().text_color(t.foreground) : image(a.program.icon).w(16).h(16).flex_none()) : null;
        const st = shownStatus(a.status, info); // Seen too (lib/ui.js)
        const quiet = st === "idle" && !a.focused;
        // Its state at its end, lib/ui.js's pill (the same marks and colors as the sidebar and
        // the Agents list; idle its ring). In the tab being looked at: an "Active" label in the
        // accent too (seen even while the row is the selected one, which it is when ⌘P opens).
        return h_flex().id(`pk-agent-${a.address}`).mx(4).px(10).h(44).rounded(8).gap(10).items_center().cursor_pointer()
          .when(r.here && !on, (el) => el.bg(t.selected)).when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_click(() => this.go(r))
          .when(Boolean(pic), (el) => el.child(pic))
          .child(v_flex().flex_1().min_w(0).gap(1)
            .child(h_flex().min_w(0).gap(5).items_center()
              .child(div().flex_shrink(0).max_w(220).truncate().text_size(13).text_color(quiet ? t.muted : t.foreground).child(a.space_name))
              .when(Boolean(a.title) && a.title !== a.space_name, (el) => el.child(div().flex_1().min_w(0).truncate().text_size(12.5).text_color(t.dim).child(`· ${a.title}`))))
            .child(h_flex().min_w(0).gap(6).items_center().text_size(11)
              // Its repo as a tag in the repo's sidebar color, then the branch (lib/ui.js's repoTag).
              .when(option("pickerRepoNames") && Boolean(repoOfSpace(a.space)), (el) => el.child(repoTag(t, repoOfSpace(a.space), 160)).child(div().flex_shrink(0).max_w(160).truncate().text_color(t.dim).child(repoOfSpace(a.space).branch)))
              .when(!(option("pickerRepoNames") && repoOfSpace(a.space)) && Boolean(r.where), (el) => el.child(div().flex_shrink(0).max_w(220).truncate().text_color(t.dim).child(r.where)))
              .when(Boolean(news), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(a.status === "blocked" ? t.blocked : t.muted).child(`${a.status === "done" ? "✓" : a.status === "blocked" ? "?" : "▸"} ${news}`)))))
          .when(Boolean(info.at), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(info.at))))
          .when(Boolean(r.here), (el) => el.child(pill(t.accent, "Active")))
          .child(statusPill(t, st));
      }
      if (r.kind === "dochead") {
        return h_flex().px(10).pt(10).pb(3).gap(8).items_center().text_size(11).font_semibold().text_color(t.dim).child(r.text);
      }
      if (r.kind === "doc") {
        // Its name, the folder it's in (from the repo's top), when it last changed.
        const slash = r.path.lastIndexOf("/");
        return h_flex().id(`pk-doc-${r.path}`).mx(4).px(10).h(32).rounded(7).gap(10).items_center().cursor_pointer()
          .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_click(() => this.go(r))
          .child(svg("mods/files/file.svg").size(12).flex_none().text_color(t.muted))
          .child(div().flex_shrink(0).max_w(300).truncate().text_color(t.foreground).child(r.path.slice(slash + 1)))
          .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(slash > 0 ? r.path.slice(0, slash) : ""))
          .when(Boolean(r.at), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(ago(r.at))));
      }
      if (r.kind === "wthead") {
        return h_flex().px(10).pt(12).pb(3).gap(8).items_center().text_size(11).font_semibold().text_color(t.dim)
          .child(svg("mods/workspace-chrome/git-branch.svg").size(13)).child(`Worktrees · ${r.count}`);
      }
      if (r.kind === "wt") {
        return h_flex().id(`pk-wt-${r.c.path}`).mx(4).px(10).h(32).rounded(7).gap(10).items_center().cursor_pointer()
          .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_click(() => this.go(r))
          .child(svg(`mods/workspace-chrome/${r.c.main ? "folder" : "branch"}.svg`).size(12).flex_none().text_color(r.space ? t.muted : t.dim))
          .child(div().flex_shrink(0).max_w(260).truncate().text_color(r.space ? t.foreground : t.muted).child(r.name))
          .when(Boolean(r.why), (el) => el.child(div().flex_none().px(6).rounded(4).bg(t.hover).text_size(10.5).text_color(t.muted).child(r.why)))
          .child(div().flex_1())
          .when(Boolean(r.space?.status), (el) => el.child(this.glyph(t, r.space.status)))
          .child(div().flex_none().text_size(11).text_color(t.dim).child(r.space ? r.c.repo : `${r.c.repo} · not open`));
      }
      if (r.kind === "newwt") {
        return h_flex().id("pk-newwt").mx(4).mt(4).px(10).h(32).rounded(7).gap(8).items_center().cursor_pointer().text_color(t.muted)
          .when(on, (el) => el.bg(t.hover)).hover((s) => s.bg(t.hover)).on_click(() => this.go(r))
          .child(svg("mods/workspace-chrome/git-branch.svg").size(12).flex_none())
          .child(div().flex_1().truncate().child(r.pr ? `New worktree from PR #${r.pr} in ${r.repo}` : `New worktree for ${r.label} in ${r.repo}`));
      }
      if (r.kind === "new" || r.kind === "space") {
        const label = r.kind === "new" ? "new tab" : r.machine ? `new space on ${r.machine}` : "new space";
        return h_flex()
          .id(r.kind === "new" ? "pk-new" : `pk-space-${r.machine ?? "here"}`)
          .mx(4)
          .when(r.kind === "new", (el) => el.mt(4))
          .px(10)
          .h(32)
          .items_center()
          .rounded(7)
          .gap(8)
          .text_color(t.muted)
          .cursor_pointer()
          .when(on, (el) => el.bg(t.hover))
          .hover((s) => s.bg(t.hover))
          .on_click(() => this.go(r))
          .child(div().w(12).child("+"))
          .child(label);
      }
      const who = r.mine.map((a) => a.program?.name ?? "agent").join(" · ");
      const here = r.w.active && r.ctx.active;
      return h_flex()
        .id(`pk-${r.ctx.id}`)
        .mx(4)
        .px(10)
.h(32)
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(on, (el) => el.bg(t.hover))
        .hover((s) => s.bg(t.hover))
        .on_click(() => this.go(r))
        .child(this.glyph(t, r.ctx.status))
        .child(div().flex_1().truncate().text_color(t.foreground).when(here, (d) => d.font_semibold()).child(r.ctx.name))
        .when(r.ctx.status === "blocked", (el) => el.child(div().text_size(11).text_color(t.blocked).child("needs you")))
        .when(r.ctx.status === "done", (el) => el.child(div().text_size(11).text_color(t.done).child("finished")))
        .child(div().text_size(11).text_color(t.dim).child(who + (r.team ? `  +${r.team}` : "")));
    };

    return v_flex()
      .id("picker")
      .key_context("PickerPlus")
      .on_action("pk_next_view", (_e, cx) => this.nextSort(cx))
      .on_action("pk_prev_view", (_e, cx) => this.nextSort(cx, -1))
      .track_focus(this.handle)
      .w_full()
      .min_h(0)
      .p(18)
      .gap(10)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "tab") { cx.stop_propagation(); return this.nextSort(cx); }
        if (k === "down") this.at = (this.at + 1) % pickable.length;
        else if (k === "up") this.at = (this.at + pickable.length - 1) % pickable.length;
        else if (k === "d" && e.modifiers.control) {
          if (sel?.kind === "ctx") {
            this.close();
            run("tab.close", { id: sel.ctx.id });
          }
        } else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center().gap(8).child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child("Go to…"))
        .child(div().text_size(11).text_color(t.dim).child("Tab / ⇧Tab view · Esc")))
      // What it shows, as tabs: the one shown stands out; click one, or Tab for the next.
      .child(h_flex().gap(4).items_center()
        .children(SORTS.map(([id, label]) => {
          const on = this.sort === id;
          return div().id(`pk-view-${id}`).h(24).px(10).flex().items_center().rounded(6).cursor_pointer().text_size(12)
            .when(on, (el) => el.bg(t.selected).text_color(t.foreground).font_semibold())
            .when(!on, (el) => el.text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)))
            .on_click((_e, cx) => this.pickSort(id, cx))
            .child(label);
        })))
      .child(
        h_flex().h(36).flex_none().px(10).gap(8).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
          .child(svg("mods/workspace-chrome/search.svg").size(15).text_color(t.dim))
          .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)),
      )
      .child(
        v_flex()
          .id("pk-list")
          .on_size_change((size, cx) => {
            this.listHeight = size.height / settings().zoom;
            cx.notify();
          })
          .h(Math.min(320, total))
          .min_h(0)
          .mb(6)
          .when(fixed, (el) =>
            el.overflow_hidden().on_scroll_wheel((e, cx) => {
              this.scroll = Math.max(0, Math.min(this.scroll - e.delta.y, maxScroll));
              // The selection follows the wheel, so the next frame doesn't scroll back to it.
              while (this.at < pickable.length - 1 && tops[rows.indexOf(pickable[this.at])] < this.scroll) this.at++;
              while (this.at > 0 && tops[rows.indexOf(pickable[this.at])] + (H[pickable[this.at].kind] ?? 32) > this.scroll + height) this.at--;
              cx.notify();
            }))
          .children(rows.map((r, i) => (visible(i) ? place(row(r), i) : null)).filter(Boolean)),
      );
  }
}
