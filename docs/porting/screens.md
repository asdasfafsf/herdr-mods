# 화면과 상호작용의 이식 기준

화면은 기존 앱의 픽셀 복제품이 아니라 **원래 불편을 해결했는지 보이는 증거**다. 아래 도식은 요구를 설명하는 구조도이며 실제 앱 캡처로 위장하지 않는다. 새 앱의 native 탭/패널/팝업을 사용해도 결과가 같으면 된다.

## 한눈에 봐야 하는 관계

```text
프로젝트                    에이전트
▾ demo                      Pinned
  primary                   Active — 지금 보는 탭
  ▾ 결제 개선 [PR #42]       Needs you — 허용 대기 명령
    Claude — 작업 중        Done — 결과 첫 줄
    Codex — 확인 필요       Working — 현재 단계
  옛 작업 (sleeping)         Seen — 봤지만 대꾸하지 않은 결과
                            Idle

작업 탭                     문서 pane
터미널/에이전트 입력         계획서 (에이전트가 열어도 입력 포커스 보존)

Claude: 5h … · 7d … · 7d Fable … | Codex: 7d …     Refresh
```

primary와 linked worktree, 열림과 미개방, sleeping과 archived를 구별한다. 사용자 작업 상태(in-review 등)와 agent 실행 상태(working 등)는 같은 것으로 합치지 않는다. 긴 이름/한글/동명이인은 경로·repo·branch를 통해 식별할 수 있어야 한다.

## 화면별 필요한 상태

| 화면 | 반드시 확인할 상태 | 키보드/포커스/크기 |
|---|---|---|
| 트리 | primary 닫힘, 미개방 checkout, sleeping, archived 펼침, removed, 원격 단절, 여러 터미널 | 접힌 줄을 이동만으로 열지 않음, 현재 행 자동 표시, 드래그 경계 |
| New worktree | 이름 자동 채움/수동 편집, PR 조회 중/실패, 미설치 agent, 생성 실패, setup 실패 | Create/Cancel, ⌘Enter, 입력 중 자동값이 편집값을 덮어쓰지 않음 |
| Clean / Remove | 기본 선택/미선택/차단 사유, dirty/busy/pinned, 일부 삭제 실패 | 위험 동작 확인, 차단 항목 선택 금지, 결과별 이유 |
| Agents | Active, pin, child, 같은 이름, outside, 5개 상태, Seen 만료 | 숨김/상태 변경으로 현재 대상 위치를 잃지 않음 |
| Agent mode / view | 같은 작업공간의 Terminal/Agent 전환과 Agent 하단의 접이식 native terminal, 기본/치이카와 테마와 카드/마을 보기 분리, 전체 UI 공통 토큰, seen까지 표시하고 idle만 포커스한 세션을 표시, 동일한 세션과 24개 페이지, 마을의 자유 배회·현재 상태·세션명/프로젝트 이름표·입력 대기/미확인 답변 말풍선·선택 상세·말 걸기 입력란·접힌 검색 필터·세로 스크롤·움직임 끄기, 모든 프로젝트, pane 없는 child, 외부 세션, 검색 0건, 상태·출처 필터, 페이지 이동 | 설정이나 레이아웃 추가 없이 표시 전환, 캐릭터와 기존 세션의 양방향 포커스, 테마 전환 시 검색·필터·페이지 유지, 이름 hover로 전체 식별 정보, 상세에서 브랜치/주소 확인, Send/Enter로 선택 세션에 전달, ⌘Enter/Shift+Enter 줄바꿈, 이미지 파일 참조와 native 이미지 붙여넣기 구분, ⌘⇧E 보기 전환·⌘⇧J 터미널 접기, native 입력/검색/복사/스크롤/승인, 캐릭터·대화창 드래그와 화면 경계, 캐릭터별 초안 유지, 전송 중 중복 방지·실패 시 초안 보존, blocked/외부는 해당 pane/peek/외부 이어 열기 |
| 팔레트 | 5개 보기, 검색 0건, 생성 행, 미개방 worktree, Docs | Tab/↑↓/Enter/Esc, 화면과 선택 대상 일치 |
| Sessions | Reading, 빈 목록, 제목 필터, 메시지 검색 중, 실패, 결과 snippet | Enter Resume, Alt+Enter Fork, Esc Close; 실행 가능한 버튼 구별 |
| Restore | working/idle 후보, 대상 없음, 외부 실행 중, 자동 선호 | continue 항목별 선택, Not now, 중복 복구 금지 |
| Usage | null, 0/80/100%, stale, reset, CLI 오류, 긴 모델명, 여러 창 | 480/720/1200px, Refresh 보임, 상세 세로 스크롤, 열린 상세 갱신 |
| Reset credits | 조회 불가, 0개, 개수만 제공, 일부 상세 목록, 만료 있음/없음, 조회 실패, 사용/중복/불필요/실패 결과 | Usage 상세창, 개별 권 선택·사용 확인, 중복 클릭 차단, 같은 권 재시도, 별도 조회 시각, Refresh |
| Markdown | 읽는 중/삭제/읽기 실패/1MiB 초과, 링크 이동, 변경 | 텍스트 선택·복사, Back, caller에 따른 포커스, 같은 파일 중복 방지 |
| Settings | 기본값/override/구키, 범위 밖 숫자, custom 색/auto | UI와 CLI가 같은 값을 즉시 표시 |
| 알림 | 앱 앞/뒤, 첫 관찰/전이/반복, 도우미 부재 | 지원되는 경우 클릭 시 정확한 세션 이동 |

