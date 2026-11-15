# Native app session interoperability

2026-11-15 설치본에서 Codex 앱 실행기 → Herdr가 사용하는 CLI 실행기 → 앱 실행기의
**같은 대화 ID와 A → A+B → A+B+C 기록 보존**을 검증했다. 새 임시 저장소와 로컬 가짜
모델만 사용했다. 실제 데스크톱 화면을 왕복 조작한 결과는 아니며, 자동 실행권 이전도
아직 지원하지 않는다.

## 확인한 설치본과 저장 형식

- `/Applications/ChatGPT.app`, bundle ID `com.openai.codex`, version `26.1111.21308`
  (build `27194`). 앱에 포함된 실행기는 `codex-cli 0.169.0-alpha.11.1`.
- Herdr 쪽 PATH의 Codex CLI는 `0.169.0`.
- 로컬 저장소는 `$CODEX_HOME` 또는 `~/.codex`. `state_5.sqlite`의 `threads`가 현재
  제목·cwd·source·originator·history_mode 등을 보유한다. 현재 일반 대화들은 paginated
  history를 사용한다. **JSONL 전체를 대화 원본이라고 가정하거나 직접 복사하면 안 된다.**
- 읽기 전용 메타데이터에서 앱 대화는 `source=vscode`와
  `originator=codex_work_desktop` 또는 `Codex Desktop` 조합으로 관찰됐다. `vscode`
  단독은 에디터일 수도 있다. 재개 과정에서 originator가 달라질 수 있으므로 영구적인
  최초 생성 출처로 해석하지 않는다.
- 내부 자식은 JSON object/string 형태의 `source.subagent` 또는
  `attached_thread_parent_id`로 구분한다. 클라이언트 origin보다 이 구분이 우선한다.
  `exec` 작업은 일반 대화 목록과 수동 handoff에서 제외한다.
- 실행 소유권은 originator가 아니라 `thread-writer-locks/<id>.lock` 및 rollout의
  열린 파일 핸들로 확인한다. 공유 daemon의 PID를 특정 앱 화면이라고 단정하지 않는다.

## 실제 실행기 왕복 검증

`tests/native_session_roundtrip.py`는 빈 임시 HOME/CODEX_HOME에서 설치된 두 실행기를
직접 시작한다. 인증 파일을 복사하지 않고, 모델 요청은 `127.0.0.1`의 합성 SSE 서버가
답한다. 임시 세션에는 세 번의 실제 `turn/start`만 수행한다.

1. 앱 실행기에서 A와 합성 응답을 저장한다.
2. 동시에 두 번째 서버가 같은 ID를 resume하면 `already has an active writer`로 거부된다.
3. 테스트 소유 서버를 종료하고 CLI 실행기에서 같은 ID로 resume한다. A를 읽고 B를 저장한다.
4. CLI 테스트 서버를 종료하고 앱 실행기로 같은 ID를 resume한다. A+B를 읽고 C를 저장한다.
5. 다시 CLI 실행기에서 A+B+C 전체를 읽는다.

페이지 크기 1의 `thread/turns/list`로 모든 user/assistant 메시지의 순서를 비교한다.
각 후속 모델 요청의 input에도 앞선 대화가 들어가는지 검사한다. SQLite에는 처음의
단일 thread ID만 남는다. Herdr의 실제 preflight helper도 active/ready를 구분한다.

**구독 해제는 실행권 해제와 같지 않다.** 이 설치본은 `thread/unsubscribe` 성공 뒤에도
writer를 유지했고, 10초 동안 loaded 목록에 남았다. 테스트 성공 경로는 테스트 소유
서버의 종료를 사용했다. 사용자 앱/daemon을 종료하거나 재시작하는 기능은 구현하지
않았다. 실제 전환에서는 기존 클라이언트가 writer를 놓은 것을 확인한 뒤 재개해야 한다.
단순히 응답이 끝났거나 화면을 다른 대화로 바꾼 사실만으로 안전하다고 판단하지 않는다.

## 설치된 앱 코드의 근거와 범위

`app.asar`에서 필요한 JavaScript 멤버만 실행 없이 추출했다.

| 멤버 | SHA-256 | 확인한 위치 (문자 offset) |
| --- | --- | --- |
| `.vite/build/early-bootstrap-631-c364c4eef36b8fb5.js` | `3d33823eff6f760caed93a06c7bd580a2ed7631c961bf7f4454622c47205fc2c` | 634107: history page reader, 634755: 같은 threadId의 resume |
| `webview/assets/async/907538.0572f09d40.js` | `eba5577e16a50a8106a64a05025fa23d0a589d8b4f775a6fe065ba7d916e6b1c` | 1398500: resume 요청 구성, 1403500: 최신 history page를 UI 상태에 병합, 1413637: writer 충돌 시 읽기 전용 history hydration |
| `.vite/build/early-bootstrap.js` | `7a52617dc132e6c292042a2d04f84091c8e55fd004c57f0070928e4eeed03b09` | 107932: `codex://threads/<id>` 생성 |

이것은 정적 코드 관찰이며 실제 UI 갱신을 관측한 것은 아니다. 전체 추출 트리에 대한
REA 분석은 시간 제한으로 부분 결과만 남겼다:
`ev_51593501cd5926714233e4bf84e473c76b7eed3af3c28ae7759d0eed39bf6298`.
작은 lifecycle 멤버 `736735.68f54aaa04.js`의 별도 정적 분석은 완료했다:
`ev_8e146a01f2c8f951a0c95b31ab98b3d9030e12b17578dfd5509560d7ee4743a6`.
이 REA 결과만으로 전체 앱의 동작을 검증했다고 주장하지 않는다. 핵심 왕복 증거는 위의
실제 실행기 통합 검사다.

