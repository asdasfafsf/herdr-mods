# herdr-mods

Herdr 앱에 Orca 식 워크트리 작업 환경을 더하는 mod 모음. 기능별 **번들**로 나뉘어 있어 필요한 것만 설치할 수 있고, 다른 번들이 없어도 각자 동작한다.

```sh
git clone https://kcd.codes/amir/herdr-mods.git
cd herdr-mods
./install.sh            # 전부
./install.sh worktrees agents   # 골라서
```

KCD 계정으로 로그인해야 받을 수 있는 사내 레포다. Herdr 앱(`herdr-app`)과 `python3`, `git` 이 있어야 한다.

## 번들

기능마다 Herdr 가 기본으로 무엇을 안 해서 더했는지, Herdr 가 무엇을 지원하면 걷어내는지, 다른 도구로 옮길 때 무엇을 가져가는지는 [docs/WHY.md](docs/WHY.md).

다른 앱으로 옮기려면 [이식 안내](docs/porting/README.md)에서 시작한다. 기존 WHY에 36개 기능의 동작·데이터·외부 연동·합격 사례를 연결했다. 새 앱의 기본 기능으로 해결되는 것은 재구현하지 않아도 된다.

| 번들 | 하는 일 | mod |
|---|---|---|
| `worktrees` | 사이드바에 레포 → primary 체크아웃 → 워크트리(열린 것·안 열린 것 전부) → 그 밑 터미널을 트리로. 프로젝트 추가(폴더·clone·새로), 새 워크트리, 행 메뉴, 세션 목록, Sleep | `spaces-plus` `worktree-plus` `wt-menu` `wt-sessions` `project-add` |
| `agents` | Agents 목록에 Herdr 밖(Orca·iTerm 등)에서 도는 Claude Code·Codex 도 같이, 맨 위에 지금 보는 탭의 Active 묶음 | `agents-plus` |
| `palette` | ⌘P·⌘J 창에서 탭과 함께 워크트리도 찾고, 없으면 새로 만든다 | `picker-plus` |
| `restore` | 재부팅·로그아웃·크래시로 Herdr core 가 내려갔다 오면, 돌던 에이전트 세션을 같은 탭에서 이어 연다 | `wt-restore` |
| `usage` | 하단바 왼쪽 끝에 Claude·Codex 요금제 한도(5시간·7일 사용률, 리셋 시각) | `usage-bar` |
| `notify` | Herdr 창을 안 볼 때 에이전트가 끝나거나 확인을 기다리면 macOS 알림 배너 | `mac-notify` |
| `docs` | Markdown 파일을 렌더링해서 터미널 옆 pane 에(⌘P 의 Docs 보기, 에이전트의 `hm md`). 파일이 바뀌면 따라간다 | `md-view` |
| `commands` | 에이전트(Claude Code·Codex)가 말로 시킨 일을 사이드바·메뉴와 똑같이 하게: `hm` 명령과 `herdr` 스킬 | (mod 없음) `bin/hm`, `skills/herdr` |

### 설치하면 무엇이 바뀌나

`install.sh` 가 번들마다 하는 일은 다음과 같다. 그 밖의 설정은 건드리지 않는다.

