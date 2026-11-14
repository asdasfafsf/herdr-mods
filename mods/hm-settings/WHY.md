# hm-settings 를 만든 이유

herdr-mods 의 보기 설정(Agents 목록·사이드바에 무엇을 보일지, 레포 색)을 한 창에서.

## Herdr 기본
Settings(왼쪽 아래)는 Herdr 자신의 설정(모양·머신·알림·업데이트)만 다룬다. 우리 mod 의 설정은 들어갈 수 없다(기본 화면이라 고칠 수 없음).

## 모자랐던 것
레포 이름 표시, Seen, 배지 같은 우리 기능을 켜고 끄거나 레포 색을 고를 곳이 없었다.

## 더한 것
- 사이드바 맨 위 톱니바퀴 → 이 창. 묶음별(Agents, Sidebar) 켜기·끄기와 단계, 레포마다 색(8색 또는 Auto).
- 목록은 `lib/state.js` 의 `OPTION_DEFS` 에서 온다. 설정 하나 = 거기 한 줄 + 쓰는 곳. 이 창·Agents 메뉴·`hm option` 이 같은 걸 바꾼다.
- 에이전트: `hm option`(목록), `hm option NAME VALUE`, `hm color REPO COLOR|auto`. 창 없이 바로 바뀐다.
- 값은 공유 키 `hm.options`, 레포 색은 `wt.repoColors`.

## 걷어낼 조건
Herdr 가 mod 설정을 자기 Settings 에 넣을 수 있게 되면 그쪽으로 옮긴다.

## 옮길 때 가져갈 것
`hm.options`(바꾼 것만, 나머지는 기본값), `wt.repoColors`.
