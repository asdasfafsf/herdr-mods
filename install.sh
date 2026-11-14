#!/bin/sh
# Installs herdr-mods into the Herdr app: ./install.sh [bundle ...] [--layout NAME] [--replace-keys] [--dry-run]
# Bundles (bundles.json): worktrees, agents, palette, restore, usage, notify; none named: all.
# Run it again after `git pull` to update. What it does, step by step: scripts/install.py.
set -eu
exec python3 -I "$(cd "$(dirname "$0")" && pwd)/scripts/install.py" "$@"
