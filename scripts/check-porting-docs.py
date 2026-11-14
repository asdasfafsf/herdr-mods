#!/usr/bin/env python3
"""Check porting coverage, local links and synthetic examples, without running a host.

This checks documentation consistency, not feature parity or native session resume.
Usage parsing is exercised with fixture files and mocked collectors only.
"""

import importlib.util
import json
from pathlib import Path
import re
import tempfile
from unittest.mock import patch
from urllib.parse import unquote, urlsplit


ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs/porting"
FIXTURES = DOCS / "fixtures"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_json(path):
    return json.loads(path.read_text(), parse_constant=lambda value: reject(value))


def reject(value):
    raise ValueError(f"Non-JSON constant: {value}")


def check_catalog():
    catalog = read_json(DOCS / "catalog.json")
    features = catalog["features"]
    cases = read_json(DOCS / "acceptance.json")["cases"]
    ids = {item["id"] for item in features}
    case_ids = {item["id"] for item in cases}
    require(len(ids) == len(features), "Duplicate feature ID")
    require(len(case_ids) == len(cases), "Duplicate acceptance ID")
    require({item["feature"] for item in cases} == ids, "Acceptance coverage mismatch")
    require({item["acceptance"] for item in features} == case_ids, "Acceptance links mismatch")
    sources = set()
    catalog_md = (DOCS / "catalog.md").read_text()
    acceptance_md = (DOCS / "acceptance.md").read_text()
    for feature in features:
        for key in ("id", "name", "problem", "outcome", "why", "sources"):
            require(bool(feature[key]), f"Empty {key}: {feature['id']}")
        for path in [feature["why"], *feature["sources"]]:
            require((ROOT / path).is_file(), f"Missing source: {path}")
        for text in (feature["id"], feature["name"], feature["problem"], feature["outcome"]):
            require(text in catalog_md, f"Catalog Markdown drift: {feature['id']}: {text}")
        case = next(item for item in cases if item["id"] == feature["acceptance"])
        require(case["feature"] == feature["id"], f"Wrong case: {feature['id']}")
        sources.update(feature["sources"])
    for case in cases:
        require(f'id="{case["id"].lower()}"' in acceptance_md, f"Missing anchor: {case['id']}")
        for text in [case["setup"], case["action"], *case["expected"]]:
            require(text in acceptance_md, f"Acceptance Markdown drift: {case['id']}")
    for main in (ROOT / "mods").glob("*/main.js"):
        require(str(main.relative_to(ROOT)) in sources, f"Uncatalogued mod: {main.parent.name}")
    for path in ("bin/hm", "bin/hm-statusline", "skills/herdr/SKILL.md", "skills/session-translate/SKILL.md"):
        require(path in sources, f"Uncatalogued entry: {path}")
    return len(features), len(cases)


def check_links():
    files = [*DOCS.rglob("*.md"), ROOT / "skills/session-translate/WHY.md",
             ROOT / "docs/WHY.md", ROOT / "lib/README.md", ROOT / "bin/WHY.md", ROOT / "README.md"]
    count = 0
    for file in files:
        for target in re.findall(r"\[[^\]]*\]\(([^\s)]+)\)", file.read_text()):
            url = urlsplit(target)
            if url.scheme or url.netloc:
                continue
            path = (file.parent / unquote(url.path)).resolve() if url.path else file
            require(path.exists(), f"Broken link in {file.relative_to(ROOT)}: {target}")
            if url.fragment.startswith("ac-"):
                require(f'id="{url.fragment}"' in path.read_text(), f"Missing case anchor: {target}")
            count += 1
    return count


def check_fixtures():
    for file in FIXTURES.glob("*.json"):
        read_json(file)
    shared = read_json(FIXTURES / "shared.json")
    for name in ("wt.meta", "wt.repos", "wt.sleep", "wt.repoColors"):
        for key in shared[name]:
            machine, path = json.loads(key)
            require(machine is None or isinstance(machine, str), f"Bad machine: {key}")
            require(path.startswith("/example/"), f"Non-synthetic path: {path}")
    records = [json.loads(line) for line in (FIXTURES / "session.jsonl").read_text().splitlines()]
    require(records[0]["schema"] == "agent-session/1", "Wrong session schema")
    calls = {call["id"] for item in records[1:] for call in item.get("tool_calls", [])}
    for item in records[1:]:
        require(item["role"] in {"user", "assistant", "tool", "system"}, "Unknown session role")
        if item["role"] == "tool":
            require(item["tool_call_id"] in calls, "Orphan tool result")
    migration = read_json(FIXTURES / "migration.json")
    require(migration["implemented"] is False, "Example must not claim an implemented importer")
    require(migration["source_revision"] == read_json(DOCS / "catalog.json")["baseline"], "Baseline mismatch")

    spec = importlib.util.spec_from_file_location("porting_usage", ROOT / "mods/usage-bar/usage.py")
    usage = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(usage)
    source = read_json(FIXTURES / "usage-sources.json")
    limits = source["claude_control"]["response"]["response"]["rate_limits"]
    live = {"updated": source["claude_live_observed_at"], "windows": usage.claude_windows(limits)}
    with tempfile.TemporaryDirectory() as directory:
        raw_path = Path(directory) / "raw.json"
        raw_path.write_text(json.dumps(source["raw"]))
        raw = usage.claude_raw(str(raw_path))
    with patch.object(usage, "claude_raw", return_value=raw), \
            patch.object(usage, "claude", return_value=None), \
            patch.object(usage, "claude_live", return_value=live):
        result = usage.claude_now("unused")
    actual = [{"name": w["name"], "used": w["used"]} for w in result["windows"]]
    require(actual == source["expect_claude_windows"], f"Usage fixture mismatch: {actual}")
    require(result["updated"] == source["expect_claude_updated"], "Usage age lost")


if __name__ == "__main__":
    features, cases = check_catalog()
    links = check_links()
    check_fixtures()
    print(f"OK: {features} features, {cases} cases, {links} local links; synthetic fixtures consistent.")
    print("Host/UI behavior and target-app acceptance have not been executed by this check.")
