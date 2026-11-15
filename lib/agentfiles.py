"""agentfiles.py (herdr-mods lib): where Claude Code and Codex keep their records, and how to
read them, one way for the Python helpers that read the same files (agents-plus's outside.py
and activity.py, wt-sessions's sessions.py, usage-bar's usage.py). install.sh copies it beside
each mod whose .py imports it. Change it here, then run install.sh.

Everything here reads files on this computer (and asks ps/lsof about processes); nothing is
sent anywhere.

    import os, sys
    sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)),          # installed beside it
                    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "lib")]  # in the repo
    from agentfiles import ...
"""

import glob
from contextlib import closing
import json
import os
import re
import subprocess
import sqlite3

HOME = os.path.expanduser("~")
CLAUDE_HOME = os.path.join(HOME, ".claude")
CLAUDE_PROJECTS = os.path.join(CLAUDE_HOME, "projects")  # <folder, non-alphanumerics as "-">/<session>.jsonl
CLAUDE_SESSIONS = os.path.join(CLAUDE_HOME, "sessions")  # <pid>.json for each running claude
CODEX_HOME = os.environ.get("CODEX_HOME") or os.path.join(HOME, ".codex")
CODEX_SESSIONS = os.path.join(CODEX_HOME, "sessions")  # YYYY/MM/DD/rollout-<time>-<session>.jsonl
CODEX_INDEX = os.path.join(CODEX_HOME, "session_index.jsonl")  # { id, thread_name } per line
HERDR_STATE = os.path.join(HOME, ".herdr")  # our own caches and records
SESSION_ID = re.compile(r"([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$")


def load(path, default=None):
    """A JSON file, or default when it's missing or not JSON."""
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save(path, data):
    """A JSON file written whole (to a temporary file, then moved over it); False if it couldn't be."""
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path + ".tmp", "w") as f:
            json.dump(data, f)
        os.replace(path + ".tmp", path)
        return True
    except OSError:
        return False


def json_lines(path, start=0, size=None, tail=None):
    """The JSON objects of a .jsonl file, one per line, skipping what doesn't parse: from byte
    start (size bytes, or to the end), or its last `tail` bytes (the first, cut line dropped)."""
    with open(path, "rb") as f:
        if tail is not None:
            whole = os.fstat(f.fileno()).st_size
            f.seek(max(0, whole - tail))
            data = f.read()
            parts = data.split(b"\n")[1 if whole > tail else 0:]
        else:
            if start:
                f.seek(start)
            parts = (f.read(size) if size else f.read()).split(b"\n")
    for raw in parts:
        try:
            yield json.loads(raw)
        except ValueError:
            continue


def project_dir_name(folder):
    """The folder of Claude Code's transcripts for sessions in `folder`."""
    return re.sub(r"[^A-Za-z0-9]", "-", folder or "")


def text_of(content):
    """Plain text blocks shared by history search and the saved-session sidebar."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(b.get("text", "") for b in content if isinstance(b, dict)
                         and b.get("type") in ("text", "input_text", "output_text")
                         and isinstance(b.get("text", ""), str))
    return ""


def prompt_title(text):
    """A prompt's first line, excluding machine context and command wrappers."""
    text = text.strip() if isinstance(text, str) else ""
    if not text or text.startswith("<") or text.startswith("# AGENTS.md"):
        return None
    return text.splitlines()[0].strip()[:100]


def claude_transcript(session, cwd=None):
    """A Claude Code session's transcript (.jsonl), by the folder it ran in, else anywhere."""
    if cwd:
        p = os.path.join(CLAUDE_PROJECTS, project_dir_name(cwd), f"{session}.jsonl")
        if os.path.exists(p):
            return p
    hits = glob.glob(os.path.join(CLAUDE_PROJECTS, "*", f"{session}.jsonl"))
    return hits[0] if hits else None


def claude_running(pid):
    """What a running claude keeps about itself (sessionId, cwd, status, name...), or {}."""
    return load(os.path.join(CLAUDE_SESSIONS, f"{pid}.json"), {}) or {}


def claude_registry():
    """Every running claude's record: [(pid, record)] (the process may have ended since)."""
    out = []
    for f in glob.glob(os.path.join(CLAUDE_SESSIONS, "*.json")):
        d = load(f)
        if isinstance(d, dict) and d.get("pid"):
            out.append((d["pid"], d))
    return out


def codex_rollout_of(pid):
    """A single open rollout; a shared server holding several is not one TUI session."""
    try:
        out = subprocess.run(["lsof", "-a", "-p", str(pid), "-Fn"], capture_output=True, text=True, timeout=3).stdout
    except (OSError, subprocess.SubprocessError):
        return None
    paths = set(re.findall(r"^n(/[^\n]*rollout-[^\n]*\.jsonl)$", out, re.M))
    return next(iter(paths)) if len(paths) == 1 else None


def codex_rollout(session):
    """A Codex session's rollout file, by its id, or None."""
    record = codex_metadata(session=session).get(session)
    if record and os.path.isfile(record.get("rollout_path") or ""):
        return record["rollout_path"]
    hits = glob.glob(os.path.join(CODEX_SESSIONS, "*", "*", "*", f"rollout-*{session}.jsonl"))
    return hits[0] if hits else None


