"""Usage source regressions: missing model windows, stale snapshots and failed refreshes."""

import importlib.util
import pathlib
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("usage", pathlib.Path(__file__).resolve().parents[1] / "mods/usage-bar/usage.py")
usage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(usage)


class UsageTests(unittest.TestCase):
    def test_fable_zero_and_malformed_windows(self):
        wins = usage.claude_windows({
            "five_hour": {"utilization": 11, "resets_at": 1794202200},
            "seven_day": {"utilization": 94},
            "seven_day_opus": None,
            "seven_day_sonnet": {"utilization": "bad"},
            "extra_usage": {"utilization": 20},
            "model_scoped": [{"display_name": "Fable", "utilization": 0,
                              "resets_at": "2026-11-10T01:00:00+00:00"}],
        })
        self.assertEqual([w["name"] for w in wins], ["5h", "7d", "7d Fable"])
        self.assertEqual(wins[-1], {"name": "7d Fable", "used": 0, "resets": 1794272400})

    def test_newer_generic_snapshot_keeps_fable_and_its_age(self):
        raw = {"updated": 200, "windows": [{"name": "7d", "used": 95, "resets": 300}]}
        live = {"updated": 100, "windows": [{"name": "7d", "used": 94, "resets": 300},
                                             {"name": "7d Fable", "used": 0, "resets": 300}]}
        with patch.object(usage, "claude_raw", return_value=raw), patch.object(usage, "claude", return_value=None), \
                patch.object(usage, "claude_live", return_value=live):
            got = usage.claude_now("unused")
        self.assertEqual([(w["name"], w["used"]) for w in got["windows"]], [("7d", 95), ("7d Fable", 0)])
        self.assertEqual(got["updated"], 100)

    def test_new_live_answer_can_lower_usage(self):
        found = {"claude": {"windows": [{"name": "7d Fable", "used": 20, "resets": 300, "source": "live"}]}}
        with patch.object(usage, "load", return_value={"claude/7d Fable": {"used": 90, "resets": 300}}), \
                patch.object(usage, "save"):
            self.assertEqual(usage.steady(found)["claude"]["windows"][0]["used"], 20)

    def test_cache_throttle_refresh_failure_and_recovery(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(usage, "CLAUDE_LIVE", str(pathlib.Path(tmp) / "live.json")):
            old = {"updated": 100, "windows": [{"name": "7d Fable", "used": 0, "resets": 300}]}
            with patch.object(usage, "ask_claude", return_value=(old, None)) as ask:
                self.assertEqual(usage.claude_live(), old)
                self.assertEqual(usage.claude_live(), old)
                ask.assert_called_once()
            with patch.object(usage, "ask_claude", return_value=(None, "offline")):
                failed = usage.claude_live(now=True)
                self.assertEqual(failed["updated"], 100)
                self.assertEqual(failed["windows"], old["windows"])
                self.assertEqual(failed["error"], "offline")
            with patch.object(usage, "ask_claude", return_value=(old, None)):
                self.assertNotIn("error", usage.claude_live(now=True))

    def test_manual_codex_failure_reports_failure_even_with_cached_limits(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(usage, "LIVE", str(pathlib.Path(tmp) / "codex.json")):
            cached = {"tried": 100, "updated": 100, "limits": {"primary": {"usedPercent": 10, "windowDurationMins": 300}}}
            usage.save(usage.LIVE, cached)
            outcome = {}
            with patch.object(usage, "ask_codex", return_value=(None, "network offline")):
                got = usage.codex_live(True, outcome)
            self.assertEqual(got["updated"], 100)
            self.assertFalse(outcome["ok"])
            self.assertEqual(outcome["error"], "network offline")
            self.assertNotIn("error", got)  # Automatic UI stays quiet; explicit refresh still fails.

    def test_manual_claude_outcome_and_busy_lock(self):
        with tempfile.TemporaryDirectory() as tmp, patch.object(usage, "CLAUDE_LIVE", str(pathlib.Path(tmp) / "claude.json")):
            result = {"updated": 100, "windows": [{"name": "5h", "used": 1}]}
            outcome = {}
            with patch.object(usage, "ask_claude", return_value=(result, None)):
                self.assertEqual(usage.claude_live(True, outcome), result)
            self.assertTrue(outcome["ok"])
            with patch.object(usage.fcntl, "flock", side_effect=BlockingIOError):
                self.assertEqual(usage.claude_live(True, outcome), result)
            self.assertFalse(outcome["ok"])
            self.assertIn("in progress", outcome["error"])

    def test_unavailable_claude_keeps_snapshot(self):
        snapshot = {"updated": 200, "windows": [{"name": "5h", "used": 10, "resets": 300}]}
        with patch.object(usage, "claude_raw", return_value=snapshot), patch.object(usage, "claude", return_value=None), \
                patch.object(usage, "claude_live", return_value=None):
            self.assertEqual(usage.claude_now("unused")["windows"][0]["used"], 10)


if __name__ == "__main__":
    unittest.main()
