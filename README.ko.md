# Mary Code

> **Rv.0 / plugin 0.2.0 · Experimental · Claude Code**
>
> [English](./README.md) (정본) · **한국어**
>
> 이 문서는 번역본입니다. 내용이 어긋나면 영문 README가 우선합니다.

**AI는 틀렸을 때도 설득력 있게 말합니다.**

Mary는 AI의 불확실한 출력을 더 안전한 작동 루프 안에 가두는 작업 하네스입니다: 가역적 실행,
관측 가능한 검증, 비가역 행동의 명시적 승인, 세션을 넘어 살아남는 기록.

Mary는 모델을 바꾸지 않습니다. 일이 정의되고, 실행되고, 검증되고, 기록되는 방식을 바꿔서
그럴듯하지만 틀린 판단 하나가 작업 전체의 병목이 될 가능성을 낮춥니다.

## Rv.0에 들어 있는 것

Rv.0은 Mary의 첫 공개 릴리스입니다: 워크플로 스킬 + 그 일부를 훅으로 집행하는 실행층.

- `PreToolUse` 게이트가 인식된 비가역 셸 행동 앞에서 승인을 요청합니다.
- `PostToolUse` / `PostToolUseFailure` 훅이 승인 요청을 관측된 실행 결과와 결속합니다.
- `PermissionDenied` 훅이 호스트가 거부를 보고하면 승인을 `denied`로 닫습니다.
- `SessionStart` 훅이 결과가 기록되지 않은 승인을 `unknown`으로 보고합니다 — 실패로 간주하거나
  자동 재시도하지 않습니다.
- 덧붙이기 전용 승인 원장이 사용자에게 보여준 문장, 정규화된 요청 해시, 관측된 결과를 저장합니다.
  게이트를 거친 호출만 기록되며, 도구 응답 본문은 저장하지 않습니다 — 명령 출력에는 비밀이 섞일 수 있습니다.
- 동봉된 읽기 전용 `mary-critic` 에이전트가 반례 검토 단계에 고정된 도구 제한 프로필을 제공합니다.
- `mary-stats.js` 검산기가 실패 카운터와 규칙 승격 후보를 모델의 산술 대신 결정론적으로 재계산합니다.
- 여러 작업이 각자의 `_work-<슬러그>.md`를 쓰되 `RULES.md`와 `FAILLOG.md`는 하나를 공유합니다.

다음 주요 기능은 결정 재추적 엔진입니다. 전제가 무효화되면 작업 전체를 재시작하는 대신 그 전제에
의존한 결정만 다시 엽니다. 명세는 있으나 엔진은 아직 구현되지 않았습니다.

## 작동 방식

Mary는 해당되는 작업을 여섯 단계로 돌립니다. 4단계에 비가역 행동의 승인·실행 지점이 있습니다.

```text
0. 위험 점검     비가역 행동 목록화; 검증 가능한 주장과 판단 영역 분리
1. 명세          목표·완료 조건·제외 범위·검증 방법 정의
2. 대안          근본적으로 다른 접근들을 비교, 각각의 붕괴 조건 기록
3. 안전 실행     가역적인 것부터; 비가역 행동은 보류
4. 검증          검증 → 반례 → 수정 → 재검증
   4.5 실행      대상·범위 제시 → 승인 → 상태 재대조 → 실행 → 결과 관측
5. 적립          결과 기록, 반복 실패는 규칙 후보로 승격
```

Mary는 결론을 두 종류로 구분합니다:

- **검증 가능한 주장**은 실행·테스트·실측·diff·원문·권한 있는 검토자 확인 같은
  관측 가능한 증거로 확인해야 합니다.
- **판단 영역**(설계·전략·취향)은 객관적으로 검증된 것처럼 제시하지 않습니다. 추천안, 핵심 전제,
  뒤집힐 조건, 남은 가치 판단의 소유자를 밝힙니다.

다른 LLM의 비평은 별도의 관점이지 독립 검증이 아닙니다. 증거는 모델 자신의 주장 바깥에서 검사
가능해야 합니다. 증거가 존재한다는 사실과 그 증거가 현재 주장을 뒷받침한다는 판단도 따로 검토합니다.

