# Mary

> **Rv.0 / plugin 0.4.5 · Experimental · Claude Code**
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

Rv.0은 Mary의 공개 라인입니다: 워크플로 스킬 + 그 일부를 훅으로 집행하는 실행층. 0.4.5부터
플러그인은 **게이트 우선**입니다 — 기본으로 등록되는 훅은 `PreToolUse` 비가역 행동 게이트
하나뿐이고(매 호출 조용한 방지), 관측은 명시적 선택입니다("훅 티어" 참조).

- `PreToolUse` 게이트가 인식된 비가역 셸 행동 앞에서 승인을 요청합니다. **플러그인이 기본으로
  등록하는 훅은 이것 하나입니다** — 아래 "훅 티어" 참조.
- full 티어 한정: `PostToolUse` / `PostToolUseFailure` 훅이 승인 요청을 관측된 실행 결과와 결속합니다.
- full 티어 한정: `PermissionDenied` 훅이 호스트가 거부를 보고하면 승인을 `denied`로 닫습니다.
- full 티어 한정: `SessionStart` 훅이 결과가 기록되지 않은 승인을 `unknown`으로 보고합니다 —
  실패로 간주하거나 자동 재시도하지 않습니다.
- 덧붙이기 전용 승인 원장은 시크릿 마스킹 설명, 본문을 제외한 요청 메타데이터, 호스트 `tool_use_id`,
  무결성·레거시 fallback용 원본 입력 해시, 관측 결과를 저장합니다. Write/Edit/Notebook 본문과 도구 응답 본문은 저장하지 않습니다.
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
/mary
```

명시 호출은 작업 크기와 무관하게 전체 절차를 돌립니다.

다음의 경우 자동 발동될 수 있습니다:

- 비가역이거나 되돌리기 어려운 요청 (삭제·덮어쓰기·외부 전송·배포·업무시스템 쓰기)
- 다단계 작업 (초기 판단이 이후 결과에 영향)
- 사실 의존 작업 (법령·수치·규격 같은 사실 판정이 결과를 좌우)

자동 발동은 모델 판단에 의존하므로 누락될 수 있습니다. 확실히 필요하면 `/mary`를 치세요.

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
git clone https://github.com/mary-jeon/mary-code.git ~/.claude/skills/mary
claude plugin validate --strict ~/.claude/skills/mary
```

### Windows PowerShell

```powershell
git clone https://github.com/mary-jeon/mary-code.git "$HOME\.claude\skills\mary"
claude plugin validate --strict "$HOME\.claude\skills\mary"
```

`~/.claude/skills/` 아래에 `.claude-plugin/plugin.json`이 있는 폴더는 다음 세션에서
스킬 디렉터리 플러그인으로 로드됩니다. `mary@skills-dir`로 나타나고 스킬은
`/mary:mary`로 네임스페이스됩니다 (충돌이 없으면 `/mary`로 호출).

Git 대신 **Code → Download ZIP**을 쓰면 전체 저장소를 풀고 폴더 이름을 `mary`로 바꿔
다음 파일이 존재하게 하세요:

```text
~/.claude/skills/mary/.claude-plugin/plugin.json
```

첫 설치 후 Claude Code를 재시작하세요. 업데이트 후에는 재시작하거나 `/reload-plugins`를 실행하세요.

### 업데이트

macOS / Linux:

```bash
git -C ~/.claude/skills/mary pull --ff-only
```

Windows PowerShell:

```powershell
git -C "$HOME\.claude\skills\mary" pull --ff-only
```

그 후 Claude Code 재시작 또는 `/reload-plugins`.

## 비가역 행동 게이트가 실제로 집행하는 것

Mary의 보호층은 둘이고, 서로 다릅니다:

| 층 | 역할 |
|---|---|
| **워크플로 규칙** | 스킬이 Claude에게 모든 비가역 행동을 대상·범위·복구 경로·승인이 확보될 때까지 보류하라고 지시 |
| **훅 게이트** | `PreToolUse` 훅이 등록된 도구 호출에서 인식 가능한 행동에 대해 독립적으로 승인을 요청 |