1. **mod 복사**: `mods/<이름>/` 을 `~/.config/herdr-app/mods/<이름>/` 으로 복사하고, 이 스크립트가 설치했다는 표시(`.herdr-mods`, 안에 이 레포 경로)를 남긴다. 같은 이름의 폴더가 이미 있는데 표시가 없으면(Herdr 기본 mod 이거나 손으로 만든 것) 건너뛰고 알려준다. `lib/` 의 파일은 그것을 import 하는 mod 폴더마다 같이 복사된다(`.js` 는 main.js 가, `.py` 는 mod 의 .py 가 import 하면. mod 는 자기 폴더 밖을 import 할 수 없다).
2. **레이아웃**: 지금 보이는 레이아웃(`shared.json` 의 `layout`, `--layout 이름` 으로 다른 것)에 번들이 필요한 블록만 넣는다.

   | 번들 | 레이아웃에 하는 일 |
   |---|---|
   | `worktrees` | `spaces` 블록을 `spaces-plus` 로 바꾼다 |
   | `agents` | `agents` 블록을 `agents-plus` 로 바꾼다 |
   | `palette` | 없음(단축키로 연다) |
   | `restore` | 화면에 안 보이는 floating 블록 `wt-restore` 추가 |
   | `usage` | 하단바(`workspace-status`)를 `status-row` 로 감싸 왼쪽에 720px `usage-bar` 블록 추가 |
   | `notify` | 화면에 안 보이는 floating 블록 `mac-notify` 추가 |

   Herdr 에 딸린 레이아웃(`main`, `terminals`, `win98`)은 모양을 바꿀 수 없어서, 그것을 쓰고 있으면 `herdr-worktrees` 로 복사한 뒤 그쪽을 바꾼다. 설치가 끝나면 `ctrl-shift-l` 로 `herdr-worktrees` 로 옮기면 된다. 이미 들어간 블록은 다시 넣지 않는다. 고치기 전 파일은 `~/.herdr/backups/<파일>.<시각>` 에 남는다.
3. **단축키**: `~/.config/herdr-app/keys.json` 의 `global` 에 아래를 더한다. 이미 다른 명령에 묶인 키는 그대로 두고 알려준다(`--replace-keys` 면 덮어쓴다).

   | 키 | 명령 | 번들 |
   |---|---|---|
   | `⌘⇧↓` / `⌘⇧↑` | 사이드바 다음·이전 space(레포 → 워크트리 순서) | worktrees |
   | `⌘⌥]` / `⌘⌥[` | 위와 같음 | worktrees |
   | `⌘⌥T` | 지금 워크트리에 새 터미널·에이전트 | worktrees |
   | `⌘P` / `⌘J` | 탭·워크트리 찾기 창 | palette |

4. **명령·스킬** (`commands`): `bin/hm` 을 `~/.local/bin/hm` 으로, `skills/herdr/` 를 `~/.claude/skills/herdr/`·`~/.codex/skills/herdr/` 로(그 에이전트가 있으면) 복사한다. 같은 이름이 이미 있는데 이 스크립트가 넣은 게 아니면 건너뛴다.
5. **검사·복구**: 임시 폴더에서 검사한 뒤 기존 mod를 `~/.herdr/backups/mod-<이름>-…/`에 백업하고 교체한다. 교체 후 검사나 복사가 실패하면 해당 mod의 이전 파일을 복구한다. 실패·비소유 mod 건너뜀은 exit 1이며 레이아웃·키·명령 갱신 전에 멈춘다. 앞서 성공한 다른 mod는 유지하므로 번들 전체의 원자적 설치는 아니다. 검사 시간 제한은 각 30초다.

저장·조회·설치 실패의 처리와 검증 범위는 [실패 복구](docs/recovery-reliability.md)에 정리했다.

`--dry-run` 은 위를 실제로 하지 않고 할 일만 출력한다. 처음엔 이걸로 먼저 보는 게 좋다.

### 번들끼리의 의존

같은 번들 안의 mod 는 함께 설치된다. 번들 사이에는 꼭 필요한 의존이 없고, 상대가 없으면 아래처럼 동작한다(상대가 지금 레이아웃에 떠 있는지로 판단한다).

