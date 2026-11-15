"""Optional installed-CLI check using only temporary synthetic threads.

No credentials copied, no real thread IDs, no turn/start, no model/tool requests,
no approval decisions. Terminates only the isolated stdio server it starts.
Run: python3 tests/native_codex_permissions.py
"""
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import tempfile
import time
import uuid


class Server:
    def __init__(self, root):
        self.seq = 0
        self.buf = b""
        self.proc = subprocess.Popen(
            [shutil.which("codex"), "app-server", "--stdio"], cwd=root / "work",
            env={"PATH": os.environ["PATH"], "HOME": str(root), "CODEX_HOME": str(root / "codex")},
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)

    def __enter__(self):
        try:
            self.rpc("initialize", {"clientInfo": {"name": "herdr-permission-test", "version": "1"},
                                    "capabilities": {"experimentalApi": True}})
            self.proc.stdin.write(b'{"jsonrpc":"2.0","method":"initialized"}\n')
            self.proc.stdin.flush()
            return self
        except Exception:
            self.__exit__()
            raise

    def __exit__(self, *_):
        self.proc.terminate()
        try:
            self.proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            self.proc.kill()
            self.proc.wait()
        self.proc.stdin.close()
        self.proc.stdout.close()

    def rpc(self, method, params):
        assert method in {"initialize", "thread/start", "thread/resume", "config/read", "configRequirements/read"}
        self.seq += 1
        self.proc.stdin.write((json.dumps({"jsonrpc": "2.0", "id": self.seq, "method": method, "params": params}) + "\n").encode())
        self.proc.stdin.flush()
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if not select.select([self.proc.stdout], [], [], 0.5)[0]:
                continue
            chunk = os.read(self.proc.stdout.fileno(), 65536)
            if not chunk:
                raise RuntimeError("isolated server exited")
            self.buf += chunk
            while b"\n" in self.buf:
                line, self.buf = self.buf.split(b"\n", 1)
                msg = json.loads(line)
                if msg.get("id") == self.seq:
                    if "error" in msg:
                        raise RuntimeError(msg["error"])
                    return msg["result"]
        raise TimeoutError(method)


def fixture(root):
    sid = str(uuid.uuid4())
    stamp = "2026-11-15T00:00:00Z"
    path = root / "codex" / "sessions" / "2026" / "11" / "15" / f"rollout-2026-11-15T00-00-00-{sid}.jsonl"
    path.parent.mkdir(parents=True, exist_ok=True)
    items = [
        ("session_meta", {"id": sid, "timestamp": stamp, "cwd": str(root / "work"),
                          "originator": "herdr-permission-test", "cli_version": "0.169.0", "source": "cli", "model_provider": "openai"}),
        ("response_item", {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "Synthetic history only"}]}),
        ("turn_context", {"turn_id": str(uuid.uuid4()), "cwd": str(root / "work"),
                          "approval_policy": "on-request", "approvals_reviewer": "user",
                          "active_permission_profile": {"id": ":workspace"},
                          "sandbox_policy": {"type": "workspace-write", "network_access": False},
                          "permission_profile": {"type": "managed", "network": "restricted", "file_system": {
                              "type": "restricted", "entries": [
                                  {"path": {"type": "special", "value": {"kind": "root"}}, "access": "read"},
                                  {"path": {"type": "path", "path": str(root / "work")}, "access": "write"},
                              ]}},
                          "model": "gpt-5", "effort": "medium", "summary": "auto"}),
    ]
    path.write_text("".join(json.dumps({"timestamp": stamp, "type": kind, "payload": payload}) + "\n" for kind, payload in items))
    return sid


def policy(result):
    return result["approvalPolicy"], result["sandbox"]["type"]


def main():
    print(subprocess.check_output(["codex", "--version"], text=True).strip())
    with tempfile.TemporaryDirectory(prefix="herdr-permission-test-") as directory:
        root = Path(directory)
        (root / "work").mkdir()
        (root / "codex").mkdir()
        (root / "codex" / "config.toml").write_text('sandbox_mode = "danger-full-access"\napproval_policy = "never"\n')
        saved = fixture(root)
        explicit = fixture(root)
        with Server(root) as server:
            requirements = server.rpc("configRequirements/read", {})
            assert requirements.get("requirements") is None, "test requires an unmanaged isolated server"
            new = server.rpc("thread/start", {"cwd": str(root / "work"), "ephemeral": True})
            assert policy(new) == ("never", "dangerFullAccess"), policy(new)
            print("PASS new thread: user config => never / dangerFullAccess")
            resumed = server.rpc("thread/resume", {"threadId": saved, "excludeTurns": True})
            assert policy(resumed) == ("on-request", "workspaceWrite"), policy(resumed)
            print("PASS cold resume: saved workspaceWrite / on-request beats YOLO config defaults")
            yolo = {"approvalPolicy": "never", "sandbox": "danger-full-access"}
            changed = server.rpc("thread/resume", {"threadId": explicit, "excludeTurns": True, **yolo})
            assert policy(changed) == ("never", "dangerFullAccess"), policy(changed)
            print("PASS cold resume: explicit request selects never / dangerFullAccess")
            loaded = server.rpc("thread/resume", {"threadId": saved, "excludeTurns": True, **yolo})
            assert policy(loaded) == ("on-request", "workspaceWrite"), policy(loaded)
            print("PASS loaded subscribed thread: resume does not replace its active permissions")
    print("No model turns, user sessions, approval decisions or reset/redemption calls.")


if __name__ == "__main__":
    main()
