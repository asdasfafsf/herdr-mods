# 왜 만들었나: Herdr 가 기본으로 하는 것과 우리가 더한 것

herdr-mods 의 기능마다 Herdr 가 기본으로 어디까지 하고, 무엇이 모자라서 더했는지. 이 문서는 한눈에 보는 표와 목차이고, 자세한 건 기능마다 그 폴더의 `WHY.md`. 두 가지에 쓴다.

- **Herdr 가 업데이트될 때**: 아래 "걷어낼 조건" 이 생기면 우리 쪽을 지운다(쓸데없이 겹쳐 쓰지 않기). 업데이트를 따라가는 방법은 README 의 "Herdr 가 업데이트되면".
- **다른 도구로 옮길 때**: 각 문서의 "옮길 때 가져갈 것"에서 보존할 이유와 규칙을 찾는다. 구체적인 동작·데이터·새 앱 연결부·검증 사례는 [이식 안내](porting/README.md)로 이어진다.

"Herdr 기본" 은 Herdr 에 딸린 mod(`spaces`, `worktree`, `picker`, `agents`, 원본은 `upstream/`)와 Herdr 문서(`~/.config/herdr-app/AGENTS.md`)로 확인한 것이다. 2026-11 기준.

## 한눈에

| 우리 기능 | Herdr 기본 | 모자랐던 것 | 번들 |
|---|---|---|---|
| 레포 → 워크트리 → 터미널 트리 사이드바 | space 목록, 열린 워크트리는 그 체크아웃 밑에 | 안 연 워크트리가 안 보임, 접기·터미널 트리·이름·링크·정렬 없음 | worktrees |
| 새 워크트리 폼 | 브랜치 이름 하나로 만들기 | 표시 이름, base, PR, 링크, 파일 복사, setup, 에이전트·첫 메시지 없음 | worktrees |
| 워크트리 삭제 + 브랜치 정리 | 체크아웃만 지움 | 머지된 브랜치가 쌓임 | worktrees |
| PR 상태·CI 배지, 다 끝난 워크트리 정리 | 없음 | PR 이 머지됐는지·CI 가 깨졌는지 안 보이고, 끝난 워크트리가 쌓임 | worktrees |
| 밖에서 지운 워크트리 정리 | (해당 없음) | 에이전트가 git 으로 지우면 space 가 남음 | worktrees |
| 행 메뉴(이름·메모·링크·PR·상태·핀·보관) | space 메뉴(이름 등) | 워크트리 단위 정보가 없음 | worktrees |
| Sleep | 없음 | 안 쓰는 워크트리를 닫으면 에이전트 세션을 잃음 | worktrees |
| 워크트리별 세션 목록·검색·이어가기 | 없음 | 예전 Claude·Codex 대화를 찾기 어려움 | worktrees |
| 헤더 버튼(프로젝트 추가·터미널·워크트리) | `+` 는 빈 space 만 | 다른 폴더 열기·clone·새 프로젝트·터미널만 띄우기가 불편 | worktrees |
| 사이드바 드래그 | 행 순서 바꾸기(얇은 선) | 끄는 동안 따라오지 않고 놓을 자리가 모호 | worktrees |
| 워크트리 이동 단축키 | `ctrl-1..9` space 선택, 탭·에이전트 이동 | 사이드바 순서대로 워크트리 오가기 없음 | worktrees |
| 바깥 에이전트 + Active 묶음 | Herdr 가 띄운 에이전트 목록 | Orca·iTerm 등에서 도는 세션이 안 보임 | agents |
| 에이전트의 지금 하는 일·마지막 답·레포/브랜치 | 상태(working·blocked·done·idle)와 제목 | 무엇을 하는지·뭘 허용할지·결과가 뭔지 열어봐야 앎 | agents |
| ⌘P 워크트리 검색, 보기(Agents·Recent·Name·Docs) | 탭 찾기, 새 탭·space | 워크트리·PR·티켓으로 못 찾음, 에이전트·최근 순으로 못 봄 | palette |
| 재부팅 뒤 세션 이어 열기 | 터미널이 마지막 폴더의 셸로 돌아옴 | 돌던 에이전트를 다시 실행하지 않음 | restore |
| 요금제 한도 | 없음 | Claude·Codex 를 얼마나 썼는지 안 보임 | usage |
| macOS 알림 배너 | 소리 + 창 안 토스트 | 창을 안 보고 있으면 모름 | notify |
| 설정 창(보기 설정·레포 색, `hm option`·`hm color`) | Settings 는 Herdr 자신의 것만 | 우리 기능을 켜고 끄거나 레포 색을 고를 곳이 없음 | worktrees |
| Markdown 뷰어(⌘P Docs, `hm md`) | Files 패널은 소스로만 보여줌 | 계획서·README 를 읽으려면 Herdr 밖으로 나가야 함 | docs |
| `hm` 명령 + `herdr` 스킬 | `herdr-app do`, `hc`(Herdr 기능) | 우리가 더한 기능은 에이전트가 부를 입구가 없음 | commands |
| UI 오류·렌더 시간 기록(`hm logs`, `--render`) | `status`로 현재 오류 확인 | 사라진 오류의 시각·스택을 잃고 스택만으로 느린 구간을 알 수 없음 | agents + commands |