게이트의 역할은 **분류가 아니라 사람에게 라우팅하는 것**입니다. 어떤 패턴 집합도 셸 의미론을
다 읽지 못하므로, 목표는 "모든 위험 명령 인식"이 아닙니다 — 그것은 불가능합니다. 목표는
인식된 위험과 **판정할 수 없는 모든 것**을 사람에게 넘기고, 어떤 패턴도 자동 허용을 만들지
않는 것입니다. 실제 방어선은 사람이 누르는 승인 버튼이고, 그것은 패턴 기반이 아니라서
인코딩 우회가 통하지 않습니다 — 패턴은 언제 사람이 봐야 하는지를 정할 뿐입니다.

게이트 훅은 `Bash`, `Write`, `Edit`, `MultiEdit`, `NotebookEdit`에 등록되며 다음을 인식하면 승인을 요청합니다:

- 파일 삭제 — 비재귀·경로 접두 포함 (`rm`, `/bin/rm`, `del`, `Remove-Item`, `Clear-Content`, `find -delete`, `shred`)
- `git push`(`-C` 같은 전역 옵션과 `-c core.pager="less -n"` 같은 따옴표 값 허용).
  `--dry-run` 면제는 **문자열 매칭이 아니라 파싱**으로 판정합니다 — 그 `push`의 실제 인자로,
  그 명령 세그먼트 안에 있을 때만 인정되며, 주석 처리된 플래그·`--push-option`의 값인 `-n`·
  설정값에서 빌려온 `-n`은 면제를 사지 못합니다. 파괴적 Git reset/clean, 브랜치 강제 삭제,
  `--no-verify` 우회도 포함
- 커밋되지 않은 작업의 폐기와 복구 수단 자체의 파괴: `git checkout -- .` / `git checkout .` / `-f`,
  `git restore`(`--worktree` 없는 `--staged`는 인덱스만 되돌리므로 제외),
  `git switch -f`/`--discard-changes`, `git stash clear`/`drop`,
  `git reflog expire`, `git gc --prune`, `git filter-branch`/`filter-repo`, `git tag -d`,
  `git update-ref -d`, `git worktree remove`, `git submodule deinit`
- `gh`를 통한 GitHub 조작: 저장소·릴리스·gist·시크릿 삭제, DELETE·POST·PUT·PATCH 메서드의
  `gh api`, `gh pr merge`/`close`, `gh release create`, `gh secret set`
- 파괴적 SQL과 비-SQL 저장소의 동등 명령 (`drop table`/`database`/`schema`/`index`/`view`,
  `delete from`, `truncate`, `FLUSHALL`/`FLUSHDB`, mongo `dropDatabase()`·`drop()`·`deleteMany({})`) —
  목적어만 있는 형태는 DB 클라이언트가 같은 명령에 있을 때만 인정합니다. "drop database support"
  같은 커밋 메시지가 게이트를 건드리지 않게요
- 디스크 덮어쓰기·절단 명령, 볼륨 전체 파괴 (`mkfs`, `diskpart`/`fdisk`/`parted`,
  `Format-Volume`, `Clear-Disk`), Windows `rd /s /q`
- 데이터를 전송하는 HTTP 명령 — 업로드 형태 포함 (`-F`/`--form`, `-T`/`--upload-file`, `--json`, `--data-*`)
- 원격 동기화·클라우드 삭제 (`rsync --delete`, `user@host:` 대상의 `scp`/`rsync`,
  `aws s3 rm`/`rb`/`sync --delete`, `aws <서비스> delete-*`/`terminate-*`, `gcloud … delete`,
  `az … delete`, `helm uninstall`, `docker … prune`)
- 패키지 배포와 **배포 철회** (`npm publish`/`unpublish`/`deprecate`, `cargo publish`/`yank`,
  `gem push`, `twine upload`, `poetry publish`, `dotnet nuget push`, `mvn deploy`) 및 주요 배포 명령.
  배포된 버전을 내리는 것은 롤백이 아닙니다 — 이름은 예약된 채 남고 하위 lockfile은 즉시 깨집니다
