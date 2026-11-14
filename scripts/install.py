#!/usr/bin/env python3
"""Installs herdr-mods bundles into the Herdr app. Run through ../install.sh.

    install.sh [bundle ...] [--layout NAME] [--replace-keys] [--dry-run]

Bundles are in ../bundles.json (default: all of them). For each picked bundle:
  1. its mods are copied to <home>/mods/<name>/ (home: $HERDR_APP_HOME or ~/.config/herdr-app),
     with the lib files beside every mod that imports one: lib/*.js its main.js imports, lib/*.py
     its own .py files import or its JS declares (and their transitive imports). A folder of the same name this script
     didn't install (no .herdr-mods marker: Herdr's own, or one made by hand) is left alone.
     Files Herdr writes into mod folders (jsconfig.json, *.d.ts, *.error) aren't touched.
  2. the layout gets what the bundle needs, and nothing else changes in it: a shipped block
     swapped for ours ("spaces" -> "spaces-plus"), a floating block added, or a block beside
     the bottom bar. The layout is the one shown now (--layout to pick another). A shipped
     layout (main, terminals, win98) can't change shape, so it's copied to "herdr-worktrees"
     first and that one is changed; switch to it with ctrl-shift-l. A backup of each layout
     file written goes to ~/.herdr/backups/ (<home>/herdr-mods-backups/ with HERDR_APP_HOME).
  3. its keys are added to <home>/keys.json. A key already bound to something else stays as
     it is and is reported (--replace-keys to bind it anyway).
  4. its commands (bin/<name>) are copied to ~/.local/bin/, and its agent skills
     (skills/<name>/, with the lib/*.py their scripts/ import beside them) to ~/.claude/skills/ and ~/.codex/skills/ (for each agent this
     computer has). One of the same name this script didn't install is left alone.
  5. each mod is checked before and after replacement; failed replacements restore its backup.
     A failed/skipped mod exits nonzero before layout/keys/commands updates. Earlier successful
     mods stay updated: this is per-mod rollback, not a transaction for the entire bundle.
Running it again updates the mods and leaves what's already in place alone.
"""

import json
import os
import re
import shutil
import subprocess
import sys
import time
import tempfile
from pathlib import Path

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOME = os.environ.get("HERDR_APP_HOME") or os.path.expanduser("~/.config/herdr-app")
# Backups of the files it changes; beside an other home (HERDR_APP_HOME) when there is one.
BACKUPS = os.path.join(HOME, "herdr-mods-backups") if os.environ.get("HERDR_APP_HOME") else os.path.expanduser("~/.herdr/backups")
MARK = ".herdr-mods"
SHIPPED_LAYOUTS = {"main", "terminals", "win98"}
COPY_LAYOUT = "herdr-worktrees"
HERDR_WRITES = ("jsconfig.json", ".d.ts", ".error", ".DS_Store", MARK, "__pycache__")
DOCS = (".md",)  # a mod's WHY.md stays in the repo, as Herdr leaves a shared mod's RECIPE.md out
CACHES = ("__pycache__",)  # Python's, left by running a helper in the repo
# Where commands and skills go: the person's home, or inside an other home (HERDR_APP_HOME).
USER = os.path.join(HOME, "user") if os.environ.get("HERDR_APP_HOME") else os.path.expanduser("~")
BIN = os.path.join(USER, ".local", "bin")
SKILL_HOMES = [os.path.join(USER, ".claude"), os.path.join(USER, ".codex")]
BIN_MARK = "herdr-mods"  # a command this script installed says so in its first lines


def load(path, default=None):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, data, dry):
    if dry:
        return
    if os.path.exists(path):
        os.makedirs(BACKUPS, exist_ok=True)
        shutil.copy2(path, os.path.join(BACKUPS, f"{os.path.basename(path)}.{time.strftime('%Y%m%d-%H%M%S')}"))
    tmp = path + ".tmp-herdr-mods"
    with open(tmp, "w") as f:
        f.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    os.replace(tmp, path)


def say(kind, text):
    print(f"{kind:<8}{text}")


# 1. mods ------------------------------------------------------------------------------