| 번들 | 있으면 더 하는 것 | 없을 때 |
|---|---|---|
| `agents` ← `worktrees` | 바깥 에이전트를 누르면 그 세션의 워크트리 space 에 탭으로 이어 연다 | 그 폴더를 담은 space 에 탭으로, 없으면 새 space 로 이어 연다 |
| `agents` ← `restore` | 이미 Herdr 터미널에서 이어 연 세션을 다시 누르면 그 터미널로 간다 | 누를 때마다 새로 이어 연다(Claude Code·Codex 는 같은 세션을 동시에 열 수 있다) |
| `palette` ← `worktrees` | 워크트리 검색, 안 열린 워크트리 열기, PR·링크로 새 워크트리 | 기본 `picker` 처럼 탭만 찾는다 |
| `palette` ← `docs` | Docs 보기에서 고른 파일을 렌더링해서 연다 | 열리지 않는다(`md-view` 가 없음) |
| `worktrees` ← `restore` | Sleep 했다 깨운 세션, 바깥 세션을 이어 열 때 이미 떠 있는 터미널로 간다 | 위와 같이 새로 이어 연다 |
| `usage` ← ClaudeHUD | Claude 한도 스냅샷을 보조 자료로 읽는다 | Claude 직접 조회·상태줄 스냅샷과 Codex 직접 조회로 표시 |
| `commands` ← 나머지 | `hm` 이 그 번들의 일을 한다(worktrees: 대부분, agents: `hm outside`, usage: `hm usage`, restore: `hm restore`, docs + worktrees: `hm md`) | 그 명령만 어느 번들이 없는지 말하고 멈춘다 |

### 설치 뒤 한 번만

- **usage**: 설치된 Claude Code·Codex에 직접 조회하므로 기본 설정은 필요 없다. Claude 스냅샷도 함께 쓰려면 `hm-statusline`을 상태줄 명령 앞에 두거나, ClaudeHUD 설정(`~/.claude/plugins/claude-hud/config.json`)의 `display.externalUsageWritePath`를 `~/.herdr/usage/claude.json`의 절대경로로 둔다.
- **notify**: Herdr 아이콘으로 뜨게 하려면 `sh mods/mac-notify/notifier/build.sh` 로 도우미 앱(`~/Applications/HerdrNotify.app`)을 한 번 빌드하고(Xcode Command Line Tools 필요), 처음 뜰 때 알림을 허용한다. 빌드하지 않으면 "스크립트 편집기" 이름으로 뜨고 눌러도 아무 데도 가지 않는다.

## 에이전트에게 말로 시키기 (`commands`)

Herdr 안의 Claude Code·Codex 에게 "워크트리 만들어줘", "이거 핀 해줘", "이 워크트리 재워줘", "PR 연결해줘", "그 세션 이어서 열어줘", "한도 얼마 남았어" 처럼 말하면, `herdr` 스킬이 그 에이전트에게 `hm` 을 쓰게 한다. 버튼을 대신 누르는 게 아니라 같은 기능을 바로 실행한다.

- **워크트리는 버튼과 똑같이 만들어진다.** New worktree 창의 Create 와 `hm new` 는 같은 함수(`lib/worktree.js` 의 `createWorktree`)를 부른다. 위치(`~/.herdr/worktrees/<레포>/<이름>`), base 에서 딴 브랜치, 표시 이름·링크, `.worktreeinclude` 복사, setup, 에이전트, 레포 밑 space 까지 같다. 스킬은 에이전트에게 `git worktree add` 로 직접 만들지 말라고 한다(그렇게 만든 건 이름·링크 없이, 열리지 않은 행으로만 보인다).
- 대상은 생략하면 그 에이전트가 일하는 워크트리(없으면 창에 보이는 space), 아니면 이름·브랜치·경로.
- **에이전트가 한 일에는 창도 알림도 안 뜬다.** 사람이 시킨 게 곧 확인이라 지우기(`hm rm`)·정리(`hm clean`)도 바로 한다. 다만 잃을 게 있으면(안 올린 변경, 그 안에서 일하는 에이전트) 하지 않고 이유를 돌려줘 에이전트가 대화로 묻고, 사람이 그래도 하라면 `--force`. 확인 창은 사람이 버튼을 누를 때만.
- 레포는 Herdr 에 아직 안 열었어도 이름이나 경로로 가리킬 수 있다(`hm new … --repo pets`).

```sh
hm ls                                         # 열린 레포의 워크트리 (* = 지금 있는 곳)
hm new "결제 리팩터" --link BOOK-123 --agent claude --prompt "…"
hm pin · hm sleep · hm go 결제-리팩터 · hm set --comment "…" --pr 123
hm rm · hm clean                              # 지우기, 머지된 것 정리
hm add ~/Desktop/workspace · hm clone <url> · hm project 이름   # 프로젝트 추가
hm sessions · hm resume <id> · hm outside · hm usage · hm pin-agent
hm md PLAN.md                                 # 그 문서를 렌더링해서 옆 pane 에
hm --help                                     # 전부
```

