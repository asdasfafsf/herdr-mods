# md-view 를 만든 이유

Markdown 파일을 렌더링해서 터미널 옆 pane 에 띄운다.

## Herdr 기본
- Files 패널(`files`)은 파일을 소스(코드 보기)로만 보여준다. `.md` 도 글자 그대로다.
- mod 를 pane 으로 띄우는 길(`pane.split {direction, mod, props}`)과 Markdown 을 그리는 부품(`TextView.markdown`)은 있다. 문서에도 "a markdown viewer" 가 mod pane 의 예로 나온다. 하지만 그런 mod 는 없다.

## 모자랐던 것
에이전트가 쓴 계획서·README·WHY.md 를 제대로 읽으려면 Herdr 밖의 앱으로 나가야 했다.

## 더한 것
- `md-view`: 파일 하나를 제목·목록·표·코드·인용·링크까지 렌더링한다. 글자는 선택·복사된다. pane 이라서 Herdr 의 pane 헤더로 나누기·줌·닫기가 되고, 탭과 같이 저장된다.
- 파일을 따라간다. 에이전트가 그 파일을 고치면 바로 다시 그린다. 이 컴퓨터에선 폴더 감시로, 다른 machine 에선 3초마다 읽어서. 헤더에 `updated 2m ago` 로 표시한다.
- 링크: 다른 `.md` 는 같은 pane 에서 열린다(← 로 돌아감). 웹 주소는 브라우저로 열린다. 다른 파일은 Finder 에서 보여준다. 실행은 하지 않는다.
- 여는 길은 두 가지이고 둘 다 `lib/docs.js` 의 `openDoc` 을 쓴다. 그래서 결과가 같다.
  - ⌘P 의 **Docs** 보기(picker-plus): 지금 pane 의 폴더가 속한 레포(아니면 그 폴더)의 Markdown 파일이 최근 바뀐 순으로 나온다. Git 이 무시하는 파일은 빠진다. 타이핑으로 경로를 거르고, Enter 하면 지금 pane 오른쪽에 열린다.
  - 에이전트: `hm md <file>`("이 문서 띄워줘"). spaces-plus 의 `doc@` 을 거쳐 그 에이전트 pane 오른쪽에 열린다.
- 같은 탭에 그 파일을 띄운 pane 이 이미 있으면 새로 열지 않는다. ⌘P 로 고르면 그 pane 으로 포커스가 간다. 에이전트가 열 땐 키보드 포커스를 그대로 둔다(사람이 그 에이전트에게 타이핑 중일 수 있다). 그 탭을 앞으로 가져오지도 않는다. 각 pane 이 무엇을 보여주는지는 공유 키 `md.panes` 에 있다(`lib/state.js` 의 `DOC_PANES`). 에이전트가 연 pane 은 탭이 보이기 전엔 시작하지 않아서, 여는 쪽(`noteOpened`)이 먼저 적어 둔다.

## 걷어낼 조건
Herdr 의 Files 패널이나 다른 기본 mod 가 Markdown 을 렌더링해서 보여주면 뺀다. ⌘P 의 Docs 보기와 `hm md` 는 그 기본 뷰어를 여는 쪽으로 바꾸거나 같이 뺀다.

## 옮길 때 가져갈 것
없다. 열 파일 경로만 있으면 된다(`md.panes` 는 열려 있는 pane 이 다시 쓴다).
