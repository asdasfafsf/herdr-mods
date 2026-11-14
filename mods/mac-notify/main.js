// mac-notify: Herdr 창을 보고 있지 않을 때, 에이전트 상태 변화를 macOS 알림 센터 배너로 보낸다.
//
// - 대상: agents() 에 잡히는 모든 에이전트 (Claude Code, Codex 등 OSC 7501 로 상태를 보고하는 것).
// - 보내는 때 (Herdr 창이 비활성일 때만, ONLY_WHEN_AWAY):
//     * 어떤 상태 → blocked            : 확인(승인·입력)이 필요함
//     * working  → done | idle         : 작업을 마침
//       (창이 비활성이어도 Herdr 가 그 탭을 "보고 있다"고 보면 done 대신 idle 로 바뀔 수 있어서 둘 다 본다)
// - 창이 활성일 때는 Herdr 자체 토스트·소리로 충분하므로 보내지 않는다.
// - 레이아웃에 놓여 있어야 돈다 (mod.json 은 place: "none"). 기본 레이아웃(main)은 구조 변경을 받지 않아
//   자동으로 붙지 않으므로, 개인 레이아웃의 floating 블록으로 넣는다.
// - 화면에는 아무것도 그리지 않는다. Herdr 는 live 데이터(agents, focus 등)가 바뀔 때마다
//   render 를 다시 부르므로, render 에서 이전 상태와 비교해 전이를 잡는다 (폴링 없음).
// - 배너는 ~/Applications/HerdrNotify.app 이 띄운다. 알림 설정·알림 센터에는 "Herdr" 이름과 Herdr 아이콘으로
//   보인다 (Herdr 앱 자체는 macOS 알림을 못 보내서 따로 둔 앱. 진짜 Herdr 와는 bundle id 가 다르다). 누르면 그 에이전트로
//   가고 Herdr 가 앞으로 온다. 이 앱은 notifier/build.sh 로 빌드·설치하고, 처음 한 번 알림 허용이 필요하다.
//   앱이 없으면 osascript 로 대신 띄운다 ("스크립트 편집기" 이름, 눌러도 아무 데도 안 감).

import { View, div } from "gpui-kit";
import { agents, window, exec, home } from "herdr";

const ONLY_WHEN_AWAY = true;

// 전이 판정용 직전 상태: address → status.
// 모듈 수준에 두어, 같은 빌드의 copy 가 여러 개 떠도 한 번만 보내게 한다.
// null = 아직 첫 render 전 (시작할 때 이미 있던 상태로는 알림을 보내지 않는다).
let last = null;

const MESSAGE = {
  blocked: "확인이 필요해요",
  finished: "작업을 마쳤어요",
};

// 직전 상태와 지금 상태로 보낼 알림 종류를 고른다. 보낼 게 없으면 null.
function kindOf(prev, now) {
  if (now === "blocked" && prev !== "blocked") return "blocked";
  if (prev === "working" && (now === "done" || now === "idle")) return "finished";
  return null;
}

// HerdrNotify.app 으로 배너를 올린다. 실행이 안 되면 (설치 전) osascript 로 대신 올린다.
// 실행은 됐는데 실패한 경우 (알림 미허용 등, 종료 코드 ≠ 0) 는 osascript 도 같은 이유로 막힐 수 있어 그냥 둔다.
function banner({ title, subtitle, body, terminal, group }) {
  const notifier = `${home()}/Applications/HerdrNotify.app/Contents/MacOS/HerdrNotify`;
  exec(notifier, [
    "--title", title, "--subtitle", subtitle, "--body", body,
    "--terminal", terminal, "--group", group,
  ]).catch(() => osascriptBanner({ title, subtitle, body }));
}

// 문자열을 AppleScript 에 끼워 넣지 않고 argv 로 넘긴다 (따옴표 이스케이프·주입 걱정 없음).
function osascriptBanner({ title, subtitle, body }) {
  exec("osascript", [
    "-e", "on run argv",
    "-e", "display notification (item 3 of argv) with title (item 1 of argv) subtitle (item 2 of argv)",
    "-e", "end run",
    title, subtitle, body,
  ]).catch(() => {});
}

function check() {
  const now = new Map(agents().map((a) => [a.address, a]));
  const prev = last;
  last = new Map([...now].map(([address, a]) => [address, a.status]));
  if (prev === null) return;
  if (ONLY_WHEN_AWAY && window().active) return;

  for (const [address, a] of now) {
    const kind = kindOf(prev.get(address), a.status);
    if (!kind) continue;
    const where = [a.space_name, a.tab_name].filter(Boolean).join(" · ");
    banner({
      title: a.program?.name || a.app || "Agent",
      subtitle: where,
      body: a.title ? `${MESSAGE[kind]} — ${a.title}` : MESSAGE[kind],
      terminal: address,
      // 알림 센터에서 space 별로 묶인다.
      group: a.space || "",
    });
  }
}

export default class MacNotify extends View {
  render(_cx) {
    check();
    return div().id("mac-notify");
  }
}