Herdr 원래 기능(space·탭·화면 나누기·레이아웃)은 `herdr-app do <명령>`, 터미널·에이전트는 `hc` 로 하며, 스킬이 그 둘도 안내한다.

## 에이전트를 어떤 옵션으로 띄우나

새 워크트리, 행 메뉴의 새 터미널, 세션 목록이 Claude Code·Codex 를 띄울 때는 Herdr 가 아는 실행 명령(`programs.json` 의 `run`, 없으면 `claude` / `codex`)을 쓴다. 셸 alias 는 거치지 않으므로, 늘 쓰는 옵션은 `~/.config/herdr-app/programs.json` 에 둔다.

```json
{ "programs": {
    "claude": { "run": ["claude", "--dangerously-skip-permissions"] },
    "codex": { "run": ["codex", "--dangerously-bypass-approvals-and-sandbox"] },
    "antigravity": { "run": ["agy", "--dangerously-skip-permissions"] },
    "cursor": { "run": ["cursor-agent", "--force"] } } }
```

없으면 각 에이전트 자체 설정을 따른다: Claude Code 는 `~/.claude/settings.json` 의 `permissions.defaultMode`, Codex 는 `~/.codex/config.toml` 의 `approval_policy`·`sandbox_mode`(둘이 `"never"`·`"danger-full-access"` 면 옵션 없이도 YOLO). 처음 여는 폴더에서 묻는 "이 폴더를 믿나"는 에이전트마다 다르다: Claude Code·Codex 는 이미 믿은 레포의 워크트리면 묻지 않고, Antigravity 는 새 폴더마다 한 번 묻는다. 세션을 이어 열 때(restore, Sleep 깨우기, 바깥 에이전트)는 그 세션을 처음 띄운 옵션을 그대로 쓴다.

## 업데이트·제거

UI 오류가 잠깐 떴다가 사라지면 `hm logs --watch`로 기록하고 다른 터미널에서 `hm logs`로 확인한다. 기록 위치와 한계는 [UI 오류 진단](docs/ui-diagnostics.md). 감시 명령은 실행 중에만 작동하며 Ctrl-C로 종료한다.

느린 구간은 `hm logs --render`로 확인한다. Agents Plus는 구간별 JS 렌더 시간을 집계해 60초마다 별도 파일에 저장한다. 정상 렌더의 평균·최대와 25ms 이상 표본, 미완료 관측을 구분한다. 화면 전체의 GPU 프레임 시간은 아니다.

```sh
git pull && ./install.sh      # 설치했던 번들을 다시 적는다
```

다시 실행하면 mod 는 새 것으로 바꾸고, 이미 들어간 레이아웃 블록과 단축키는 그대로 둔다.

제거는 손으로 한다.

1. `~/.config/herdr-app/mods/` 에서 해당 mod 폴더를 지운다.
2. 레이아웃은 `~/.herdr/backups/` 의 설치 전 파일로 되돌리거나, 블록 이름을 원래(`spaces`, `agents`)로 바꾸고 추가된 블록을 지운다.
3. `keys.json` 에서 위 단축키를 지운다.

어떤 설정 때문에 창이 이상해지면 `ctrl-alt-shift-escape` 가 언제나 먹는다. 지금 레이아웃과 `keys.json` 을 `*.reset-<시각>` 으로 치우고 기본 `main` 레이아웃으로 돌아간다.

## 기능

### worktrees