## 공통 API와 Saved sessions 연동

기존 `lib/resume.js`의 `AGENTS`는 실행 명령 어댑터이고,
`lib/session_handoff.py`의 `PROVIDERS`는 읽기 전용 소유권·기능 어댑터다.
공급자별 파일 형식을 UI에 노출하지 않는다.

```js
const rec = { agent: "codex", session: id, argv: ["codex"], cwd, title };

// 상태 표시용. 이 결과를 캐시해 나중의 실행 허가로 사용하지 않는다.
const status = await inspectSession(rec, "agents-plus");
// { agent, session, state, reason, origin, pids, cwd, capabilities }

// Herdr 안에 이미 해당 세션이 있으면 LIVE를 보고 먼저 focus한다.
// 새 client를 만들 때는 바로 전에 다시 검사하고 중복 클릭을 막는다.
await resumeSession(rec, argv => run("tab.new", { folder: cwd, argv }), "agents-plus");

// worktrees bundle에 위임하면 기존 배치/focus 및 검사 경로를 함께 재사용한다.
run(`spaces-plus.resume@${JSON.stringify(rec)}`);

// 앱으로 돌아가는 주소만 생성. 열거나 writer를 중단하지 않는다.
const url = nativeSessionUrl(rec); // Codex UUID: codex://threads/<id>, 미지원: null
```

`state`는 `ready | active | unknown | missing | unsupported`다. 새 client 실행은
`ready`만 허용한다. 프로세스 확인 실패는 `unknown`이며 성공으로 간주하지 않는다.
원격 서버의 소유권을 로컬 메타데이터로 판정하지 않는다. 앱 링크를 열기 전에도
`assertResumable(rec, owner)`로 소유권을 다시 확인해야 한다.

`hm resume`는 같은 `spaces-plus.resume` 요청에 request ID를 붙이고 결과를 기다린다.
실패했는데 성공했다고 출력하지 않는다. Resume에는 자동 첫 메시지를 붙이지 않으며,
Fork는 사용자가 명시한 별도 동작으로 유지한다. 자동 restore/Sleep 정책은 이 변경의
범위가 아니다.

통합된 Saved는 `codex_metadata()`와 `codex_session_kind(record, firstHeader)`를
재사용해 desktop/editor/CLI 부모 세션을 읽는다. paginated history는 index 제목을
사용할 수 있으며 본문은 공급자의 supported resume/history API가 관리한다.
기존 JSONL 기반 본문 검색은 paginated history 전체 검색을 보장하지 않는다.

Saved check와 실제 launch 모두 공통 provider adapter를 fresh 조회한다. launch
reservation은 여러 mod 사이에서 공유하며, 실제 live terminal만 focus한다.
검사 도중 새로 붙은 terminal도 재확인한다. fresh cwd가 달라지거나 확인 불가능하면
새 client를 열지 않는다. Saved는 위임된 resume의 guard 응답을 기다려 오류와 pending을
정리한다. 자세한 계약과 남은 한계는 [Saved 문서](saved-sessions.md)에 있다.

## 공급자 확장 계약과 현재 한계

| 공급자 | 동일 ID 재개 | 소유권 검사 | 네이티브 앱 왕복 |
| --- | --- | --- | --- |
| Codex | native `resume ID` | native writer lock + 열린 rollout | 실행기/history API 검증; 화면·자동 이전 미검증 |
| Claude Code | 기존 `--resume ID` | PID registry + 실제 Claude process 확인 | Claude Desktop 호환은 주장하지 않음 |
| Gemini 등 | 아직 등록 안 됨 | 어댑터 필요 | 공급자 증거가 있을 때만 선언 |

새 에이전트는 `AGENTS`에 executable matcher, resume/fork 인자 규칙과 선택적인 native URL 생성기를,
`PROVIDERS`에 `inspect(session)`과 capabilities를 등록한다. 새 저장 형식의 discovery
reader도 구현해야 하지만 UI의 상태 처리와 handoff 코드는 그대로 사용한다.
등록하지 않은 공급자를 Codex 방식으로 추측하거나 새 대화로 바꾸지 않는다.

Claude의 registry 검사는 native 원자적 writer lock과 동일한 보장이 아니다. Herdr의
15초 공유 launch reservation은 여러 수동 진입점의 중복 클릭을 막으며, 외부 client와의
경쟁을 원자적으로 조정하지는 못한다. Codex의 최종 경쟁 판정은 native lock이 맡는다.
앱 전용 도구·첨부 표시·권한·모델 기능까지 양쪽 UI가 동일하다는 의미도 아니다.

## 재현

```sh
python3 -m unittest discover -s tests -p 'test_session_handoff.py'
python3 -m unittest discover -s tests -p 'test_codex_sessions.py'
node --experimental-vm-modules tests/session-handoff.mjs
node --experimental-vm-modules tests/session-parity.mjs
python3 tests/native_session_roundtrip.py --desktop-bin /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex
```

검사는 사용자 세션에 메시지·승인 응답을 보내지 않는다. 원본 transcript/DB를 직접
수정하지 않고 설치·앱/core 재시작·reset/redemption 동작을 실행하지 않는다.
