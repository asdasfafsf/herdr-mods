// project.js (herdr-mods lib): adding a project, one way for everyone: the Add project
// dialog (mods/project-add) and an agent's `hm clone` / `hm project` (spaces-plus clone@,
// project@) call these. install.sh copies it beside each mod that imports "./project.js".

import { run, exec, home, shared, setShared } from "herdr";
import { TREES } from "./state.js";

// The parent folder last used per machine ("" this computer), offered next time.
export const PARENT = "project.parent";
// Clones just started ({ "<machine>:<path>": when }): until git makes the folder (at once,
// once it runs), the folder check alone would let the same clone start twice.
const CLONING = "project.cloning";

const shq = (x) => (/^[A-Za-z0-9_@%+=:,./-]+$/.test(x) ? x : `'${String(x).replace(/'/g, `'\\''`)}'`);
// A name as a folder: any letters (Korean too); separators and characters folders can't
// hold become dashes.
const folderOf = (name) => name.trim().replace(/[\s/\\:*?"<>|~^\[\]]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[-.]+|[-.]+$/g, "");

// The folder a Git URL clones into: "git@host:team/app.git" and "https://host/team/app" give "app".
export const repoName = (url) => folderOf(String(url).trim().replace(/[/\s]+$/, "").replace(/\.git$/, "").split(/[/:]/).pop() ?? "");

// Where new projects go on a machine: the folder last used there, else the folder most of
// its repos' main checkouts sit in (shared "wt.trees"), else its home.
export function defaultParent(on = null) {
  const last = (shared(PARENT) ?? {})[on ?? ""];
  if (last) return last;
  const count = new Map();
  for (const r of Object.values(shared(TREES) ?? {})) {
    if ((r.machine ?? null) !== (on ?? null)) continue;
    const main = (r.checkouts ?? []).find((c) => c.main)?.path;
    if (main) { const up = main.replace(/\/[^/]+\/?$/, ""); count.set(up, (count.get(up) ?? 0) + 1); }
  }
  const best = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  return best ?? (on ? "~" : home());
}

const remember = (on, parent) => setShared(PARENT, { ...(shared(PARENT) ?? {}), [on ?? ""]: parent });
const exists = async (path, on) => (await exec("test", ["-e", path], { on }).catch(() => ({ code: 1 }))).code === 0;

// Clone url into <parent>/<its name>, in a new space whose terminal does it: the clone can
// take long (exec stops at 30 s) and may ask for a login. Once cloned, the terminal's shell
// sits in the checkout, so the sidebar shows it as a repo; if it fails, it says why and
// stays a shell. Resolves to { path } (the checkout to be), or throws an Error why not.
export async function cloneRepo({ url, parent, on = null }) {
  const link = String(url ?? "").trim();
  if (!link) throw new Error("Type the Git URL.");
  const name = repoName(link);
  if (!name) throw new Error(`Can't tell the folder to clone into from ${link}.`);
  const into = String(parent ?? "").trim().replace(/\/+$/, "") || defaultParent(on);
  if (!(await exists(into, on))) throw new Error(`${into} doesn't exist.`);
  const path = `${into}/${name}`;
  if (await exists(path, on)) throw new Error(`${path} is already there: Browse folder opens it.`);
  const key = `${on ?? ""}:${path}`;
  const started = Object.fromEntries(Object.entries(shared(CLONING) ?? {}).filter(([, at]) => Date.now() - at < 60000));
  if (started[key]) throw new Error(`${path} is being cloned already, in its own space.`);
  setShared(CLONING, { ...started, [key]: Date.now() });
  remember(on, into);
  const script = `git clone ${shq(link)} ${shq(path)}; s=$?; if [ $s -eq 0 ]; then cd ${shq(path)}; else echo; echo "git clone failed (exit $s)"; fi; exec "\${SHELL:-/bin/zsh}" -l`;
  run("space.new", { name, folder: into, machine: on ?? "", argv: ["sh", "-c", 'exec "${SHELL:-/bin/zsh}" -lic "$0"', script] });
  return { path };
}

// A new project: <parent>/<name> made, a git repo with a first (empty) commit, so a
// worktree can start from it at once; opened as a space. Resolves to { path, note? } (note:
// the first commit couldn't be made, as when git has no name and email yet), or throws.
export async function createProject({ name, parent, on = null }) {
  const folder = folderOf(String(name ?? ""));
  if (!folder) throw new Error("Type a name.");
  const into = String(parent ?? "").trim().replace(/\/+$/, "") || defaultParent(on);
  if (!(await exists(into, on))) throw new Error(`${into} doesn't exist.`);
  const path = `${into}/${folder}`;
  if (await exists(path, on)) throw new Error(`${path} is already there.`);
  const step = async (cmd, args, cwd) => {
    const r = await exec(cmd, args, { cwd, on }).catch((e) => ({ code: -1, stderr: String(e?.message ?? e) }));
    return r.code === 0 ? null : (r.stderr || r.stdout || `${cmd} failed`).trim();
  };
  const made = await step("mkdir", ["-p", path]);
  if (made) throw new Error(made);
  const init = await step("git", ["init", "-q"], path);
  if (init) throw new Error(init);
  const first = await step("git", ["commit", "--allow-empty", "-q", "-m", "Initial commit"], path);
  remember(on, into);
  run("space.new", { name: String(name).trim(), folder: path, machine: on ?? "" });
  return { path, note: first ? `No first commit yet: ${first.split("\n")[0]}` : null };
}

// The git repos right inside a folder (one level down): a folder of repos, as
// ~/Desktop/workspace is. [] when the folder is itself in a repo, or has none.
export async function reposIn(folder, on = null) {
  const inside = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on }).catch(() => null);
  if (inside?.code === 0) return [];
  const r = await exec("sh", ["-c", 'for d in "$0"/*/; do [ -e "${d}.git" ] && printf "%s\\n" "${d%/}"; done', folder], { on }).catch(() => null);
  return (r?.stdout ?? "").split("\n").map((x) => x.trim()).filter(Boolean).sort((a, b) => a.localeCompare(b));
}

// Whether a repo already has a space (its main checkout, from spaces-plus's wt.trees).
export const isOpen = (path, on = null) => Object.values(shared(TREES) ?? {}).some((r) => (r.machine ?? null) === (on ?? null) && (r.checkouts ?? []).some((c) => c.main && c.path === path));
