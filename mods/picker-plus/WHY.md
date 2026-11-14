# picker-plus 를 만든 이유

⌘P·⌘J 창. Herdr 에 딸린 `picker` 의 복제본(원본은 `upstream/picker/`).

## Herdr 기본
탭으로 가기(손이 필요한 space 먼저, 조용한 건 접어서), 새 탭·space.

## 모자랐던 것
워크트리(안 연 것 포함)·브랜치·티켓·PR 번호로 찾을 수 없다. PR·이슈 링크로 바로 워크트리를 만들 수 없다.

## 더한 것
여러 단어 검색으로 워크트리까지(`wt.trees`·`wt.meta`), PR·이슈 URL 이나 `#123` 을 붙이면 그걸로 새 워크트리, 맞는 게 없으면 입력한 이름으로 새 워크트리. worktrees 번들이 없으면 워크트리 행을 숨겨 기본 `picker` 처럼.

## 보기와 정렬
창 위쪽 칩(또는 Tab)으로 고르고, 고른 건 기억한다. Needs you(기본: space·탭 묶음, 소식 있는 것 먼저, 조용한 건 접음), Agents(에이전트 한 줄씩, 묶음 제목 없이 좌측 하단 Agents 목록과 같은 순서로: agents-plus 가 그린 순서를 `ag.order` 로 공유, 없으면 최근에 움직인 순(Herdr 의 `seq`). 상태는 사이드바·Agents 목록과 같은 표시에 글자를 붙인 알약(Needs you 빨강 !, Working 노랑 돌아가는 표시, Done 초록 점, Idle 흐린 동그라미), 지금 보는 탭의 행은 배경 강조와 파란 "Active" 알약. 행은 아이콘·이름·경과 시간·상태, 둘째 줄에 레포 · 브랜치와 지금 하는 일. Enter 로 그 화면), Recent(최근에 본 space 부터: spaces-plus 가 `wt.seen` 에 남김), Name(이름순), Docs(지금 pane 의 레포의 Markdown 파일, 최근 바뀐 순, Enter 로 옆 pane 에 렌더링: md-view, [mods/md-view/WHY.md](../md-view/WHY.md)). 기본이 아닌 건 접지 않아 ↑↓ 가 그 순서를 따라간다.

## 걷어낼 조건
Herdr 팔레트가 워크트리를 찾고 만들면 뺀다.

## 옮길 때 가져갈 것
없다.
