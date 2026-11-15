// worktree.js (herdr-mods lib): making and removing a worktree, one way for everyone. The
// New worktree form's Create (worktree-plus) and an agent's `hm new` (spaces-plus create@)
// both call createWorktree, so a worktree an agent makes is the one the button would have
// made: the same folder, branch, name and link, files copied, setup run, agent started,
// space opened. The Remove dialog's yes calls removeWorktree.
// install.sh copies it beside each mod that imports "./worktree.js". Change it here.

import { run, exec, home, knownAgents, shared, setShared, notify } from "herdr";
import { agentLaunchArgv } from "./agent-launch.js";

// The shared state it reads and writes (META, REPOS, KNOWN, LAST_AGENT) is lib/state.js's;
// re-exported for the mods that import them from here.
import { META, metaKey, setMeta, dropMeta, REPOS, KNOWN, LAST_AGENT } from "./state.js";
export { META, metaKey, setMeta, REPOS, KNOWN, LAST_AGENT };

const shq = (x) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(x) ? x : `'${String(x).replace(/'/g, `'\\''`)}'`);
// Agents that take a first message as an argument (used when a setup runs first, since
// Herdr's own first message goes to the program the tab starts, here the shell).
const PROMPT_ARG = new Set(["claude", "codex"]);

// A display name as a folder: any letters (Korean too); separators and characters
// folders or git refs can't hold become dashes.
export const folderName = (name) => name.trim().replace(/[\s/\\:*?"<>|~^\[\]]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[-.]+|[-.]+$/g, "");
// `#123`, `pr:123` or a pull request URL: that PR's number, else null.
export const prNumber = (text) => text.trim().match(/^(?:#|pr:)(\d+)$/i)?.[1] ?? text.trim().match(/\/pull\/(\d+)(?:[/?#]|$)/)?.[1] ?? null;
// Checkouts go to <ROOT>/<repo>/<name>.
export const ROOT = (home) => `${home}/.herdr/worktrees`;
export const slug = (branch) => branch.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
// A folder or branch from a long title: at most 50 characters, cut at a dash.
export const short = (s) => (s.length <= 50 ? s : s.slice(0, 50).replace(/-[^-]*$/, "") || s.slice(0, 50));

// A name for a worktree from what it's for: a pull request (base `#123` or a PR URL, or a PR
// link) or a GitHub issue link gives its title (gh); a ticket key in the link (TAXTEAM-1446,
// or a URL holding one) gives that key. { name, from } or null. Nothing is asked of a
// tracker other than GitHub: no login of ours, no company address assumed. A PR's also
// gives its branch (the one its worktree checks out).
export async function nameFrom({ base = "", link = "", top, on = null }) {
  const asked = async (kind, what) => {
    const r = await exec("gh", [kind, "view", what, "--json", kind === "pr" ? "title,number,headRefName" : "title,number"], { cwd: top, on }).catch(() => null);
    try { return r?.code === 0 ? JSON.parse(r.stdout) : null; } catch { return null; }
  };
  const l = String(link ?? "").trim();
  const pr = prNumber(String(base ?? "")) ?? (/\/pull\/\d+/.test(l) ? l : null);
  if (pr) { const v = await asked("pr", pr); if (v?.title) return { name: v.title, from: `PR #${v.number}`, branch: v.headRefName }; }
  if (/\/issues\/\d+/.test(l)) { const v = await asked("issue", l); if (v?.title) return { name: v.title, from: `issue #${v.number}` }; }
  const key = l.match(/\b([A-Z][A-Z0-9]+-\d+)\b/)?.[1];
  return key ? { name: key, from: key } : null;
}

// A git command's outcome. exec throws when it can't start git at all (its folder is gone,
// say, right after a worktree is removed): that's a failure like any other, not an error
// that stops the caller halfway (a dialog left open).
export async function git(cwd, args, on) {
  const r = await exec("git", args, { cwd, on }).catch((e) => ({ code: -1, stdout: "", stderr: String(e?.message ?? e) }));
  return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: (r.stderr ?? r.stdout ?? "").trim() };
}

// The repo a folder belongs to: its main checkout and name, and whether
// the folder is itself a linked worktree. null outside git.
export async function repoOf(folder, on) {
  const top = await git(folder, ["rev-parse", "--show-toplevel"], on);
  const common = await git(folder, ["rev-parse", "--path-format=absolute", "--git-common-dir"], on);
  if (!top.ok || !common.ok) return null;
  const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
  return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out };
}