- **사이드바**: 레포 헤더 아래에 primary 체크아웃(폴더 아이콘)과 모든 워크트리(브랜치 아이콘)가 나온다. 아직 space 로 안 연 워크트리도 흐리게 보이고, 누르면 연다. 각 행 밑에 그 space 의 터미널·에이전트가 나온다. 레포·워크트리·터미널 묶음은 오른쪽 버튼으로 접고 편다. 들어가는 워크트리는 저절로 펴지고, 떠나면 접힌다. 다른 space 로 가면(Agents 목록에서 에이전트를 누르거나 ⌘P 등) 그 줄이 화면 밖일 때 목록이 거기로 스크롤된다.
- **배지**: 브랜치, PR, 링크(티켓·URL), 열려 있는 포트, 메모. 링크가 URL 이 아니면 shared `wt.linkTemplate`(예: `https://tracker.example/browse/{key}`)으로 주소를 만든다. 설정하지 않으면 그냥 글자로 보인다.
- **정렬**: 사이드바 맨 위 `Spaces` 줄의 정렬 버튼. 활동순(기본), 최근 연 순, 이름순, 만든 순.
- **설정**(`Spaces` 줄 오른쪽 톱니바퀴): Agents 목록·⌘P·사이드바에 무엇을 보일지(레포 이름, 하는 일, Seen 과 그 시간, PR·링크·메모·포트 배지), 사이드바 카드 모양(Compact 한 줄 / Detailed: Orca 처럼 이름·상태 아래 브랜치와 배지, 에이전트마다 하는 일), 레포마다 색. 에이전트에게 말해도 같다(`hm option`, `hm color`).
- **헤더 버튼 셋**(`Spaces` 줄 오른쪽, 한 번에): 프로젝트 추가(폴더 고르기·URL 로 clone·새 프로젝트, 원격 머신이 있으면 Host 선택), 새 터미널(홈), 지금 레포의 새 워크트리.
- **새 워크트리**(레포 행의 `+`): 이름(한글 가능), 브랜치(이름을 따라가다 고치면 멈춤), 베이스(기본은 리모트 HEAD, fetch 먼저. `#123` 이나 PR URL 이면 그 PR 브랜치), 링크, setup 명령, 더 복사할 파일, 에이전트, 첫 메시지.
  - **복사**: 레포의 `.worktreeinclude` 와 "Also copy" 패턴에 맞는, git 이 추적하지 않는 파일(`.env` 등)만 새 워크트리로 복사한다(APFS 에서는 `cp -c` 복제라 공간을 안 먹는다).
  - **setup**: 첫 터미널에서 로그인 셸로 setup 을 먼저 돌리고, 성공하면 에이전트를 시작한다. setup 과 복사 패턴은 레포별로 이 컴퓨터에만 저장한다. 레포 안 파일에서 읽지 않으므로, 받은 레포가 명령을 몰래 실행시킬 수 없다.
- **PR 상태와 정리**: 배지에 PR 열림·머지됨·닫힘과 CI 결과(gh 로 5분마다). 레포 헤더의 정리 버튼은 다 끝난 워크트리(PR 머지·브랜치 머지)를 한 창에 모아 한 번에 지운다(안 올린 변경·에이전트 작업 중은 막음).
- **행 메뉴**(우클릭): 이름·메모·링크·PR 고치기, 상태 표시, 고정(pin), 읽음/안 읽음, 보관(archive), 세션 목록, Finder·에디터에서 열기, 경로·브랜치 복사, Sleep, space 닫기, 워크트리 삭제(머지된 브랜치는 같이 지움, 지우기 전에 확인). primary 체크아웃은 보관·Sleep·삭제가 없다.
- **Sleep**: Claude Code·Codex 세션을 식별·저장한 뒤 워크트리 space와 터미널을 닫는다. 식별 실패 시 열린 상태를 유지한다. 행은 흐리게 남고, 다시 열면 그 세션들을 이어 연다. Codex 공유 서버의 작업 중단은 보장하지 않는다.
- **세션 목록**: 그 워크트리에서 돌았던 Claude Code·Codex 세션을 보고, 검색하고, 이어가거나 fork 한다. Claude 프로젝트와 Codex rollout·현재 SQLite 인덱스·이름 기록을 읽기만 한다. [Claude/Codex 지원 범위와 검증](docs/codex-parity.md).
- **Herdr 기본 기능**은 그대로 쓴다. `⌘W` 는 탭만 닫고 워크트리는 남는다. `⌘D` / `⌘⇧D` 는 화면을 오른쪽·아래로 나누고, `⌘⌥←↑↓→` 로 나뉜 칸을 옮겨 다니고, `⌘⇧↩` 로 한 칸을 키운다.

