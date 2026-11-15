"""Optional real Codex engine interoperability check, with a loopback fake model.

Uses two installed binaries, a new temporary HOME/CODEX_HOME, and synthetic A/B/C
turns only. Never connects to a live app server, copies credentials, or opens the
desktop UI. This verifies the engines and history API, not desktop rendering.
Run: python3 tests/native_session_roundtrip.py --desktop-bin /path/to/app/codex
"""
import argparse
import contextlib
import http.server
import json
import os
from pathlib import Path
import queue
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time


class RpcError(RuntimeError):
    pass


class Server:
    def __init__(self, binary, root, client):
        self.messages = queue.Queue()
        self.notifications = []
        self.seq = 0
        self.stderr = tempfile.TemporaryFile()
        env = {"PATH": os.environ.get("PATH", "/usr/bin:/bin"),
               "HOME": str(root), "CODEX_HOME": str(root / "codex"),
               "TMPDIR": str(root / "tmp")}
        self.proc = subprocess.Popen([binary, "app-server", "--stdio"],
                                     cwd=root / "work", env=env, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, stderr=self.stderr)
        def read():
            for line in self.proc.stdout:
                self.messages.put(json.loads(line))
            self.messages.put(None)
        self.reader = threading.Thread(target=read, daemon=True)
        self.reader.start()
        try:
            self.rpc("initialize", {"clientInfo": {"name": client, "version": "1"},
                                    "capabilities": {"experimentalApi": True}})
            self.send({"method": "initialized"})
        except BaseException:
            self.close()
            raise

    def send(self, message):
        self.proc.stdin.write((json.dumps(message) + "\n").encode())
        self.proc.stdin.flush()

    def receive(self, timeout=30):
        try:
            msg = self.messages.get(timeout=timeout)
        except queue.Empty:
            raise TimeoutError("app-server response") from None
        if msg is None:
            self.stderr.seek(0)
            raise RuntimeError(self.stderr.read().decode()[-4000:])
        # The fake model never requests a tool/approval. Do not answer any request.
        if "method" in msg and "id" in msg:
            raise AssertionError(f"Unexpected server request: {msg['method']}")
        return msg

    def rpc(self, method, params):
        self.seq += 1
        self.send({"id": self.seq, "method": method, "params": params})
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            msg = self.receive(max(.01, deadline - time.monotonic()))
            if msg.get("id") == self.seq:
                if "error" in msg:
                    raise RpcError(json.dumps(msg["error"]))
                return msg["result"]
            self.notifications.append(msg)
        raise TimeoutError(method)

    def event(self, method, thread_id, turn_id=None):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            for i, msg in enumerate(self.notifications):
                p = msg.get("params", {})
                if (msg.get("method") == method and p.get("threadId") == thread_id
                        and (turn_id is None or p.get("turn", {}).get("id") == turn_id)):
                    return self.notifications.pop(i)["params"]
            self.notifications.append(self.receive(max(.01, deadline - time.monotonic())))
        raise TimeoutError(method)

    def turn(self, sid, text):
        result = self.rpc("turn/start", {"threadId": sid,
                           "input": [{"type": "text", "text": text, "text_elements": []}]})
        done = self.event("turn/completed", sid, result["turn"]["id"])
        assert done["turn"]["status"] == "completed", done

    def release(self, sid):
        result = self.rpc("thread/unsubscribe", {"threadId": sid})
        assert result["status"] == "unsubscribed", result

    def history(self, sid):
        turns, cursor = [], None
        while True:
            page = self.rpc("thread/turns/list", {"threadId": sid, "cursor": cursor,
                            "limit": 1, "itemsView": "full", "sortDirection": "asc"})
            turns.extend(page["data"])
            cursor = page["nextCursor"]
            if cursor is None:
                return turns

    def close(self):
        if self.stderr.closed:
            return
        if self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.proc.kill()
                self.proc.wait()
        self.proc.stdin.close()
        self.reader.join(timeout=2)
        self.proc.stdout.close()
        self.stderr.close()


class Model(http.server.BaseHTTPRequestHandler):
    requests = []

    def log_message(self, *_):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        self.requests.append(body)
        n = len(self.requests)
        item = {"id": f"msg_{n}", "type": "message", "role": "assistant",
                "status": "completed", "content": [{"type": "output_text",
                "text": f"Synthetic reply {n}", "annotations": []}]}
        events = [
            {"type": "response.created", "response": {"id": f"resp_{n}", "status": "in_progress"}},
            {"type": "response.output_item.added", "output_index": 0, "item": {**item, "content": []}},
            {"type": "response.output_text.delta", "item_id": item["id"], "output_index": 0,
             "content_index": 0, "delta": f"Synthetic reply {n}"},
            {"type": "response.output_item.done", "output_index": 0, "item": item},
            {"type": "response.completed", "response": {"id": f"resp_{n}", "status": "completed",
             "output": [item], "usage": {"input_tokens": 1, "output_tokens": 1, "total_tokens": 2}}},
        ]
        data = "".join(f"event: {e['type']}\ndata: {json.dumps(e)}\n\n" for e in events).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)


