# Threat model

> **Scope note (0.5.0).** The gate and ledger described here are an **optional** component. The
> plugin registers no hooks; nothing on this page is active unless you register the gate yourself
> (`docs/gate.md`). The document is kept because the option is still shipped and still reviewable.
> Findings reproduced on 2026-09-02 and not yet fixed are listed in `docs/gate.md` under
> "Known open findings".

What the gate and ledger actually enforce, who they defend against, the bypasses we
know about, and what the records can and cannot prove. Everything here is testable;
where a claim has a regression test, the test name is given.

A security mechanism whose limits are secret fails twice: once when the limit is
found, and once more when the user discovers it was known and unstated. This file
exists so the second failure cannot happen.

## 1. What is enforced

Registration is tiered (README "Hook tiers"): the default **gate** tier registers only
the `PreToolUse` gate; the **full** tier adds the observability hooks (outcome
recorder, trifecta sentinel, approval notifier, session report). Prevention — the
first and third bullets below — holds in both tiers. Approval→outcome binding, the
`unknown` report, and the trifecta escalation exist only where their hooks are
registered: claims about them in this document are **full-tier claims**.

- **Irreversible-action gating.** `PreToolUse` intercepts `Bash | Write | Edit |
  MultiEdit | NotebookEdit` calls. Registered irreversible shapes (deletion,
  overwrite, external send, deployment, gate bypass, ledger closure,
  enforcement-config change) return `ask` — a human sees a dialog before the call
  runs. Everything else emits no hook decision (exit 0 with empty stdout), never
  `allow`; the host's normal permission flow remains authoritative.
- **Approval→outcome binding** (full tier). Every `ask` appends an `asked` record with the
  host `tool_use_id`, normalized cwd, and a canonical request hash. Closing events
  bind by `tool_use_id`; strict session+cwd+hash matching exists only for legacy
  events without an id. An approval with no closing record is **unknown** — reported
  at every session start until a human closes it with observed evidence. Under the
  gate tier, `asked` records are still written but no outcome ever arrives and no
  session-start report runs; closure happens only through `mary-reconcile`.
- **Fail-closed judgment.** Unreadable stdin, broken JSON, a missing tool name, an
  empty command, an internal exception — every failure to judge ends in `ask`,
  never in a pass. (Tests: `[fail-closed — cannot judge is not a pass]`.)

## 2. What is deliberately NOT enforced

- **No automatic allow.** No pattern ever whitelists a call. A non-match emits no
  hook decision; it is not an approval.
- **No hard block.** The gate never exits 2. Removing the human's ability to say
  "yes, do it" would just move the bypass to "disable the plugin".
- **No approval reuse.** No session cache, no timeout window, no "the same command
  passed last time".

## 3. The one ungated surface

Tools outside the hook matcher (`Bash | Write | Edit | MultiEdit | NotebookEdit`,
plus `WebFetch | WebSearch` for the sentinel) **never reach the gate at all** —
there is no fail-closed path for a call the host never routes to us. This includes
MCP-provided tools, the Agent tool, and any future tool the host adds. Calls that
are routed but do not match emit no decision; calls outside the matcher never reach
Mary at all. Mitigation: the matcher list is short, explicit, and lives in
`hooks/hooks.json` — which is itself a SELF_PROTECTED file.

## 4. Attacker classes

| Class | Example | Defense |
|---|---|---|
| **Careless agent** | runs `rm -rf` on the wrong dir mid-plan | gate asks; human reads target/scope/rollback |
| **Instruction-injected agent** | web page tells it to `curl -F` a secrets file out | gate asks; the trifecta sentinel (full tier) escalates the dialog when the session has ingested untrusted content |
| **Gate-aware agent** | wraps the action so no pattern matches | wrapping itself (`bash -c`, interpreter `-c/-e`, encoded PowerShell, `ssh host cmd`, pipe-to-shell) is gated as *cannot judge → ask* |
| **Record-falsifying agent** | edits the ledger or its own receipts to fake compliance | see §6 — partially defended, honestly bounded |
| **Malicious human with file access** | edits hooks out of settings | **out of scope.** The gate defends the human's decision authority against the agent, not the machine against its owner |

