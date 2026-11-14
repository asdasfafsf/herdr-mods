"""Runner subprocess cleanup only; harmless Python fixtures, no app or sessions."""
import importlib.util
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("agent_workspace_runner", ROOT / "scripts/test-agent-workspace.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class RunnerTests(unittest.TestCase):
    def test_nonzero_exit_is_not_reported_as_success(self):
        with tempfile.TemporaryFile(mode="w+") as log:
            code = runner.run_check([sys.executable, "-c", "print('failed fixture'); raise SystemExit(7)"],
                                    os.environ.copy(), log, 5)
            self.assertEqual(code, 7)
            log.seek(0)
            self.assertIn("failed fixture", log.read())

    @unittest.skipUnless(os.name == "posix", "process-group cleanup requires POSIX")
    def test_timeout_ends_descendant_even_if_parent_exits_on_term(self):
        with tempfile.TemporaryDirectory() as directory, tempfile.TemporaryFile(mode="w+") as log:
            ready = Path(directory, "child.pid")
            child = ("import os,signal,time; from pathlib import Path; "
                     "signal.signal(signal.SIGTERM, signal.SIG_IGN); "
                     f"Path({str(ready)!r}).write_text(str(os.getpid())); time.sleep(30)")
            parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',{child!r}]); time.sleep(30)"
            child_pid = None
            try:
                code = runner.run_check([sys.executable, "-c", parent], os.environ.copy(), log, 2)
                self.assertEqual(code, 124)
                self.assertTrue(ready.exists(), "child must install its signal handler before the timeout")
                child_pid = int(ready.read_text())
                status = subprocess.run(["ps", "-o", "stat=", "-p", str(child_pid)], capture_output=True, text=True).stdout.strip()
                self.assertTrue(not status or status.startswith("Z"), f"descendant is still running: {status}")
            finally:
                if child_pid is None and ready.exists():
                    child_pid = int(ready.read_text())
                if child_pid is not None:
                    try:
                        os.kill(child_pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass


if __name__ == "__main__":
    unittest.main()