def messages(turns):
    out = []
    for turn in turns:
        for item in turn["items"]:
            if item["type"] == "userMessage":
                out.append(("user", "".join(x.get("text", "") for x in item["content"])))
            elif item["type"] == "agentMessage":
                out.append(("assistant", item["text"]))
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--desktop-bin", required=True)
    parser.add_argument("--cli-bin", default=shutil.which("codex"))
    args = parser.parse_args()
    for binary in [args.desktop_bin, args.cli_bin]:
        if not binary or not Path(binary).is_file():
            parser.error(f"No installed binary: {binary}")
        print(subprocess.check_output([binary, "--version"], text=True).strip(), flush=True)
    with tempfile.TemporaryDirectory(prefix="herdr-roundtrip-") as directory, contextlib.ExitStack() as stack:
        root = Path(directory)
        for name in ["codex", "work", "tmp"]:
            (root / name).mkdir()
        httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Model)
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        stack.callback(httpd.server_close)
        stack.callback(httpd.shutdown)
        (root / "codex/config.toml").write_text(f'''model = "gpt-5.4"
model_provider = "fixture"
cli_auth_credentials_store = "file"
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
[model_providers.fixture]
name = "Local synthetic test"
base_url = "http://127.0.0.1:{httpd.server_port}/v1"
wire_api = "responses"
requires_openai_auth = false
[analytics]
enabled = false
[features]
shell_snapshot = false
''')
        desktop = Server(args.desktop_bin, root, "codex_work_desktop")
        stack.callback(desktop.close)
        cli = Server(args.cli_bin, root, "codex-tui")
        stack.callback(cli.close)
        def preflight(sid, expected):
            result = json.loads(subprocess.check_output([
                sys.executable, "-I", str(Path(__file__).resolve().parents[1] / "lib/session_handoff.py"),
                json.dumps({"agent": "codex", "session": sid})],
                env={"PATH": os.environ.get("PATH", "/usr/bin:/bin"), "HOME": str(root),
                     "CODEX_HOME": str(root / "codex")}, text=True))
            assert result["state"] == expected, result
        started = desktop.rpc("thread/start", {"cwd": str(root / "work"), "historyMode": "paginated"})
        sid = started["thread"]["id"]
        print("synthetic thread created", flush=True)
        desktop.turn(sid, "Fixture A: design in desktop")
        preflight(sid, "active")
        expected = [("user", "Fixture A: design in desktop"), ("assistant", "Synthetic reply 1")]
        assert messages(desktop.history(sid)) == expected
        try:
            cli.rpc("thread/resume", {"threadId": sid, "excludeTurns": True})
        except RpcError as error:
            print("concurrent resume refused:", error, flush=True)
        else:
            raise AssertionError("Second app-server acquired a live thread")
        desktop.release(sid)
        # This installed build retains the writer after unsubscribe. Never assume
        # an idle/unsubscribed session is released. Only stop our disposable server.
        desktop.close()
        preflight(sid, "ready")
        resumed = cli.rpc("thread/resume", {"threadId": sid, "excludeTurns": True})
        assert resumed["thread"]["id"] == sid
        assert messages(cli.history(sid)) == expected
        cli.turn(sid, "Fixture B: continue in Herdr CLI engine")
        expected += [("user", "Fixture B: continue in Herdr CLI engine"), ("assistant", "Synthetic reply 2")]
        assert messages(cli.history(sid)) == expected
        cli.release(sid)
        cli.close()
        desktop = Server(args.desktop_bin, root, "codex_work_desktop")
        stack.callback(desktop.close)
        resumed = desktop.rpc("thread/resume", {"threadId": sid, "excludeTurns": True})
        assert resumed["thread"]["id"] == sid
        assert messages(desktop.history(sid)) == expected
        desktop.turn(sid, "Fixture C: continue back in desktop")
        expected += [("user", "Fixture C: continue back in desktop"), ("assistant", "Synthetic reply 3")]
        desktop.release(sid)
        desktop.close()
        cli = Server(args.cli_bin, root, "codex-tui")
        stack.callback(cli.close)
        resumed = cli.rpc("thread/resume", {"threadId": sid, "excludeTurns": True})
        assert resumed["thread"]["id"] == sid
        assert messages(cli.history(sid)) == expected
        assert len(Model.requests) == 3
        for i, body in enumerate(Model.requests):
            model_history = json.dumps(body["input"])
            for _, text in expected[:2 * i + 1]:
                assert text in model_history, (i, text)
        with contextlib.closing(sqlite3.connect((root / "codex/state_5.sqlite").as_uri() + "?mode=ro", uri=True)) as db:
            assert db.execute("SELECT id FROM threads").fetchall() == [(sid,)]
        print("PASS: A -> A+B -> A+B+C; same ID, paginated display history AND model input preserved.")
        print("PASS: concurrent writer refused; stopping ONLY owned test servers permits sequential handoff.")
        print("Only temporary sessions and the loopback fake model were used; desktop UI not tested.")


if __name__ == "__main__":
    main()