// A ref's name without refs/heads/ or refs/remotes/. Git's own short form (--short,
// --abbrev-ref) cuts some Korean branch names in the middle of a letter (Apple Git 2.39:
// "감면세액조정명세서-중복" came back as 16 bytes ending inside 정), so take the full ref.
export const refName = (ref) => ref.replace(/^refs\/(heads|remotes)\//, "");

// Where a new worktree starts by default: the remote's HEAD (origin/develop), else
// origin/main or origin/master if there, else the checkout's HEAD.
export async function defaultBase(repo, on) {
  const head = await git(repo.top, ["symbolic-ref", "refs/remotes/origin/HEAD"], on);
  if (head.ok && head.out) return refName(head.out);
  for (const b of ["origin/main", "origin/master"]) if ((await git(repo.top, ["show-ref", "--verify", "--quiet", `refs/remotes/${b}`], on)).ok) return b;
  return "HEAD";
}

// The patterns of the repo's .worktreeinclude (files git doesn't track that a new
// worktree needs, like .env), [] without one.
export async function includeFile(repo, on) {
  const inc = await exec("cat", [`${repo.main}/.worktreeinclude`], { on }).catch(() => null);
  return inc?.code === 0 ? inc.stdout.split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")) : [];
}

// Makes a worktree and opens it, as the New worktree form's Create does. Resolves to
// { path }, or throws an Error saying why not. Which commit it starts from, in order:
// - base is a pull request (#123, pr:123, its URL): that PR's head branch, fetched;
// - the branch exists here: checked out as it is;
// - the branch exists on origin: a local branch tracking it;
// - else a new branch from base (fetched first when it's a remote branch), not
//   tracking it, so a plain `git push -u` makes origin/<branch> rather than pushing to base.
// o: { folder (any folder in the repo) or repo (from repoOf), on (machine, null here), name
//   (default: from its PR or link, see nameFrom),
//   branch (default: from the name), branchEdited (a PR's branch doesn't replace it), base
//   (default: defaultBase), link, agent (a key from knownAgents, null: a shell), prompt (its
//   first message), setup and include (default: what was used last in this repo), argv (the
//   first terminal's program instead of the agent's), tab (its name), quiet (an agent's: no
//   toast, the agent says what happened), and from the form what it read already: userHome,
//   agents (the installed ones), includeFile }.
export async function createWorktree(o) {
  const on = o.on ?? null;
  const repo = o.repo ?? (o.folder ? await repoOf(o.folder, on) : null);
  if (!repo) throw new Error(`${o.folder ?? "That folder"} is not in a git repository.`);
  let name = String(o.name ?? "").trim();
  let userHome = o.userHome;
  if (!userHome) {
    if (!on) userHome = home();
    else {
      const r = await exec("sh", ["-c", 'printf %s "$HOME"'], { on }).catch(() => null);
      if (!r || r.code !== 0 || !r.stdout.trim()) throw new Error("Could not find the remote home folder.");
      userHome = r.stdout.trim().replace(/\\/g, "/");
    }
  }
  const saved = (shared(REPOS) ?? {})[metaKey(on, repo.main)] ?? {};
  const setup = String(o.setup ?? saved.setup ?? "").trim();
  const include = String(o.include ?? saved.include ?? "").trim();
  let agent = null;
  if (o.agent) {
    const agents = o.agents ?? (await knownAgents({ on })).filter((a) => a.installed);
    agent = agents.find((a) => a.key === o.agent) ?? null;
    if (!agent) throw new Error(`No "${o.agent}" agent installed here (${agents.map((a) => a.key).join(", ") || "none"}).`);
  }
  const base = String(o.base ?? "").trim() || (await defaultBase(repo, on));
  const top = repo.top;
  const pr = prNumber(base);
  let prInfo = null;
  if (pr) {
    const view = await exec("gh", ["pr", "view", pr, "--json", "number,headRefName,title,url"], { cwd: top, on });
    if (view.code !== 0) throw new Error((view.stderr || view.stdout).trim() || `gh pr view ${pr} failed.`);
    prInfo = JSON.parse(view.stdout);
  }
  // No name typed: what it's for names it (its PR's title, its link's issue or key).
  if (!name) name = prInfo?.title ?? (await nameFrom({ link: o.link, top, on }))?.name ?? "";
  if (!name) throw new Error("Type a name.");
  let branch = String(o.branch ?? "").trim() || short(folderName(name));
  if (prInfo && !o.branchEdited) branch = prInfo.headRefName;
  if (!branch) throw new Error("Type a branch name.");
  if (!(await git(top, ["check-ref-format", "--branch", branch], on)).ok) throw new Error(`"${branch}" can't be a branch name.`);
  // The folder: <ROOT>/<repo>/<name>, numbered when taken, or when it once was: Claude Code
  // keeps sessions by folder (~/.claude/projects/<the path, non-alphanumerics as "-">), so
  // a removed worktree's old conversations would show up in a new one at the same path.
  const first = `${ROOT(userHome)}/${repo.name}/${short(folderName(name)) || slug(branch)}`;
  const retired = async (dir) => !on && (await exec("test", ["-e", `${home()}/.claude/projects/${dir.replace(/[^A-Za-z0-9]/g, "-")}`])).code === 0;
  let path = first;
  for (let n = 2; (await exec("test", ["-e", path], { on })).code === 0 || (await retired(path)); n++) path = `${first}-${n}`;
  const local = (await git(top, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], on)).ok;
  let add;
  if (local) add = ["worktree", "add", path, branch];
  else {
    if (prInfo) await git(top, ["fetch", "origin", `${prInfo.headRefName}:refs/remotes/origin/${prInfo.headRefName}`], on);
    const remote = (await git(top, ["show-ref", "--verify", "--quiet", `refs/remotes/origin/${branch}`], on)).ok;
    if (remote) add = ["worktree", "add", "--track", "-b", branch, path, `origin/${branch}`];
    else {
      // A remote base is fetched so the checkout starts from what's there now; offline, from what's here.
      const [remoteName, ...rest] = base.split("/");
      if (rest.length && (await git(top, ["remote", "get-url", remoteName], on)).ok) await git(top, ["fetch", remoteName, rest.join("/")], on);
      add = ["worktree", "add", "--no-track", "-b", branch, path, base];
    }
  }
  const r = await git(top, add, on);
  if (!r.ok) throw new Error(r.err || "git worktree add failed.");
  // Ready it: the files .worktreeinclude (and "also copy") name, copied from the main checkout.
  const patterns = o.includeFile ?? (await includeFile(repo, on));
  const extra = include.split(/[,\n]/).map((x) => x.trim()).filter(Boolean).join("\n");
  setShared(REPOS, { ...(shared(REPOS) ?? {}), [metaKey(on, repo.main)]: { setup: setup || null, include: include || null } });
  let copied = [];
  if (!on && (patterns.length || extra)) {
    const c = await exec("python3", ["-I", `${home()}/.config/herdr-app/mods/worktree-plus/include.py`, repo.main, path, extra]).catch(() => null);
    try { copied = JSON.parse(c?.stdout ?? "{}").copied ?? []; } catch {}
  }
  setMeta(metaKey(on, path), {
    name, branch, base: pr ? `#${pr}` : base, link: String(o.link ?? "").trim() || null,
    pr: prInfo ? { number: prInfo.number, url: prInfo.url, title: prInfo.title } : null,
    agent: agent?.key ?? null, created: Date.now(), newBranch: !local,
  });
  setShared(LAST_AGENT, agent?.key ?? null);
  // With a setup, the first terminal runs it in the person's login shell, then starts the
  // agent (its first message as an argument), or stays a shell; if the setup fails, it
  // says so and stays a shell instead of starting the agent.
  const prompt = String(o.prompt ?? "").trim();
  let argv = o.argv ?? (agent ? agentLaunchArgv(agent.key, agent.run) : undefined);
  let task = agent && prompt ? prompt : undefined;
  if (setup) {
    const start = argv ? `exec ${[...argv, ...(prompt && PROMPT_ARG.has(agent?.key) ? [prompt] : [])].map(shq).join(" ")}` : 'exec "${SHELL:-/bin/zsh}" -l';
    const script = `${setup}; s=$?; if [ $s -eq 0 ]; then ${start}; else echo; echo "setup failed (exit $s): ${setup.replace(/"/g, "'")}"; exec "\${SHELL:-/bin/zsh}" -l; fi`;
    argv = ["sh", "-c", 'exec "${SHELL:-/bin/zsh}" -lic "$0"', script];
    task = undefined;
  }
  // Named after the display name; the sidebar nests it under its repo by git, not by name.
  run("space.new", { name, folder: path, machine: on, tab: o.tab, argv, task });
  if (!o.quiet && (copied.length || setup)) notify({ title: `${name} is being set up`, body: [copied.length ? `Copied ${copied.slice(0, 4).join(", ")}${copied.length > 4 ? ` and ${copied.length - 4} more` : ""}` : "", setup ? `Running ${setup}` : ""].filter(Boolean).join(" · "), level: "info", timeout: 5000 });
  return { path };
}

