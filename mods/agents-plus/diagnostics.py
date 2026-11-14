#!/usr/bin/env python3
"""Persist Herdr UI status and render aggregates outside the mod runtime.

Used by `hm logs`: read the last 50 records, --once to sample, --watch to poll
once per second until interrupted or --stop requests exit. A flock allows only
one watcher per app home. Stop tokens identify an execution, never an arbitrary PID.
This samples current errors, not a lossless host exception stream. Short-lived
errors between polls can be missed; an unavailable host is not a recovery.
--render reads a separate bounded stream. Agents Plus sends in-memory aggregates
to --record-render from a timer; unflushed measurements can be lost with its VM.
"""

import argparse
from collections import deque
from datetime import datetime, timezone
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import time
import uuid


APP_HOME = Path(os.environ.get("HERDR_APP_HOME") or Path.home() / ".config/herdr-app")
LOG_DIR = APP_HOME / "diagnostics"
MAX_BYTES = 2 * 1024 * 1024
BACKUPS = 3


def stamp():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def append_record(directory, event, limit=MAX_BYTES, filename="ui.jsonl"):
    """Append bounded JSONL; callers serialize writes/rotation with a stream lock."""
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = directory / filename
    line = (json.dumps({"at": stamp(), **event}, ensure_ascii=False) + "\n").encode()
    if path.exists() and path.stat().st_size + len(line) > limit:
        for i in range(BACKUPS, 0, -1):
            source = directory / (f"{filename}.{i - 1}" if i > 1 else filename)
            if source.exists():
                source.replace(directory / f"{filename}.{i}")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "ab") as stream:
        stream.write(line)


def context(home):
    """Counts and code identity only: never copy prompts, titles, argv or state blobs."""
    result = {}
    try:
        file = home / "shared.json"
        shared = json.loads(file.read_text())
        trees = shared.get("wt.trees", {})
        result.update(shared_bytes=file.stat().st_size, repos=len(trees),
                      checkouts=sum(len(r.get("checkouts", [])) for r in trees.values()),
                      agent_info=len(shared.get("ag.info", {})))
    except (OSError, ValueError, TypeError, AttributeError):
        result["shared_unreadable"] = True
    try:
        code = (home / "mods/agents-plus/main.js").read_bytes()
        result["agents_plus_sha256"] = hashlib.sha256(code).hexdigest()
    except OSError:
        pass
    return result


def sample():
    try:
        reply = subprocess.run(["herdr-app", "status"], capture_output=True, text=True, timeout=5)
        if reply.returncode:
            return None, f"status exited {reply.returncode}"
        status = json.loads(reply.stdout)
        if not isinstance(status, dict) or not isinstance(status.get("errors"), list):
            return None, "status did not contain an errors list"
        return status, None
    except subprocess.TimeoutExpired:
        return None, "status timed out after 5 seconds"
    except (OSError, ValueError) as error:
        return None, type(error).__name__


class Recorder:
    def __init__(self):
        self.previous = None
        self.unavailable = None
        self.last_record = 0

    def observe(self, status, failure, now):
        """Deduplicate identical errors, preserving outage and recovery boundaries."""
        if failure:
            if failure == self.unavailable and now - self.last_record < 60:
                return None
            self.unavailable = failure
            self.last_record = now
            return {"event": "status_unavailable", "reason": failure}
        signature = json.dumps(status["errors"], ensure_ascii=False, sort_keys=True)
        changed = signature != self.previous
        reconnected = self.unavailable is not None
        if not changed and not reconnected and now - self.last_record < 60:
            return None
        event = ("errors" if status["errors"] else "recovered") if changed and self.previous is not None else "snapshot"
        if not changed and not reconnected:
            event = "heartbeat"
        if self.previous is None and status["errors"]:
            event = "errors"
        self.previous, self.unavailable, self.last_record = signature, None, now
        # A bounded text field retains the stack without letting one bad error fill disk.
        return {"event": event, "error_count": len(status["errors"]),
                "errors": signature[:32000], "errors_truncated": len(signature) > 32000,
                "layout": status.get("layout"), "agent": status.get("agent"),
                "reconnected": reconnected}


