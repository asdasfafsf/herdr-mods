#!/usr/bin/env python3
"""Copies the files a new worktree needs but git doesn't carry, for worktree-plus.

    include.py <primary checkout> <new worktree> [extra patterns, one per line]

Which files: the repo's .worktreeinclude (the convention Claude Code and Orca use, in
.gitignore syntax: one pattern per line, # comments; a pattern with no slash matches at any
depth, one with a slash is from the repo root, a trailing slash means a folder), plus the
extra patterns given. Only files git ignores or doesn't track are candidates: tracked ones are
in the new checkout already. Each match is copied from the primary checkout to the same place
in the worktree, as an APFS clone on macOS when it can (instant, no extra disk until changed),
else a plain copy; anything already there is left alone.

Prints JSON: { "copied": [paths], "kept": [paths already there], "patterns": [patterns used] }.
"""

import fnmatch
import json
import os
import subprocess
import sys


def patterns_of(primary, extra):
    lines = []
    try:
        with open(os.path.join(primary, ".worktreeinclude")) as f:
            lines += f.read().splitlines()
    except OSError:
        pass
    lines += (extra or "").splitlines()
    out = []
    for line in lines:
        p = line.strip()
        if p and not p.startswith("#") and not p.startswith("!") and p not in out:
            out.append(p)
    return out


def candidates(primary):
    """Paths git ignores or doesn't track, ignored folders as one entry ("node_modules/")."""
    r = subprocess.run(["git", "-C", primary, "ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
                       capture_output=True, text=True)
    untracked = subprocess.run(["git", "-C", primary, "ls-files", "--others", "--exclude-standard", "-z"], capture_output=True, text=True)
    return [p for p in (r.stdout + untracked.stdout).split("\0") if p]


def matches(path, pattern):
    folder = pattern.endswith("/")
    pat = pattern.strip("/")
    is_dir = path.endswith("/")
    clean = path.rstrip("/")
    if folder and not is_dir:
        return False
    if "/" in pat:  # from the repo root
        return fnmatch.fnmatch(clean, pat) or clean.startswith(pat + "/")
    # anywhere: the name of any part of the path
    return any(fnmatch.fnmatch(part, pat) for part in clean.split("/"))


def copy(src, dst):
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    for args in (["cp", "-c", "-R", src, dst], ["cp", "-R", src, dst]):
        if subprocess.run(args, capture_output=True).returncode == 0:
            return True
    return False


def main(argv):
    if len(argv) < 2:
        print(__doc__, file=sys.stderr)
        return 2
    primary, target = os.path.realpath(argv[0]), os.path.realpath(argv[1])
    pats = patterns_of(primary, argv[2] if len(argv) > 2 else "")
    copied, kept = [], []
    if pats:
        seen = set()
        for path in candidates(primary):
            clean = path.rstrip("/")
            if clean in seen or not any(matches(path, p) for p in pats):
                continue
            seen.add(clean)
            src, dst = os.path.join(primary, clean), os.path.join(target, clean)
            if os.path.lexists(dst):
                kept.append(clean)
            elif os.path.lexists(src) and copy(src, dst):
                copied.append(clean)
    print(json.dumps({"copied": copied, "kept": kept, "patterns": pats}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