정규 실패 키와 단계 매핑은 [`skills/mary/LAYERS.md`](./skills/mary/LAYERS.md)에 있습니다.

## 언제 쓰나

설치 후 Claude Code에서 직접 호출:

```text
/mary-code:mary
```

명시 호출은 작업 크기와 무관하게 전체 절차를 돌립니다.

다음의 경우 자동 발동될 수 있습니다:

- 비가역이거나 되돌리기 어려운 요청 (삭제·덮어쓰기·외부 전송·배포·업무시스템 쓰기)
- 다단계 작업 (초기 판단이 이후 결과에 영향)
- 사실 의존 작업 (법령·수치·규격 같은 사실 판정이 결과를 좌우)

자동 발동은 모델 판단에 의존하므로 누락될 수 있습니다. 확실히 필요하면 `/mary-code:mary`를 치세요.

단발 질문·설명·번역·조회에는 쓰지 않습니다. 모든 요청에 무거운 절차를 돌리면 하네스는
우회되기 쉬워지고 쓰기 어려워집니다.

### 작업 등급

| 등급 | 대상 | 처리 |
|---|---|---|
| **Standard** | 가역적·저영향 작업 | Claude가 자율 진행하며 필요한 검증을 수행. 자동 발동 시 탐색·표현은 압축 가능하나 검증·승인 게이트는 압축 불가 |
| **Guarded** | 비가역 행동; 법률·노무·세무·고비용; 되돌리기 어려운 설계 결정 | 검증 가능한 주장은 관측 증거 필수. 중요한 판단과 비가역 행동은 사용자 확인 필수 |

Guarded는 탐색을 줄이지 않습니다. 결정 확정 전에 요구되는 증거와 승인 수준을 높입니다.

## 설치

필요한 것:

- 스킬 디렉터리 플러그인을 지원하는 최신 **Claude Code**
- **Node.js** (훅 스크립트가 `node`로 실행됨)

### macOS / Linux

```bash
git clone https://github.com/a01078794-arch/mary-code.git ~/.claude/skills/mary-code
claude plugin validate --strict ~/.claude/skills/mary-code
```

### Windows PowerShell

```powershell
git clone https://github.com/a01078794-arch/mary-code.git "$HOME\.claude\skills\mary-code"
claude plugin validate --strict "$HOME\.claude\skills\mary-code"
```

`~/.claude/skills/` 아래에 `.claude-plugin/plugin.json`이 있는 폴더는 다음 세션에서
스킬 디렉터리 플러그인으로 로드됩니다. `mary-code@skills-dir`로 나타나고 스킬은
`/mary-code:mary`로 네임스페이스됩니다.

Git 대신 **Code → Download ZIP**을 쓰면 전체 저장소를 풀고 폴더 이름을 `mary-code`로 바꿔
다음 파일이 존재하게 하세요:

```text
~/.claude/skills/mary-code/.claude-plugin/plugin.json
```

첫 설치 후 Claude Code를 재시작하세요. 업데이트 후에는 재시작하거나 `/reload-plugins`를 실행하세요.

### 업데이트

macOS / Linux:

```bash
git -C ~/.claude/skills/mary-code pull --ff-only
```

Windows PowerShell:

```powershell
git -C "$HOME\.claude\skills\mary-code" pull --ff-only
```

그 후 Claude Code 재시작 또는 `/reload-plugins`.

## 비가역 행동 게이트가 실제로 집행하는 것

Mary의 보호층은 둘이고, 서로 다릅니다:

| 층 | 역할 |
|---|---|
| **워크플로 규칙** | 스킬이 Claude에게 모든 비가역 행동을 대상·범위·복구 경로·승인이 확보될 때까지 보류하라고 지시 |
| **훅 게이트** | `PreToolUse` 훅이 등록된 도구 호출에서 인식 가능한 행동에 대해 독립적으로 승인을 요청 |

Rv.0 훅은 `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`에 등록되며 다음을 인식하면 승인을 요청합니다:

