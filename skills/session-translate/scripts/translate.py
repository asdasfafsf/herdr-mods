#!/usr/bin/env python3
"""Agent session translation — the session-translate skill's script (lib/agentsession.py does the work).
Runs anywhere (no Herdr needed); hm translate / hm resume --as call it and then open the result in Herdr.

    translate.py export SESSION                        the session as an agent-session/1 file
    translate.py import STD --to AGENT --cwd DIR       a new AGENT session from that file, in DIR
    translate.py convert SESSION --to A[,B…] --cwd DIR export, then one new session per agent

Prints JSON: export {std, path, agent, title, messages}; import {agent, id, cwd};
convert {std, path, sessions: [{agent, id, cwd}]}. The original session is never changed.
Nothing is printed from the messages.
"""

import json
import os
import sys

sys.path[:0] = [os.path.dirname(os.path.abspath(__file__)),  # agentsession.py, installed beside it
                os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "lib")]  # in the repo
from agentsession import ADAPTERS, STD_DIR, from_std, load_std, save_std, to_std  # noqa: E402


def opt(argv, name):
    if name in argv:
        i = argv.index(name)
        if i + 1 < len(argv):
            value = argv[i + 1]
            del argv[i : i + 2]
            return value
    return None


def main(argv):
    if not argv or argv[0] not in ("export", "import", "convert"):
        print(__doc__, file=sys.stderr)
        return 2
    cmd, rest = argv[0], argv[1:]
    to, cwd = opt(rest, "--to"), opt(rest, "--cwd")
    if len(rest) != 1:
        print(__doc__, file=sys.stderr)
        return 2
    try:
        if cmd == "export":
            std = to_std(rest[0])
            path = save_std(std)
            out = {"std": std["header"]["id"], "path": path, "agent": std["header"]["source"]["agent"],
                   "title": std["header"]["title"], "messages": len(std["messages"])}
        else:
            agents = [a.strip() for a in (to or "").split(",") if a.strip()]
            if not agents or any(a not in ADAPTERS for a in agents):
                raise ValueError(f"--to: {', '.join(ADAPTERS)} 중에서")
            if cmd == "import":
                std = load_std(rest[0])
            else:
                std = to_std(rest[0])
                save_std(std)
            where = cwd or std["header"]["source"].get("cwd") or os.getcwd()
            made = [{"agent": a, "id": from_std(std, a, where), "cwd": os.path.realpath(where)} for a in agents]
            if cmd == "import" and len(made) == 1:
                out = made[0]
            else:
                out = {"std": std["header"]["id"], "path": os.path.join(STD_DIR, f"{std['header']['id']}.jsonl"), "sessions": made}
    except ValueError as e:
        print(str(e), file=sys.stderr)
        return 1
    print(json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