def install_mod(name, dry):
    src = os.path.join(REPO, "mods", name)
    target = os.path.join(HOME, "mods", name)
    if not os.path.isdir(src):
        say("missing", f"{name}: not in this repo")
        return False
    if os.path.islink(target) or (os.path.exists(target) and not os.path.exists(os.path.join(target, MARK))):
        say("skip", f"{name}: {target} is already there and wasn't installed by this script; rename or remove it")
        return False
    if dry:
        say("would", f"copy mods/{name}")
        return True
    # Build and check away from the watched mod directory before touching live files.
    with tempfile.TemporaryDirectory(prefix="herdr-mod-stage-") as staging:
        candidate = os.path.join(staging, name)
        os.makedirs(candidate)
        for entry in os.listdir(src):
            if host_file(entry) or entry.endswith(DOCS) or entry in CACHES:
                continue
            copy_entry(os.path.join(src, entry), os.path.join(candidate, entry))
        for lib in mod_libs(src):
            shutil.copy2(os.path.join(REPO, "lib", lib), os.path.join(candidate, lib))
        with open(os.path.join(candidate, MARK), "w") as f:
            f.write(REPO + "\n")
        if not check_mod(name, candidate):
            return False
        backup = None
        if os.path.isdir(target):
            os.makedirs(BACKUPS, exist_ok=True)
            backup = tempfile.mkdtemp(prefix=f"mod-{name}-", dir=BACKUPS)
            shutil.copytree(target, os.path.join(backup, name), symlinks=True)
            backup = os.path.join(backup, name)
        try:
            replace_owned(candidate, target)
            if not check_mod(name, target):
                raise RuntimeError("installed mod check failed")
        except (OSError, RuntimeError) as error:
            say("failed", f"{name}: {error}")
            if backup:
                replace_owned(backup, target)
                say("restored", f"{name}: previous files from {backup}")
            else:
                clear_owned(target)
                marker = os.path.join(target, MARK)
                if os.path.exists(marker):
                    os.remove(marker)
                say("removed", f"{name}: failed first install (host files preserved)")
            return False
    say("copied", f"{name}")
    return True


def host_file(entry):
    return entry.endswith(HERDR_WRITES) or entry in HERDR_WRITES


def copy_entry(source, target):
    if os.path.isdir(source) and not os.path.islink(source):
        shutil.copytree(source, target, symlinks=True)
    else:
        shutil.copy2(source, target, follow_symlinks=False)


def clear_owned(target):
    """Remove installer-owned files only; retain host definitions, errors and marker."""
    os.makedirs(target, exist_ok=True)
    for entry in os.listdir(target):
        if not host_file(entry):
            path = os.path.join(target, entry)
            shutil.rmtree(path) if os.path.isdir(path) and not os.path.islink(path) else os.remove(path)


def replace_owned(source, target):
    """Replace code/assets, preserving files the live host may have written meanwhile."""
    clear_owned(target)
    for entry in os.listdir(source):
        if not host_file(entry) or entry == MARK:
            copy_entry(os.path.join(source, entry), os.path.join(target, entry))


def check_mod(name, path):
    try:
        result = subprocess.run(["herdr-app", "check", path], capture_output=True, text=True, timeout=30)
        detail = (result.stdout + result.stderr).strip().splitlines()
        say("check", f"{name}: {'ok' if result.returncode == 0 else (detail[-1] if detail else f'exit {result.returncode}')}")
        return result.returncode == 0
    except (OSError, subprocess.SubprocessError) as error:
        say("check", f"{name}: {type(error).__name__}")
        return False


def mod_libs(src):
    """Copy JS imports, their declared Python helpers, and transitive Python imports."""
    py = "\n".join(Path(src, f).read_text() for f in sorted(os.listdir(src)) if f.endswith(".py"))
    main = Path(src, "main.js").read_text()
    js = libs_for(main)
    # JS helpers may declare a Python runtime dependency next to their import.
    texts = main + "\n" + "\n".join(Path(REPO, "lib", name).read_text() for name in js)
    direct_py = [name for name in os.listdir(os.path.join(REPO, "lib"))
                 if name.endswith(".py") and f'"./{name}"' in texts]
    py += "\n" + "\n".join(Path(REPO, "lib", name).read_text() for name in direct_py)
    return js + sorted(set(direct_py + libs_for(py, ".py")))