- 파일 삭제 — 비재귀 포함 (`rm`, `del`, `Remove-Item`, `find -delete`, `shred`)
- `git push`, 파괴적 Git reset/clean, 브랜치 강제 삭제, `--no-verify` 우회
- `gh`를 통한 GitHub 저장소·릴리스 삭제
- 파괴적 SQL 패턴
- 디스크 덮어쓰기·절단 명령
- 데이터를 전송하는 HTTP 명령
- 패키지 배포와 주요 배포 명령
- 패턴 검사를 세탁할 수 있는 셸 래퍼·인코딩 호출 (`bash -c`, `powershell -EncodedCommand`,
  다운로드를 셸에 파이프, `eval`) — 감싼 내용을 판정할 수 없으므로 감싸는 행위 자체를
  "판정 불가 → 승인 요청"으로 처리
- Mary 자신의 설정·매니페스트·훅 등록·훅 스크립트 수정 — Write 계열은 경로로,
  Bash는 보호 경로 언급 + 쓰기 흔적(리다이렉트, `sed -i`, `tee`, `cp`/`mv`, PowerShell 쓰기 cmdlet) 결합으로

Bash 자기 보호 검사는 휴리스틱입니다. 어떤 문자열 검사도 셸 의미론을 다 읽지 못합니다 —
명백한 우회를 눈에 보이게 만드는 장치이지, 우회를 불가능하게 만드는 장치가 아닙니다.

인식된 행동에는 Claude Code 고유의 `ask` 결정을 반환합니다. 조용히 승인하지 않고,
이전 승인을 재사용하지 않습니다.

인식되지 않은 명령과 일반 파일 쓰기는 `defer`를 반환해 Claude Code의 정상 권한 시스템에
넘깁니다. `defer`는 훅이 안전을 확인했다는 뜻이 **아닙니다**.

게이트는 잘못된 훅 입력에 fail-closed입니다: 빈 입력, 깨진 JSON, 도구명 누락, 읽을 수 없는
Bash 명령은 승인이 아니라 `ask`를 냅니다. 이것이 보편적 기본 거부 정책은 아닙니다 — 등록된
matcher 밖의 도구와 구현된 패턴에 걸리지 않는 의미론적 위험은 훅의 집행 범위 밖입니다.

### 승인 원장과 `unknown` 결과

게이트가 물으면 Mary는 `~/.claude/mary/approvals.jsonl`에 `asked` 이벤트를 덧붙입니다. 기록에는:

- 사용자에게 보여준 정확한 설명
- 도구 요청
- 기계 대조용 정규화 요청 해시
- 관측된 경우의 결과: `succeeded` / `failed` / `denied`

결과 기록 훅은 같은 해시의 열린 `asked`가 있을 때만 씁니다. 게이트를 거치지 않은 도구 호출은
기록되지 않으므로, 원장은 모든 명령 출력이 쌓이는 평문 로그가 아니라 승인 기록으로 유지됩니다.

대응하는 결과가 오지 않으면 승인은 열린 채 남습니다. 다음 세션 시작 때 Mary는 그것을 실패가
아니라 `unknown`으로 보고하고, 재시도를 고려하기 전에 실제 부작용을 먼저 관측하라고 지시합니다.
이미 성공했을 수 있는 작업의 재시도로 인한 중복 효과를 줄입니다. 사용자 거부는 호스트가
`PermissionDenied` 이벤트를 낼 때만 `denied`로 닫히며, 내지 않으면 역시 `unknown`으로 남습니다.

## 집행 경계 — 게이트를 신뢰하기 전에 읽을 것

일반 스킬 디렉터리 설치는 **신뢰 경계가 아닙니다.**

에이전트가 `~/.claude/skills/mary-code/` 아래 파일을 고치거나, 사용자·프로젝트 설정을 바꾸거나,
훅을 끌 수 있을 수 있습니다. 자기 보호는 Mary의 집행 파일에 대한 명백한 수정을 눈에 보이게
만들지만, 사용자 쓰기 가능 파일을 변조 불가능하게 만들 수는 없습니다. 기본 설치는 유용한 승인
체크포인트이지, 관리자 수준 격리가 아닙니다.

강화 배포에는 둘 다 필요합니다:

1. 플러그인 파일과 배포 출처를 관리자가 통제하고 에이전트가 접근 불가할 것
2. 정확한 관리형 플러그인 ID를 Claude Code 관리형 설정에서 강제 활성화할 것
   (필요 시 `allowManagedHooksOnly` 포함)

