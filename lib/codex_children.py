"""Read-only Codex internal-thread discovery, separate from terminal sessions.

The SQLite index owns identity and parentage: a forked rollout can contain its
parent's session_meta. Only explicit lifecycle events (or an item explicitly
owned by the child) provide state. Database recency never means "working".
"""
from collections import defaultdict, deque
from datetime import datetime
import json
import os
from pathlib import Path
import sqlite3
import time


MAX_DEPTH = 4
MAX_CHILDREN = 64
MAX_ROWS = 4096
TAIL_BYTES = 512 * 1024
DB_TIMEOUT = 0.15
DB_BUDGET = 0.5

# Do not derive terminal state from assistant text or a tool's result contents.
LIFECYCLE = {
    "task_started": "working",
    "task_complete": "done",
    "task_failed": "error",
    "turn_aborted": "unknown",
}


def _milliseconds(value):
    try:
        return int(float(value) * 1000)
    except (TypeError, ValueError, OverflowError):
        return 0


def _timestamp(value):
    if not isinstance(value, str):
        return 0
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        # Codex emits timezone-qualified timestamps; do not guess local time.
        return int(parsed.timestamp() * 1000) if parsed.tzinfo else 0
    except (ValueError, OverflowError, OSError):
        return 0


def _rows(home):
    path = home / "state_5.sqlite"
    if not path.is_file():
        return []
    connection = None
    try:
        deadline = time.monotonic() + DB_BUDGET
        connection = sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True, timeout=DB_TIMEOUT)
        connection.row_factory = sqlite3.Row
        connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(threads)")}
        required = {"id", "source", "rollout_path", "created_at", "updated_at"}
        if not required.issubset(columns):
            return []
        selected = sorted(required | (columns & {"created_at_ms", "updated_at_ms", "cwd", "agent_nickname", "agent_path"}))
        # Only internal spawn records; prompts, titles and previews are not read.
        query = "SELECT " + ",".join(selected) + " FROM threads WHERE source LIKE ? ORDER BY updated_at DESC LIMIT ?"
        return [dict(row) for row in connection.execute(query, ("%thread_spawn%", MAX_ROWS))]
    except (sqlite3.Error, OSError, ValueError):
        return []
    finally:
        if connection is not None:
            connection.close()


def _spawn(row):
    try:
        source = json.loads(row["source"])
        spawn = source["subagent"]["thread_spawn"]
        if not isinstance(spawn, dict) or not isinstance(spawn.get("parent_thread_id"), str):
            return None
        return spawn
    except (TypeError, ValueError, KeyError):
        return None


def _events(path):
    """A bounded tail, skipping partial/malformed records during concurrent writes."""
    try:
        with open(path, "rb") as stream:
            stream.seek(0, os.SEEK_END)
            start = max(0, stream.tell() - TAIL_BYTES)
            stream.seek(start)
            if start:
                # Drop an initial record only if the seek landed inside it.
                stream.seek(start - 1)
                if stream.read(1) != b"\n":
                    stream.readline(TAIL_BYTES)
            data = stream.read(TAIL_BYTES)
        for line in data.splitlines():
            try:
                event = json.loads(line)
                if isinstance(event, dict) and event.get("type") == "event_msg":
                    yield event
            except (ValueError, UnicodeDecodeError):
                continue
    except (OSError, TypeError, ValueError):
        return


def _state(row):
    state, evidence = "unknown", "unavailable"
    updated = row.get("updated_at_ms") or _milliseconds(row.get("updated_at"))
    created = row.get("created_at_ms") or _milliseconds(row.get("created_at"))
    precise_creation = bool(row.get("created_at_ms"))
    events = list(_events(row.get("rollout_path")))
    owned_turns = set()
    for event in events:
        payload = event.get("payload")
        if not isinstance(payload, dict) or payload.get("thread_id") != row["id"]:
            continue
        turn = payload.get("turn_id")
        if isinstance(turn, str) and turn and _timestamp(event.get("timestamp")) >= created:
            owned_turns.add(turn)
    latest = 0
    for event in events:
        payload = event.get("payload")
        if not isinstance(payload, dict):
            continue
        stamp = _timestamp(event.get("timestamp"))
        owner = payload.get("thread_id")
        if not stamp or stamp < created or stamp < latest or (owner and owner != row["id"]):
            continue
        kind = payload.get("type")
        turn = payload.get("turn_id")
        owned = owner == row["id"] or (isinstance(turn, str) and turn in owned_turns)
        # Older indexes round creation down to a whole second. An inherited
        # parent event from that same second cannot establish child state.
        ambiguous_creation = not created or (not precise_creation and stamp < created + 1000)
        if not isinstance(kind, str) or (ambiguous_creation and not owned):
            continue
        next_state = LIFECYCLE.get(kind)
        if kind == "item_completed" and owner == row["id"]:
            # Newer versions put the real thread ID here even when session_meta
            # is inherited. This also works when task_started is outside the tail.
            next_state = "working"
        if next_state is not None:
            state, evidence, updated, latest = next_state, kind, stamp, stamp
    return {"state": state, "evidence": evidence, "updated": updated}


def children_for(parent_session_ids, codex_home=None):
    """Return descendants for each requested parent, without creating sessions.

    Rows contain id, direct parent_session_id, name, state, evidence, updated
    (Unix milliseconds), relative depth, and optional nickname/cwd. State is
    working/done/error/unknown; read/seen presentation belongs to the UI model.
    Missing, unavailable or incompatible indexes return empty lists. Discovery
    is bounded to MAX_ROWS recent spawn records, MAX_CHILDREN per root and
    MAX_DEPTH levels; rollouts are read only in bounded tails.
    """
    if isinstance(parent_session_ids, str):
        parent_session_ids = [parent_session_ids]
    roots = dict.fromkeys(value for value in parent_session_ids if isinstance(value, str) and value)
    result = {root: [] for root in roots}
    if not result:
        return result
    home = Path(codex_home or os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    by_parent = defaultdict(list)
    for row in _rows(home):
        spawn = _spawn(row)
        if spawn and isinstance(row["id"], str) and row["id"]:
            by_parent[spawn["parent_thread_id"]].append((row, spawn))
    states = {}
    for root, children in result.items():
        visited = {root}
        pending = deque([(root, 1)])
        while pending and len(children) < MAX_CHILDREN:
            parent, depth = pending.popleft()
            for row, spawn in by_parent.get(parent, []):
                sid = row["id"]
                if sid in visited:
                    continue
                visited.add(sid)
                path = spawn.get("agent_path") or row.get("agent_path")
                nickname = spawn.get("agent_nickname") or row.get("agent_nickname")
                name = path.rstrip("/").rsplit("/", 1)[-1] if isinstance(path, str) and path.strip("/") else nickname
                if sid not in states:
                    states[sid] = _state(row)
                child = {"id": sid, "parent_session_id": parent, "name": name if isinstance(name, str) and name else sid,
                         "depth": depth, **states[sid]}
                if isinstance(nickname, str) and nickname:
                    child["nickname"] = nickname
                if isinstance(row.get("cwd"), str) and row["cwd"]:
                    child["cwd"] = row["cwd"]
                children.append(child)
                if depth < MAX_DEPTH:
                    pending.append((sid, depth + 1))
                if len(children) >= MAX_CHILDREN:
                    break
    return result