def libs_for(text, kind=".js"):
    """The lib/*<kind> that `text` imports and those they import: for .js, an import of "./x.js";
    for .py, "import x" or "from x import" at a line's start."""
    lib_dir = os.path.join(REPO, "lib")
    known = [f for f in os.listdir(lib_dir) if f.endswith(kind)]
    if kind == ".js":
        imports = lambda lib, t: f'"./{lib}"' in t
    else:
        imports = lambda lib, t: re.search(rf"^\s*(?:from|import)\s+{re.escape(lib[:-len(kind)])}\b", t, re.M) is not None
    need, todo = set(), [text]
    while todo:
        t = todo.pop()
        for lib in known:
            if lib not in need and imports(lib, t):
                need.add(lib)
                todo.append(Path(lib_dir, lib).read_text())
    return sorted(need)


# 2. layout ----------------------------------------------------------------------------

def blocks(node, parent=None):
    """Every node with its parent's children list, depth first."""
    if isinstance(node, dict):
        yield node, parent
        for child in node.get("children", []) or []:
            yield from blocks(child, node.get("children"))


def uses(layout, mod):
    return any((n.get("content") or {}).get("mod") == mod for n, _ in blocks(layout)) or any((f.get("content") or {}).get("mod") == mod for f in layout.get("floating", []))


def patch(layout, step):
    """Applies one bundle layout step; returns what it did, or None if already there."""
    kind, spec = next(iter(step.items()))
    if kind == "swap":
        hits = [n for n, _ in blocks(layout) if (n.get("content") or {}).get("mod") == spec["from"]]
        for n in hits:
            n["content"]["mod"] = spec["to"]
        if hits:
            return f'{spec["from"]} -> {spec["to"]}'
        return None if uses(layout, spec["to"]) else f'(no {spec["from"]} block to swap for {spec["to"]})'
    if kind == "float":
        if uses(layout, spec["mod"]):
            return None
        layout.setdefault("floating", []).append({"id": spec["id"], "content": {"mod": spec["mod"]}, "edge": spec["edge"], "align": spec["align"]})
        return f'floating {spec["mod"]}'
    if kind == "status":
        if uses(layout, spec["mod"]):
            return None
        for n, siblings in blocks(layout):
            if (n.get("content") or {}).get("mod") != "workspace-status" or siblings is None:
                continue
            ours = {"id": spec["id"], "type": "block", "size": {"px": spec["px"]}, "content": {"mod": spec["mod"]}}
            row = next((p for p, _ in blocks(layout) if p.get("children") is siblings), None)
            if row is not None and row.get("type") == "row" and row.get("id") == "status-row":
                siblings.insert(0, ours)
            else:
                i = siblings.index(n)
                bar = dict(n)
                size = bar.pop("size", {"px": 28})
                siblings[i] = {"id": "status-row", "type": "row", "size": size, "children": [ours, bar]}
            return f'{spec["mod"]} beside the bottom bar'
        return f'(no bottom bar for {spec["mod"]})'
    return f"(unknown layout step {kind})"


