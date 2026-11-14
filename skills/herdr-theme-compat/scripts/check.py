#!/usr/bin/env python3
"""Read-only Herdr theme/source compatibility checks, using Python stdlib only."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

ASSETS = Path(__file__).resolve().parents[1] / "assets/herdr-app"
LIMIT = 8 * 1024 * 1024


def digest(path):
    try:
        return hashlib.sha256(path.read_bytes()).hexdigest()
    except OSError:
        return None


def object_file(path):
    try:
        with path.open("rb") as stream:
            raw = stream.read(LIMIT + 1)
        if len(raw) > LIMIT:
            return {}, "too_large"
        value = json.loads(raw)
        return (value, None) if isinstance(value, dict) else ({}, "invalid_object")
    except FileNotFoundError:
        return {}, "missing"
    except (OSError, ValueError):
        return {}, "unreadable"


def check_installation(executable, manifest):
    report = {"status": "unavailable", "version": None,
              "baseline_version_match": None, "runtime_surface_rules": "unknown"}
    if not executable:
        return report
    try:
        result = subprocess.run([str(executable), "--version"], capture_output=True,
                                text=True, timeout=5, stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired, UnicodeError):
        report["status"] = "probe_failed"
        return report
    match = re.fullmatch(r"herdr-app\s+(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\s*", result.stdout)
    if result.returncode != 0 or not match:
        report["status"] = "unrecognized_version"
        return report
    report.update(status="version_only", version=match[1],
                  baseline_version_match=match[1] == manifest["version"])
    return report


def check_source(checkout, manifest, assets=ASSETS):
    if checkout is None:
        return {"status": "not_checked", "changed_files": []}
    checkout = Path(checkout)
    actual = {name: digest(checkout / name) for name in manifest["files"]}
    module = checkout / "src/terminal_surfaces.rs"
    module_hash = digest(module)
    expected_module = manifest["module_sha256"]
    if digest(assets / "terminal_surfaces.rs") != expected_module:
        return {"status": "package_mismatch", "changed_files": ["terminal_surfaces.rs"]}
    if actual == manifest["files"]:
        if module.exists():
            return {"status": "module_conflict", "changed_files": ["src/terminal_surfaces.rs"]}
        return {"status": "compatible", "changed_files": []}
    if actual == manifest["patched_files"]:
        if module_hash == expected_module:
            return {"status": "already_applied", "changed_files": []}
        return {"status": "module_mismatch", "changed_files": ["src/terminal_surfaces.rs"]}
    changed = [name for name, value in actual.items()
               if value != manifest["files"][name]]
    return {"status": "unsupported", "changed_files": changed}


def theme_slots(choice):
    if isinstance(choice, str):
        return {"light": choice, "dark": choice}
    if isinstance(choice, dict):
        return {slot: choice.get(slot) if isinstance(choice.get(slot), str) else None
                for slot in ("light", "dark")}
    return {"light": None, "dark": None}


def pick_theme(choice, appearance):
    slots = theme_slots(choice)
    if appearance in ("light", "dark"):
        return slots[appearance]
    return slots["light"] if slots["light"] == slots["dark"] else None


def check_theme(home, layout_name=None):
    if home is None:
        return {"status": "not_checked"}
    home = Path(home)
    settings, settings_error = object_file(home / "settings.json")
    shared, shared_error = object_file(home / "shared.json")
    layout_name = layout_name or shared.get("layout")
    errors = [label for label, error in [("settings", settings_error), ("shared", shared_error)] if error]
    if not isinstance(layout_name, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,127}", layout_name):
        return {"status": "layout_unknown", "read_errors": errors}
    layout, layout_error = object_file(home / "layouts" / f"{layout_name}.json")
    clicks, _ = object_file(home / "layouts/.state" / f"{layout_name}.json")
    if layout_error:
        errors.append("layout")
    # Herdr discards a persisted theme pick if the layout file changed it.
    old_file = clicks.get("file")
    click_valid = not isinstance(old_file, dict) or old_file.get("theme") == layout.get("theme")
    choice = clicks.get("theme") if click_valid else None
    choice = choice or layout.get("theme") or settings.get("theme")
    appearance = settings.get("appearance", "system")
    appearance = appearance if appearance in ("light", "dark", "system") else None
    if choice is None:
        choice = {"light": "paper", "dark": "graphite"}
    slots = theme_slots(choice)
    chiikawa_dark = slots["dark"] == "herdr-chiikawa" if slots["dark"] else None
    pinned = slots["light"] == slots["dark"] == "herdr-chiikawa"
    name = pick_theme(choice, appearance)
    legacy = shared.get("ag.workspaceTheme")
    legacy = legacy if legacy in ("default", "chiikawa") else None
    native_skin = ("chiikawa" if name == "herdr-chiikawa" else "default") if name else None
    palette, _ = object_file(home / "themes/herdr-chiikawa.json")
    palette = palette.get("colors", {})
    colors = layout.get("colors", {})
    if not isinstance(palette, dict):
        palette = {}
    if not isinstance(colors, dict):
        colors = {}
    matching = sorted(key for key, value in colors.items() if key in palette and palette[key] == value)
    legacy_overlay = len(matching) >= 3 and {"chrome", "foreground"}.issubset(matching)
    drift = legacy != native_skin if legacy is not None and native_skin is not None else None
    return {"status": "configuration_only", "layout": layout_name,
            "appearance_configured": appearance, "native_theme_configured": name,
            "native_theme_slots": slots, "chiikawa_dark_slot": chiikawa_dark,
            "appearance_switch_pinned_to_chiikawa": pinned,
            "legacy_native_migration_marked": shared.get(f"ag.nativeThemeMigrated.{layout_name}") is True,
            "legacy_theme_state": legacy,
            "legacy_state_drift": drift, "legacy_palette_overlay": legacy_overlay,
            "read_errors": errors}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Optional isolated Herdr source checkout")
    parser.add_argument("--app-home", type=Path, help="Optional Herdr configuration home to inspect")
    parser.add_argument("--layout", help="Layout within --app-home; defaults to its shared selection")
    parser.add_argument("--executable", help="Herdr executable; defaults to herdr-app on PATH")
    parser.add_argument("--json", action="store_true", help="Print a machine-readable report")
    args = parser.parse_args(argv)
    if args.layout and args.app_home is None:
        parser.error("--layout requires --app-home")
    manifest = json.loads((ASSETS / "upstream.json").read_text())
    report = {
        "schema": 1,
        "baseline": {key: manifest[key] for key in ("version", "commit")},
        "installation": check_installation(args.executable or shutil.which("herdr-app"), manifest),
        "source": check_source(args.source, manifest),
        "theme": check_theme(args.app_home, args.layout),
    }
    if args.json:
        print(json.dumps(report, indent=2))
    else:
        installed = report["installation"]
        print(f"Installed Herdr: {installed['version'] or installed['status']}; native surface rules: unknown")
        print(f"Source: {report['source']['status']}")
        for name in report["source"]["changed_files"]:
            print(f"  Check: {name}")
        theme = report["theme"]
        print(f"Theme: {theme.get('native_theme_configured') or theme['status']}")
        if "native_theme_slots" in theme:
            slots = theme["native_theme_slots"]
            print(f"  Appearance: {theme['appearance_configured'] or 'unknown'}; Light: {slots['light'] or 'unknown'}; Dark: {slots['dark'] or 'unknown'}")
        if theme.get("chiikawa_dark_slot"):
            print("  Dark slot uses the Chiikawa theme")
        if theme.get("appearance_switch_pinned_to_chiikawa"):
            print("  Both slots use Chiikawa: changing Appearance cannot select a different theme")
        if theme.get("legacy_state_drift"):
            print("  Legacy Agent theme state differs from the native theme")
        if theme.get("legacy_palette_overlay"):
            print("  Legacy root colors may override native theme choices")
        print("Read-only report; version/source checks do not prove installed renderer support.")
    return 0 if report["source"]["status"] in ("not_checked", "compatible", "already_applied") else 2


if __name__ == "__main__":
    raise SystemExit(main())