### agents

- Herdr 의 Agents 목록에 Herdr 밖에서 도는 Claude Code·Codex 가 같은 상태 묶음(working·blocked·done·idle) 안에 섞여 나온다. 앱 이름 태그와 흐린 아이콘으로 구분한다. 창이 앞에 있을 때 10초마다 `ps`·`lsof` 와 `~/.claude/sessions` 로 찾는다.
- 바깥 에이전트를 누르면 그 세션을 Herdr 에서 이어 연다. 원래 앱의 것은 끄지 않는다.
- 맨 위 **Active** 묶음에 지금 보고 있는 탭의 에이전트가 온다. done 이 돼도 아래로 밀려나지 않는다.
- **Seen**: 끝난 걸 봤지만(Herdr 가 done 을 idle 로 바꿈) 아직 대꾸하지 않은 에이전트는 2시간 동안 Working 과 Idle 사이 Seen 묶음에 보라 테두리로 남는다. 다시 일하면 빠지고, 2시간이 지나면 Idle 로 간다. 사이드바·⌘P 도 같은 표시. 상태를 보고하는 에이전트 모두(Claude·Codex 등).
- 행마다 레포 이름(그 레포 색 글자, 바탕 없이). 보일지는 Agents 목록과 ⌘P 따로(설정 창, Agents 제목 옆 메뉴, `hm option agents-repo-names off` / `picker-repo-names off`); 색은 어디서나 같다. 레포 색은 레포마다 하나(`wt.repoColors`), 열린 레포끼리 겹치지 않게 상태 색(빨강·노랑·초록·보라)을 뺀 8색에서 준다. 에이전트가 많아도 어느 레포인지 바로 보인다. 레포의 primary 체크아웃이라 이름이 이미 레포면 생략. ⌘P Agents 보기도 같은 태그.
- 소식이 있는 행에만 두 번째 줄: 일하는 중이면 지금 하는 일(도구 사이엔 마지막으로 한 말), 기다리는 중이면 허용을 기다리는 명령, 끝났으면 답의 첫 줄. 마우스를 올리면 레포 · 브랜치(같은 이름이 둘이면 행에 바로).

### palette

- 여러 단어로 찾는다(순서 무관). 워크트리의 이름·브랜치·메모·티켓·PR 번호까지 본다.
- PR·이슈 URL 이나 `#123` 을 붙여 넣으면 그것으로 새 워크트리를 만드는 행이 나온다. 맞는 게 없을 때도 입력한 이름으로 새 워크트리를 만드는 행이 나온다.
- 위쪽 보기(Tab 으로 넘김): Needs you(기본), Agents(좌측 하단 Agents 목록 순서로 에이전트 한 줄씩), Recent, Name, Docs(지금 레포의 Markdown 파일, 최근 바뀐 순. Enter 로 옆 pane 에 렌더링).

### docs

- `md-view` pane 이 Markdown 파일을 렌더링한다(제목·목록·표·코드·인용·링크, 글자 선택 가능). Herdr 의 pane 헤더로 나누기·줌·닫기.
- 파일이 바뀌면 다시 그린다. 에이전트가 계획서를 쓰는 동안 띄워 두면 쓰는 대로 보인다.
- 다른 `.md` 링크는 같은 pane 에서 열리고 ← 로 돌아간다. 웹 링크는 브라우저로 열린다.
- 여는 곳: ⌘P 의 Docs 보기, 또는 에이전트에게 "이 문서 띄워줘"(`hm md`). 같은 탭에 이미 띄운 파일이면 새로 열지 않는다. 에이전트가 열 땐 키보드 포커스를 가져가지 않는다.

### restore

