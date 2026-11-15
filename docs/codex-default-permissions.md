# Codex 기본 실행 및 복구 권한 감사

2026-11-15, `fix/default-yolo-audit` 워크트리. 사용자 승인에 따라 herdr-mods의 기본 Codex 실행은 YOLO를 요청한다. 이 문서에서 YOLO는 `approval=never`와 sandbox 비활성화를 함께 뜻한다. CLI 옵션은 요청이며 플랫폼이 부여한 권한을 증명하지 않는다.

## 확인된 원인과 관측

| 관측 대상 | 읽기 전용 근거 | 결과 |
|---|---|---|
| 이 감사 세션 | 플랫폼 지시, 현재 rollout의 `turn_context`, SQLite 메타데이터 | `never`, `danger-full-access`, `permission_profile.type=disabled` 일치 |
| 설치 CLI | `codex --version`, `codex --help`, `codex resume --help` | 0.169.0, 새 실행과 resume 모두 명시적 bypass 플래그 지원 |
| 현재 실행 argv | 현재 Codex 프로세스의 프롬프트를 제외한 argv | `codex --no-daemon …`; `--no-daemon` 자체는 권한 옵션이 아님 |
| Herdr 실행 기본값 | `shared.json`의 Codex 항목만 읽음 | `run=["codex","--no-daemon"]`; 별도 `programs.json` 없음 |
| 전역 설정 | `config.toml`의 권한 필드만 읽음 | `sandbox_mode="danger-full-access"`, `approval_policy="never"` |
| profile/project | profile 목록, 해당 main·감사 워크트리의 `.codex/config.toml` 존재 검사 | 선택된 profile 없음, `*.config.toml` profile 파일 없음, 두 프로젝트 설정 파일 없음; main은 trusted |
| 로컬 관리 설정 | `/etc/codex/requirements.toml`, `/etc/codex/config.toml` 존재 검사; `app-server --print-startup-config`의 requirements만 조회 | 파일 없음, 현재 시작 진단의 `configRequirements.requirements=null` |
| 문제 root thread `01a1d8ad-…` | SQLite `approval_mode`/`sandbox_policy`, rollout의 턴 및 `thread_settings_applied` | `on-request`, workspace 제한, 저장된 profile `:workspace`; `.git`, `.agents`, `.codex`, `.aws` 읽기 전용, 네트워크 제한 |
| 같은 thread의 복구 기록 | `~/.herdr/restore/last.json`의 해당 항목 | `codex resume --no-daemon <id>`; 권한 override 없음 |

기존 t3은 조회 시 finished 상태였고 host argv는 셸이었다. 남아 있는 복구 기록은 같은 root thread를 다른 terminal 주소에 연결한다. 따라서 t3의 **최초** CLI argv나 당시의 정책 주입 주체를 현재 상태만으로 단정하지 않는다. 원래 글로벌 설정이 변경된 시점 또한 이 감사에서 재구성하지 않았다. 다만 제한된 실제 턴·저장 권한과 권한 없는 resume argv는 직접 확인했다.

전역 기본값이 기존 세션까지 바꾼다는 이전 README 설명은 잘못됐다. Codex는 직접 실행 옵션과 config 기본값을 구별하며, resume 요청에서 생략한 approval/profile은 저장 기록에서 복원한다. 이미 열려 있고 구독 중인 thread에 대한 resume은 현재 설정을 유지할 수 있다. 따라서 `--no-daemon`이나 전역 설정만 보고 실행 중 thread를 YOLO라고 말할 수 없다. `permission_profile.type=managed` 또한 **그 자체로 조직의 강제 MDM 정책이 있다는 뜻은 아니다**. 여기서는 구체적인 파일·네트워크 허용 범위와 저장 profile을 나타낸다.

## 권한 결정 경계

1. 일반 config 기본값은 CLI/`-c` > 신뢰된 project config(가까운 경로 우선) > 선택 profile 파일 > user config > cloud 기본값 > system config > 내장 기본값 순이다. 현재 CLI의 `--profile NAME`은 `$CODEX_HOME/NAME.config.toml`을 선택한다.
2. resume에서는 생략된 직접 권한 선택을 저장된 thread 설정으로 채울 수 있다. 이 저장값은 user config 기본값보다 먼저 확인해야 한다. 새 thread와 resume을 동일하게 취급하지 않는다.
3. 이미 열린 app-server thread에 재접속하는 것은 새로운 권한으로 다시 시작하는 것과 다르다. 현재 실행의 적용값은 서버 응답/실제 턴 권한으로 확인해야 한다. 실제 사용자 thread에는 조사 목적으로 `thread/resume`을 호출하지 않았다.
4. 조직 requirements, 플랫폼의 filesystem/approval 정책은 위 설정이 선택할 수 있는 범위를 제한한다. 허용되지 않는 선택은 서버가 거부하거나 제한된 값으로 처리할 수 있다. 본 변경은 그 제약을 우회하지 않는다. 현재 시작 진단에서 requirements가 없었다고 과거 세션의 모든 원격·관리 정책도 없었다고 단정하지 않는다.