// Removes a worktree (the person already said yes: worktree-plus's Remove asks), as its
// Remove does: its space closes first (a shell in the folder keeps it busy on Windows),
// the checkout goes (forced when it has changes or submodules), its entry in META goes,
// and so does its branch, unless it was there before the worktree or isn't merged (see
// dropBranch). Resolves to { name, branch: what happened to it }, or throws an Error.
// o: { repo (from repoOf, of the worktree), on, space (its space's id, if one shows it),
//   force, prMerged (its pull request was merged: the branch goes even when git can't see
//   it in the base, as after a squash merge), quiet (an agent's: no toast) }.
export async function removeWorktree(o) {
  const { repo } = o;
  const on = o.on ?? null;
  if (!repo?.linked) throw new Error("This is the repository's main checkout, not a worktree.");
  const head = await git(repo.top, ["symbolic-ref", "--quiet", "HEAD"], on);
  const branch = head.ok && head.out ? refName(head.out) : null;
  if (o.space) run("space.close", { id: o.space, confirmed: true });
  const r = await git(repo.main, ["worktree", "remove", ...(o.force ? ["--force"] : []), repo.top], on);
  if (!r.ok) throw new Error(r.err || "git worktree remove failed.");
  const key = metaKey(on, repo.top);
  const meta = (shared(META) ?? {})[key] ?? {};
  dropMeta(key);
  const kept = branch ? await dropBranch(repo, branch, meta, on, o.prMerged) : null;
  const name = meta.name ?? repo.top.split("/").pop();
  if (!o.quiet) notify({ title: `Removed ${name}`, body: kept, level: "success", timeout: 5000 });
  return { name, branch: kept };
}