## 기능별 문서

기능마다 그 폴더에 `WHY.md` 가 있다(Herdr 기본, 모자랐던 것, 더한 것, 걷어낼 조건, 옮길 때 가져갈 데이터). 기능을 바꾸거나 옮길 때 그 문서에서 시작한다. 구현에 필요한 세부 조건은 [기능 목록](porting/catalog.md)의 ID로 찾는다.

| 기능 | 문서 |
|---|---|
| 사이드바(묶음·접기·배지·정렬·Sleep·헤더 버튼·드래그·밖에서 지운 워크트리) | [mods/spaces-plus/WHY.md](../mods/spaces-plus/WHY.md) |
| 프로젝트 추가(폴더·clone·새 프로젝트) | [mods/project-add/WHY.md](../mods/project-add/WHY.md) |
| 새 워크트리·삭제와 그 규칙, `wt.meta` | [mods/worktree-plus/WHY.md](../mods/worktree-plus/WHY.md) |
| 행 메뉴·편집 창·정렬 | [mods/wt-menu/WHY.md](../mods/wt-menu/WHY.md) |
| 세션 목록 | [mods/wt-sessions/WHY.md](../mods/wt-sessions/WHY.md) |
| 다른 워크트리·에이전트로 대화 이어가기 | [skills/session-translate/WHY.md](../skills/session-translate/WHY.md) |
| 바깥 에이전트·Active | [mods/agents-plus/WHY.md](../mods/agents-plus/WHY.md) |
| ⌘P | [mods/picker-plus/WHY.md](../mods/picker-plus/WHY.md) |
| 재부팅 뒤 이어 열기 | [mods/wt-restore/WHY.md](../mods/wt-restore/WHY.md) |
| 한도 | [mods/usage-bar/WHY.md](../mods/usage-bar/WHY.md) |
| macOS 알림 | [mods/mac-notify/WHY.md](../mods/mac-notify/WHY.md) |
| Markdown 뷰어 | [mods/md-view/WHY.md](../mods/md-view/WHY.md) |
| 설정 창 | [mods/hm-settings/WHY.md](../mods/hm-settings/WHY.md) |
| `hm`·`herdr` 스킬 | [bin/WHY.md](../bin/WHY.md) |
| 같이 쓰는 코드 | [lib/README.md](../lib/README.md) |

## 에이전트 시작 옵션

기능을 더한 게 아니라 Herdr 설정을 쓴다. 메뉴로 에이전트를 띄울 때 Herdr 는 `programs.json` 의 `run` 을 쓰고 셸 alias 는 거치지 않는다. 그래서 Claude Code 는 `--dangerously-skip-permissions`, Antigravity 는 `--dangerously-skip-permissions`, Cursor 는 `--force` 를 `run` 에 둔다. Codex 는 자체 설정(`approval_policy = "never"`, `sandbox_mode = "danger-full-access"`).