## 5. Known bypasses and their status

### Closed in 0.4.0 (each has a regression test: `[bypass counterexamples (2026-07-26 review)]`)

| # | Bypass | Fix |
|---|---|---|
| 1 | `/bin/rm -rf` — prefix class had no `/` | optional path prefix on deletion commands |
| 2 | `git -C <dir> push` — adjacency requirement | global-option-tolerant `git` prefix |
| 3 | `git -C <dir> reset --hard` | same |
| 4 | `curl -F` multipart upload | upload forms added to external-send pattern |
| 5 | `curl -T` / `--upload-file` | same |
| 6 | real push + `--dry-run` string in another command (**fail-open**) | per-segment judgment: the exemption only counts inside its own segment |
| 7 | `python -c "shutil.rmtree(…)"` — interpreter wrapper passed while `bash -c` asked | interpreter one-liners (`python/node/perl/ruby/php/deno/bun` + `-c/-e/--eval`) gated as unreadable wrappers |
| 8 | `node -e` appending forged lines to the ledger | same fix; the write is now visible *before* it happens |
| 9 | `ln -sf` replacing a gate script | `ln` added to write hints |
| 10 | `rsync --delete` to a remote | rsync/scp/aws-s3 deletion and remote-send patterns |

### Closed in 0.4.1 (external review by @thegreatesthoneybee, PRs #2–#3; integration and follow-up in #4)

All three are the same class as the ten above: **the command string was matched as
text where the shell parses it as grammar.** Each was reproduced against the
shipped hook under an isolated `MARY_DIR` before being fixed.

| # | Bypass | Fix |
|---|---|---|
| H-1 | `git push origin main # --dry-run` — the exemption was a substring test, so a *commented* flag bought it | comments stripped, quote-aware tokenization, only tokens after `push` considered |
| H-1 | `git push -o -n origin main` — `-n` is the **value** of `--push-option` | options that consume a value are respected; a value is never read as a flag |
| H-1 | `git -c core.pager="less -n" push` — `-n` belongs to a config value | same parse; and `GIT`'s option-value pattern (`-c\s+\S+`) could not span a quoted value at all, so this push had been **invisible to the registry**, not merely unexempted |
| H-2 | `bash -lc`, `sh -ec`, `zsh -ic`, `bash --login -c`, `python3 -Ic`, `perl -we`, `perl -E` — clustered short options run the string exactly like `-c` | cluster-aware entry; `perl -E`/`php -R` kept case-sensitive so node's `-r` (runs a *file*) is not read as code |
| H-3 | `"rm" -rf`, `'rm' -rf`, `r\m -rf`, `git "push"`, `sudo "rm"`, `("rm" …)` — the shell's own quote removal defeats every `(^\|[\s;&\|])name` anchor | quotes stripped from the **command word only**, per segment, matched *in addition to* the raw string — strictly additive, can add an ask but never remove one |
| H-3 | `sudo -u root "rm"`, `env FOO=1 "rm"`, `timeout 5 "rm"` — normalization stopped at the wrapper's own operand | wrapper grammar: option values, `env` assignments, and required positional operands are walked through |
| — | `notify.json` was not in `SELF_PROTECTED` while `approvals.jsonl` was. It names the URL and headers every approval ping is POSTed to, so a quiet edit turns each prompt into an outbound ping to an attacker-chosen endpoint | protected at any path, like the ledger |
| — | CI `fail-fast` defaulted to `true`: on the released 0.4.0 tag one failing ubuntu leg cancelled the rest, so **neither Windows job ever ran the suite** — on a gate whose job is cross-platform path handling | `fail-fast: false`; tests also run on `dev` pushes |

### Closed in 0.4.2 (self-review of the 0.4.1 code, 2026-07-29)

