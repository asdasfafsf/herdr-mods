#!/usr/bin/env python3
"""TCP ports being listened on by programs, with each program's folder, for spaces-plus.

    ports.py

Prints JSON: [{ "port": 3000, "pid": 123, "cmd": "node", "cwd": "/path" }], one per port.
spaces-plus shows a port on the worktree its program runs in (a dev server: vite, next,
uvicorn, rails…). Coding agents' own ports (Claude Code, Codex: MCP and login callbacks) are
left out: they say nothing about the work. Reads `lsof` only.
"""

import json
import re
import subprocess

AGENT = re.compile(r"^(claude|codex|\d+\.\d+\.\d+)$")  # Claude Code's process is named by its version


def lsof(args):
    r = subprocess.run(["lsof", "-nP", *args], capture_output=True, text=True)
    return r.stdout.splitlines()


def main():
    listen, pid, cmd = {}, None, None
    for line in lsof(["-iTCP", "-sTCP:LISTEN", "-Fpcn"]):
        tag, value = line[:1], line[1:]
        if tag == "p":
            pid = int(value)
        elif tag == "c":
            cmd = value
        elif tag == "n" and pid and cmd and not AGENT.match(cmd):
            m = re.search(r":(\d+)$", value)
            if m:
                listen.setdefault(pid, {"cmd": cmd, "ports": set()})["ports"].add(int(m.group(1)))
    cwd = {}
    if listen:
        pid = None
        for line in lsof(["-a", "-d", "cwd", "-p", ",".join(map(str, listen)), "-Fpn"]):
            if line.startswith("p"):
                pid = int(line[1:])
            elif line.startswith("n") and pid:
                cwd[pid] = line[1:]
    out = [{"port": port, "pid": p, "cmd": v["cmd"], "cwd": cwd.get(p)} for p, v in listen.items() if cwd.get(p) for port in sorted(v["ports"])]
    print(json.dumps(out))


if __name__ == "__main__":
    main()