- 패턴 검사를 세탁할 수 있는 셸 래퍼·인코딩 호출 (`bash -c`, `python -c`/`node -e` 류 인터프리터
  원라이너, `powershell -EncodedCommand`, `ssh host <명령>`, 다운로드를 셸에 파이프, `eval`) —
  감싼 내용을 판정할 수 없으므로 감싸는 행위 자체를 "판정 불가 → 승인 요청"으로 처리.
  **묶인 단문자 옵션도 포함**: `bash -lc`, `sh -ec`, `python3 -Ic`, `perl -we`는 `-c`와 똑같이
  문자열을 실행합니다. `perl -E`·`php -R`는 대소문자를 구분하는 별도 항목인데, 대소문자를 접으면
  node의 `-r`(파일을 실행하는 모듈 프리로드)이 코드로 읽혀 평범한 명령에 승인을 요구하기 때문입니다
- Mary 자신의 설정·매니페스트·훅 등록·훅 스크립트·승인 원장(`approvals.jsonl`)·알림 설정
  (`notify.json` — 모든 승인 핑이 POST될 URL과 헤더를 지정합니다) 수정 — Write 계열은 경로로,
  Bash는 보호 경로 언급 + 쓰기 흔적(리다이렉트, `sed -i`, `tee`, `cp`/`mv`, `ln`, PowerShell 쓰기 cmdlet) 결합으로.
  조용히 고칠 수 있는 원장은 증거이기를 멈춥니다

위 패턴은 모두 단어 경계(`(^|[\s;&|])name`)에 앵커되므로, 셸 자신의 따옴표 제거가 그대로
무력화합니다 — `"rm" -rf`, `'rm'`, `r\m`, `git "push"`, `$'rm'`은 실행되지만 매칭될 맨 단어가
없습니다. 그래서 따옴표는 **명령어 자리(첫 단어)에서만** 제거하고, 래퍼 문법(`sudo -u root "rm"`,
`env FOO=1 "rm"`, `timeout 5 "rm"`)과 리다이렉션(명령어 앞의 `>/dev/null "rm" -rf`, 래퍼와
명령 사이의 `sudo >/dev/null "rm"`)을 따라가며, 정규화된 문자열을 원본과 **함께** 매칭합니다.
인자의 따옴표는 손대지 않으며, 그것이 `echo "rm -rf /"`와 `git commit -m "rm -rf fix"`를
`defer`로 유지하는 이유입니다.

자기 보호는 **앵커링**됩니다: 플러그인 상대 경로(`scripts/`, `hooks/hooks.json`,
`.claude-plugin/plugin.json`)는 플러그인의 실제 설치 루트 아래에서만 보호되며, 무관한
저장소의 같은 이름은 게이트를 건드리지 않습니다. 호스트 수준 파일(`.claude/settings*.json`,
`managed-settings.json`)과 원장은 어느 경로에서든 보호됩니다. 늑대를 자꾸 외치는 게이트는
사용자를 읽지 않고 승인하게 길들이고, 그것이 게이트를 무너뜨립니다.

Bash 자기 보호 검사는 휴리스틱입니다. 어떤 문자열 검사도 셸 의미론을 다 읽지 못합니다 —
명백한 우회를 눈에 보이게 만드는 장치이지, 우회를 불가능하게 만드는 장치가 아닙니다.
실증되어 닫힌 우회와 구조상 열려 있는 표면은 [`docs/threat-model.md`](docs/threat-model.md)에 공개돼 있습니다.

인식된 행동에는 Claude Code 고유의 `ask` 결정을 반환합니다. 조용히 승인하지 않고,
이전 승인을 재사용하지 않습니다.

인식되지 않은 명령과 일반 파일 쓰기는 훅 판정을 출력하지 않고 정상 종료합니다. 따라서 Claude Code의 정상 권한 시스템이 그대로 판정합니다. 무출력은 훅이 안전을 확인했다는 뜻이 **아닙니다**.

게이트는 잘못된 훅 입력에 fail-closed입니다: 빈 입력, 깨진 JSON, 도구명 누락, 읽을 수 없는
Bash 명령은 승인이 아니라 `ask`를 냅니다. 이것이 보편적 기본 거부 정책은 아닙니다 —
**게이트가 결코 보지 못하는 유일한 표면**은 등록된 matcher 밖의 도구(MCP 도구, Agent 도구,
호스트가 앞으로 추가할 도구)입니다. 호스트가 훅에 라우팅 자체를 하지 않으므로 fail-closed
경로가 존재할 수 없고, 발견되길 기다리는 대신 여기에 명시해 둡니다. 구현된 패턴에 걸리지
않는 의미론적 위험은 호스트의 정상 권한 흐름으로 넘어갑니다.

