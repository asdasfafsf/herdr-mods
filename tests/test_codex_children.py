"""Internal subagent discovery using synthetic metadata, never live actions."""
import json
from contextlib import closing
from pathlib import Path
import sqlite3
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "lib"))
import codex_children


class CodexChildrenTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.db = self.home / "state_5.sqlite"
        with closing(sqlite3.connect(self.db)) as connection, connection:
            connection.execute("CREATE TABLE threads (id TEXT PRIMARY KEY, source TEXT, rollout_path TEXT, created_at INTEGER, updated_at INTEGER, cwd TEXT)")

    def child(self, sid="child", parent="parent", events=(), source=None, created=100):
        path = self.home / (sid + ".jsonl")
        path.write_text("".join(json.dumps(event) + "\n" for event in events))
        if source is None:
            source = {"subagent": {"thread_spawn": {"parent_thread_id": parent, "agent_path": "/root/" + sid, "agent_nickname": "Synthetic"}}}
        with closing(sqlite3.connect(self.db)) as connection, connection:
            connection.execute("INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)", (sid, json.dumps(source), str(path), created, 9999999999, "/synthetic"))
        return path

    def event(self, kind, second=101, **payload):
        return {"type": "event_msg", "timestamp": "1970-01-01T00:%02d:%02dZ" % divmod(second, 60), "payload": {"type": kind, **payload}}

    def rows(self, roots=("parent",)):
        return codex_children.children_for(roots, self.home)

    def test_identity_and_parentage_ignore_inherited_session_metadata(self):
        inherited = {"type": "session_meta", "payload": {"id": "parent"}}
        self.child(events=[inherited, self.event("task_complete", 90), self.event("task_started")])
        self.child("nested", "child", [self.event("task_complete")])
        self.child("unrelated", "another", [self.event("task_started")])
        rows = self.rows()["parent"]
        self.assertEqual([(r["id"], r["parent_session_id"], r["depth"], r["state"]) for r in rows],
                         [("child", "parent", 1, "working"), ("nested", "child", 2, "done")])
        self.assertEqual(rows[0]["name"], "child")
        self.assertEqual(rows[0]["nickname"], "Synthetic")

    def test_latest_explicit_lifecycle_wins_including_followup(self):
        path = self.child(events=[self.event("task_started"), self.event("task_complete", 102)])
        self.assertEqual(self.rows()["parent"][0]["state"], "done")
        with path.open("a") as stream:
            stream.write(json.dumps(self.event("task_started", 103)) + "\n")
        row = self.rows()["parent"][0]
        self.assertEqual((row["state"], row["updated"], row["evidence"]), ("working", 103000, "task_started"))

    def test_updated_at_alone_never_implies_activity(self):
        self.child(events=[self.event("task_started", 90), self.event("item_completed", thread_id="other")])
        row = self.rows()["parent"][0]
        self.assertEqual((row["state"], row["evidence"]), ("unknown", "unavailable"))

    def test_own_completed_item_proves_activity_without_start_in_tail(self):
        self.child(events=[self.event("item_completed", thread_id="child"), self.event("task_complete", 102, thread_id="other")])
        self.assertEqual(self.rows()["parent"][0]["state"], "working")

    def test_failure_and_interruption_are_not_success(self):
        self.child("failed", events=[self.event("task_failed")])
        self.child("interrupted", events=[self.event("task_started"), self.event("turn_aborted", 102)])
        self.assertEqual({r["id"]: r["state"] for r in self.rows()["parent"]}, {"failed": "error", "interrupted": "unknown"})

    def test_never_exports_message_or_tool_content(self):
        marker = "synthetic-content-must-not-leave-rollout"
        self.child(events=[self.event("item_completed", thread_id="child", item={"text": marker}),
                           self.event("task_complete", 102, last_agent_message=marker)])
        output = json.dumps(self.rows())
        self.assertNotIn(marker, output)
        self.assertNotIn("last_agent_message", output)

    def test_malformed_source_and_records_are_ignored(self):
        self.child("invalid", source={"subagent": []})
        path = self.child(events=[self.event("task_started")])
        with path.open("a") as stream:
            stream.write('{"broken\nnull\n{"type":"event_msg","payload":[]}\n')
            stream.write(json.dumps(self.event([])) + "\n")
        self.assertEqual([r["id"] for r in self.rows()["parent"]], ["child"])
        self.assertEqual(self.rows()["parent"][0]["state"], "working")

    def test_bounded_tail_preserves_last_lifecycle(self):
        path = self.child()
        path.write_bytes(b"x" * 1000 + b"\n" + json.dumps(self.event("task_complete")).encode() + b"\n")
        with patch.object(codex_children, "TAIL_BYTES", 200):
            self.assertEqual(self.rows()["parent"][0]["state"], "done")

    def test_cycles_depth_and_child_count_are_bounded(self):
        self.child("child", "parent")
        self.child("parent", "child")
        self.child("nested", "child")
        self.child("deep", "nested")
        with patch.object(codex_children, "MAX_DEPTH", 2):
            self.assertEqual([r["id"] for r in self.rows()["parent"]], ["child", "nested"])
        with patch.object(codex_children, "MAX_CHILDREN", 1):
            self.assertEqual(len(self.rows()["parent"]), 1)

    def test_missing_corrupt_and_incompatible_index_return_empty(self):
        missing = self.home / "missing"
        self.assertEqual(codex_children.children_for(["parent"], missing), {"parent": []})
        self.assertFalse(missing.exists())
        self.db.write_bytes(b"invalid database")
        self.assertEqual(self.rows(), {"parent": []})
        self.db.unlink()
        with closing(sqlite3.connect(self.db)) as connection, connection:
            connection.execute("CREATE TABLE threads (id TEXT)")
        self.assertEqual(self.rows(), {"parent": []})

    def test_busy_index_is_bounded_and_not_modified(self):
        self.child()
        connection = sqlite3.connect(self.db)
        self.addCleanup(connection.close)
        connection.execute("BEGIN EXCLUSIVE")
        before = time.monotonic()
        self.assertEqual(self.rows(), {"parent": []})
        self.assertLess(time.monotonic() - before, 1.5)
        connection.rollback()
        before_bytes = self.db.read_bytes()
        self.rows()
        self.assertEqual(self.db.read_bytes(), before_bytes)

    def test_root_input_is_deduplicated_and_string_supported(self):
        self.child()
        self.assertEqual(list(self.rows(["parent", "parent", None, ""])), ["parent"])
        self.assertEqual(len(self.rows("parent")["parent"]), 1)

    def test_second_precision_creation_does_not_claim_inherited_lifecycle(self):
        inherited = self.event("task_complete", 100, turn_id="parent-turn")
        inherited["timestamp"] = "1970-01-01T00:01:40.100Z"
        self.child(events=[inherited])
        self.assertEqual(self.rows()["parent"][0]["state"], "unknown")

    def test_same_second_lifecycle_requires_actual_child_turn_evidence(self):
        events = [self.event("task_started", 100, turn_id="child-turn"),
                  self.event("item_completed", 100, thread_id="child", turn_id="child-turn"),
                  self.event("task_complete", 100, turn_id="child-turn")]
        for index, event in enumerate(events, 1):
            event["timestamp"] = "1970-01-01T00:01:40.%03dZ" % index
        self.child(events=events)
        self.assertEqual(self.rows()["parent"][0]["state"], "done")

    def test_millisecond_creation_accepts_unambiguous_lifecycle(self):
        event = self.event("task_complete", 100)
        event["timestamp"] = "1970-01-01T00:01:40.900Z"
        self.child(events=[event])
        with closing(sqlite3.connect(self.db)) as connection, connection:
            connection.execute("ALTER TABLE threads ADD COLUMN created_at_ms INTEGER")
            connection.execute("UPDATE threads SET created_at_ms=100800")
        self.assertEqual(self.rows()["parent"][0]["state"], "done")


if __name__ == "__main__":
    unittest.main()