- Herdr core 가 다시 뜨면, 직전에 돌던 에이전트 세션을 탭마다 보여주고 이어 열기·다시 열기를 고르게 한다. 작업 중(working)이던 세션은 "이어서 해 줘" 메시지를 함께 보내 하던 일을 계속하게 한다.
- 세션 기록은 바뀔 때마다 `~/.herdr/restore/last.json` 에 쓴다(갑작스러운 재부팅 직전 상태까지 남도록). core 가 뜬 뒤 20초는 터미널이 아직 재부팅 전 상태로 보이므로 기다렸다 판단한다.
- 멈춘 run 의 기록은 `previous.json` 에 남아, 창을 놓쳤거나 닫았으면 `hm restore`(또는 에이전트에게 "재부팅으로 꺼진 세션 살려줘")로 다시 물을 수 있다.
- 이어 열 때는 그 세션을 처음 시작한 플래그(`--dangerously-skip-permissions`, `--model` 등)를 그대로 쓴다.

### usage

- 하단바 왼쪽 끝 알약에 Claude·Codex 의 5시간·7일 사용률과 리셋까지 남은 시간(`resets in 3h 39m`, `6d 12h`). 정확한 리셋 시각은 마우스를 올리면, 누르면 자세히, 끝의 Refresh 는 바로 다시 읽기.
- Claude 는 상태줄·ClaudeHUD 스냅샷과 Claude Code의 `get_usage` 직접 조회를 합쳐 읽는다. 상태줄에 없는 **Fable 주간 사용률·리셋 시각**도 표시한다. 직접 조회는 5분마다 또는 Refresh 때 하며, 모델 호출이나 인증정보 직접 읽기는 없다. 실험적 인터페이스를 지원하지 않는 Claude 버전에서는 스냅샷으로 대체한다. Codex 는 Codex 에게 직접 묻는다(`codex app-server` 의 한도 읽기, 5분마다 또는 Refresh 때). 로그인 정보는 읽지 않는다. 못 물으면 Codex 세션 기록의 마지막 값.

### notify

- 창이 앞에 있지 않을 때만, working → done/idle(끝남), → blocked(확인 필요) 전이를 배너로 보낸다. 누르면 그 에이전트로 간다.

## mod 사이의 약속

번들을 오가는 데이터는 Herdr 의 shared state 와 명령뿐이다. 새 mod 가 이것을 써도 된다.

| shared 키 | 쓰는 곳 → 읽는 곳 | 내용 |
|---|---|---|
| `wt.meta` | worktree-plus·wt-menu·spaces-plus | 체크아웃별(`[machine, path]` JSON 키) `{ name, branch, base, link, pr, comment, agent, created, archived }` |
| `wt.trees` | spaces-plus → picker-plus·agents-plus·hm | space 가 열린 레포별 체크아웃 `{ path, branch, main, space, sleeping }` |
| `wt.live` | wt-restore → spaces-plus·agents-plus | `{ 세션 id: 터미널 주소 }` |
| `wt.sleep` | spaces-plus·wt-menu | 잠든 워크트리와 깨울 때 이어 열 세션 |
| `wt.repos` | worktree-plus | 레포별 setup·복사 패턴 |
| `wt.sort` | wt-menu → spaces-plus | 워크트리 정렬 |
| `wt.linkTemplate` | 사용자 → spaces-plus | 링크 주소 틀 |
| `wt.results` | spaces-plus → hm | `create@` 요청별 결과 `{ ok, path, error, at }` (최근 20개) |
| `ag.info` / `ag.order` | agents-plus → picker-plus | 에이전트별 `{ at, doing, said }`, Agents 목록의 순서 |
| `md.panes` | md-view → lib/docs.js | md-view pane 별로 보여주는 파일 `{ file, on }` |