Same method: reproduced against the shipped hook under an isolated `MARY_DIR`,
then proved monotone with a 248-case differential corpus (172 unchanged, 75 now
ask, 1 now defers — that one is the false positive at the end of this table).
Regression tests: `[H-3 follow-up …]` and `[registry gaps …]`.

The first two are the H-3 root cause reached by routes the command-word
normalizer did not walk. Each was confirmed twice — the gate returned `defer`,
**and** the shell was confirmed to execute the command word for real (verified
with `echo` in place of `rm`).

| # | Bypass | Fix |
|---|---|---|
| A-1 | `>/dev/null "rm" -rf /d`, `2>/dev/null "rm" …`, `<in.txt "rm" …`, `> out.txt "rm" …`, `sudo >/dev/null "rm" …` — a redirection may precede the command word, and `unquoteCommandWord` skipped a leading `(`/`{`/`!` run but not a redirection | redirections are walked through in leading position and between a wrapper and its nested command; a detached target (`> out.txt`) consumes the next word |
| A-2 | `$'rm' -rf /d`, `$"rm" …` — ANSI-C and locale quoting; `bareCommandName` unquoted to `$rm`, which failed its plain-name test | a `$` directly before an opening quote is dropped before the name test |
| B-1 | `git checkout -- .` / `git checkout .` / `-f`, `git restore .` — discards uncommitted work, which no reflog entry can restore. Only `reset --hard` and `clean` were registered | registered; `git restore --staged` without `--worktree` stays exempt because it only unstages |
| B-2 | `git stash clear`/`drop`, `git reflog expire`, `git gc --prune`, `git filter-branch`/`filter-repo`, `git tag -d`, `git update-ref -d`, `git worktree remove`, `git submodule deinit` — the recovery net itself | registered, anchored to command position |
| B-3 | `drop database`, `drop schema`, `drop index`, `drop view`; `FLUSHALL`/`FLUSHDB`; mongo `dropDatabase()`, `drop()`, `deleteMany({})` — only `drop table` was in the SQL pattern | pattern extended per store; the bare-object forms count only next to a DB client, because in free text they collide with English prose (`git commit -m "drop database support"`) |
| B-4 | `npm unpublish`/`deprecate`, `cargo publish`/`yank`, `gem push`, `twine upload`, `poetry publish`, `dotnet nuget push`, `mvn deploy` — only `npm publish` was registered | registered as deployment |
| B-5 | `gh api` with POST/PUT/PATCH (only DELETE was registered), `gh pr merge`/`close`, `gh release create`, `gh secret set` | registered |
| B-6 | `aws <service> delete-*`/`terminate-*` (only `aws s3 rm`/`rb` was registered), `gcloud … delete`, `az … delete`, `helm uninstall`, `docker … prune` | registered as deletion/deployment; for gcloud/az, `delete` in VALUE position (`az group show --name delete`) is not read as the verb |
| B-8 | `git switch -f`/`--force`/`--discard-changes` — discards local modifications like `checkout -f`, through the subcommand that replaced it | registered; a plain `git switch <branch>` refuses to lose changes and stays defer |
| B-7 | `mkfs`, `diskpart`/`fdisk`/`parted`, `Format-Volume`/`Clear-Disk`, Windows `rd /s /q` (`rmdir` was registered, its alias was not) | registered as overwrite/deletion |
| D-1 | **false positive**: `./deploy.sh -c config.yml` asked as `gate bypass` — `\b` matched the `sh` at the end of a *filename*, while `bash deploy.sh` (the same script, actually run) deferred, so the ask protected nothing | the shell name must be in command position; an optional path prefix keeps `/bin/sh -c` matching |

New `git` entries anchor to command position (`GIT_CMD`), so a dangerous
subcommand quoted inside argument text (`echo "git restore ."`) stays `defer`.
The pre-existing `echo "git push"` false positive was closed in 0.4.4 (below).

