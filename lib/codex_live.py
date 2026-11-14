"""Resolve a local Codex TUI without assuming it owns the shared server's rollout.

Direct open files are authoritative. Daemon clients can only be matched when the
complete terminal title and cwd select exactly one named, live-writer session.
Never pick the newest session or use cwd alone. Ambiguity means unresolved.
"""
import json
import os
import re
import sqlite3
import subprocess
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from agentfiles import CODEX_HOME, codex_names, codex_rollout_of, codex_session_id


def named_session(cwd, title, records, names):
    """Unique full displayed name plus cwd; truncated/empty titles cannot identify a session."""
    label = re.sub(r"^[^\w]+", "", title or "").split(" | ")[0]
    if not cwd or not label or label.endswith(("…", "...")):
        return None
    hits = [r for r in records if os.path.realpath(r["cwd"]) == os.path.realpath(cwd)
            and label == (names.get(r["id"]) or r.get("name") or r.get("title"))]
    return hits[0] if len(hits) == 1 else None


def writer_open(session):
    """True/False for an open/stale lock, None when the process probe is inconclusive."""
    path = os.path.join(CODEX_HOME, "thread-writer-locks", session + ".lock")
    if not os.path.isfile(path):
        return False
    try:
        r = subprocess.run(["lsof", "-t", path], capture_output=True, text=True, timeout=3)
        if r.stdout.strip():
            return True
        return False if r.returncode in (0, 1) and not r.stderr.strip() else None
    except (OSError, subprocess.SubprocessError):
        return None


def resolve(pid, cwd=None, title=None, argv=None):
    """Return session/source, or None; only inspect an existing Codex client process."""
    if any(arg == "--remote" or arg.startswith("--remote=") for arg in (argv or [])):
        return None  # A remote client's session does not belong to this machine's index.
    try:
        comm = subprocess.run(["ps", "-p", str(pid), "-o", "comm="],
                              capture_output=True, text=True, timeout=3).stdout.strip()
        if not os.path.basename(comm).startswith("codex"):
            return None
        path = codex_rollout_of(pid)
        if path:
            return {"session": codex_session_id(path), "source": "open-file"}
        database = os.path.join(CODEX_HOME, "state_5.sqlite")
        with sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=1) as connection:
            connection.row_factory = sqlite3.Row
            records = [dict(r) for r in connection.execute(
                "SELECT id,cwd,title,name,rollout_path FROM threads WHERE archived=0")]
        match = named_session(cwd, title, records, codex_names())
        if match and os.path.isfile(match["rollout_path"]) and writer_open(match["id"]):
            return {"session": match["id"], "source": "unique-title-cwd"}
    except (OSError, ValueError, sqlite3.Error, subprocess.SubprocessError):
        pass
    return None


if __name__ == "__main__":
    request = json.loads(sys.argv[1])
    print(json.dumps(writer_open(request["writer"]) if "writer" in request else
                     resolve(int(request["pid"]), request.get("cwd"), request.get("title"), request.get("argv"))))
