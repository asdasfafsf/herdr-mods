# 기능별 이식 목록

기준 버전의 35개 결과와 이후 추가된 UI 진단(C03)을 합쳐 36개 사용자 결과로 묶었다. mod의 수와 같지 않다. 각 행은 WHY → 업무 규칙 → 합격 사례로 연결한다. 원래 불편은 기존 WHY를 요약했으며 S03/S04는 이번에 추가한 목적 설명을 따른다.

**새 앱에서 같은 불편이 이미 해결되면 이 기능을 새로 구현하지 않는다.** `target_status`는 전부 not_evaluated로 시작한다. 지원 판정과 근거는 host-contract의 평가표에 기록한다.

| ID / 기능 | 원래 불편 | 보존할 결과 | 배경 | 합격 사례 |
|---|---|---|---|---|
| P01 폴더/레포 묶음 열기 | 레포마다 터미널에서 경로를 잡아 공간을 만들어야 한다 | 폴더를 골라 필요한 레포를 중복 없이 연다 | [WHY](../../mods/project-add/WHY.md) | [AC-P01](acceptance.md#ac-p01) |
| P02 clone 후 작업 시작 | 별도 clone과 로그인 대응 후 다시 앱에 추가해야 한다 | 앱 안의 터미널에서 clone하고 그 폴더에서 이어 일한다 | [WHY](../../mods/project-add/WHY.md) | [AC-P02](acceptance.md#ac-p02) |
| P03 빈 프로젝트 생성 | mkdir·git init·첫 커밋·공간 열기를 따로 해야 한다 | 바로 worktree를 만들 수 있는 프로젝트를 연다 | [WHY](../../mods/project-add/WHY.md) | [AC-P03](acceptance.md#ac-p03) |
| W01 이름/base/PR 기반 worktree 생성 | 브랜치 이름만으로 작업 목적과 시작점을 다루기 어렵다 | 표시 이름과 Git 분기를 일관되게 만들고 즉시 연다 | [WHY](../../mods/worktree-plus/WHY.md) | [AC-W01](acceptance.md#ac-w01) |
| W02 파일 복사와 setup | worktree마다 env 복사와 의존성 준비를 반복한다 | 사용자 지정 준비 후 에이전트를 시작한다 | [WHY](../../mods/worktree-plus/WHY.md) | [AC-W02](acceptance.md#ac-w02) |
| W03 작업 메타데이터와 행 메뉴 | 폴더 이름만으로 목적·티켓·진행 상태를 찾기 어렵다 | 동일 checkout의 이름/메모/PR/상태를 어디서나 공유한다 | [WHY](../../mods/wt-menu/WHY.md) | [AC-W03](acceptance.md#ac-w03) |
| W04 checkout와 브랜치 안전 삭제 | checkout 정리 뒤 브랜치가 쌓이거나 작업을 잃을 수 있다 | 작업 중 데이터를 보호하고 확인된 완료 브랜치만 정리한다 | [WHY](../../mods/worktree-plus/WHY.md) | [AC-W04](acceptance.md#ac-w04) |
| W05 완료 worktree 일괄 정리 | 끝난 작업을 하나씩 확인하고 치워야 한다 | 완료 증거와 보류 이유를 보고 안전 후보만 정리한다 | [WHY](../../mods/worktree-plus/WHY.md) | [AC-W05](acceptance.md#ac-w05) |
| B01 레포/worktree/터미널 트리 | 열지 않은 worktree와 primary 없는 레포 묶음이 안 보인다 | Git에 있는 모든 checkout과 실행 공간 관계를 한눈에 본다 | [WHY](../../mods/spaces-plus/WHY.md) | [AC-B01](acceptance.md#ac-b01) |
| B02 접기/자동 펼치기/드래그 | 목록이 길고 현재 작업 위치와 이동 대상이 불명확하다 | 현재 위치를 잃지 않고 묶음을 정돈한다 | [WHY](../../mods/spaces-plus/WHY.md) | [AC-B02](acceptance.md#ac-b02) |
| B03 정렬과 순서대로 이동 | 호스트 기본 이동 순서가 레포 트리 순서와 다르다 | 보이는 작업 순서대로 이동한다 | [WHY](../../mods/spaces-plus/WHY.md) | [AC-B03](acceptance.md#ac-b03) |
| B04 PR/CI/포트/링크 배지 | 완료·실패·실행 서버를 확인하려면 매번 외부로 나가야 한다 | 작업 행에서 관련 상태와 진입점을 찾는다 | [WHY](../../mods/spaces-plus/WHY.md) | [AC-B04](acceptance.md#ac-b04) |
| B05 밖에서 삭제된 worktree 정리 | Git으로 삭제한 폴더의 공간이 앱에 남는다 | 실제 삭제와 일시 단절을 구별해 정리한다 | [WHY](../../mods/spaces-plus/WHY.md) | [AC-B05](acceptance.md#ac-b05) |
| B06 Sleep과 깨우기 | 공간을 닫으면 어떤 세션을 이어야 하는지 잃는다 | 폴더를 보존하고 같은 세션으로 돌아온다 | [WHY](../../mods/spaces-plus/WHY.md) | [AC-B06](acceptance.md#ac-b06) |
| A01 Active/우선순위/부모·자식 보기 | 현재 에이전트가 상태 변경 때 밀려나고 긴급 작업을 놓친다 | 현재 작업을 고정하고 주의가 필요한 상태를 찾는다 | [WHY](../../mods/agents-plus/WHY.md) | [AC-A01](acceptance.md#ac-a01) |
| A02 바깥 앱의 에이전트 보기 | 여러 앱에서 도는 작업을 한곳에서 볼 수 없다 | 외부 세션도 찾고 새 앱에서 이어간다 | [WHY](../../mods/agents-plus/WHY.md) | [AC-A02](acceptance.md#ac-a02) |
| A03 현재 단계와 마지막 결과 | 상태만으로 무엇을 하는지/허용할지/끝냈는지 알 수 없다 | 각 작업의 짧은 소식을 목록에서 읽는다 | [WHY](../../mods/agents-plus/WHY.md) | [AC-A03](acceptance.md#ac-a03) |
| A04 Seen과 수동 확인 | 끝난 작업을 봤다가 다른 일을 하면 Idle에 묻힌다 | 확인했으나 대꾸하지 않은 일을 일정 시간 구분한다 | [WHY](../../mods/agents-plus/WHY.md) | [AC-A04](acceptance.md#ac-a04) |
| A05 에이전트 고정 | 중요한 agent를 매번 긴 목록에서 찾아야 한다 | 선택한 agent를 목록 상단에서 찾는다 | [WHY](../../mods/agents-plus/WHY.md) | [AC-A05](acceptance.md#ac-a05) |
| Q01 여러 단어로 작업 검색 | 탭 이름만으로 branch·티켓·메모의 작업을 찾기 어렵다 | 작업 문맥으로 열린/닫힌 checkout을 찾는다 | [WHY](../../mods/picker-plus/WHY.md) | [AC-Q01](acceptance.md#ac-q01) |
| Q02 목적별 팔레트 보기 | 탭 목록 하나로 긴급/최근/에이전트/문서를 찾기 어렵다 | 목적에 맞는 목록과 키보드 이동을 제공한다 | [WHY](../../mods/picker-plus/WHY.md) | [AC-Q02](acceptance.md#ac-q02) |
| Q03 검색에서 바로 worktree 생성 | PR이나 작업 이름을 찾다가 생성 폼으로 다시 가야 한다 | 검색 문맥을 유지해 새 작업을 시작한다 | [WHY](../../mods/picker-plus/WHY.md) | [AC-Q03](acceptance.md#ac-q03) |
| S01 세션 목록과 메시지 검색 | 어느 폴더에서 했던 대화인지 찾아 이어가기 어렵다 | 폴더별 대화를 찾고 선택한다 | [WHY](../../mods/wt-sessions/WHY.md) | [AC-S01](acceptance.md#ac-s01) |
| S02 Resume과 Fork | 이전 대화를 이어갈 실행 옵션과 위치를 다시 찾아야 한다 | 같은 세션을 이어가거나 새 갈래를 연다 | [WHY](../../mods/wt-sessions/WHY.md) | [AC-S02](acceptance.md#ac-s02) |
| S03 같은 세션의 작업 폴더 이동 | 세션이 이전 폴더에 묶여 다른 worktree에서 이어가기 어렵다 | 선택한 새 checkout에 세션 경로를 맞춘다 | [WHY](../../skills/session-translate/WHY.md) | [AC-S03](acceptance.md#ac-s03) |
| S04 에이전트 간 세션 변환 | 다른 에이전트로 바꾸면 기존 대화 문맥을 다시 전달해야 한다 | 기록된 대화로 새 에이전트 세션을 시작한다 | [WHY](../../skills/session-translate/WHY.md) | [AC-S04](acceptance.md#ac-s04) |
| R01 런타임 재시작 후 복구 | 터미널이 셸로 돌아오면 돌던 세션과 작업을 수동 복구해야 한다 | 안전한 대상만 원래 작업 문맥으로 복구한다 | [WHY](../../mods/wt-restore/WHY.md) | [AC-R01](acceptance.md#ac-r01) |
| U01 통합 한도 수집 | 각 서비스에서 남은 사용량을 따로 확인해야 한다 | 전체/모델별 사용률과 출처 시각을 함께 읽는다 | [WHY](../../mods/usage-bar/WHY.md) | [AC-U01](acceptance.md#ac-u01) |
| U02 한도 화면과 Refresh | 사용량 수치만으로 리셋/오래된 값/모델별 제약을 놓친다 | 좁은 화면에서도 사용률과 리셋 정보를 읽는다 | [WHY](../../mods/usage-bar/WHY.md) | [AC-U02](acceptance.md#ac-u02) |
| N01 앱 밖에서 완료/승인 알림 | 다른 앱을 보는 동안 완료나 승인 대기를 놓친다 | 필요한 상태 전이에만 시스템 알림을 보낸다 | [WHY](../../mods/mac-notify/WHY.md) | [AC-N01](acceptance.md#ac-n01) |
| D01 옆에서 읽는 Markdown | 계획서나 README를 읽으려면 앱 밖으로 나가야 한다 | 입력을 방해하지 않고 최신 문서를 옆에서 읽는다 | [WHY](../../mods/md-view/WHY.md) | [AC-D01](acceptance.md#ac-d01) |
| C01 말로 시키는 동일 기능 | 버튼으로만 가능하거나 git 직접 실행이 앱 상태를 빠뜨린다 | 에이전트가 버튼과 같은 결과를 명령으로 만든다 | [WHY](../../bin/WHY.md) | [AC-C01](acceptance.md#ac-c01) |
| C02 보기 설정과 레포 색 | mod별 표현을 조정할 일관된 설정 창이 없다 | 한곳에서 바꾸고 모든 관련 화면에 적용한다 | [WHY](../../mods/hm-settings/WHY.md) | [AC-C02](acceptance.md#ac-c02) |
| C03 UI 오류·성능 기록 | 오류 화면이 사라지면 스택과 발생 시각을 잃고, 스택만으로 느린 구간을 알 수 없다 | 오류·복구·연결 실패와 코드/데이터 규모, 렌더 구간 시간을 나중에 비교한다 | [WHY](../../bin/WHY.md) | [AC-C03](acceptance.md#ac-c03) |
| I01 선택 설치와 설정 보존 | 필요한 기능만 적용하면서 기존 설정을 보존하기 어렵다 | 번들을 선택해 설치하고 충돌을 알린다 | [WHY](../../README.md) | [AC-I01](acceptance.md#ac-i01) |
| I02 기본 mod 업데이트 따라가기 | 복제한 UI가 호스트 업데이트와 어긋난다 | 기본 변경과 사용자 기능을 구분해 갱신한다 | [WHY](../../README.md) | [AC-I02](acceptance.md#ac-i02) |

## 코드 대응

코드는 현재 구현을 검토할 때의 근거다. 다른 앱 구현자가 원본 코드를 반드시 읽어야만 요구를 이해하도록 쓰지는 않는다. 기능 규칙은 [behavior](behavior.md)에, 데이터와 외부 메시지는 별도 문서에 있다.

- P01: [mods/project-add/main.js](../../mods/project-add/main.js), [lib/project.js](../../lib/project.js), [bin/hm](../../bin/hm)
- P02: [lib/project.js](../../lib/project.js)
- P03: [lib/project.js](../../lib/project.js)
- W01: [lib/worktree.js](../../lib/worktree.js), [mods/worktree-plus/main.js](../../mods/worktree-plus/main.js)
- W02: [mods/worktree-plus/include.py](../../mods/worktree-plus/include.py), [lib/worktree.js](../../lib/worktree.js)
- W03: [mods/wt-menu/main.js](../../mods/wt-menu/main.js), [lib/state.js](../../lib/state.js)
- W04: [lib/worktree.js](../../lib/worktree.js), [mods/spaces-plus/main.js](../../mods/spaces-plus/main.js)
- W05: [lib/worktree.js](../../lib/worktree.js), [mods/worktree-plus/main.js](../../mods/worktree-plus/main.js)
- B01: [mods/spaces-plus/main.js](../../mods/spaces-plus/main.js)
- B02: [mods/spaces-plus/main.js](../../mods/spaces-plus/main.js)
- B03: [mods/spaces-plus/main.js](../../mods/spaces-plus/main.js), [mods/wt-menu/main.js](../../mods/wt-menu/main.js)
- B04: [mods/spaces-plus/main.js](../../mods/spaces-plus/main.js), [mods/spaces-plus/ports.py](../../mods/spaces-plus/ports.py)
- B05: [mods/spaces-plus/main.js](../../mods/spaces-plus/main.js)
- B06: [mods/spaces-plus/main.js](../../mods/spaces-plus/main.js), [lib/resume.js](../../lib/resume.js)
- A01: [mods/agents-plus/main.js](../../mods/agents-plus/main.js), [lib/ui.js](../../lib/ui.js)
- A02: [mods/agents-plus/outside.py](../../mods/agents-plus/outside.py), [mods/agents-plus/main.js](../../mods/agents-plus/main.js)
- A03: [mods/agents-plus/activity.py](../../mods/agents-plus/activity.py), [mods/agents-plus/main.js](../../mods/agents-plus/main.js)
- A04: [lib/ui.js](../../lib/ui.js), [mods/agents-plus/main.js](../../mods/agents-plus/main.js), [bin/hm](../../bin/hm)
- A05: [mods/agents-plus/main.js](../../mods/agents-plus/main.js), [bin/hm](../../bin/hm)
- Q01: [mods/picker-plus/main.js](../../mods/picker-plus/main.js)
- Q02: [mods/picker-plus/main.js](../../mods/picker-plus/main.js)
- Q03: [mods/picker-plus/main.js](../../mods/picker-plus/main.js)
- S01: [mods/wt-sessions/sessions.py](../../mods/wt-sessions/sessions.py), [mods/wt-sessions/main.js](../../mods/wt-sessions/main.js)
- S02: [mods/wt-sessions/main.js](../../mods/wt-sessions/main.js), [lib/resume.js](../../lib/resume.js)
- S03: [mods/wt-sessions/sessions.py](../../mods/wt-sessions/sessions.py), [bin/hm](../../bin/hm)
- S04: [lib/agentsession.py](../../lib/agentsession.py), [skills/session-translate/scripts/translate.py](../../skills/session-translate/scripts/translate.py), [skills/session-translate/SKILL.md](../../skills/session-translate/SKILL.md)
- R01: [mods/wt-restore/main.js](../../mods/wt-restore/main.js), [lib/resume.js](../../lib/resume.js)
- U01: [mods/usage-bar/usage.py](../../mods/usage-bar/usage.py), [bin/hm-statusline](../../bin/hm-statusline)
- U02: [mods/usage-bar/main.js](../../mods/usage-bar/main.js)
- N01: [mods/mac-notify/main.js](../../mods/mac-notify/main.js), [mods/mac-notify/notifier/main.swift](../../mods/mac-notify/notifier/main.swift)
- D01: [mods/md-view/main.js](../../mods/md-view/main.js), [lib/docs.js](../../lib/docs.js)
- C01: [bin/hm](../../bin/hm), [skills/herdr/SKILL.md](../../skills/herdr/SKILL.md), [lib/state.js](../../lib/state.js)
- C02: [mods/hm-settings/main.js](../../mods/hm-settings/main.js), [lib/state.js](../../lib/state.js), [bin/hm](../../bin/hm)
- I01: [scripts/install.py](../../scripts/install.py), [bundles.json](../../bundles.json), [install.sh](../../install.sh)
- I02: [scripts/sync-upstream.sh](../../scripts/sync-upstream.sh), [upstream/versions.json](../../upstream/versions.json)
- C03 (기준 이후 추가): [bin/hm](../../bin/hm), [mods/agents-plus/diagnostics.py](../../mods/agents-plus/diagnostics.py), [docs/ui-diagnostics.md](../../docs/ui-diagnostics.md)