// As Orca does: a removed worktree's branch goes too, unless it was there before the
// worktree (meta.newBranch false) or it can't be shown to be merged: its tip must already
// be in the base it started from or the remote's HEAD. What happened, for the toast. Asked
// in the main checkout: the worktree's own folder is gone by now.
async function dropBranch(repo, branch, meta, on, prMerged = false) {
  const main = repo.main;
  if (meta.newBranch === false) return `Branch ${branch} stays: it was there before the worktree.`;
  if (prMerged) {
    const d = await git(main, ["branch", "-D", branch], on);
    return d.ok ? `Branch ${branch} deleted: its pull request was merged.` : `Branch ${branch} stays: ${d.err}`;
  }
  const bases = [...new Set([meta.base && !meta.base.startsWith("#") ? meta.base : null, await defaultBase({ ...repo, top: main }, on)].filter((b) => b && b !== "HEAD"))];
  for (const b of bases) {
    if (!(await git(main, ["merge-base", "--is-ancestor", branch, b], on)).ok) continue;
    const d = await git(main, ["branch", "-D", branch], on);
    return d.ok ? `Branch ${branch} deleted: it's merged into ${b}.` : `Branch ${branch} stays: ${d.err}`;
  }
  return `Branch ${branch} stays: it isn't merged into ${bases.join(" or ") || "a base"}.`;
}

