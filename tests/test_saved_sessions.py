"""Read-only saved history with temporary records and synthetic process probes only."""
import contextlib
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "lib"))
import agentfiles
import session_handoff as handoff

spec = importlib.util.spec_from_file_location("saved_history", ROOT / "mods/agents-plus/saved.py")
saved = importlib.util.module_from_spec(spec)
spec.loader.exec_module(saved)
live_sessions = saved.live_sessions


def sid(number):
    return f"00000000-0000-4000-8000-{number:012d}"


class SavedSessionsTests(unittest.TestCase):
    def setUp(self):
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.base = Path(self.stack.enter_context(tempfile.TemporaryDirectory()))
        self.cwd = self.base / "external project 'quote' $(literal)"
        self.cwd.mkdir()
        self.projects = self.base / "claude/projects"
        self.sessions = self.base / "codex/sessions"
        self.index = {}
        for module in (saved, agentfiles):
            self.stack.enter_context(patch.object(module, "CLAUDE_PROJECTS", str(self.projects)))
            self.stack.enter_context(patch.object(module, "CODEX_SESSIONS", str(self.sessions)))
        self.stack.enter_context(patch.object(saved, "codex_metadata", side_effect=lambda **kw: self.index.copy()))
        self.stack.enter_context(patch.object(saved, "codex_names", return_value={}))
        self.ownership = self.stack.enter_context(patch.object(saved, "inspect_session", side_effect=lambda agent, session: {
            "agent": agent, "session": session, "state": "ready", "cwd": str(self.cwd)}))
        self.probe = self.stack.enter_context(patch.object(saved, "live_sessions", return_value=(set(), {})))
        # Any accidental real process launch is a test failure.
        self.stack.enter_context(patch.object(subprocess, "run", side_effect=AssertionError("real process")))

    def put(self, path, items, updated):
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("\n".join(json.dumps(item) for item in items) + "\n", encoding="utf-8")
        os.utime(path, (updated, updated))
        return path

    def claude(self, number, updated=1, **extra):
        return self.put(self.projects / agentfiles.project_dir_name(str(self.cwd)) / f"{sid(number)}.jsonl", [
            {"type": "user", "sessionId": sid(number), "cwd": str(self.cwd), "message": {"content": "External Claude conversation"}, **extra},
            {"type": "custom-title", "customTitle": "Claude renamed"},
        ], updated)

    def codex(self, number, updated=2, **meta):
        return self.put(self.sessions / "2026/11/15" / f"rollout-test-{sid(number)}.jsonl", [
            {"type": "session_meta", "payload": {"id": sid(number), "cwd": str(self.cwd), "source": "cli", **meta}},
            {"type": "response_item", "payload": {"role": "user", "content": [{"type": "input_text", "text": "<environment_context>ignore</environment_context>"}]}},
            {"type": "response_item", "payload": {"role": "user", "content": [{"type": "input_text", "text": "External Codex conversation"}]}},
        ], updated)

    def test_external_history_is_read_only_and_newest_first(self):
        paths = [self.claude(1), self.codex(2)]
        before = [path.read_bytes() for path in paths]
        result = saved.recent()
        self.assertEqual([(r["agent"], r["session"]) for r in result["rows"]], [("codex", sid(2)), ("claude", sid(1))])
        self.assertEqual(result["rows"][1]["title"], "Claude renamed")
        self.assertTrue(all("status" not in row and "argv" not in row for row in result["rows"]))
        self.assertEqual([path.read_bytes() for path in paths], before)
        self.assertEqual(result["errors"], [])

    def test_running_sessions_and_unknown_ownership_remain_visible_with_reasons(self):
        self.claude(1); self.codex(2)
        self.probe.return_value = ({("codex", sid(2))}, {})
        rows = saved.recent()["rows"]
        self.assertEqual([r["agent"] for r in rows], ["codex", "claude"])
        self.assertEqual(rows[0]["handoff"]["state"], "active")
        self.probe.return_value = (set(), {"claude": "Ownership unknown"})
        result = saved.recent()
        self.assertEqual([r["agent"] for r in result["rows"]], ["codex", "claude"])
        self.assertEqual(result["rows"][1]["handoff"], {"state": "unknown", "reason": "Ownership unknown"})
        self.assertEqual(result["errors"], ["Ownership unknown"])

    def test_malformed_missing_and_internal_records_do_not_hide_valid_rows(self):
        self.claude(1); good = self.codex(2)
        self.claude(3, isSidechain=True)
        self.codex(4, source={"subagent": "review"})
        self.codex(5, cwd=str(self.base / "gone"))
        self.codex(6, id={"bad": "id"})
        bad = self.codex(7)
        bad.write_bytes(b'null\n[]\n{"type":"session_meta","payload":[]}\n{"broken\n\xff\n')
        missing = str(self.sessions / "missing.jsonl")
        self.index[sid(8)] = {"id": sid(8), "source": "cli", "rollout_path": missing}
        self.assertEqual({r["session"] for r in saved.recent()["rows"]}, {sid(1), sid(2)})
        good.unlink()
        self.assertEqual([r["session"] for r in saved.recent()["rows"]], [sid(1)])
        self.assertEqual(list(saved.objects(missing)), [])

    def test_current_index_and_fork_identity_take_precedence(self):
        path = self.codex(2, cwd="/original/removed")
        self.index[sid(2)] = {"id": sid(2), "source": "cli", "rollout_path": str(path), "cwd": str(self.cwd), "name": "Current name", "updated_at": 40}
        with path.open("a") as stream:
            stream.write(json.dumps({"type": "session_meta", "payload": {"id": sid(1), "cwd": "/copied-original"}}) + "\n")
        row = saved.recent()["rows"][0]
        self.assertEqual((row["session"], row["title"], row["cwd"], row["updated"]), (sid(2), "Current name", str(self.cwd), 40))
        self.index[sid(2)]["archived"] = 1
        self.assertEqual(saved.recent()["rows"], [])

    def test_current_index_recency_wins_over_old_rollout_mtime(self):
        renamed = self.codex(1, updated=1)
        self.codex(2, updated=2)
        self.codex(3, updated=3)
        self.index[sid(1)] = {"source": "cli", "rollout_path": str(renamed), "updated_at": 100, "name": "Recently renamed"}
        with patch.object(saved, "CANDIDATES", 2):
            self.assertEqual([r["session"] for r in saved.recent()["rows"]], [sid(1), sid(3)])

    def test_bounds_limit_candidates_excerpts_and_output(self):
        for n in range(1, 8):
            self.claude(n, updated=n)
        with patch.object(saved, "CANDIDATES", 3), patch.object(saved, "LIMIT", 2), patch.object(saved, "json_lines", wraps=agentfiles.json_lines) as reads:
            rows = saved.recent()["rows"]
        self.assertEqual([r["session"] for r in rows], [sid(7), sid(6)])
        self.assertEqual(reads.call_count, 6)  # Head and tail of three candidates.
        self.assertTrue(all(call.kwargs in ({"size": saved.EXCERPT}, {"tail": saved.EXCERPT}) for call in reads.call_args_list))

    def test_safe_check_reloads_both_providers_without_changing_id_or_file(self):
        paths = [self.claude(1), self.codex(2)]
        before = [path.read_bytes() for path in paths]
        for agent, number in (("claude", 1), ("codex", 2)):
            with self.subTest(agent=agent):
                request = {"agent": agent, "session": sid(number), "cwd": str(self.cwd), "argv": ["evil"], "prompt": "do not send"}
                checked = saved.check(request)
                self.assertFalse(checked["running"])
                self.assertEqual(checked["record"]["session"], sid(number))
                self.assertNotIn("argv", checked["record"])
                self.ownership.side_effect = None
                self.ownership.return_value = {"state": "active", "cwd": str(self.cwd), "reason": "Writer retained"}
                self.assertTrue(saved.check(request)["running"])
                self.assertEqual(saved.check(request)["handoff"]["reason"], "Writer retained")
                self.ownership.return_value = {"state": "unknown", "reason": "Ownership unknown"}
                with self.assertRaisesRegex(ValueError, "Ownership unknown"):
                    saved.check(request)
                self.ownership.return_value = {"state": "ready", "cwd": str(self.cwd)}
        self.assertEqual([path.read_bytes() for path in paths], before)

    def test_check_rejects_invalid_missing_moved_and_archived_sessions(self):
        path = self.codex(2)
        request = {"agent": "codex", "session": sid(2), "cwd": str(self.cwd)}
        for bad in (None, [], {}, {**request, "session": "--last"}, {**request, "agent": "shell"}, {**request, "cwd": "/gone"}, {**request, "cwd": str(self.cwd) + "\0"}):
            with self.subTest(request=bad), self.assertRaises(ValueError):
                saved.check(bad)
        self.index[sid(2)] = {"rollout_path": str(path), "cwd": str(self.base), "source": "cli"}
        with self.assertRaisesRegex(ValueError, "folder changed"):
            saved.check(request)
        self.index[sid(2)]["archived"] = 1
        with self.assertRaisesRegex(ValueError, "no longer available"):
            saved.check(request)
        path.unlink()
        with self.assertRaisesRegex(ValueError, "no longer exists"):
            saved.check(request)

    def test_bounded_shared_metadata_and_malformed_names(self):
        home = self.base / "index"
        home.mkdir()
        database = home / "state_5.sqlite"
        with contextlib.closing(sqlite3.connect(database)) as db:
            db.execute("CREATE TABLE threads (id,cwd,title,name,rollout_path,source,updated_at,archived)")
            db.executemany("INSERT INTO threads VALUES (?,?,?,?,?,?,?,?)", [(sid(n), str(self.cwd), "Task", None, "path", "cli", n, n == 4) for n in range(5)])
            db.commit()
        names = home / "session_index.jsonl"
        names.write_text('null\n[]\n{"id":[]}\n' + json.dumps({"id": sid(1), "thread_name": "Named"}) + '\n{"partial')
        before = database.read_bytes(), names.read_bytes()
        with patch.object(agentfiles, "CODEX_HOME", str(home)), patch.object(agentfiles, "CODEX_INDEX", str(names)):
            self.assertEqual(list(agentfiles.codex_metadata(limit=2)), [sid(3), sid(2)])
            self.assertEqual(list(agentfiles.codex_metadata(sessions=[sid(4)])), [sid(4)])
            self.assertEqual(agentfiles.codex_names(tail=65536), {sid(1): "Named"})
        self.assertEqual((database.read_bytes(), names.read_bytes()), before)

    def test_process_ownership_probes_fail_closed_and_keep_provider_identity(self):
        output = (f"n/example/thread-writer-locks/{sid(2)}.lock\n"
                  f"n/example/rollout-2026-{sid(3)}.jsonl\n")
        result = subprocess.CompletedProcess([], 0, output, "")
        with patch.object(saved, "claude_registry", return_value=[(123, {"sessionId": sid(1)})]), patch.object(saved.os, "kill") as kill, patch.object(saved.subprocess, "run", return_value=result):
            running, errors = live_sessions()
            self.assertEqual(running, {("claude", sid(1)), ("codex", sid(2)), ("codex", sid(3))})
            self.assertEqual(errors, {})
            kill.assert_called_once_with(123, 0)  # Signal zero only checks existence.
        with patch.object(saved, "claude_registry", return_value=[]), patch.object(saved.subprocess, "run", side_effect=subprocess.TimeoutExpired("lsof", 5)):
            running, errors = live_sessions()
            self.assertEqual(running, set())
            self.assertIn("codex", errors)
        for record in ((-1, {"sessionId": sid(1)}), (123, {"sessionId": ["malformed"]})):
            with patch.object(saved, "claude_registry", return_value=[record]), patch.object(saved.os, "kill"), patch.object(saved.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "")):
                running, errors = live_sessions()
                self.assertEqual(running, set())
                self.assertIn("claude", errors)

    def test_native_editor_legacy_and_internal_history_share_adapter_rules(self):
        self.codex(1, source="vscode")
        app = self.codex(2, source="vscode", originator="codex_work_desktop", history_mode="paginated")
        # Paginated history need not contain response items in the rollout.
        app.write_text(app.read_text().splitlines()[0] + "\n")
        self.index[sid(2)] = {"rollout_path": str(app), "title": "App design conversation", "history_mode": "paginated"}
        self.codex(3, source={"subagent": "review"}, originator="Codex Desktop")
        self.codex(4, source=json.dumps({"subagent": "review"}), originator="Codex Desktop")
        self.codex(5, source="vscode", attached_thread_parent_id=sid(2))
        self.codex(6, source="exec")
        self.codex(7, source=None)  # Supported legacy CLI header.
        self.codex(8, source=None, originator="future-client", history_mode="paginated")
        rows = {r["session"]: r for r in saved.recent()["rows"]}
        self.assertEqual(set(rows), {sid(1), sid(2), sid(7)})
        self.assertEqual(rows[sid(1)]["origin"], "editor")
        self.assertEqual(rows[sid(2)]["origin"], "desktop")
        self.assertEqual(rows[sid(2)]["historyMode"], "paginated")
        self.assertEqual(rows[sid(2)]["title"], "App design conversation")
        # Exercise the real exact adapter for the records that discovery admits.
        with patch.object(saved, "inspect_session", wraps=handoff.inspect_session), \
             patch.object(handoff, "CODEX_HOME", str(self.base / "codex")), \
             patch.object(handoff, "codex_metadata", side_effect=lambda **kw: self.index.copy()), \
             patch.object(handoff, "codex_rollout", side_effect=lambda session: next(self.sessions.rglob(f"*{session}.jsonl"))), \
             patch.object(handoff.subprocess, "run", return_value=subprocess.CompletedProcess([], 1, "", "")):
            for rec in rows.values():
                self.assertFalse(saved.check(rec)["running"])
            with patch.object(handoff.subprocess, "run", return_value=subprocess.CompletedProcess([], 0, "123\n", "")):
                self.assertTrue(saved.check(rows[sid(2)])["running"])
            with patch.object(handoff.subprocess, "run", side_effect=subprocess.TimeoutExpired("lsof", 3)):
                with self.assertRaises(ValueError):
                    saved.check(rows[sid(2)])

    def test_fresh_adapter_cwd_change_rejects_stale_row(self):
        self.codex(1)
        self.ownership.side_effect = None
        self.ownership.return_value = {"state": "ready", "cwd": str(self.base)}
        with self.assertRaisesRegex(ValueError, "folder changed"):
            saved.check({"agent": "codex", "session": sid(1), "cwd": str(self.cwd)})


if __name__ == "__main__":
    unittest.main()