## 한도 표시의 구체적 기준

[usage.json](fixtures/usage.json)은 Claude 3창 + Codex 1창이다.

- 720px: Fable 이름과 0%, Codex의 사용률, Refresh가 모두 보여야 한다. 공간이 부족하면 `resets in` 문구를 줄여도 된다.
- 480px: 이름과 퍼센트를 유지하고 막대·리셋 countdown을 숨길 수 있다. 숨긴 시각은 hover/detail에서 읽을 수 있어야 한다.
- 1200px: 충분한 공간에서는 막대와 countdown을 함께 표시한다.
- 상세: 창이나 리셋권이 늘어나도 아래 항목이 사라지지 않게 스크롤한다. 현재 Herdr 구현의 최대 높이는 680px이지만 새 앱은 자신의 viewport에 맞춰도 된다.
- 경고색뿐 아니라 숫자/표식으로 상태를 구별한다. 0%는 정상 데이터이고 null은 데이터 없음이다. reset 경과를 새 주기 0%로 표시하지 않는다.

## 실제 캡처 증거와 한계

2026-11-09의 기준 작업에서 Herdr 0.1.13, `my-main`, usage block 720px와 480px를 실제로 캡처해 수치·Refresh 표시를 확인했다. 원본 창에는 사용자 대화와 레포 목록이 포함되어 있어 이 문서 번들에는 넣지 않았다. 당시 캡처는 세션의 임시 파일(`/tmp/herdr-ui-width-settled.png`, `/tmp/herdr-usage-480-settled.png`)이며 **배포 가능한 fixture나 영속 검증 증거가 아니다**. 전체 화면/빈 상태/오류 상태를 모두 실측한 것으로 간주하지 않는다.

다른 앱 이식 시에는 위 가상 데이터를 표시한 별도 테스트 공간을 사용해 다음 캡처를 남긴다. 실제 계정의 대화/키/식별자는 넣지 않는다.

| 산출 파일 예 | 조건 | 확인할 사례 |
|---|---|---|
| tree-open-closed.png | 가상 레포·현재/미개방/sleeping | AC-B01/B02/B06 |
| agents-all-states.png | fixture 상태 목록 | AC-A01/A04 |
| picker-empty-create.png | 없는 작업명 검색 | AC-Q03 |
| sessions-loading-error.png | read 지연/실패를 주입한 테스트 | AC-S01/S02 |
| usage-480.png / usage-720.png / usage-1200.png | 고정 시계 usage fixture | AC-U02 |
| usage-stale-reset-detail.png | 나이·reset·긴 상세 | AC-U02 |
| markdown-focus.png | 테스트 에이전트 옆 문서, 원래 입력 포커스 | AC-D01 |

각 캡처에 앱/버전, viewport 논리 px, 배율/폰트/테마, fixture와 고정 시각, 기능 ID, 실제 기대/관찰 결과를 붙인다. 테스트 데이터가 들어온 **후**에 캡처한다. 최초 빈 렌더 검사를 통과한 것만으로 완료 처리하지 않는다.

## UI 오류를 놓치지 않는 검증

Herdr에서는 `herdr-app check MOD` → 실제 화면을 표시 → `herdr-app status`의 errors 확인 → CUA 화면 캡처 순서다. check는 첫 렌더만 검사하므로 지연 데이터, 눌렀을 때 callback, layout overflow를 보장하지 않는다. 새 앱에서도 이에 대응하는 runtime 오류 수집과 화면 확인을 둘 다 해야 한다.

자동 갱신이 있는 화면은 최소 여러 갱신 주기를 관찰한다. 오류 0회는 관찰 기간에 대한 결과일 뿐 무오류 보증이 아니다. 크기 변경·팝업 열기·닫기·조회 실패도 별도로 시험하고, 반복 오류에는 시각·화면·동작·스택을 함께 남긴다.
