"""Append bounded restore health transitions; no titles, argv or conversation data.

Called outside render by wt-restore. A separate stream still works when last.json
cannot be saved. A disk-wide failure can prevent both writes and is shown by toast.
"""
import fcntl
from collections import deque
import json
import os
from pathlib import Path
import sys
from datetime import datetime, timezone


def record(app_home, event, limit=1024 * 1024):
    directory = Path(app_home) / "diagnostics"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    with open(directory / "restore.lock", "a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = directory / "restore.jsonl"
        line = (json.dumps({"at": datetime.now(timezone.utc).isoformat(), **event}, ensure_ascii=False) + "\n").encode()
        if path.exists() and path.stat().st_size + len(line) > limit:
            path.replace(directory / "restore.jsonl.1")
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "ab") as stream:
            stream.write(line)


def show(app_home, as_json=False):
    lines = deque(maxlen=50)
    for name in ("restore.jsonl.1", "restore.jsonl"):
        try:
            with (Path(app_home) / "diagnostics" / name).open() as stream:
                lines.extend(stream)
        except FileNotFoundError:
            pass
    if not lines:
        print("No restore health events recorded yet.")
    for line in lines:
        if as_json:
            print(line.rstrip())
        else:
            try:
                event = json.loads(line)
                print(f"{event['at']} {event['channel']} " + (json.dumps(event['problem'], ensure_ascii=False) if event['problem'] else "recovered"))
            except (ValueError, KeyError):
                print("[incomplete restore log record]")


if __name__ == "__main__":
    if sys.argv[2] == "--read":
        show(sys.argv[1], "--json" in sys.argv[3:])
    else:
        record(sys.argv[1], json.loads(sys.argv[2]))
