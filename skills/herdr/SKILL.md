---
name: herdr
description: Use when working in Herdr (the desktop app of spaces, tabs and terminals; $HC_TERMINAL_ID is set in its terminals) and the person asks for something the app does: make a worktree (so it is made exactly as Herdr's New worktree button makes it, not with plain git), remove one or clean up merged / finished worktrees (not with git worktree remove, which leaves its space behind), open, pin, archive, rename, comment on, link a ticket or PR to, sleep or wake a worktree; add a project (open a folder or a folder of repos, clone a repo, make a new project); open a terminal or agent tab, a space or a split; list or resume Claude Code / Codex sessions; see agents running outside Herdr; show plan usage limits; pin an agent; show a Markdown file rendered beside the terminal; change the herdr-mods settings (what the Agents list, ⌘P and the sidebar show, Seen, repo colors). E.g. "워크트리 만들어줘", "워크트리 지워줘", "워크트리 정리해줘", "머지된 거 치워줘", "이거 핀 해줘", "이 워크트리 재워줘", "메모 달아줘", "PR 연결해줘", "이 레포 clone 해서 열어줘", "이 폴더 열어줘", "새 프로젝트 만들어줘", "세션 이어서 열어줘", "재부팅으로 꺼진 세션 살려줘", "한도 얼마 남았어", "화면 나눠서 코덱스 띄워", "이 문서 띄워줘", "PLAN.md 보여줘", "마크다운으로 보여줘", "설정 뭐 있어", "레포 이름 숨겨줘", "Seen 1시간으로", "owl 파란색으로", "레포 색 다시 다르게", "사이드바 자세히 보여줘", "make a worktree for X", "clean up worktrees", "pin this". Not for git work inside a checkout (commit, push, rebase).
---

# Herdr

The person works in Herdr. Its window shows spaces > tabs > panes; herdr-core (`hc`) runs
the terminals. The herdr-mods bundles add an Orca-style sidebar (repo → primary checkout →
worktrees → their terminals) with worktree names, links, pins, sleep and more.

Everything the window does by button or menu, you do with a command. Nothing is clicked;
the change shows in the window at once.

| What | Command | Its own guide |
|---|---|---|
| Worktrees and the herdr-mods features | `hm` | `hm --help` |
| The window: spaces, tabs, splits, layouts, focus | `herdr-app do <command>` | `herdr-app --skill`, `herdr-app commands` |
| Terminals and agents: start, read, message, wait, stop | `hc` | `hc --skill` |

## The one rule: worktrees through `hm new`

When the person asks for a worktree, make it with `hm new`, never with `git worktree add`,
`claude --worktree`, an EnterWorktree tool or a folder you pick. `hm new` runs the code
Herdr's New worktree button runs, so it is the same worktree: it goes to
`~/.herdr/worktrees/<repo>/<name>`, gets a branch from the base (fetched first), keeps the
display name and link, copies the repo's `.worktreeinclude` files, runs the repo's setup,
opens a space under its repo and starts the agent asked for. One made with git shows only
as a bare, unopened row.

```sh
hm new "결제 리팩터"                              # in the repo you're in; prints the new path
hm new "결제 리팩터" --repo owl --link BOOK-123   # another repo, with its ticket
hm new --base '#482'                              # PR #482's branch, named from its title
hm new --link https://…/issues/45                 # named from the issue's title (a ticket key: that key)
hm new "X" --agent claude --prompt "Y"            # and start Claude Code (or codex...) on Y
```

It prints the new checkout's path, or why it couldn't (exit 1). Say which; don't claim
a worktree you didn't see made. It opens a space the person sees: make one only when asked.

## Look first

```sh
hm ls            # every open repo's worktrees; * marks the one you're in
hm ls --json     # paths, branch, open space id, name, link, pr, pinned, status...
herdr-app ls     # spaces > tabs > terminals, with ids
```

## Which worktree ("this", "that one")

Commands that take a worktree take `T`: nothing means the checkout you're running in, else
the space shown in the window ("이거 / this" from an agent in a worktree: pass nothing); or a
name or branch as `hm ls` shows it, `repo/name` when two repos share one, or a path. If
`hm` says a name is ambiguous or unknown, run `hm ls` and pick; ask the person only when
the list doesn't settle it.

## Requests and commands

| Person says | Run |
|---|---|
| 이거 핀 해줘 / 풀어줘 | `hm pin` / `hm unpin` |
| 보관해줘 | `hm archive` |
| 이름 바꿔 / 메모 달아 / 리뷰중으로 | `hm set --name "…"` / `--comment "…"` / `--status in-review` |
| PR 연결해줘 | `hm set --pr 123` (or its URL; the title comes from gh) |
| 재워줘 / 깨워줘, 거기로 가 | `hm sleep T` / `hm go T` |
| 거기 터미널 하나 / 코덱스 하나 | `hm term T` / `hm term T --agent codex --prompt "…"` |
| 지워줘 | `hm rm T`: removed at once (its branch goes only if merged). If it says "Not removed" (uncommitted changes, an agent at work), tell the person why; `--force` only if they still want it gone |
| 워크트리 정리해줘 / 머지된 거 치워줘 | `hm clean` (`--repo R`): removes the done ones (PR or branch merged, nothing uncommitted, no agent) and lists the rest with why: tell the person |
| 여기서 했던 세션 / 그 세션 이어서 | `hm sessions T` (`--search "word"`) / `hm resume <id>` (`--fork`) |
| 그 세션을 저 워크트리로 옮겨서 열어 (Claude·Codex 같게) | `hm resume <id> --into T` — 새로 만들 거면 먼저 `hm new`, 그 경로를 T 로. 실행 중인 세션은 안 옮긴다 |
| 원래 세션은 그대로 두고 저 워크트리에서 이어가 (워크트리 만들어서 이어가, Slack 등 다른 곳이 계속 쓰는 세션) | `hm resume <id> --into T --fork` — T 에서 복사본(새 세션 id)이 열리고 원본은 바이트 그대로. 실행 중인 세션도 된다. 새로 만들 거면 먼저 `hm new <이름> --repo R`, 그 경로를 T 로. Claude 복사본은 첫 메시지 때 기록되므로 그 전엔 `hm sessions T` 에 안 보인다 |
| Orca·iTerm 에서 돌던 거 가져와 | `hm outside`, then `hm resume <session>` |
| 재부팅·재시작으로 꺼진 세션 다시 살려 / 복구 창 놓쳤어 | `hm restore`: asks again (in the person's window) for the sessions the last core restart stopped that run nowhere now, and makes it ask (not auto-restore) from now on. "No stopped sessions" means none are left to restore |
| 한도 얼마 남았어 | `hm usage` |
| UI 오류 기록 / 지난 오류 확인 | `hm logs --watch`로 기록(Ctrl-C로 종료), `hm logs`로 최근 기록 확인. 기록 시작 전 오류나 조회 사이에 사라진 오류는 복원할 수 없다. |
| 복원 기록 실패 / 세션 누락 로그 | `hm logs --restore` (`--json` 가능). 저장·조회 실패, 식별되지 않은 터미널과 회복 기록. |
| 렌더가 어디서 느린지 / 성능 로그 확인 | `hm logs --render` (`--json` 가능). Agents Plus가 60초마다 저장한 구간 시간·횟수·규모. GPU 프레임 시간이 아니며 unfinished는 원인 확정이 아닌 미완료 관측이다. |
| 설정 바꿔줘: 레포 이름 숨겨줘, Seen 끄기, Seen 1시간, PR 배지 빼줘… | `hm option` lists every choice with its value and what it does; then `hm option NAME on\|off\|NUMBER\|default` (each place apart: `agents-repo-names off` for the Agents list, `picker-repo-names off` for ⌘P; `seen-minutes 60`, `pr-badges off`; 사이드바 자세히 / 간단히: `sidebar-cards detailed` / `compact`). The person's settings window (sidebar gear) shows the same |
| owl 파란색으로 / 레포 색 바꿔줘 / 원래 색으로 | `hm color owl blue` (teal blue orange pink cyan brown slate lime, #rrggbb), `hm color owl auto`; 레포 색 전부 다르게 다시: `hm color all auto` |
| 이 문서 띄워줘 / PLAN.md 보여줘 / 마크다운으로 보여줘 | `hm md <file>`: rendered in a pane beside this terminal (not twice; the person's keyboard focus stays where it is); it follows the file as you edit it. Only when asked, not for every file you write |
| done 다 봤음 처리 / seen 으로 보내줘 (안 열고) | `hm seen all`, or `hm seen t7 t9` for some |
| 이 에이전트 핀 (Agents 목록) | `hm pin-agent` (this terminal) or `hm pin-agent t7` |
| 이 폴더 열어줘 / 이 폴더 안 레포들 다 열어줘 | `hm add /path`: a repo or folder opens as a space (under its repo); a folder of repos opens each one not open yet |
| 이 레포 clone 해서 열어줘 | `hm clone <git url>` (`--into DIR`; a new space clones it in its terminal, where a login prompt would go) |
| 새 프로젝트 만들어줘 | `hm project "이름"` (`--in DIR`): an empty folder with git and a first commit, opened as a space |
| 터미널 하나 띄워 | `herdr-app do space.new --folder ~` (in a worktree: `hm term T`) |
| 화면 나눠서 X 띄워 | `herdr-app do pane.split --direction right --pane <pane id>`, or `herdr-app do terminal.open --place right --argv '["codex"]'` |
| 새 탭에서 클로드 | `herdr-app do tab.new --name "…" --argv '["claude"]' --task "…"` |

"핀" is the sidebar worktree (`hm pin`) unless the person points at the Agents list or an
agent (`hm pin-agent`).

## Rules

- Remove worktrees only when the person asked, and with `hm rm` / `hm clean` (no window: their
  asking is the yes). `--force` only on their word after hm said what would be lost. Never
  with git yourself: hm closes the space and keeps unmerged branches.
- Use ids from `hm ls` / `herdr-app ls`, not guesses. Don't stop or restart the person's
  app or core.
- `hm` needs the window open and the herdr-mods bundles in the shown layout; its error says
  which bundle is missing.