| 명령 | 하는 일 |
|---|---|
| `spaces-plus.next` / `.prev` | 사이드바 순서로 다음·이전 space |
| `spaces-plus.new_terminal` | 지금 워크트리에 새 터미널 |
| `spaces-plus.new_worktree` | 지금 레포에 새 워크트리 창 |
| `spaces-plus.sessions` | 지금 워크트리의 세션 목록 |
| `spaces-plus.open@<경로>` | 그 체크아웃을 space 로 연다(잠들었으면 깨운다) |
| `spaces-plus.resume@<JSON>` | `{ agent, session, argv, cwd, title }` 세션을 알맞은 곳에서 이어 연다 |
| `spaces-plus.sleep@<space id 또는 경로>` | 그 워크트리를 Sleep |
| `spaces-plus.go@<경로>` | 그 체크아웃의 space 로(없으면 연다) |
| `spaces-plus.meta@<JSON { path, patch }>` | 이름·메모·링크·PR·상태·pinned·archived 바꾸기 |
| `spaces-plus.create@<JSON>` | `{ repo, name, branch, base, link, agent, prompt, setup, include, request }` 로 워크트리를 만든다(버튼과 같은 함수) |
| `spaces-plus.remove@<경로>` | 삭제 확인 창 |
| `spaces-plus.sessions@<경로>` | 그 체크아웃의 세션 목록 |
| `spaces-plus.sort@<activity·recent·name·created>` | 정렬 |
| `spaces-plus.doc@<JSON { file, terminal, request }>` | 그 터미널 pane 오른쪽에 Markdown 파일을 렌더링해서 연다(⌘P Docs 와 같은 `lib/docs.js` 의 `openDoc`) |

명령은 그 mod 가 지금 레이아웃에 떠 있을 때만 받는다. 그래서 다른 번들의 명령을 부르기 전에 `lib/resume.js` 의 `runs(layout(), "<mod>")` 로 확인한다.

## Herdr 가 업데이트되면

`spaces-plus`, `worktree-plus`, `picker-plus`, `agents-plus` 는 Herdr 기본 mod(`spaces`, `worktree`, `picker`, `agents`)의 복제본이라 그대로 두면 Herdr 의 새 기능을 못 받는다.

- `upstream/<원본>/` 에 복제본에 마지막으로 합친 원본을, `upstream/versions.json` 에 그 해시를 둔다.
- Herdr 가 켜질 때 원본 해시가 바뀌었으면 `spaces-plus` 가 알림을 띄운다. 누르면 이 레포에서 Claude Code 가 아래 작업을 대신 한다.
- `scripts/sync-upstream.sh` 가 원본의 변경을 복제본에 3-way 병합(`git merge-file`)한다. 우리 수정은 남고 Herdr 의 변경이 들어오며, 양쪽이 같은 줄을 고친 곳만 충돌로 남긴다(그때는 설치하지 않는다).
- Herdr 가 바꾼 내용은 `upstream-changes/<원본>.diff` 에 남는다. Herdr 가 이제 복제본이 더한 기능을 기본으로 한다면, 우리 쪽 기능을 걷어낸다.

## 고치는 법

- 레포에서 고친 뒤 `./install.sh <번들>` 로 다시 설치한다. Herdr 는 mod 파일이 바뀌면 바로 다시 불러온다. 심볼릭 링크로 연결하면 다시 불러오지 않아서 복사 방식을 쓴다.
- 여러 mod 가 같이 쓰는 코드는 `lib/` 에 하나만 둔다: `state.js`(공유 데이터 키), `worktree.js`(워크트리 만들기·지우기: 버튼과 `hm` 이 같이 씀), `resume.js`(세션 이어 열기), `ui.js`(상태 표시·버튼), `places.js`, `project.js`, `agentfiles.py`(Claude·Codex 기록 읽기: Python helper 들이 같이 씀). 목록은 [lib/README.md](lib/README.md). mod 폴더의 사본은 설치 때 복사되는 것이라 git 에 넣지 않는다.
- 번들 구성(mod, 레이아웃 단계, 단축키, 안내)은 `bundles.json` 에서 정한다.
- 확인: `herdr-app check ~/.config/herdr-app/mods/<mod>`, `herdr-app status`(에러), `herdr-app shot`(화면). `check` 는 처음 한 번 그리는 것만 보므로, 그 뒤 다시 그리다 나는 오류(사이드바 위 "This view could not be re-rendered")는 못 잡는다. 고친 뒤엔 화면으로도 본다.
- 레이아웃이 깨졌으면 `~/.config/herdr-app/layout.error` 에 이유가 남고, Herdr 는 마지막으로 정상이던 것을 계속 쓴다.
