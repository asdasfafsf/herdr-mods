"""Compatibility checks and skill packaging use synthetic files/commands only."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SKILL = ROOT / "skills/herdr-theme-compat"


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


checker = load("theme_compat", SKILL / "scripts/check.py")
installer = load("theme_skill_installer", ROOT / "scripts/install.py")


def sha(content):
    return hashlib.sha256(content).hexdigest()


def put(root, name, value):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


def snapshot(root):
    return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}


class ThemeCompatibilityTests(unittest.TestCase):
    def test_version_match_does_not_claim_runtime_capability_or_leak_output(self):
        manifest = {"version": "0.1.15"}
        for version, same in [("0.1.15", True), ("0.2.0", False)]:
            result = subprocess.CompletedProcess([], 0, f"herdr-app {version}\n", "private diagnostic")
            with patch.object(checker.subprocess, "run", return_value=result) as run:
                report = checker.check_installation("fixture", manifest)
            self.assertEqual(report["baseline_version_match"], same)
            self.assertEqual(report["runtime_surface_rules"], "unknown")
            self.assertNotIn("private", json.dumps(report))
            self.assertEqual(run.call_args_list[0].args[0], ["fixture", "--version"])
            self.assertEqual(run.call_args.args[0], ["fixture", "--help"])
            self.assertEqual(run.call_count, 2, "never send unknown capability flags to stock binaries")
        with patch.object(checker.subprocess, "run", side_effect=subprocess.TimeoutExpired("fixture", 5)):
            self.assertEqual(checker.check_installation("fixture", manifest)["status"], "probe_failed")

    def test_advertised_capabilities_are_verified_without_configuration_or_gui(self):
        version = subprocess.CompletedProcess([], 0, "herdr-app 0.1.15\n", "")
        help_result = subprocess.CompletedProcess([], 0, "  herdr-app --capabilities  read-only JSON\n", "")
        capabilities = {"schema": 1, "paint_only": True, "terminal_surface_rules": 1, "codex_semantic_surfaces": 1}
        result = subprocess.CompletedProcess([], 0, json.dumps(capabilities), "private diagnostic")
        with patch.object(checker.subprocess, "run", side_effect=[version, help_result, result]) as run:
            report = checker.check_installation("fixture", {"version": "0.1.15"})
        self.assertEqual(report["status"], "capabilities_verified")
        self.assertEqual(report["runtime_surface_rules"], "supported")
        self.assertEqual(report["runtime_codex_surfaces"], "supported")
        self.assertNotIn("private", json.dumps(report))
        self.assertEqual([call.args[0] for call in run.call_args_list],
                         [["fixture", "--version"], ["fixture", "--help"], ["fixture", "--capabilities"]])
        for call in run.call_args_list:
            self.assertEqual(call.kwargs["stdin"], subprocess.DEVNULL)
            self.assertEqual(call.kwargs["timeout"], 5)

    def test_malformed_or_failed_capability_probe_remains_unknown(self):
        version = subprocess.CompletedProcess([], 0, "herdr-app 0.1.15\n", "")
        help_result = subprocess.CompletedProcess([], 0, "  herdr-app --capabilities\n", "")
        for payload in ["not json", "[]", '{"schema":true}',
                        '{"schema":1,"paint_only":true,"terminal_surface_rules":true}',
                        '{"schema":2,"paint_only":true,"terminal_surface_rules":1}']:
            result = subprocess.CompletedProcess([], 0, payload, "private diagnostic")
            with patch.object(checker.subprocess, "run", side_effect=[version, help_result, result]):
                report = checker.check_installation("fixture", {"version": "0.1.15"})
            self.assertEqual(report["status"], "version_only")
            self.assertEqual(report["runtime_surface_rules"], "unknown")
        with patch.object(checker.subprocess, "run", side_effect=[version, help_result, subprocess.TimeoutExpired("fixture", 5)]):
            self.assertEqual(checker.check_installation("fixture", {"version": "0.1.15"})["runtime_codex_surfaces"], "unknown")

    def fixture(self, root):
        assets, source = root / "assets", root / "source"
        assets.mkdir(); (source / "src").mkdir(parents=True)
        original = {"src/main.rs": b"mod vt;\n", "src/vt.rs": b"original\n"}
        applied = {"src/main.rs": b"mod vt;\nmod terminal_surfaces;\n", "src/vt.rs": b"patched\n"}
        module = b"pub fn remap() {}\n"
        (assets / "terminal_surfaces.rs").write_bytes(module)
        manifest = {"version": "0.1.15", "commit": "fixture",
                    "files": {k: sha(v) for k, v in original.items()},
                    "patched_files": {k: sha(v) for k, v in applied.items()},
                    "module_sha256": sha(module)}
        for name, content in original.items():
            (source / name).write_bytes(content)
        return assets, source, manifest, applied, module

    def test_source_hashes_reject_partial_off_hunk_and_module_edits_without_writes(self):
        with tempfile.TemporaryDirectory() as directory:
            assets, source, manifest, applied, module = self.fixture(Path(directory))
            before = snapshot(source)
            self.assertEqual(checker.check_source(source, manifest, assets)["status"], "compatible")
            self.assertEqual(snapshot(source), before)
            (source / "src/main.rs").write_bytes(applied["src/main.rs"])
            self.assertEqual(checker.check_source(source, manifest, assets)["status"], "unsupported")
            for name, content in applied.items():
                (source / name).write_bytes(content)
            self.assertEqual(checker.check_source(source, manifest, assets)["status"], "module_mismatch")
            (source / "src/terminal_surfaces.rs").write_bytes(module)
            self.assertEqual(checker.check_source(source, manifest, assets)["status"], "already_applied")
            (source / "src/vt.rs").write_bytes(applied["src/vt.rs"] + b"// unrelated local change\n")
            before = snapshot(source)
            self.assertEqual(checker.check_source(source, manifest, assets)["changed_files"], ["src/main.rs", "src/vt.rs"])
            self.assertEqual(snapshot(source), before)
            (assets / "terminal_surfaces.rs").write_bytes(b"modified package")
            self.assertEqual(checker.check_source(source, manifest, assets)["status"], "package_mismatch")

    def test_existing_module_in_clean_checkout_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            assets, source, manifest, _, _ = self.fixture(Path(directory))
            module = source / "src/terminal_surfaces.rs"
            module.write_text("personal module")
            self.assertEqual(checker.check_source(source, manifest, assets)["status"], "module_conflict")
            self.assertEqual(module.read_text(), "personal module")

    def test_preparation_is_idempotent_and_rejects_modified_applied_source(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            assets, source, manifest, _, module = self.fixture(root)
            package = root / "skill"
            shutil.copytree(SKILL, package, ignore=shutil.ignore_patterns("__pycache__"))
            target = package / "assets/herdr-app"
            (target / "upstream.json").write_text(json.dumps(manifest))
            (target / "terminal_surfaces.rs").write_bytes(module)
            (target / "live-terminal-surfaces.patch").write_text(
                "--- a/src/main.rs\n+++ b/src/main.rs\n@@ -1 +1,2 @@\n mod vt;\n+mod terminal_surfaces;\n"
                "--- a/src/vt.rs\n+++ b/src/vt.rs\n@@ -1 +1 @@\n-original\n+patched\n")
            command = ["python3", str(target / "prepare.py"), str(source)]
            applied = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(applied.returncode, 0, applied.stderr)
            self.assertEqual(checker.check_source(source, manifest, assets)["status"], "already_applied")
            before = snapshot(source)
            repeated = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(repeated.returncode, 0, repeated.stderr)
            self.assertEqual(snapshot(source), before)
            with (source / "src/vt.rs").open("a") as stream:
                stream.write("personal change\n")
            before = snapshot(source)
            rejected = subprocess.run(command, capture_output=True, text=True)
            self.assertNotEqual(rejected.returncode, 0)
            self.assertEqual(snapshot(source), before)
            report = subprocess.run(["python3", str(package / "scripts/check.py"), "--source", str(source), "--executable", str(root / "missing"), "--json"], capture_output=True, text=True)
            self.assertEqual(report.returncode, 2)
            self.assertEqual(json.loads(report.stdout)["source"]["status"], "unsupported")

    def test_theme_drift_and_persisted_native_choice_are_read_only_and_redacted(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            colors = {"chrome": "#f4ecdb", "foreground": "#503c2e", "background": "#f8f5ec"}
            put(home, "settings.json", {"appearance": "light", "secret": "must-not-leak"})
            put(home, "shared.json", {"layout": "custom", "ag.workspaceTheme": "chiikawa", "conversation": "private text"})
            put(home, "layouts/custom.json", {"theme": "herdr-chiikawa", "colors": colors})
            put(home, "layouts/.state/custom.json", {"theme": {"light": "paper", "dark": "graphite"}, "file": {"theme": "herdr-chiikawa"}})
            put(home, "themes/herdr-chiikawa.json", {"colors": colors})
            before = snapshot(home)
            report = checker.check_theme(home)
            self.assertEqual(report["native_theme_configured"], "paper")
            self.assertTrue(report["legacy_state_drift"])
            self.assertTrue(report["legacy_palette_overlay"])
            self.assertNotIn("private", json.dumps(report))
            self.assertNotIn("must-not-leak", json.dumps(report))
            self.assertEqual(snapshot(home), before)
            put(home, "layouts/custom.json", {"theme": "ink"})
            self.assertEqual(checker.check_theme(home)["native_theme_configured"], "ink", "edited layout discards stale theme pick")

    def test_unknown_system_appearance_and_invalid_files_do_not_invent_theme(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            put(home, "settings.json", {"appearance": "system"})
            put(home, "shared.json", {"layout": "custom", "ag.workspaceTheme": "chiikawa"})
            put(home, "layouts/custom.json", {"theme": {"light": "herdr-chiikawa", "dark": "graphite"}})
            report = checker.check_theme(home)
            self.assertIsNone(report["native_theme_configured"])
            self.assertIsNone(report["legacy_state_drift"])
            self.assertEqual(checker.check_theme(home, "../../secrets")["status"], "layout_unknown")
            (home / "settings.json").write_text("not json")
            self.assertIn("settings", checker.check_theme(home)["read_errors"])

    def test_single_chiikawa_pins_both_slots_despite_old_migration_marker(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            put(home, "settings.json", {"appearance": "dark"})
            put(home, "shared.json", {"layout": "custom", "ag.nativeThemeMigrated.custom": True})
            put(home, "layouts/custom.json", {"theme": "herdr-chiikawa"})
            before = snapshot(home)
            report = checker.check_theme(home)
            self.assertEqual(report["native_theme_slots"], {"light": "herdr-chiikawa", "dark": "herdr-chiikawa"})
            self.assertEqual(report["appearance_configured"], "dark")
            self.assertEqual(report["native_theme_configured"], "herdr-chiikawa")
            self.assertTrue(report["legacy_native_migration_marked"])
            self.assertTrue(report["chiikawa_dark_slot"])
            self.assertTrue(report["appearance_switch_pinned_to_chiikawa"])
            self.assertEqual(snapshot(home), before)

    def test_native_pair_keeps_dark_theme_and_reports_slots_in_system_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            put(home, "shared.json", {"layout": "custom", "ag.nativeThemeMigrated.custom": True})
            pair = {"light": "herdr-chiikawa", "dark": "ink"}
            put(home, "layouts/custom.json", {"theme": pair})
            for appearance, expected in [("light", "herdr-chiikawa"), ("dark", "ink"), ("system", None)]:
                put(home, "settings.json", {"appearance": appearance})
                report = checker.check_theme(home)
                self.assertEqual(report["native_theme_slots"], pair)
                self.assertEqual(report["native_theme_configured"], expected)
                self.assertFalse(report["chiikawa_dark_slot"])
                self.assertFalse(report["appearance_switch_pinned_to_chiikawa"])

    def test_native_default_slots_and_persisted_dark_chiikawa_pick(self):
        with tempfile.TemporaryDirectory() as directory:
            home = Path(directory)
            put(home, "shared.json", {"layout": "custom"})
            put(home, "settings.json", {"appearance": "dark"})
            put(home, "layouts/custom.json", {})
            report = checker.check_theme(home)
            self.assertEqual(report["native_theme_slots"], {"light": "paper", "dark": "graphite"})
            self.assertEqual(report["native_theme_configured"], "graphite")
            put(home, "layouts/.state/custom.json", {"theme": {"light": "paper", "dark": "herdr-chiikawa"}, "file": {}})
            report = checker.check_theme(home)
            self.assertTrue(report["chiikawa_dark_slot"])
            self.assertFalse(report["appearance_switch_pinned_to_chiikawa"])
            self.assertEqual(report["native_theme_configured"], "herdr-chiikawa")

    def test_installed_skill_is_self_contained_and_keeps_unowned_skill(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            codex = root / "codex"; codex.mkdir()
            with patch.object(installer, "SKILL_HOMES", [str(codex)]):
                installer.install_skill("herdr-theme-compat", False)
                target = codex / "skills/herdr-theme-compat"
                self.assertTrue((target / "assets/herdr-app/live-terminal-surfaces.patch").is_file())
                result = subprocess.run(["python3", str(target / "scripts/check.py"), "--executable", str(root / "missing"), "--json"], capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(json.loads(result.stdout)["source"]["status"], "not_checked")
                (target / ".herdr-mods").unlink()
                (target / "personal.txt").write_text("preserve")
                before = snapshot(target)
                installer.install_skill("herdr-theme-compat", False)
                self.assertEqual(snapshot(target), before)


if __name__ == "__main__":
    unittest.main()