### Closed in 0.4.4 (independent adversarial review of the 0.4.3 release, 2026-07-29)

A second-perspective critique attacked the 0.4.3 delta; every finding was
reproduced by execution before being fixed, and the fd-duplication route was
confirmed to run for real (`2>&1 "echo" ran-anyway` prints). The review's
sharpest observation was about the snapshot itself: **a regenerated snapshot
pins the gate's actual output, so wherever the gate already disagreed with the
corpus's section intent, "267/267 green" was agreement with the bug** — the
`2>&1` bypass sat pinned as `defer` inside the very section that existed to
prove redirections fixed. The corpus section headers now carry their intent
("must ask" / "must stay defer") and `decisions.test.js` fails — in `--update`
mode too — when a pin contradicts the block it sits in. That audit immediately
caught five more misplaced or contradictory pins beyond the review's findings.

| # | Bypass | Fix |
|---|---|---|
| A-3 | `2>&1 "rm" -rf /d`, `1>&2 "rm" …`, `>&2 "rm" …` — `commandParts` split on the unquoted `&` of a redirection, so the segment's command word became `1` and the A-1 walker never saw the token | the splitter reads `>&`/`<&`/`&>`/`&>>` as redirection text, not separators; a lone background `&` still separates |
| B-9 | `git checkout main -f` / `--force` (flag after the ref — the same commit fixed exactly this shape for `switch` and missed `checkout`) and `git checkout ./subdir` / `.github/…` (dot-leading arguments are pathspecs; a ref cannot begin with a dot) — all discard uncommitted work | flags accepted after arguments; dot-leading arguments read as pathspecs |
| B-10 | `aws --profile prod rds delete-…` (a global flag consumed the service slot and the verb never matched), `gh api …/issues -f title=x` (gh switches to POST the moment a field flag appears — no `-X` spelling required), `GIT tag -d` (the one new entry without `/i`) | named value-taking aws globals are walked (unknown globals still err toward defer); field flags without an explicit GET register as a write; `/i` added — unlike `branch -D`, tag deletion has no case distinction to preserve |
| D-2 | **false positives** of exactly the cry-wolf class 0.4.3 claimed closed: `echo "please truncate the file"` (pre-existing, then *pinned into the snapshot as correct*), `git commit -m "add FLUSHALL guard"` (newly shipped), `echo "git push"` (known since 0.4.2) | these matches now run against a string whose quoted spans are replaced by an inert placeholder word — a quoted command word is already unquoted into the normalized string, so `"truncate" -s 0 f` still asks; a placeholder rather than deletion, because erasing `-C "/repo"`'s value made the option pattern consume `push` as the value |

Workflow-side findings from the same review (receipt-continuity warning fired
only when zero checks were EVER re-run; the identity key erased comparison
operators and normalized non-Korean CJK to the empty string; the published
measurement was cited with two different value sets) are in the CHANGELOG —
they are auditor defects, not gate bypasses.

### Open, by construction

- **The regex layer is a router, not a classifier.** A command shape nobody
  registered defers. The gate reduces the attack surface to "invent a genuinely
  novel shape"; it does not close it. Novel shapes found in use belong in this
  file and in the pattern table, in that order.
- **Segmentation is quote-naive.** `splitSegments` — the split the `git push`
  judgment runs on — does not parse shell quoting. Splitting inside a quoted
  string can only create *extra* segments, which errs toward asking, never toward
  passing. (`commandParts`, the split used for command-word normalization, **is**
  quote-aware, so a quoted `|`, `&&`, or `;` that is only argument text does not
  split there.)
- **Denials are usually not observable.** The hook reference describes
  `PermissionDenied` as firing when the *auto mode classifier* denies a call. In
  every ledger observed so far a manual denial has produced no closing record:
  macOS 2026-07-26 (9 asked / 0 denied) and Windows 2026-07-24 → 07-29
  (171 asked / 0 denied across 999 records). A denied action is therefore
  reported as `unknown` until a human closes it. Mitigated, not fixed, in 0.4.2:
  `mary-reconcile --outcome denied` records the refusal as a refusal instead of
  as a lost outcome, and the session-start report says that some unknowns may be
  refusals rather than actions to chase down. The hook still cannot tell the two
  apart on its own.