게이트가 물을 때, 사용자가 승인할 문구에 두 가지 최선-노력 맥락 경고가 덧붙을 수 있습니다:

- **교차 세션 가시성.** 같은 작업 디렉터리를 향한 **다른 세션**의 미결 승인을 표시합니다 —
  그 결과가 unknown이라는 것은 방금 검토한 상태가 이미 달라졌을 수 있다는 뜻이기 때문입니다.
  원장을 세션별로 쪼개지 않고 공유하는 이유가 정확히 이것입니다: 격리는 충돌을 숨기고,
  공유는 충돌을 보이게 합니다. (대조는 cwd 문자열 기준 — 같은 원격의 서로 다른 클론은 못 봅니다.)
- **lethal-trifecta 신호.** `mary-trifecta-sentinel.js`(WebFetch·WebSearch·fetch형 Bash를 관측하는
  `PostToolUse` 훅 — **거부된** fetch는 아무것도 읽지 않았으므로 신호를 오염시키지 않도록
  실행된 호출에만 발화하는 PostToolUse를 씁니다)가 세션의 비신뢰 외부 콘텐츠 유입을 기록해
  두고, 같은 세션이 나중에 **외부 전송** — 또는 게이트가 읽을 수 없는 래핑·인코딩 명령,
  그것이 전송일 수 있으므로 — 의 승인을 요청하면 게이트가 trifecta 경고를 덧붙입니다.
  세 다리 중 둘만 관측 가능합니다 — 민감정보 접근은 도구 호출에서 신뢰성 있게 감지할 수
  없으므로, 감지한다고 주장하지 않습니다.

두 경고 모두 가시성일 뿐입니다: 결정을 바꾸지 않고, 차단하지 않고, 자동 거부하지 않습니다.
trifecta 경고는 센티널이 등록된 **full 티어**(다음 절)에서만 동작합니다 — 기본 gate 티어에서는
마커가 기록되지 않으므로 경고도 나타나지 않습니다.

### 훅 티어 — 기본은 방지, 관측은 선택

Mary의 훅 스크립트 다섯 중 무언가를 **막는** 것은 `PreToolUse` 게이트 하나뿐입니다. 나머지 넷 —
결과 기록기, trifecta 센티널, 승인 알리미, 세션 리포트 — 는 관측하고 기록하고 보고할 뿐,
차단도 판정도 하지 않습니다. 가치가 있지만 값도 있습니다: 등록된 훅 하나가 대응 도구 호출마다
별도 `node` 프로세스입니다. 전체 세트는 `Bash`/`Write`/`Edit` 호출당 2–3개 프로세스 —
Mary 워크플로를 쓰지 않는 세션·프로젝트에서도 매 호출 체감되는 지연입니다.

그래서 등록이 티어로 나뉩니다:

| 티어 | 등록 | 게이트 대상 호출당 비용 | 포기하는 것 |
|---|---|---|---|
| **gate** (기본) | `PreToolUse` 게이트만 | 프로세스 1개 | 승인→결과 결속, 세션 시작 `unknown` 보고, trifecta 경고, 승인 핑. 원장에는 `asked`가 계속 기록되지만 결과는 관측되지 않으며, 수동 종결(`mary-reconcile`)은 그대로 동작합니다. |
| **full** | 게이트 + 기록기 + 센티널 + 알리미 + 리포트 | 프로세스 2–3개 | 없음 — 이 README가 기술하는 관측 계약 전부가 이 티어입니다. |

플러그인의 `hooks/hooks.json`은 gate 티어를 등록합니다. full 티어는 관리형 설치에서 선택하거나
(`install-managed.ps1 -Tier full` / `install-managed.sh --tier full`), 관측 훅 넷을 사용자
settings에 직접 등록해서 얻습니다. 아래에서 결과 기록·`unknown` 보고·trifecta 경고·핑을
설명하는 절은 **full 티어** 동작입니다.