def render_batch(raw):
    """Validate a bounded numeric-only profiler schema before persisting it.

    No titles, prompts, paths or arbitrary host state are accepted as measurements.
    Counts/phase times are measured in the mod; context is read at persistence time.
    """
    if len(raw) > 16000:
        raise ValueError("render batch exceeds 16000 characters")
    batch = json.loads(raw)
    phases = {"inputs", "state", "ordering", "labels", "groups", "rows", "container"}
    numbers = {"schema", "slow_ms", "completed", "slow", "unfinished", "invalid_clock",
               "total_ms", "max_ms", "started_at_ms", "agents", "terminals", "outside",
               "panes", "checkouts", "groups", "rows"}
    objects = {"phases", "completed_phases", "counts", "worst"}

    def validate(value, key=None):
        if key in ("phases", "completed_phases"):
            if not isinstance(value, dict) or not set(value) <= phases:
                raise ValueError("invalid render phases")
            for item in value.values():
                if isinstance(item, dict):
                    if set(item) != {"total_ms", "max_ms"}:
                        raise ValueError("invalid phase aggregate")
                    validate(item)
                elif type(item) not in (int, float) or not math.isfinite(item) or item < 0:
                    raise ValueError("invalid phase time")
        elif key == "samples":
            if not isinstance(value, list) or len(value) > 8:
                raise ValueError("invalid render samples")
            for item in value:
                if not isinstance(item, dict):
                    raise ValueError("invalid render sample")
                validate(item)
        elif key == "worst" and value is None:
            return
        elif key is None or key in objects:
            if not isinstance(value, dict):
                raise ValueError("expected render object")
            for name, item in value.items():
                validate(item, name)
        elif key in ("collapsed",) or (key == "invalid_clock" and type(value) is bool):
            if type(value) is not bool:
                raise ValueError("expected render boolean")
        elif key in numbers:
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise ValueError("invalid render number")
        elif key == "instance":
            if not isinstance(value, str) or len(value) > 64 or not all(c in "0123456789abcdefghijklmnopqrstuvwxyz-" for c in value):
                raise ValueError("invalid profiler instance")
        elif key == "sort" and value in ("priority", "grouped"):
            return
        elif key == "outcome" and value in ("completed", "unfinished"):
            return
        elif key == "last_phase" and value in phases:
            return
        else:
            raise ValueError("unknown render field or value")

    validate(batch)
    if batch.get("schema") != 1 or not {"completed", "slow", "unfinished", "phases", "samples", "instance"} <= batch.keys():
        raise ValueError("incomplete render batch")
    return batch


def show(directory, as_json, filename="ui.jsonl"):
    lines = deque(maxlen=50)
    for i in range(BACKUPS, -1, -1):
        path = directory / (f"{filename}.{i}" if i else filename)
        try:
            with path.open() as stream:
                lines.extend(stream)
        except FileNotFoundError:
            pass
    if not lines:
        print("No render samples yet; Agents Plus saves them every 60s." if filename == "render.jsonl"
              else "No recorded UI samples. Start recording with: hm logs --watch")
    for line in lines:
        if as_json:
            print(line.rstrip())
        else:
            try:
                item = json.loads(line)
                print(f"{item['at']} {item['event']} " + json.dumps({k: v for k, v in item.items() if k not in ('at', 'event')}, ensure_ascii=False))
            except ValueError:
                print("[incomplete log record]")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--watch", action="store_true")
    mode.add_argument("--once", action="store_true")
    mode.add_argument("--stop", action="store_true", help="request the running recorder to stop")
    mode.add_argument("--render", action="store_true", help="read saved render timing aggregates")
    mode.add_argument("--record-render", help=argparse.SUPPRESS)
    parser.add_argument("--app-home", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    if args.record_render is not None:
        try:
            batch = render_batch(args.record_render)
        except (ValueError, TypeError, RecursionError):
            parser.error("invalid render measurement batch")
        home = args.app_home or APP_HOME
        directory = home / "diagnostics"
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Multiple mod copies may flush at once. Keep rotation/write atomic between them.
        with (directory / "render.lock").open("a+") as lock:
            fcntl.flock(lock, fcntl.LOCK_EX)
            append_record(directory, {"event": "render_profile", **batch, "context": context(home)},
                          filename="render.jsonl")
        return 0
    if args.render:
        show(LOG_DIR, args.json, "render.jsonl")
        return 0
    if not (args.watch or args.once or args.stop):
        show(LOG_DIR, args.json)
        return 0
    LOG_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (LOG_DIR / "watch.lock").open("a+") as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            if args.stop:
                lock.seek(0)
                try:
                    owner = json.loads(lock.read())
                    token = owner["token"]
                except (ValueError, KeyError):
                    print("Recorder is starting; retry --stop.", flush=True)
                    return 1
                (LOG_DIR / "stop-request").write_text(token)
                print("Stop requested; the recorder will stop after its current sample (up to 6 seconds).", flush=True)
                return 0
            print("A UI recorder is already running for this app home.", flush=True)
            return 1
        if args.stop:
            print("No UI recorder is running.")
            return 0
        token = uuid.uuid4().hex
        lock.seek(0)
        lock.truncate()
        lock.write(json.dumps({"pid": os.getpid(), "token": token}))
        lock.flush()
        recorder = Recorder()
        print(f"Recording UI status to {LOG_DIR / 'ui.jsonl'} (PID {os.getpid()}; Ctrl-C to stop).", flush=True)
        if args.watch:
            append_record(LOG_DIR, {"event": "watch_started", "pid": os.getpid(), "interval_seconds": 1})
        try:
            while True:
                status, failure = sample()
                event = recorder.observe(status, failure, time.monotonic())
                if event:
                    append_record(LOG_DIR, {**event, "context": context(APP_HOME)})
                if args.once:
                    return 0 if status is not None else 1
                try:
                    if (LOG_DIR / "stop-request").read_text() == token:
                        append_record(LOG_DIR, {"event": "watch_stopped", "pid": os.getpid()})
                        return 0
                except FileNotFoundError:
                    pass
                time.sleep(1)
        except KeyboardInterrupt:
            append_record(LOG_DIR, {"event": "watch_stopped", "pid": os.getpid()})
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