관리자 마켓플레이스 배포의 예시 형태:

```json
{
  "enabledPlugins": {
    "mary-code@your-managed-marketplace": true
  },
  "allowManagedHooksOnly": true
}
```

`mary-code@skills-dir`를 대신 넣고 사용자 쓰기 가능 체크아웃이 강화됐다고 가정하지 **마세요.**
이 저장소는 현재 원커맨드 관리형 배포를 제공하지 않습니다.

관리형 설정 위치:

- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`
- Linux/WSL: `/etc/claude-code/managed-settings.json`
- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`

`allowManagedHooksOnly`는 사용자·프로젝트·비관리형 플러그인 훅을 차단합니다. 환경에 필요한
모든 훅을 고려한 뒤에만 켜세요.

올바른 관리형 설치도 Mary가 관측하는 훅 이벤트·도구명·행동 패턴만 커버합니다. 작업이
다단계인지, 사실 판정이 결과를 좌우하는지는 어떤 패턴 전용 디스패처도 완전히 집행할 수 없는
의미론적 판단으로 남습니다.

Claude Code의 현재 플러그인·관리형 설정 동작은 공식 [플러그인 문서](https://code.claude.com/docs/en/plugins),
[플러그인 레퍼런스](https://code.claude.com/docs/en/plugins-reference),
[설정 레퍼런스](https://code.claude.com/docs/en/configuration)를 참고하세요.

## 상태·기록 파일

Mary는 런타임 상태를 저장소 밖 `~/.claude/mary/`에 둡니다. 파일은 필요할 때 생성됩니다.

| 파일 | 역할 |
|---|---|
| `RULES.md` | 승인된 상시 규칙과 확인된 사실. 하나 |
| `FAILLOG.md` | 관측된 실패, 기각된 반례, 카운터, task ID, 승격 상태. 하나 |
| `_work-<슬러그>.md` | 작업 흐름당 하나의 진행 기록. 동시에 여러 개 가능. 완료된 것만 삭제 |
| `approvals.jsonl` | 훅이 쓰는 덧붙이기 전용 승인·결과 원장 |

이 파일들은 사용자 컴퓨터에 남고 저장소에 올라가지 않습니다.

## Mary가 실패에서 배우는 방식

1. 실패·증거·정규 키·scope·고정 `task_id`를 `FAILLOG.md`에 기록합니다.
2. 한 작업은 세션이 갈라져도, 종료 상태가 바뀌어도 정확히 한 번만 셉니다.
3. 같은 실패 키가 서로 다른 두 task ID에서 재현되면 규칙 후보가 됩니다.
4. 제안 규칙 한 줄과 근거 사건 2건을 보여줍니다.
5. 사용자가 승인한 규칙만 `RULES.md`에 들어갑니다.
6. 잘못된 상시 규칙은 나중에 수정·삭제될 수 있습니다.

기각된 반례는 따로 저장되며 승격에 절대 반영되지 않습니다. 승격 범위는 실제 관측된 scope로
한정되고 조용히 전체로 일반화되지 않습니다.

> `FAILLOG.md`는 Mary가 발동한 동안 관측된 실패의 기록입니다. 모델이 낸 모든 실패의 완전한
> 추정치가 아닙니다.

## 저장소 구조

플러그인 구성 요소는 함께 있어야 합니다.

| 파일 | 역할 |
|---|---|
| `.claude-plugin/plugin.json` | 플러그인 정체성·버전·구성 경로·메타데이터 |
| `skills/mary/SKILL.md` | Mary의 실행 절차 |
| `skills/mary/LAYERS.md` | 정규 실패 키 |
| `agents/mary-critic.md` | 4-2 단계가 쓰는 읽기 전용 반례 검토자 |
| `scripts/mary-stats.js` | 카운터·승격 후보를 재계산하는 읽기 전용 검산기 |
| `hooks/hooks.json` | `PreToolUse`·`PostToolUse`·`PostToolUseFailure`·`PermissionDenied`·`SessionStart` 등록 |
| `scripts/hooks/mary-irreversible-gate.js` | 게이트 대상 인식, `ask`/`defer` 반환 |
| `scripts/hooks/mary-outcome-recorder.js` | 대응하는 승인의 관측 결과 기록 |
| `scripts/hooks/mary-session-report.js` | 세션 시작 시 미결 승인을 `unknown`으로 보고 |
| `scripts/hooks/lib/ledger.js` | 요청 정규화와 덧붙이기 전용 원장 |
| `tests/gate.test.js` | 게이트·원장·결과 결속·세션 보고 회귀 테스트 |
| `tests/stats.test.js` | 검산기·승격 판정 회귀 테스트 |

## 설계 원칙

- **생각은 자유롭게, 확정은 엄격하게.** 탐색은 열어 두되, 파급이 있는 결론에는 증거를 요구한다.
- **가역적 작업은 자율로.** 모호함·고영향·비가역 결정만 올린다 — 모든 평범한 단계가 아니라.
- **사실과 판단을 분리한다.** 사실은 검증하고, 판단은 전제와 뒤집힐 조건을 드러낸다.
- **모델 비평은 관점이지 증명이 아니다.** 독립 증거는 실행·테스트·실측·원문·권한 있는 검토자에서 온다.
- **효과를 관측한 뒤에 성공을 보고한다.** 없는 결과는 `unknown`이지 자동으로 실패가 아니다.
- **세션은 소모품, 파일은 자산.** 작업 상태와 실패 이력은 세션 경계를 넘어 살아남는다.
- **나쁜 규칙은 내려올 수 있어야 한다.** 승격된 규칙은 영구 진리가 아니다.

## 현재 한계

- 자동 발동은 누락되거나 불필요하게 적용될 수 있습니다.
- Claude가 명세 초안을 먼저 쓰는 구조는 사용자를 모델의 초기 프레임에 정박시킬 수 있습니다.
- Guarded 작업에서 추천 전에 사용자의 핵심 조건을 확인하는 메커니즘은 아직 미구현입니다.
- 결정 재추적 엔진은 명세만 있고 미구현입니다.
- 훅은 정의된 도구·패턴 집합만 인식합니다. 모든 도구·명령·외부 전송·업무시스템 쓰기를 중재하지 않습니다.
- Bash 자기 보호는 보호 경로 언급과 쓰기 흔적의 결합 휴리스틱입니다. 파서가 아니므로 충분히
  우회적인 셸 명령은 피해 갈 수 있습니다.
- 수동 거부 시 호스트가 `PermissionDenied`를 내는지는 완전히 문서화돼 있지 않습니다. 관측되지
  않은 거부는 열린 채 남아 다음 세션 시작 때 `unknown`으로 보고됩니다.
- 별도 LLM 검토자는 생성자와 편향을 공유할 수 있습니다. 관측 가능한 증거의 대체물이 아닙니다.

## 개발 상태

**현재 버전: Rv.0 / plugin 0.2.0 · Experimental**

동작 중: 6단계 절차, Standard/Guarded 등급, 검증→반례→수정→재검증, 사용자 언어 자동 일치,
다중 `_work` 기록, 실패 적립과 사용자 승인 승격, 비가역 게이트(래퍼 세탁 패턴 포함),
승인-결과-거부 결속, 게이트 통과 호출 전용 원장, 미결 승인 보고, 동봉 비평 에이전트와 검산기,
회귀 검사 68건.

개발 중: **결정 재추적 엔진** — 명세 완료, 구현 진행 중.

안정판 전: 실제 작업 5–10건 검증, 새 세션의 절차 준수 확인, macOS 검증, `PermissionDenied`
수동 거부 실측, 자동 발동 누락·과잉 측정, 패턴 밖 회귀 커버리지 확장,
[Anthropic 커뮤니티 마켓플레이스](https://github.com/anthropics/claude-plugins-community) 제출,
재추적 엔진 반례 시나리오 테스트.

이후: Codex·ChatGPT 설치 방식, 세션 종료·재시작의 증거 기반 기준, 이미지·PDF 전용 검증 절차.

## Mary 응원하기

Mary가 실제 작업에 도움이 되면 저장소에 ⭐ **Star**를 고려해 주세요.

Star는 선택이며 설치·기능·지원에 영향을 주지 않습니다.

## 라이선스

Mary Code는 [MIT License](./LICENSE)로 배포됩니다.
