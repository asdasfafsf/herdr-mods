# worktree-plus 를 만든 이유

새 워크트리 폼과 삭제. Herdr 에 딸린 `worktree` 의 복제본(원본은 `upstream/worktree/`). 만들기·지우기는 `lib/worktree.js` 의 `createWorktree`·`removeWorktree` 이고, 에이전트의 `hm new` 도 같은 함수를 부른다.

## Herdr 기본
브랜치 이름 하나로 `<ROOT>/<레포>/<브랜치>` 에 만들기, 있는 체크아웃 열기, 지우기(체크아웃만).

## 모자랐던 것
- 사람이 읽는 이름(한글), base 선택, PR 체크아웃, 티켓 링크가 없다.
- `.env` 같은 추적 안 되는 파일 복사, 의존성 설치(setup)가 없다.
- 첫 터미널에서 에이전트와 첫 메시지를 시작할 수 없다.
- 지울 때 브랜치가 남아 쌓인다.
- Enter 로만 만들어져서, 에이전트를 고른 뒤나 첫 메시지 칸에서는 만들어지지 않았다(버튼 없음).

## 더한 것
- Orca 식 폼: 이름·브랜치(이름을 따라감)·base·링크·Setup·Also copy·에이전트·첫 메시지, Create worktree·Cancel 버튼(⌘↵ 도).
- 이름 자동 채우기: Base 에 PR(`#123`·URL)이나 Link 에 PR·GitHub 이슈를 넣으면 gh 로 제목을 읽어 이름을(PR 이면 그 브랜치도) 채운다. 티켓 키(TAXTEAM-1446)면 그 키. 직접 입력한 이름은 안 덮어쓰고, 이름 옆에 "from PR #123". Jira 등 다른 트래커의 제목은 안 읽는다(로그인·회사 주소를 전제하지 않으려고). 에이전트는 `hm new --base '#123'` 처럼 이름 없이.
- 삭제: 확인 창(Remove worktree·Cancel), 변경·서브모듈 경고, 머지된 브랜치만 삭제.
- 사람이 버튼으로 지울 땐 확인 창, 에이전트(`hm rm`·`hm clean`)는 창 없이 바로(사람이 시킨 게 확인). 에이전트 쪽도 안 올린 변경·작업 중인 에이전트가 있으면 지우지 않고 이유를 돌려준다(`--force` 로만).
- 정리(Clean up): 레포의 다 끝난 워크트리를 한 창에. PR 이 머지됐거나(squash 머지도: gh 의 PR 상태로) 브랜치가 base 에 들어간 것은 체크, 자기 커밋 없이 끝난 것·PR 이 머지 없이 닫힌 것은 체크 없이. 안 올린 변경·에이전트 작업 중·핀은 막고, 커밋 없이 작업 중인 건 아예 안 보인다. 한 번 누르면 Remove 와 같은 함수로 하나씩(머지된 PR 의 브랜치는 squash 여도 삭제).

## 규칙 (다른 도구로 옮길 때 그대로 가져갈 것)
- 만드는 순서: base 가 PR(`#123`, PR URL)이면 그 브랜치를 fetch → 브랜치가 로컬에 있으면 그대로 → origin 에 있으면 추적 브랜치 → 아니면 base 에서 새 브랜치(추적 안 함: 첫 `git push -u` 가 같은 이름으로 올라가게). base 기본값은 리모트 HEAD, remote 브랜치면 먼저 fetch.
- 위치: `~/.herdr/worktrees/<레포>/<이름>`. 이미 있거나 예전에 있던 경로(Claude Code 가 폴더로 대화를 찾으므로 `~/.claude/projects/` 에 흔적이 있으면)는 `-2`, `-3` 을 붙인다.
- 준비: 레포의 `.worktreeinclude` 와 Also copy 패턴 중 git 이 추적하지 않는 파일만 primary 에서 복사(`include.py`, APFS 면 복제). setup 은 첫 터미널의 로그인 셸에서 먼저 돌리고, 성공하면 에이전트를 시작, 실패하면 셸로 남는다. setup·패턴은 레포 파일이 아니라 이 컴퓨터(`wt.repos`)에만 저장: 받은 레포가 명령을 몰래 실행하지 못하게.
- 지우기: space 먼저 닫고(셸이 폴더를 잡고 있지 않게), 변경·서브모듈이 있으면 force, 브랜치는 그 워크트리가 새로 만들었고(`newBranch`) base 나 리모트 HEAD 에 머지됐거나 그 PR 이 머지됐을 때만 삭제. 확인은 사람이 한다.
- 정리 후보: origin 을 fetch 한 뒤, PR 머지(gh) 또는 HEAD 가 base·리모트 HEAD 의 조상이면 "끝남". 그중 HEAD 커밋이 워크트리보다 오래되면 "자기 커밋 없음"(체크 안 함).

## 걷어낼 조건
Herdr 의 New worktree 가 이름·base·PR·링크·파일 복사·setup·에이전트를 지원하면 폼을 버리고, `hm new` 가 Herdr 명령을 부르게 바꾼다. 삭제 때 머지된 브랜치를 정리하면 `removeWorktree` 의 브랜치 부분을 뺀다.

## 옮길 때 가져갈 것
- `wt.meta`(`~/.config/herdr-app/shared.json`): `{ "[null,\"<경로>\"]": { name, branch, base, link, pr: { number, url, title }, comment, status, pinned, archived, agent, created, newBranch } }`. 사이드바·메뉴·⌘P 가 같이 읽고 쓴다.
- `wt.repos`: `{ "[null,\"<primary 경로>\"]": { setup, include } }`.
- 워크트리 폴더 `~/.herdr/worktrees/` 는 보통 git 워크트리라 그대로 쓸 수 있다.