- **A ledger file outlives the code that wrote it.** The gate records only gated
  calls, but an earlier implementation recorded every call. On the author's own
  ledger, 659 of 999 records are closing events for calls that were never asked
  about — all written on 2026-07-24/25, before that guard existed. Current
  behaviour is correct; the file on disk is still 66 % general tool log. Nothing
  deletes it, because the ledger is append-only by design. Read counts from a
  long-lived ledger with the writing date in mind.
- **Secret masking has never fired in real use.** Across 171 `asked` records, no
  entry carries `redacted: true`. That is consistent with no secret ever having
  been in a gated command, but it means the masking patterns are exercised only
  by unit tests, never by real traffic.
- **Relative self-protection depends on `cwd`.** A relative mention of
  `scripts/hooks/` is protected only when the call's working directory is inside
  the plugin root. A payload with no `cwd` (not observed from Claude Code, which
  always sends it) would skip that branch; absolute mentions and the generic
  entries (settings, managed-settings, ledger) are protected regardless.
- **Stored request minimization.** Non-content strings are masked for known secret
  shapes. Write/Edit/Notebook content fields are never retained; byte counts and
  SHA-256 digests replace them. Unknown secrets may still appear in command strings
  or other non-content metadata. The request hash is over raw input, so masking and
  compaction do not break approval→outcome matching.

### The ledger under each install tier (C4)

The **managed install** makes the *code* root-owned/read-only, so the agent cannot
edit the gate out from under the user. It does **not** protect
`~/.claude/mary/approvals.jsonl` — the hooks run as the user and must append to
it, so it stays user-writable by necessity. Consequences, stated plainly:

- In managed installs, a compromised agent can still *attempt* to append forged
  lines — but every write path we know of (`>`/`tee`/`sed -i` redirection,
  interpreter one-liners) is gated, so the attempt surfaces as an approval dialog.
- A human (or any non-hook process) can edit the ledger silently. The ledger is
  therefore **evidence of what the hooks observed, not a tamper-proof audit log.**

## 6. What the ledger can and cannot prove

Can prove (assuming the relevant hooks were installed and running — outcome and
`unknown` rows require the full tier):

- that a matching gate dialog was **presented** (`asked` plus a masked copy of its reason),
- that the host later reported the call **succeeded / failed / was denied**
  (closing record bound by `tool_use_id`, with strict legacy fallback),
- that an approval **never got an outcome** (`unknown` — surfaced every session).

Cannot prove:

- that the human **read** what they approved,
- that a record was not edited by something with file access outside the hook path
  (see C4 above),
- **that the state approved is the state executed.** The gate hashes the *request
  text*. It does not re-derive the world (`HEAD` SHA, file contents, target set)
  at execution time and compare it against what the approval was granted for.
  SKILL stage 4-5 step 3 requires that re-check *procedurally*; the hooks do not
  yet enforce it. Closing that gap — execution-time re-derivation, hash
  comparison, single-use approvals, stale-approval refusal with both hashes
  recorded — is the planned direction for the next architecture revision, and the
  same revision moves verification receipts from "model-written" toward
  "hook-captured". Until then, receipts are model-authored claims that the
  auditor checks for **shape and binding** (fields present, `pass` booleans,
  `task_id` match), not for truth.

## 7. What fail-closed means in this project

Malformed or unjudgeable input routed to the gate ends in `ask`; no parser or
internal-error path silently approves it. A routed call that is successfully judged
to have no registered risk emits no hook decision, so the host's normal permission
flow remains authoritative. A tool outside the matcher never invokes Mary at all.
These are three distinct states and must remain distinct in code, tests, and docs.