// Which of a repo's worktrees can go, for Clean up: each { path, name, branch, why, ok (picked
// by default), stop (why it shouldn't, if anything) }. A worktree is listed when its work is
// done: its pull request merged (pr.state, from gh: a squash merge leaves no trace git can
// see) or closed, or its branch already in its base or the remote's HEAD. One with commits of
// its own that are merged is picked; one that never had commits of its own (made after its
// tip) or whose PR closed unmerged is listed unpicked, and one never committed to that has
// changes or an agent is left out (it's being worked on). Uncommitted changes, an agent
// working or waiting there (busy), or a pin stop it from being picked. The remote is fetched first so
// "merged" is today's. o: { main (the main checkout), on, checkouts ([{ path, branch, main,
// pr }], as spaces-plus publishes them in wt.trees), busy (paths with an agent at work) }.
export async function cleanupCandidates({ main, on = null, checkouts = [], busy = new Set() }) {
  const repo = await repoOf(main, on);
  if (!repo) throw new Error(`${main} is not in a git repository.`);
  await git(main, ["fetch", "--prune", "--quiet", "origin"], on);
  const head = await defaultBase({ ...repo, top: main }, on);
  const metas = shared(META) ?? {};
  const out = [];
  for (const c of checkouts.filter((c) => !c.main && c.branch)) {
    const m = metas[metaKey(on, c.path)] ?? {};
    const name = m.name ?? c.path.split("/").pop();
    const pr = c.pr ?? null;
    if (pr?.state === "OPEN") continue;
    let why = null, ok = false;
    if (pr?.state === "MERGED") { why = `PR #${pr.number} merged`; ok = true; }
    else {
      const bases = [...new Set([m.base && !m.base.startsWith("#") ? m.base : null, head].filter((b) => b && b !== "HEAD"))];
      for (const b of bases) {
        if (!(await git(c.path, ["merge-base", "--is-ancestor", "HEAD", b], on)).ok) continue;
        // Its tip older than the checkout: it never had commits of its own.
        const tip = Number((await git(c.path, ["log", "-1", "--format=%ct"], on)).out) || 0;
        const born = m.created ? m.created / 1000 : Number((await exec("stat", ["-f", "%B", `${c.path}/.git`], { on }).catch(() => ({ stdout: "0" }))).stdout.trim()) || 0;
        if (born && tip && tip < born) why = `no commits of its own (at ${b})`;
        else { why = `merged into ${b}`; ok = true; }
        break;
      }
      if (!why && pr?.state === "CLOSED") why = `PR #${pr.number} closed without merging`;
    }
    if (!why) continue;
    const status = await git(c.path, ["--no-optional-locks", "-c", "core.fsmonitor=false", "status", "--porcelain"], on);
    const changed = status.ok ? status.out.split("\n").filter(Boolean).length : 0;
    // Never committed to, but being worked on (changes, an agent): not done, so not listed.
    if (!ok && why.startsWith("no commits") && (changed || busy.has(c.path))) continue;
    const stop = !status.ok ? (status.err || "git status failed") : changed ? `${changed} uncommitted change${changed === 1 ? "" : "s"}`
      : busy.has(c.path) ? "an agent is working there" : m.pinned ? "pinned" : null;
    out.push({ path: c.path, name, branch: c.branch, why, ok: ok && !stop, stop, prMerged: pr?.state === "MERGED" });
  }
  return out;
}
