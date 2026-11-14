#!/usr/bin/env python3
"""Apply the optional renderer patch to an isolated, pinned Herdr checkout.

Does not download, build, install, start or stop an application.
"""
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys


def main():
    package = Path(__file__).resolve().parent
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 assets/herdr-app/prepare.py /path/to/isolated/herdr-app")
    checkout = Path(sys.argv[1]).resolve(strict=True)
    manifest = json.loads((package / "upstream.json").read_text())
    patch = package / "live-terminal-surfaces.patch"
    module = checkout / "src/terminal_surfaces.rs"
    checker_path = package.parents[1] / "scripts/check.py"
    spec = importlib.util.spec_from_file_location("herdr_theme_compat", checker_path)
    checker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(checker)
    report = checker.check_source(checkout, manifest, package)
    if report["status"] == "already_applied":
        print("Renderer patch already prepared")
        return
    if report["status"] != "compatible":
        changed = ", ".join(report["changed_files"])
        raise SystemExit(f"{report['status']}: {changed}; use a clean isolated checkout for {manifest['commit']}")
    command = ["git", "-C", str(checkout), "apply"]
    subprocess.run(command + ["--check", str(patch)], check=True)
    subprocess.run(command + [str(patch)], check=True)
    shutil.copyfile(package / module.name, module)
    print(f"Prepared renderer patch for Herdr {manifest['version']}; no installed app was changed")


if __name__ == "__main__":
    main()
