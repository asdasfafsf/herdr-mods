#!/bin/sh
# Brings what Herdr changed in its shipped mods into our clones of them.
#
# Herdr rewrites its shipped mods (~/.config/herdr-app/mods/<name>) on every start. Each
# clone here was made from one of them; upstream/<name>/ keeps the shipped files as they
# were when the clone was last merged. For each pair below whose shipped main.js changed:
#   1. show what Herdr changed (and keep it in upstream-changes/<name>.diff), so we can
#      see whether Herdr now does natively what the clone adds (then drop ours);
#   2. three-way merge that change into mods/<clone>/main.js (git merge-file): our edits
#      stay, Herdr's land; lines both changed are left with conflict markers;
#   3. refresh upstream/<name>/ and upstream/versions.json.
# Clones rewrite their own names (mods/<name>/ paths, mod: "<name>" overlays), so the same
# rewrite is applied to both shipped versions before merging. Nothing is installed when a
# file has conflicts; without conflicts, merged clones are copied into Herdr and checked.
set -eu

repo="$(cd "$(dirname "$0")/.." && pwd)"
home="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
pairs="spaces-plus:spaces worktree-plus:worktree picker-plus:picker agents-plus:agents"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
mkdir -p "$repo/upstream-changes"
conflicts=0
merged=""

for pair in $pairs; do
  ours="${pair%%:*}"
  base="${pair##*:}"
  shipped="$home/mods/$base/main.js"
  snap="$repo/upstream/$base/main.js"
  mine="$repo/mods/$ours/main.js"
  if [ ! -f "$mine" ]; then
    echo "skip    $ours: mods/$ours/main.js isn't in the repo"
    continue
  fi
  if cmp -s "$shipped" "$snap"; then
    echo "same    $base (nothing new for $ours)"
    continue
  fi
  echo "changed $base -> merging into $ours"
  git --no-pager diff --no-index --stat "$snap" "$shipped" || true
  git --no-pager diff --no-index "$snap" "$shipped" > "$repo/upstream-changes/$base.diff" || true
  rename="s|mods/$base/|mods/$ours/|g; s|mod: \"$base\"|mod: \"$ours\"|g"
  sed "$rename" "$snap" > "$tmp/base.js"
  sed "$rename" "$shipped" > "$tmp/theirs.js"
  n=0
  git merge-file -L "$ours (ours)" -L "$base (before)" -L "$base (Herdr now)" "$mine" "$tmp/base.js" "$tmp/theirs.js" || n=$?
  if [ "$n" -eq 0 ]; then
    echo "        merged cleanly"
    merged="$merged $ours"
  elif [ "$n" -gt 127 ]; then
    echo "        git merge-file failed for $ours"
    exit 1
  else
    echo "        $n conflict(s) left in mods/$ours/main.js: fix them, then run this again"
    conflicts=$((conflicts + n))
  fi
  cp "$shipped" "$snap"
  cp "$home/mods/$base/mod.json" "$repo/upstream/$base/mod.json"
done

python3 -I - "$home/installed.json" "$repo/upstream/versions.json" <<'PY'
import json, sys
inst = json.load(open(sys.argv[1]))
path = sys.argv[2]
v = json.load(open(path))
for b in v["mods"]:
    v["mods"][b] = inst.get(b, v["mods"][b])
open(path, "w").write(json.dumps(v, indent=2) + "\n")
PY

if [ "$conflicts" -gt 0 ]; then
  echo "not installed: $conflicts conflict(s). Herdr's changes are in upstream-changes/."
  exit 1
fi
for ours in $merged; do
  rsync -a --exclude jsconfig.json --exclude '*.d.ts' --exclude '*.error' --exclude .herdr-mods --exclude .DS_Store --exclude '*.md' --exclude __pycache__ "$repo/mods/$ours/" "$home/mods/$ours/"
  # The lib files beside the mod, as install.sh does (a mod can't import from outside its
  # folder): lib/*.js its main.js imports, lib/*.py its .py files import, and those they import.
  for lib in $(python3 -I -c 'import sys; sys.path.insert(0, sys.argv[1]); import install; print(" ".join(install.mod_libs(sys.argv[2])))' "$repo/scripts" "$repo/mods/$ours"); do
    cp "$repo/lib/$lib" "$home/mods/$ours/"
  done
  herdr-app check "$home/mods/$ours"
done
echo "done. Review upstream-changes/*.diff: if Herdr now does what a clone adds, drop ours."
