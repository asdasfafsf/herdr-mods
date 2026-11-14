# 가져갈 데이터와 다시 만들 데이터

데이터 형식은 기준 버전의 관찰이다. 새 앱이 같은 키 이름을 사용할 필요는 없다. **머신·경로·세션의 의미와 사용자가 편집한 값**을 유지해야 한다. [fixtures](fixtures/README.md)는 실제 계정과 무관한 예제다.

## 분류와 형식

Herdr 공유 파일은 기본 `~/.config/herdr-app/shared.json`이다. 일부 도구는 `HERDR_APP_HOME`을 지원하지만 모든 helper 경로가 그 변수로 바뀌는 것은 아니다. 백업 도구는 실제 사용 경로를 확인해야 한다.

| 키/파일 | 형식과 시간 단위 | 이전 정책 |
|---|---|---|
| `wt.meta` | `JSON.stringify([machine|null,path]) → {name,branch,base,link,pr,comment,status,pinned,archived,unread,agent,created,newBranch}`. created는 ms, pr은 `{number,url,title}` 및 추가 필드 가능 | 필수 보존. null/없는 필드는 기본 미설정으로 유지. 경로/머신 키 변환 |
| `wt.repos` | 같은 키 규칙의 primary → `{setup,include}` | 보존. 새 앱에서 실행 의미를 확인하고 자동 실행과 단순 이전을 분리 |
| `wt.sleep` | checkout 키 → `{at:ms,sessions:[{agent,session,argv,cwd,title}]}` | 필수 보존. cwd 변환, session ID는 그대로. import 자체로 resume하지 않음 |
| `hm.options` | 바꾼 옵션 이름 → 값; 없으면 기본값 | 보존. 옵션 표와 구버전 별칭을 해석 |
| `wt.repoColors` | 레포 key → `#rrggbb` | 레포 경로·머신으로 다시 대응하고 보존. 공간 ID로 혼동 금지 |
| `wt.sort` | activity/recent/name/created | 보존 |
| `wt.linkTemplate` | 티켓 URL 템플릿 문자열 `{key}` | 보존; 임의 회사 URL 기본값 없음 |
| `project.parent` | 머신명(로컬 `""`) → 부모 경로 | 선택 보존, 경로 바뀌면 변환 |
| `agents.sort`, `wt.lastAgent` | priority/grouped, 에이전트 키 | 선택 보존 |
| `~/.herdr/restore/last.json` | `{core:{pid,start:ms},sessions:{terminal:{address,space,tab,agent,session,argv,cwd,status,title}}}` | 세션 정보는 보존, core pid/start와 terminal/space/tab ID는 새 앱에서 재사용하지 않음 |
| `~/.herdr/restore/previous.json` | `last.json`과 같은 형식, 직전 런타임의 기록 | `last.json`과 같음. 다시 묻기(`hm restore`)용 |
| `wt.trees` | 레포 key → `{name,machine,checkouts:[{path,branch,main,space,sleeping,pr}]}` | Git에서 재수집. 기존 space는 임시 대응 자료로만 사용 |
| `wt.live` | session ID → terminal address | 실행 중인 프로세스로 재구성 |
| `wt.results` | request ID → `{ok,path?,error?,at:ms,…}`, 최근 20개 | 버림. 이전 명령을 새 앱에서 재실행하지 않음 |
| `ag.info`, `ag.order`, `ag.acked`, `wt.seen` | 터미널/공간 ID 기반 activity·표시순서·확인시각(ms) | 기본 재구성. Seen 이력이 꼭 필요하면 SessionRef/CheckoutRef로 바꾸고 새 ID에 재결합 |
| `md.panes` | pane ID → `{file,on}` | 열린 파일 목록만 필요에 따라 보존. pane ID는 다시 발급 |
| `new-menu.agents`, `project.cloning` | 설치 프로그램 목록, `<machine>:<path> → 시작 ms` | 버림. 새 앱에서 다시 탐색 |
| mod localStorage | 접힘·보관 노출·선택 보기·캐시, restore의 `auto` | 선택 보존. storage 위치·인코딩은 호스트별이며 직접 복사하지 않음. 자동 복구 선호는 별도 명시 |
| `~/.herdr/usage/*.json`, activity/outside 캐시 | 수집 결과와 조회 시각 | 재수집 가능. 가져오면 원래 관측 시각 유지, 최신 값으로 위장하지 않음 |

`unread`, `pinned`, `archived`, `newBranch`는 boolean이다. `status`는 작업자가 붙인 작업 상태로, 프로세스의 working/blocked와 다르다. 알려지지 않은 추가 필드는 export 사본에 보존하고 import 보고서에 남기는 것이 좋다.

## 옵션 기본값

현재 저장 키는 camelCase, CLI는 kebab-case(`seenMinutes` ↔ `seen-minutes`)다.

| 저장 키 | 기본값 | 허용값 / 구버전 별칭 |
|---|---|---|
| agentsRepoNames | true | boolean, 이전 repoNames |
| agentsNews | true | boolean, 이전 agentNews |
| pickerRepoNames | true | boolean, 이전 repoNames |
| pickerNews | true | boolean, 이전 agentNews |
| seen | true | boolean |
| seenMinutes | 120 | 숫자, 반올림 후 5–1440으로 제한; UI 단계 30/60/120/240/480 |
| sidebarCards | compact | compact 또는 detailed |
| sidebarAgentNews | true | boolean |
| prBadges | true | boolean |
| linkBadges | true | boolean |
| noteBadges | true | boolean |
| portBadges | true | boolean |