근거: [공식 config 우선순위](https://learn.chatgpt.com/docs/config-file/config-basic#configuration-precedence), [app-server 프로토콜](https://learn.chatgpt.com/docs/app-server), OpenAI 소스의 [직접 실행 권한 구분](https://github.com/openai/codex/blob/main/codex-rs/tui/src/resume_permissions.rs), [저장 권한 복원](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/persisted_resume_settings.rs), [thread resume 처리](https://github.com/openai/codex/blob/main/codex-rs/app-server/src/request_processors/thread_processor.rs). 소스 링크는 감사일에 읽은 main이며 설치 binary와 동일 커밋이라고 주장하지 않는다. 핵심 동작은 아래 설치 binary 검사로 별도 재현했다.

## 수정 범위

- `lib/agent-launch.js`가 기본 argv를 결정한다. Python 독립 명령 `bin/hm`도 같은 계약을 따르며 공통 81개 fixture로 동작 차이를 검사한다.
- 새 워크트리(설정 스크립트 포함), 행 메뉴의 새 Codex, `hm term`, 저장 세션 및 외부 세션 resume, fork, Sleep 복원과 core 재시작 복구에서 명시 선택이 없으면 bypass 플래그를 전달한다.
- model, cwd, feature, `--no-daemon` 등 기존 옵션을 유지한다. sandbox/approval/profile, 관련 `-c` 설정, `--add-dir`, 원격 app-server, 알 수 없는 옵션 및 wrapper는 보존하며 기본값을 추가하지 않는다. 하나의 권한 축만 지정해도 다른 축을 임의로 확대하지 않는다.
- `--` 뒤의 프롬프트 문자열을 restore 옵션으로 재해석하지 않는다. 원래 positional prompt나 세션 선택자를 재전송하지 않는 기존 동작을 유지한다.
- 새 기본값은 일반 config 파일보다 우선하는 CLI 선택이다. 프로젝트별 제한이 필요하면 실행 설정에서 sandbox/profile 등을 명시한다. 일반 셸의 직접 `codex`, Herdr 본체의 다른 메뉴, 원격 app-server는 본 모듈이 통제하지 않는다.
- 설치/설정 파일/사용자 기록은 변경하지 않았다. main 통합 및 실제 앱 설치는 별도 소유 세션에서 수행해야 한다.

## 검사와 재현

`python3 tests/native_codex_permissions.py`는 임시 HOME/CODEX_HOME에 합성 기록을 생성하고, 자체 stdio 서버만 시작·정리한다. 실제 credentials를 복사하지 않고 실제 thread ID를 사용하지 않는다. 설치된 0.169.0에서 다음 결과를 확인했다.

| 조건 | 서버의 실제 응답 |
|---|---|
| YOLO user config로 새 thread | `never / dangerFullAccess` |
| 같은 config에서 저장 `:workspace` thread를 override 없이 cold resume | `on-request / workspaceWrite` |
| 별도 합성 thread를 명시 `approvalPolicy=never`, `sandbox=danger-full-access`로 cold resume | `never / dangerFullAccess` |
| 이미 열린 구독 thread에 같은 override로 resume | 기존 `on-request / workspaceWrite` 유지 |

`turn/start`, 모델/도구 실행, 승인 응답은 호출하지 않는다. `configRequirements/read`가 제한이 있는 환경을 반환하면 강제로 우회하지 않고 검사를 중단한다. raw filesystem grants만 있는 오래된 기록과 named profile 기록은 복원 동작이 다를 수 있어 fixture에 명시적인 `:workspace` profile을 사용했다.

기능 검사 명령:

```sh
node --experimental-vm-modules tests/agent-launch.mjs
node --experimental-vm-modules tests/session-parity.mjs
node --experimental-vm-modules tests/session-handoff.mjs
node --experimental-vm-modules tests/restore-progress.mjs
python3 -m unittest discover -s tests -p test_session_handoff.py
python3 tests/native_codex_permissions.py
git diff --check
```

추가로 변경된 번들의 transitive helper를 임시 디렉터리에 복사하여 `herdr-app check`로 검사한다. 실제 앱에 설치하거나 실제 세션을 종료/재시작하지 않는다. Saved history UI의 합성 기능 검사만 수행하며 렌더 성능 검증은 별도 `perf-render-audit` 작업 범위다. reset/redemption 실행 경로는 mock을 포함하여 호출하거나 검사하지 않는다.

## 기존 세션에 소급 적용 가능한가

이 커밋이나 글로벌 설정 파일 변경은 현재 턴에 부여된 권한을 소급 변경하지 않는다. 이미 열린 세션을 강제 종료·재생성하거나 내부 DB/rollout의 권한 필드를 고치지 않았다. 지원되는 다음 실행/중지 세션 복구에서 명시 기본값을 요청할 수 있지만, 실제 결과는 해당 클라이언트와 서버의 적용값 및 관리 제약에 따른다. 현재 세션의 권한 변경이 필요하면 사용자가 지원되는 권한 UI/세션 설정으로 선택해야 하며, 플랫폼이 허용하지 않는 범위는 Herdr 코드로 해결할 수 없다.