def codex_metadata(limit=None, sessions=None, *, session=None):
    """Read-only index with bounded/exact queries and optional schema columns.

    Preserve saved-history's positional (limit, sessions) API and the native
    adapter's positional string ID, as well as explicit session= requests.
    """
    if isinstance(limit, str) and session is None:
        session, limit = limit, None
    try:
        database = os.path.join(CODEX_HOME, "state_5.sqlite")
        with closing(sqlite3.connect(f"file:{database}?mode=ro", uri=True, timeout=1)) as connection:
            connection.row_factory = sqlite3.Row
            columns = {r[1] for r in connection.execute("PRAGMA table_info(threads)")}
            wanted = ("id", "cwd", "title", "name", "rollout_path", "source", "updated_at", "archived",
                      "originator", "thread_source", "history_mode", "attached_thread_parent_id")
            selected = [name for name in wanted if name in columns]
            if "id" not in selected:
                return {}
            query = "SELECT " + ",".join(selected) + " FROM threads"
            params = ()
            if session is not None:
                query += " WHERE id=?"
                params = (session,)
            elif sessions is not None:
                sessions = tuple(sessions)
                if not sessions:
                    return {}
                query += " WHERE id IN (" + ",".join("?" for _ in sessions) + ")"
                params = sessions
            elif limit is not None:
                if "archived" in columns:
                    query += " WHERE archived = 0"
                query += " ORDER BY " + ("updated_at DESC," if "updated_at" in columns else "") + "id LIMIT ?"
                params = (max(0, int(limit)),)
            return {r["id"]: dict(r) for r in connection.execute(query, params)}
    except (OSError, sqlite3.Error):
        return {}


def codex_session_meta(path):
    """Read only the first header, never mistake a fork's copied header for its identity."""
    try:
        with open(path, encoding="utf-8") as f:
            item = json.loads(f.readline(2 * 1024 * 1024))
        payload = item.get("payload")
        return payload if item.get("type") == "session_meta" and isinstance(payload, dict) else {}
    except (OSError, ValueError, TypeError, AttributeError):
        return {}


def codex_session_kind(record, meta=None):
    """Recorded client origin, NOT the current writer. vscode alone is not desktop proof.

    Resume can update originator; this describes available metadata, not immutable
    creation provenance. Internal children take precedence over every client label.
    """
    records = [record or {}, meta or {}]
    sources = []
    for rec in records:
        source = rec.get("source")
        if isinstance(source, str) and source.lstrip().startswith("{"):
            try:
                source = json.loads(source)
            except ValueError:
                pass
        if ((isinstance(source, dict) and "subagent" in source)
                or rec.get("attached_thread_parent_id")):
            return "subagent"
        sources.append(source)
    source = next((s for s in sources if s is not None), None)
    if source in (None, "cli", "vscode") and any(r.get("originator") in ("codex_work_desktop", "Codex Desktop") for r in records):
        return "desktop"
    # Older CLI headers omitted source. Paginated history alone is not desktop
    # evidence and an unrecognized modern origin must not inherit this fallback.
    if source is None and meta and (meta.get("id") or meta.get("session_id")) and not any(r.get("originator") or r.get("history_mode") for r in records):
        return "cli"
    return {"cli": "cli", "vscode": "editor", "exec": "exec"}.get(source, "unknown") if isinstance(source, str) else "unknown"


def codex_running(session):
    """Active writer or legacy rollout owner, including a shared app-server process."""
    paths = [os.path.join(CODEX_HOME, "thread-writer-locks", session + ".lock")]
    path = codex_rollout(session)
    if path:
        paths.append(path)
    for path in paths:
        if not os.path.isfile(path):
            continue
        try:
            result = subprocess.run(["lsof", "-t", path], capture_output=True, text=True, timeout=3)
            if result.stdout.strip():
                return True
            if result.returncode not in (0, 1) or result.stderr.strip():
                raise RuntimeError("Could not check whether the Codex session is running")
        except (OSError, subprocess.SubprocessError):
            # Can't prove a move is safe when the process check failed.
            raise RuntimeError("Could not check whether the Codex session is running")
    return False


def codex_rollouts(days=None):
    """Codex's rollout files, newest first by when they last changed; `days`: from the newest
    that many day folders (in the newest two months) only, not the whole history."""
    if not os.path.isdir(CODEX_SESSIONS):
        return []
    if days is None:
        found = [os.path.join(d, n) for d, _, names in os.walk(CODEX_SESSIONS) for n in names if n.endswith(".jsonl")]
    else:
        found = []
        for y in sorted(os.listdir(CODEX_SESSIONS), reverse=True)[:2]:
            for m in sorted(os.listdir(os.path.join(CODEX_SESSIONS, y)), reverse=True)[:2]:
                for d in sorted(os.listdir(os.path.join(CODEX_SESSIONS, y, m)), reverse=True)[:days]:
                    base = os.path.join(CODEX_SESSIONS, y, m, d)
                    found += [os.path.join(base, n) for n in os.listdir(base) if n.endswith(".jsonl")]
    return sorted(found, key=os.path.getmtime, reverse=True)


def codex_session_id(path):
    """The session id in a rollout file's name, or None."""
    m = SESSION_ID.search(path or "")
    return m.group(1) if m else None


def codex_names(tail=None):
    """Codex's thread names, { session id: name }."""
    names = {}
    if os.path.exists(CODEX_INDEX):
        for o in json_lines(CODEX_INDEX, tail=tail):
            if isinstance(o, dict) and isinstance(o.get("id"), str) and isinstance(o.get("thread_name"), str):
                names[o["id"]] = o["thread_name"]
    return names
