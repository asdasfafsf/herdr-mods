# wt-menu 를 만든 이유

워크트리 행의 우클릭 메뉴, 이름·메모·링크·PR 편집 창, 정렬 메뉴.

## Herdr 기본
space 우클릭 메뉴(이름 바꾸기, 닫기 등). 워크트리 단위 정보는 없다.

## 모자랐던 것
워크트리에 이름·메모·링크·PR·상태(To do·In progress·In review·Completed)·핀·읽음·보관을 붙일 곳이 없다. Finder·에디터 열기, 경로·브랜치 복사, Sleep, 세션 목록, 삭제가 한곳에 없다.

## 더한 것
- 행 메뉴 전부(primary 는 보관·Sleep·삭제 없음), 편집 창(Save·Cancel 버튼, PR 은 gh 로 제목·URL 조회).
- 정렬 메뉴, 폴더에 터미널·에이전트 시작 메뉴.

## 걷어낼 조건
Herdr 가 워크트리 메타데이터 편집과 이 항목들을 메뉴로 갖추면 해당 항목만 뺀다.

## 옮길 때 가져갈 것
편집한 값은 `worktree-plus` 의 `wt.meta`, 정렬은 `wt.sort`(`activity`·`recent`·`name`·`created`).