무인·장시간 작업처럼 원장이 세션이 죽은 뒤에도 "실제로 실행됐나?"에 답해야 하면 full을,
조용한 상시 승인 체크포인트가 우선이면 gate를 고르세요. 제공하지 **않는** 것은 게이트 앞에서
명령을 선별하는 티어(예: 훅의 권한 규칙 `if` 필터)입니다 — 게이트의 파싱은 명령 문자열 글롭이
우회 가능하다는 사실 때문에 존재하므로, 그 앞의 필터는 정확히 그 우회 부류를 다시 엽니다.

### 승인 원장과 `unknown` 결과

게이트가 물으면 Mary는 `~/.claude/mary/approvals.jsonl`에 `asked` 이벤트를 덧붙입니다. 기록에는:

- 사용자에게 보여준 설명의 시크릿 마스킹 사본
- 경로와 비본문 메타데이터. Write/Edit/Notebook 본문은 저장하지 않고 바이트 수와 SHA-256만 저장
- 호스트의 `tool_use_id`. 정규화 요청 해시는 무결성 확인과 엄격한 레거시 fallback용으로 유지
- 관측된 경우의 결과: `succeeded` / `failed` / `denied` / `reconciled` — 마지막 것은 사람이
  나중에 실제 부작용을 관측하고 `scripts/mary-reconcile.js`로 닫은 기록이며, 관측 증거가 첨부됩니다

저장되는 설명과 비본문 문자열은 알려진 시크릿 형태를 마스킹합니다. Write 내용, Edit의 old/new 문자열,
Notebook 셀 본문 같은 콘텐츠 필드는 원문을 보존하지 않습니다. 해시는 원본 입력으로 계산되므로
마스킹과 본문 축약이 승인→결과 대조를 깨지 않고, 사람이 보는 대화상자는 원문을 유지합니다.
결과는 우선 `tool_use_id`로 승인에 결속하며, ID가 없는 레거시 행만 세션+정규화 cwd+해시가 모두
일치할 때 fallback으로 닫습니다.

결과 기록 훅은 대응하는 열린 `asked`가 있을 때만 씁니다. 현재 이벤트는 `tool_use_id`로,
레거시 이벤트는 세션+정규화 cwd+해시로 엄격히 대조합니다. 게이트를 거치지 않은 호출은 기록하지 않습니다.

대응하는 결과가 오지 않으면 승인은 열린 채 남습니다. 다음 세션 시작 때 Mary는 그것을 실패가
아니라 `unknown`으로 보고하고, 재시도를 고려하기 전에 실제 부작용을 먼저 관측하라고 지시합니다.
이미 성공했을 수 있는 작업의 재시도로 인한 중복 효과를 줄입니다. 사용자 거부는 호스트가
`PermissionDenied` 이벤트를 낼 때만 `denied`로 닫히며, 내지 않으면 역시 `unknown`으로 남습니다.

`unknown`은 저절로 해소되지 않습니다. 부작용을 실제로 관측했으면 항목을 닫습니다:

```
node scripts/mary-reconcile.js --list
node scripts/mary-reconcile.js <request_hash> --outcome ran|not-run|denied|superseded --evidence "<관측한 것>"
```

증거는 필수이고(관측 없는 종결은 원장이 막으려는 phantom-execution 그 자체입니다), 원장은
덧붙이기 전용으로 유지되며, 호출 1회에 asked 1건만 닫히고, 물은 적 없는 해시는 닫을 수 없습니다.
`reconciled`는 아무것도 허가하지 않습니다 — 해소된 unknown이 세션마다 다시 보고되는 것을 멈출 뿐입니다.

Bash로 `mary-reconcile`을 호출하는 것 **자체가 게이트 대상**입니다: 종결이 기록되기 전에 승인
대화상자가 해시·판정·증거를 사람에게 보여줍니다. CLI는 누가 쳤는지 알 수 없으므로 기록의
`by` 필드는 `reconcile-cli`입니다 — 사람과의 결속은 자기 신고 라벨이 아니라 게이트입니다.
결과 대조도 세션을 인식합니다: 한 세션에서 관측된 결과가 같은 명령에 대한 **다른 세션**의
unknown 승인을 닫지 않고, 잉여 종결은 다음 asked를 선지불하지 않고 버려집니다.

### 원격 알림 — 원격 승인이 아니라