`default`는 저장 override를 제거한다. 새 키가 없으면 구버전 별칭 → 기본값 순서로 읽는다. 색 이름은 teal `#22a99a`, blue `#5b8def`, orange `#e3814f`, pink `#d9649a`, cyan `#36b5d8`, brown `#b48a5e`, slate `#8792a8`, lime `#8fbf3a`. `#rrggbb`와 auto도 허용한다. auto는 새 앱의 레포 목록에서 재배정하며 상태색과 혼동되지 않게 한다.

## 에이전트 원본과 중간 세션

- Claude transcript: `~/.claude/projects/<프로젝트 경로의 비영숫자를 '-'로 치환>/<session>.jsonl`.
- Claude 실행 registry: `~/.claude/sessions/<pid>.json`; 이동 대상이 아니라 실행 탐지 자료다.
- Codex: `${CODEX_HOME:-~/.codex}/sessions/YYYY/MM/DD/rollout-…-<id>.jsonl`; 제목은 `session_index.jsonl`, 현재 cwd·이름·rollout 위치는 읽기 전용 `state_5.sqlite` 인덱스를 우선한다. 이동은 native `resume --cd`로 수행하고 기록과 DB를 수동 수정하지 않는다. 단순 앱 이동에는 이 파일들을 변환할 필요가 없다.
- 중간 파일: `~/.herdr/agent-sessions/<id>.jsonl`. 첫 줄 `{schema:"agent-session/1",id,created,title,source:{agent,session,cwd,model}}`; 이후 `{role,content,ts?}`. assistant는 `tool_calls:[{id,name,arguments}]`, tool은 `tool_call_id,name,is_error`, 요약 system은 `kind:"summary"`를 추가한다.
- 중간 파일은 이 기준 구현의 형식이다. 향후 v2 또는 다른 plugin의 표준이 생겨도 버전 확인 없이 같은 것으로 읽지 않는다. 도구 결과·이미지 손실은 [behavior](behavior.md#s01s04-세션-목록이어가기이동변환)에 명시돼 있다.

## 사용량 내부 표준

```json
{
  "claude": {
    "updated": 1893456000,
    "windows": [
      {"name":"7d Fable","used":0,"resets":1894060800,"updated":1893456000,"source":"live"}
    ]
  },
  "codex": null
}
```

updated/resets는 epoch 초, used는 사용률 퍼센트다. resets와 서비스 전체는 null일 수 있다. Claude의 창별 updated/source는 병합용 추가 필드이고 Codex에는 없을 수 있다. 서비스에는 plan/error/reached가 추가될 수 있다. 시각을 ISO 문자열·ms로 주는 외부 원본은 이 표준으로 정규화한다. usage.py는 null보다 “알 수 없음”에 해당하는 빈 상태를 사용하며 임의의 0%를 생성하지 않는다.

## 실제 이전 절차

아직 export/import 명령을 구현한 것은 아니다. 아래는 새 앱 이식자가 따라야 할 절차와 검증 기준이다.

1. source commit, 앱 버전, 실제 설정/세션/worktree 경로를 기록한다. `shared.json`, restore 기록, 사용자 설정, 필요한 에이전트 원본을 **사본**으로 확보한다. 실행 중 파일은 일관된 스냅샷이 확보되지 않았으면 다시 읽거나 쓰기 완료 후 확보한다.
2. `git worktree list --porcelain`로 실제 checkout 목록을 얻고 metadata와 대조한다. 사라진 경로는 missing으로 보고하며 자동 삭제하지 않는다.
3. 같은 컴퓨터의 앱 이동이면 worktree 경로·Git 관리 정보·에이전트 원본을 그대로 둔다. 새 앱에서 해당 경로를 열고 표시 이름·메모·핀 등을 가져온다.
4. 경로/머신이 달라지면 명시적인 이전표를 만든다. 문자열 전체 치환 대신 `machine + 절대경로 prefix 경계`로 변환한다. `/work/app` 규칙을 `/work/application`에 적용하지 않는다. 여러 원본이 같은 목적지가 되면 충돌로 중단한다.
5. **Git linked worktree 폴더를 단순 복사하면 안 된다.** `.git` 파일과 common-dir 연결까지 확인하여 Git 절차로 이동/재생성/repair한다. 다른 컴퓨터라면 repository와 미커밋 변경·미추적 파일까지 별도로 보존해야 한다.
6. 새 앱의 공간·탭·터미널 ID를 생성하고 이전표를 만든다. 세션 ID는 그대로 재사용할 수 있지만 실행 중인 세션을 중복 자동 실행하지 않는다. 복구용 core ID와 요청 큐·캐시는 가져오지 않는다.
7. 사용자 작성 값의 개수·내용, 누락/missing/충돌, 새 앱 미지원 옵션을 보고한다. import 자체로 setup 실행, 세션 resume, Git 삭제가 일어나지 않아야 한다.
8. [합격 사례](acceptance.md)의 metadata/Sleep/세션/설정 사례를 통과시킨다. 실패하면 새 앱 import를 되돌릴 수 있도록 source 사본과 원본 경로를 유지한다.

제안하는 export envelope와 경로 매핑 예제는 `fixtures/migration.json`이다. **현재 Herdr가 읽는 저장 형식도, 이미 제공되는 importer도 아니다.**