def target_layout(name, dry):
    """The layout file to change: a personal one as it is, a shipped one copied first.
    Herdr keeps the shown layout's name in shared.json ("layout")."""
    shown = (load(os.path.join(HOME, "shared.json"), {}) or {}).get("layout")
    name = name or (shown if isinstance(shown, str) else None) or "main"
    path = os.path.join(HOME, "layouts", f"{name}.json")
    if name not in SHIPPED_LAYOUTS:
        return name, path, False
    copy = os.path.join(HOME, "layouts", f"{COPY_LAYOUT}.json")
    if not os.path.exists(copy):
        data = load(path, {})
        data["cloned_from"] = {"name": name, "version": (load(os.path.join(HOME, "update-notes.json"), {}) or {}).get("last_run", "")}
        if not dry:
            with open(copy, "w") as f:
                f.write(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
        say("layout", f"{name} is Herdr's own: copied to {COPY_LAYOUT}")
    return COPY_LAYOUT, copy, True


# 4. commands and skills ---------------------------------------------------------------

def install_bin(name, dry):
    src, target = os.path.join(REPO, "bin", name), os.path.join(BIN, name)
    if os.path.exists(target) and BIN_MARK not in open(target, errors="replace").read(400):
        say("skip", f"{target} is already there and isn't herdr-mods'; rename or remove it")
        return
    if dry:
        return say("would", f"copy bin/{name} to {target}")
    os.makedirs(BIN, exist_ok=True)
    shutil.copy2(src, target)
    os.chmod(target, 0o755)
    say("command", f"{name} -> {target}" + ("" if BIN in os.environ.get("PATH", "").split(":") else f" ({BIN} isn't on PATH)"))


def install_skill(name, dry):
    homes = [h for h in SKILL_HOMES if os.path.isdir(h)]
    if not homes:
        return say("skip", f"skill {name}: no ~/.claude or ~/.codex here")
    for h in homes:
        target = os.path.join(h, "skills", name)
        if os.path.exists(target) and not os.path.exists(os.path.join(target, MARK)):
            say("skip", f"{target} is already there and wasn't installed by this script")
            continue
        if dry:
            say("would", f"copy skills/{name} to {target}")
            continue
        if os.path.isdir(target):
            shutil.rmtree(target)
        shutil.copytree(os.path.join(REPO, "skills", name), target, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
        scripts = os.path.join(target, "scripts")
        if os.path.isdir(scripts):  # the lib/*.py a skill's scripts import, beside them (so they run anywhere)
            text = "\n".join(open(os.path.join(scripts, f)).read() for f in sorted(os.listdir(scripts)) if f.endswith(".py"))
            for lib in libs_for(text, ".py"):
                shutil.copy2(os.path.join(REPO, "lib", lib), os.path.join(scripts, lib))
        with open(os.path.join(target, MARK), "w") as f:
            f.write(REPO + "\n")
        say("skill", f"{name} -> {target}")


# 3. keys ------------------------------------------------------------------------------

def merge_keys(keys, wanted, replace):
    g = keys.setdefault("global", {})
    changed = False
    for key, action in wanted.items():
        now = g.get(key)
        if now == action:
            continue
        if now is not None and not replace:
            say("key", f"{key} stays {now} (wanted {action}; --replace-keys binds it)")
            continue
        g[key] = action
        changed = True
        say("key", f"{key} -> {action}" + (f" (was {now})" if now else ""))
    return changed


def main(argv):
    args = [a for a in argv if not a.startswith("--")]
    dry, replace = "--dry-run" in argv, "--replace-keys" in argv
    layout_name = None
    if "--layout" in argv:
        i = argv.index("--layout")
        layout_name = argv[i + 1] if i + 1 < len(argv) else None
        args = [a for a in args if a != layout_name]
    bundles = load(os.path.join(REPO, "bundles.json"))
    picked = args or list(bundles)
    unknown = [b for b in picked if b not in bundles]
    if unknown:
        print(f"unknown bundle(s): {', '.join(unknown)}; bundles: {', '.join(bundles)}", file=sys.stderr)
        return 2
    if "agents" in picked and "worktrees" not in picked and not os.path.exists(os.path.join(HOME, "mods", "spaces-plus", MARK)):
        say("note", "agents without worktrees: clicking an outside agent resumes it in a new tab or space, not in its worktree's")

    results = [install_mod(m, dry) for m in dict.fromkeys(m for b in picked for m in bundles[b]["mods"])]
    if not all(results):
        say("failed", "one or more mods were not installed; layout, keys and commands were not changed")
        return 1

    # Only bundles with layout steps touch a layout (commands, say, has none).
    steps = [step for b in picked for step in bundles[b]["layout"]]
    name, path, copied = target_layout(layout_name, dry) if steps else (None, None, False)
    layout = load(path) if steps else None
    if not steps:
        pass
    elif layout is None:
        say("layout", f"{path} unreadable: layout left as it is")
    else:
        done = [d for step in steps if (d := patch(layout, step))]
        for d in done:
            say("layout", f"{name}: {d}")
        if done:
            save(path, layout, dry)

    keys_path = os.path.join(HOME, "keys.json")
    keys = load(keys_path, {}) or {}
    wanted = {k: v for b in picked for k, v in bundles[b].get("keys", {}).items()}
    if merge_keys(keys, wanted, replace):
        save(keys_path, keys, dry)

    for b in picked:
        for name in bundles[b].get("bin", []):
            install_bin(name, dry)
        for name in bundles[b].get("skills", []):
            install_skill(name, dry)

    for b in picked:
        if bundles[b].get("note"):
            say("note", f"{b}: {bundles[b]['note']}")
    if copied:
        say("next", f"switch to the {COPY_LAYOUT} layout: ctrl-shift-l, or herdr-app do layout.switch --name {COPY_LAYOUT}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