`mary-approval-notifier.js`(`Notification` 훅, `permission_prompt` matcher, full 티어에서 등록)는
`~/.claude/mary/notify.json`에 설정한 웹훅으로 짧은 핑을 보낼 수 있습니다 — 예를 들어 휴대폰이
구독하는 [ntfy.sh](https://ntfy.sh) 토픽. 승인 대기를 알아채기 위해 터미널 앞을 지킬 필요가
없어집니다:

```json
{ "url": "https://ntfy.sh/your-private-topic", "headers": { "Title": "mary" } }
```

핑에는 의도적으로 **명령 내용·경로·프로젝트 식별자가 없습니다** — "승인 대기 중", 도구명, 타임스탬프만 보냅니다. URL에는 사용자명·비밀번호·쿼리스트링·fragment를 둘 수 없고, 헤더는 길이가 제한된 출력 가능 ASCII `Title`·`Priority`·`Tags`만 허용합니다. URL은 `https`여야 하며, 신뢰하는 LAN/자체 호스팅 endpoint에만 `"allowHttp": true`로 평문 HTTP를 명시 허용할 수 있습니다. 첫 유효 설정은 프로세스 동안 캐시되고 요청에는 5초 벽시계 마감이 적용됩니다.

**응답**은 여전히 터미널에서 합니다. 호스트의 권한 프롬프트에는 원격 응답 채널이 없고, 물리적으로
그 자리에 있는 사람의 버튼을 원격 채널로 대체하는 것은 게이트의 최종 방어선을 그 채널의 인증
강도와 맞바꾸는 결정입니다. 기기 종속 인증과 원장 결속을 갖춘 채널이 생기면 그때 이 판단을
다시 검토합니다 — 편의의 부산물로가 아니라, 의도적으로.

## 집행 경계 — 게이트를 신뢰하기 전에 읽을 것

일반 스킬 디렉터리 설치는 **신뢰 경계가 아닙니다.**

에이전트가 `~/.claude/skills/mary/` 아래 파일을 고치거나, 사용자·프로젝트 설정을 바꾸거나,
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
    "mary@your-managed-marketplace": true
  },
  "allowManagedHooksOnly": true
}
```

`mary@skills-dir`를 대신 넣고 사용자 쓰기 가능 체크아웃이 강화됐다고 가정하지 **마세요.**

원커맨드 관리형 배포가 저장소에 동봉됩니다:

```
# Windows — 관리자 권한 PowerShell
powershell -ExecutionPolicy Bypass -File scripts\install-managed.ps1 [-Tier gate|full] [-AllowManagedHooksOnly]

# macOS / Linux
sudo sh scripts/install-managed.sh [--tier gate|full] [--allow-managed-hooks-only]
```

둘 다 훅 스크립트를 관리자 소유 폴더에 복사**하고** `managed-settings.json`에 절대 경로로
등록합니다 — 사용자 쓰기 가능한 스크립트를 가리키는 관리형 등록은 껍데기이기 때문입니다.
기존 관리형 설정은 무엇이든 복사되기 **전에** 먼저 검증·백업되고, 기존 `hooks` 절은 명시적
force 플래그 없이는 교체되지 않으며, 재실행은 배포된 스크립트 폴더를 중첩이 아니라 교체하고,
쓰인 파일은 BOM 없이 기록 후 파스 검사됩니다(BOM은 엄격한 JSON 파서가 파일을 거부하게 만들어
배포 전체를 조용한 no-op으로 만들 수 있습니다). 관리자 권한이 없는 환경에서는 이 배포가
불가능하며, 그 경우 게이트는 "우회를 불가능하게"가 아니라 "우회를 눈에 보이게"가 정직한
최대치입니다.

`allowManagedHooksOnly` 없이 관리형 설치를 하면 Mary 플러그인 설치본이 같은 훅을 한 번 더
등록합니다: 원장 이벤트가 두 배로 쌓이고 핑이 두 번 갑니다. 플래그를 켜거나, 사용자 공간
플러그인의 훅을 끄세요.

관리형 설정 위치:

- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`
- Linux/WSL: `/etc/claude-code/managed-settings.json`
- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`

`allowManagedHooksOnly`는 사용자·프로젝트·비관리형 플러그인 훅을 차단합니다. 환경에 필요한
모든 훅을 고려한 뒤에만 켜세요.

관리형 설치가 보호하는 것은 **코드**이지 **원장**이 아닙니다: `~/.claude/mary/approvals.jsonl`은
훅이 실행되는 사용자 계정으로 써야 하므로 사용자 쓰기 가능으로 남고, 그 계정의 파일 접근
권한을 가진 무엇이든 편집할 수 있습니다. 게이트가 인식하는 모든 원장 쓰기 경로(리다이렉트,
`tee`, `sed -i`, 인터프리터 원라이너)는 게이트에 걸리므로 에이전트의 위조 *시도*는 승인
대화상자로 드러나지만 — 원장은 훅이 관측한 것의 증거이지, 변조 방지 감사 로그가 아닙니다.
이 경계는 [`docs/threat-model.md`](docs/threat-model.md)에 명시돼 있습니다.

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
| `notify.json` | 선택. "승인 대기" 핑을 보낼 웹훅 설정. 없으면 아무 트래픽도 없음 |
| `_trifecta-<세션>.json` | 세션별 마커: 이 세션이 비신뢰 외부 콘텐츠를 읽었음. 센티널이 쓰고 게이트가 읽으며 7일 후 자동 제거. (세션 단위 상태가 옳은 유일한 자리 — 유입은 세션의 속성이고, 작업과 원장은 세션을 횡단합니다) |

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
| `hooks/hooks.json` | `PreToolUse` 게이트 등록 (기본 gate 티어 — 관측 훅들은 full 티어 관리형 설치가 등록) |
| `scripts/hooks/mary-irreversible-gate.js` | 게이트 대상에는 `ask`, 비매치에는 무출력 무판정. 교차세션·trifecta 맥락 경고 추가 |
| `scripts/hooks/mary-outcome-recorder.js` | 대응하는 승인의 관측 결과 기록 |
| `scripts/hooks/mary-session-report.js` | 세션 시작 시 미결 승인을 `unknown`으로 보고 |
| `scripts/hooks/mary-trifecta-sentinel.js` | 세션별 비신뢰 외부 콘텐츠 유입 기록 (차단·판정 없음) |
| `scripts/hooks/mary-approval-notifier.js` | 권한 프롬프트 시 선택적 웹훅 핑 (명령 내용 미포함) |
| `scripts/hooks/lib/ledger.js` | 요청 정규화와 덧붙이기 전용 원장 |
| `scripts/mary-reconcile.js` | 부작용을 사람이 관측한 뒤 미결 승인을 닫는 CLI |
| `scripts/install-managed.ps1` / `install-managed.sh` | 원커맨드 관리자(관리형 설정) 배포 |
| `tests/gate.test.js` | 게이트·원장·결과 결속·세션 보고 회귀 테스트 |
| `tests/stats.test.js` | 검산기·승격 판정 회귀 테스트 |
| `docs/threat-model.md` | 무엇을 집행하는가, 알려진 우회(닫힌 것·열린 것), 원장이 증명할 수 있는 것과 없는 것 |
| `CHANGELOG.md` | 릴리스 이력 |
| `.github/workflows/test.yml` | CI — 두 테스트 스위트, Node 20/22 · Linux/Windows |

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
- 수동 거부 시 호스트가 `PermissionDenied`를 내는지는 완전히 문서화돼 있지 않습니다. 훅 레퍼런스는
  이 이벤트를 "auto mode classifier가 도구 호출을 거부할 때" 발생한다고만 설명합니다.
  **현재까지의 실측 — macOS 빌드 2026-07-26(asked 9건 / denied 0건), Windows 원장
  2026-07-24~07-29(전체 999건 중 asked 171건 / denied 0건): 이벤트는 한 번도 방출되지
  않았고** 수동 거부는 `unknown`으로 남았습니다. 관측되지 않은 거부는 열린 채 남아 다음 세션
  시작 때 `unknown`으로 보고됩니다. 0.4.2부터는 `mary-reconcile.js --outcome denied`로 "잃어버린
  결과"가 아니라 "거부"로 기록할 수 있고, 세션 시작 보고도 미결 중 일부는 쫓아가야 할 행동이
  아니라 사용자가 거부한 건일 수 있다고 알립니다. 훅 스스로 둘을 구분하지는 못합니다.
- 교차 세션 경고는 작업 디렉터리 문자열로 대조합니다. 같은 원격의 서로 다른 클론 두 개는
  게이트가 볼 수 없는 공유 외부 상태입니다.
- trifecta 센티널은 세 다리 중 둘(비신뢰 입력, 외부 전송)만 관측합니다. 민감정보 접근은 도구
  호출에서 신뢰성 있게 감지할 수 없고, 감지한다고 주장하지 않습니다.
- 별도 LLM 검토자는 생성자와 편향을 공유할 수 있습니다. 관측 가능한 증거의 대체물이 아닙니다.

## 개발 상태

**현재 버전: Rv.0 / plugin 0.4.5 · Experimental** — 릴리스 이력은 [`CHANGELOG.md`](CHANGELOG.md)

동작 중: 6단계 절차, Standard/Guarded 등급, 검증→반례→수정→재검증, 사용자 언어 자동 일치,
다중 `_work` 기록, 실패 적립과 사용자 승인 승격, 비가역 게이트(래퍼 세탁 패턴 포함),
승인-결과-거부 결속, 게이트 통과 호출 전용 원장, 미결 승인 보고와 `reconciled` 종결,
교차세션·trifecta 맥락 경고, 검증 영수증 검산, 승인 대기 웹훅 알림, 관리형 배포 스크립트,
동봉 비평 에이전트와 검산기, 공개 위협 모델([`docs/threat-model.md`](docs/threat-model.md)),
원장 시크릿 마스킹, 플러그인 루트 앵커링 자기 보호, 파싱 기반 `--dry-run` 면제,
명령어 자리 따옴표·리다이렉션 정규화, CI(GitHub Actions, Node 20/22 · Linux/Windows, 매트릭스 전 레그 완주),
검증 영수증 회차 간 연속성 검산(재검 비율·통과→실패 뒤집힘·공통 항목 0),
4-2 반례 축 로테이션(명세 부합 · 상태와 구조 · 경계와 회귀 · 운용), 정체 감지(2회차 연속 완료 조건
0건 종결 시 중단·보고), 회귀 검사 305건 — 조회·전환 형태(`git checkout main`, `git restore --staged`, `git gc`,
`psql -c "select 1"`, `gh api -X GET`, `gcloud … list`)가 승인을 **요구하지 않아야** 한다는
음성 테스트군 포함 — 그리고 명령 287건의 **판정 스냅샷**(`tests/decisions.test.js`): 고정된
판정(`ask`+분류 또는 `defer`)이 어느 방향으로든 움직이면 CI가 실패하므로, 판정 완화는 의도적
스냅샷 재생성과 그 diff 검토를 거쳐야만 배포됩니다. 또한 핀이 자신이 놓인 코퍼스 구획의 선언된
의도("must ask" / "must stay defer")와 모순되면 **재생성 모드에서도 실패**합니다 — 스냅샷은
게이트의 실제 출력을 고정하므로, 이 감사가 없으면 재생성이 게이트의 버그를 정답으로 고정합니다.

개발 중: **결정 재추적 엔진** — 명세 완료, 구현 진행 중.

안정판 전: 실제 작업 5–10건 검증, 새 세션의 절차 준수 확인, macOS 검증, `PermissionDenied`
수동 거부의 호스트·플랫폼별 실측(2026-07-26 macOS 빌드는 미방출 관측), 자동 발동 누락·과잉 측정,
패턴 밖 회귀 커버리지 확장,
[Anthropic 커뮤니티 마켓플레이스](https://github.com/anthropics/claude-plugins-community) 제출,
재추적 엔진 반례 시나리오 테스트.

이후: Codex·ChatGPT 설치 방식, 세션 종료·재시작의 증거 기반 기준, 이미지·PDF 전용 검증 절차.

## Mary 응원하기

Mary가 실제 작업에 도움이 되면 저장소에 ⭐ **Star**를 고려해 주세요.

Star는 선택이며 설치·기능·지원에 영향을 주지 않습니다.

## 라이선스

Mary는 [MIT License](./LICENSE)로 배포됩니다.
