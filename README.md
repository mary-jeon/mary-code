# Mary

> **Rv.0 / plugin 0.4.5 · Experimental · Claude Code**
>
> **English** (canonical) · [한국어](./README.ko.md)

**AI sounds convincing even when it is wrong.**

Mary is a task harness that keeps an AI's uncertain output inside a safer operating loop: reversible execution, observable verification, explicit approval for irreversible actions, and records that survive across sessions.

Mary does not change the model. It changes how work is framed, executed, checked, and recorded so that one plausible-but-wrong judgment is less likely to become the bottleneck for an entire task.

## What is in Rv.0

Rv.0 is Mary's public line as a Claude Code plugin: a workflow skill plus an execution layer that enforces part of the workflow with hooks. Since 0.4.5 the plugin is **gate-first**: the only hook it registers by default is the `PreToolUse` irreversible-action gate — quiet prevention on every call, with observability as an explicit choice (see "Hook tiers").

- A `PreToolUse` gate asks for permission before recognized irreversible shell actions run. **This is the only hook the plugin registers by default** — see "Hook tiers" below.
- Full tier only: `PostToolUse` and `PostToolUseFailure` hooks connect an approval request to the observed execution result.
- Full tier only: a `PermissionDenied` hook closes an approval as `denied` when the host reports the denial.
- Full tier only: a `SessionStart` hook reports approvals whose result was never recorded as `unknown`; they are never treated as failed or automatically retried.
- An append-only approval ledger stores a secret-masked reason, compact request metadata, the host `tool_use_id`, a raw-input request hash for integrity/legacy fallback, and the observed result. Write/Edit/Notebook bodies and tool response bodies are never stored.
- A bundled read-only `mary-critic` agent gives the adversarial-review stage a fixed, tool-restricted reviewer profile.
- A `mary-stats.js` auditor recomputes failure counters and rule-promotion candidates deterministically, instead of trusting the model's arithmetic.
- Multiple active tasks use separate `_work-<slug>.md` files while sharing one `RULES.md` and one `FAILLOG.md`.

The next major feature is a decision-retrace engine. When a premise is invalidated, it will reopen only the decisions that depended on that premise instead of restarting the entire task. The specification exists, but the engine is not implemented yet.

## How Mary works

Mary runs applicable work through six numbered stages. Stage 4 includes the approval and execution point for irreversible actions.

```text
0. Risk check       List irreversible actions; separate verifiable claims from judgment
1. Specification    Define the goal, completion conditions, exclusions, and checks
2. Alternatives     Compare distinct approaches and record how each could fail
3. Safe execution   Produce reversible work first; hold irreversible actions
4. Verification     Verify → challenge → fix → re-verify
   4.5 Execution    Show target and scope → approve → re-check state → execute → observe
5. Learning log     Record outcomes and raise repeated failures as rule candidates
```

Mary distinguishes two kinds of conclusions:

- **Verifiable claims** must be checked with observable evidence such as execution, tests, measurements, diffs, primary sources, or confirmation from an authorized reviewer.
- **Judgment domains** such as design, strategy, and preference are not presented as objectively verified. Mary states the recommendation, its key premise, what would overturn it, and who owns the remaining value decision.

A critique from another LLM is a separate perspective, not independent verification. Evidence must be inspectable outside the model's own claims. Mary also checks separately whether evidence exists and whether it actually supports the current claim.

The canonical failure keys and stage mappings are documented in [`skills/mary/LAYERS.md`](./skills/mary/LAYERS.md).

## When to use it

After installation, invoke the plugin skill directly in Claude Code:

```text
/mary
```

A direct invocation runs the full procedure regardless of task size.

Mary can also activate automatically when the request is:

- irreversible or difficult to undo, such as deletion, overwrite, external sending, deployment, or a business-system write;
- multi-step, where an early judgment affects later results; or
- fact-dependent, where statutes, figures, specifications, or other factual claims determine the outcome.

Automatic activation depends on model judgment and can be missed. Use `/mary` when you need the workflow with certainty.

Mary is not intended for simple one-shot questions, explanations, translations, or lookups. Applying a heavy procedure to every request would make the harness easier to bypass and harder to use.

### Task grades

| Grade | Applies to | Handling |
|---|---|---|
| **Standard** | Reversible, lower-impact work | Claude proceeds autonomously and performs the necessary verification. Automatic activation may compress exploration and presentation, but not verification or approval gates. |
| **Guarded** | Irreversible actions; legal, employment, tax, or high-cost work; hard-to-reverse design decisions | Verifiable claims require observable evidence. Important judgments and irreversible actions require user confirmation. |

Guarded work does not reduce exploration. It raises the evidence and approval required before a decision is finalized.

## Installation

Mary requires:

- a recent version of **Claude Code** with skills-directory plugin support; and
- **Node.js**, because the hook scripts run with `node`.

### From the marketplace (recommended)

Inside Claude Code:

```text
/plugin marketplace add mary-jeon/mary-code
/plugin install mary@mary-code
```

Then restart Claude Code. This installs the plugin as `mary@mary-code`; updates arrive through the `/plugin` menu.

### Manual install — macOS / Linux

```bash
git clone https://github.com/mary-jeon/mary-code.git ~/.claude/skills/mary
claude plugin validate --strict ~/.claude/skills/mary
```

### Manual install — Windows PowerShell

```powershell
git clone https://github.com/mary-jeon/mary-code.git "$HOME\.claude\skills\mary"
claude plugin validate --strict "$HOME\.claude\skills\mary"
```

A folder under `~/.claude/skills/` that contains `.claude-plugin/plugin.json` loads on the next session as a skills-directory plugin. Mary appears as `mary@skills-dir` and its skill is namespaced as `/mary:mary` (invokable as `/mary` when unambiguous).

If you use **Code → Download ZIP** instead of Git, extract the complete repository and rename the extracted folder to `mary` so that this file exists:

```text
~/.claude/skills/mary/.claude-plugin/plugin.json
```

Restart Claude Code after the first installation. After an update, restart or run `/reload-plugins` so changes to hooks and other plugin components are loaded.

### Updating

macOS / Linux:

```bash
git -C ~/.claude/skills/mary pull --ff-only
```

Windows PowerShell:

```powershell
git -C "$HOME\.claude\skills\mary" pull --ff-only
```

Then restart Claude Code or run `/reload-plugins`.

## What the irreversible-action gate actually enforces

Mary has two protection layers, and they are not the same thing:

| Layer | Role |
|---|---|
| **Workflow rule** | The skill instructs Claude to hold every irreversible action until the target, scope, rollback path, and user approval are clear. |
| **Hook gate** | The `PreToolUse` hook independently asks before the specific actions it can recognize in registered tool calls. |

The gate's job is **routing to a human, not classification.** No pattern set reads full shell semantics, so the goal is not "recognize every dangerous command" — it is impossible. The goal is: route recognized risk, and everything the gate cannot judge, to the person; and never let a pattern produce an automatic allow. The actual defense line is the human approval button, which no encoding trick can pattern-match its way past — the patterns only decide when a human has to look.

The gate hook is registered for `Bash`, `Write`, `Edit`, `MultiEdit`, and `NotebookEdit`. It asks for permission when it recognizes:

- file deletion, including non-recursive and path-prefixed forms (`rm`, `/bin/rm`, `del`, `Remove-Item`, `Clear-Content`, `find -delete`, `shred`);
- `git push` (with global options such as `-C` and quoted values such as `-c core.pager="less -n"` tolerated). The `--dry-run` exemption is **parsed, not string-matched**: it counts only when the flag is a real argument of that `push`, in that command segment — a commented-out flag, a `-n` that is the value of `--push-option`, or one borrowed from a config value does not buy it. Also destructive Git reset/clean operations, forced branch deletion, and `--no-verify` bypasses;
- discarding uncommitted work and destroying the recovery net: `git checkout -- .` / `git checkout .` / `-f`, `git restore` (except `--staged` without `--worktree`, which only unstages), `git switch -f`/`--discard-changes`, `git stash clear`/`drop`, `git reflog expire`, `git gc --prune`, `git filter-branch`/`filter-repo`, `git tag -d`, `git update-ref -d`, `git worktree remove`, `git submodule deinit`;
- GitHub through `gh`: repository, release, gist, or secret deletion; `gh api` with DELETE, POST, PUT, or PATCH; `gh pr merge`/`close`; `gh release create`; `gh secret set`;
- destructive SQL and its equivalents in non-SQL stores (`drop table`/`database`/`schema`/`index`/`view`, `delete from`, `truncate`, `FLUSHALL`/`FLUSHDB`, mongo `dropDatabase()` / `drop()` / `deleteMany({})`) — the bare-object forms only next to a DB client, so a commit message saying "drop database support" does not trip the gate;
- disk overwrite and truncation commands, including whole-volume destruction (`mkfs`, `diskpart`/`fdisk`/`parted`, `Format-Volume`, `Clear-Disk`) and Windows `rd /s /q`;
- HTTP commands that send data, including upload forms (`-F`/`--form`, `-T`/`--upload-file`, `--json`, `--data-*`);
- remote sync and cloud deletion (`rsync --delete`, `scp`/`rsync` to `user@host:` targets, `aws s3 rm`/`rb`/`sync --delete`, `aws <service> delete-*`/`terminate-*`, `gcloud … delete`, `az … delete`, `helm uninstall`, `docker … prune`);
- package publication and withdrawal — `npm publish`/`unpublish`/`deprecate`, `cargo publish`/`yank`, `gem push`, `twine upload`, `poetry publish`, `dotnet nuget push`, `mvn deploy` — and selected deployment commands. Taking a published version back is not a rollback: the name stays reserved and downstream lockfiles break immediately;
- shell-wrapper and encoding invocations that would launder a command past pattern inspection (`bash -c`, interpreter one-liners such as `python -c` / `node -e`, `powershell -EncodedCommand`, `ssh host <command>`, piping a download into a shell, `eval`) — the wrapped content cannot be judged, so the wrapping itself is treated as "cannot judge → ask". **Clustered short options count**: `bash -lc`, `sh -ec`, `python3 -Ic`, `perl -we` run the string exactly like `-c` does. `perl -E` and `php -R` are a separate case-sensitive entry, so that node's `-r` (module preload, which runs a *file*) is not read as code; or
- edits to Mary's own settings, manifest, hook registration, hook scripts, the approval ledger (`approvals.jsonl`), or the notifier configuration (`notify.json`, which names the URL and headers every approval ping is POSTed to) — by path for the Write-family tools, and for Bash when a protected path appears together with a write indicator such as redirection, `sed -i`, `tee`, `cp`/`mv`, `ln`, or a PowerShell write cmdlet. A ledger that can be edited quietly stops being evidence.

Because every pattern above anchors on a word boundary (`(^|[\s;&|])name`), the shell's own quote removal would otherwise defeat it — `"rm" -rf`, `'rm'`, `r\m`, `git "push"`, `$'rm'` all execute while containing no bare word to match. Quotes are therefore stripped from the **command word only**, per segment, walking wrapper grammar (`sudo -u root "rm"`, `env FOO=1 "rm"`, `timeout 5 "rm"`) and redirections, which may sit in front of the command word (`>/dev/null "rm" -rf`) or between a wrapper and its command (`sudo >/dev/null "rm"`). The normalized string is matched *in addition to* the raw one. Argument quoting is left exactly as written, which is what keeps `echo "rm -rf /"` and `git commit -m "rm -rf fix"` at `defer`.

Self-protection is **anchored**: plugin-relative paths (`scripts/`, `hooks/hooks.json`, `.claude-plugin/plugin.json`) are protected only under the plugin's actual install root — the same names in unrelated repositories do not trigger the gate. Host-level enforcement files (`.claude/settings*.json`, `managed-settings.json`) and the ledger are protected at any path. A gate that cries wolf trains the user to approve without reading, which defeats the gate.

The Bash self-protection check is a heuristic. No string-level inspection reads full shell semantics; it exists to make an obvious bypass visible, not to make one impossible. The known bypass surfaces — the ones demonstrated and since closed, and the ones open by construction — are published in [`docs/threat-model.md`](docs/threat-model.md).

For recognized actions, the hook returns Claude Code's native `ask` decision. It does not silently approve the action and does not reuse a previous approval.

For unrecognized commands and ordinary file writes, the hook emits **no decision**: it exits successfully with empty output, leaving Claude Code's normal permission system authoritative. No decision does **not** mean the hook verified the action as safe.

The gate is fail-closed for malformed hook input: empty input, invalid JSON, a missing tool name, or an unreadable Bash command produces `ask` rather than approval. This is not a universal deny-by-default policy. **The one surface the gate never sees**: tools outside the registered matcher (MCP tools, the Agent tool, any future host tool) are never routed to the hook at all, so no fail-closed path exists for them. Semantic risks that do not match the implemented patterns produce no hook decision and remain subject to the host's normal permission flow.

When the gate asks, it may append two best-effort context warnings to the text the user approves:

- **Cross-session visibility.** Unresolved approvals from *other sessions* that target the same working directory are surfaced, because their unknown outcomes mean the state the user just reviewed may have changed. This is exactly why the ledger is shared rather than split per session — isolation would hide the collision; sharing makes it visible. (Matching is by cwd string; two clones of the same remote in different folders are not detected.)
- **Lethal-trifecta signal.** `mary-trifecta-sentinel.js` (a `PostToolUse` observer on `WebFetch`, `WebSearch`, and fetch-shaped Bash commands — PostToolUse so a *denied* fetch, which ingested nothing, never poisons the signal) records when a session ingests untrusted external content. If the same session later asks approval for an *external send* — or for a wrapped/encoded command the gate cannot read, which may be one — the gate adds a trifecta warning. Two of the three legs are observable; private-data access, the third, is not reliably detectable from tool calls — claiming otherwise would be false confidence, so it is not claimed.

Both warnings are visibility only: they never change the decision, never block, and never auto-deny. The trifecta warning depends on the sentinel being registered, which is a **full-tier** installation (see next section) — under the default gate tier the marker is never written and the warning never appears.

### Hook tiers — prevention by default, observability by choice

Only one of Mary's five hook scripts prevents anything: the `PreToolUse` gate. The other four — outcome recorder, trifecta sentinel, approval notifier, session report — observe, record, and report; none of them blocks or decides. They are valuable, and they have a price: every registered hook is a separate `node` process on the hot path of every matching tool call. The full set costs 2–3 processes per `Bash`/`Write`/`Edit` call, which is visible latency in every session on every project, whether or not Mary's workflow is in use.

So registration is tiered:

| Tier | Registers | Cost per gated call | What you give up |
|---|---|---|---|
| **gate** (default) | `PreToolUse` gate only | 1 process | Approval→outcome binding, `unknown` reports at session start, trifecta warnings, approval pings. The ledger still records every `asked` event; outcomes are simply never observed, and `mary-reconcile` still works for closing them by hand. |
| **full** | Gate + recorder + sentinel + notifier + session report | 2–3 processes | Nothing — this is the complete observability contract described in this README. |

The plugin's own `hooks/hooks.json` registers the gate tier. The full tier is selected at managed installation (`install-managed.ps1 -Tier full` / `install-managed.sh --tier full`), or by registering the four observability hooks yourself in user settings. Sections below that describe outcome recording, `unknown` reporting, trifecta warnings, or pings describe **full-tier** behavior.

Choose full when the approval ledger must be able to answer "did it actually run?" across crashed sessions — for example unattended or long-running work — and gate when the priority is a quiet, always-on approval checkpoint. What is *not* offered is a tier that pre-filters which commands reach the gate (for example a permission-rule `if` on the hook): the gate's parsing exists precisely because command-string globs are bypassable, and a filter in front of it would reopen that class.

### Approval ledger and `unknown` results

When the gate asks, Mary appends an `asked` event to `~/.claude/mary/approvals.jsonl`. The record keeps:

- the secret-masked explanation shown to the user;
- a compact request record: paths and non-content metadata, while Write/Edit/Notebook bodies are replaced by byte counts and SHA-256 digests;
- the host `tool_use_id`, with a normalized request hash retained for integrity and legacy fallback; and
- the later result, when one is observed: `succeeded`, `failed`, `denied`, or `reconciled` — the last written by `scripts/mary-reconcile.js` when a human observed the real side effects afterwards and attached evidence.

The stored explanation and non-content strings are **secret-masked**. Content-bearing fields such as Write content and Edit old/new strings are not stored at all; only size and digest remain. The hash is computed over the raw input, so compaction and masking do not break approval→outcome matching. The dialog the human sees remains the original text.

The result recorder only writes when a matching open `asked` entry exists. Tool calls that never passed the gate are not logged, so the ledger stays an approval record rather than a growing plaintext log of every command output.

If no matching result arrives, the approval remains open. At the next session start Mary reports it as `unknown`—not failed—and instructs Claude to inspect the real side effect before considering any retry. This reduces duplicate effects from retrying an operation that may already have succeeded. A user denial is closed as `denied` only when the host emits the `PermissionDenied` event; if it does not, the denial also remains `unknown`.

`unknown` never resolves by itself. Once the side effects have actually been observed, close the entry:

```
node scripts/mary-reconcile.js --list
node scripts/mary-reconcile.js <request_hash> --outcome ran|not-run|denied|superseded --evidence "<what was observed>"
```

Evidence is mandatory (a closure without observation is the phantom-execution failure the ledger exists to prevent), the ledger stays append-only, one asked instance closes per invocation, and a hash that was never asked cannot be closed. `reconciled` grants nothing — it only stops a resolved unknown from being re-reported every session.

Invoking `mary-reconcile` through Bash is **itself a gated action**: the approval dialog shows the hash, outcome, and evidence to a person before the closure is written. The CLI cannot know who typed it, so the record's `by` field says `reconcile-cli` — the human binding is the gate, not a self-reported label. Outcome matching is also session-aware: a result observed in one session never closes another session's still-unknown approval for the same command, and a stray surplus closure is dropped rather than banked against the next time that command is asked.

### Remote notification, not remote approval

`mary-approval-notifier.js` (a `Notification` hook on the `permission_prompt` matcher, registered in the full tier) can POST a short ping to a webhook configured in `~/.claude/mary/notify.json` — for example an [ntfy.sh](https://ntfy.sh) topic your phone subscribes to — so a waiting approval no longer requires sitting at the terminal to notice it:

```json
{ "url": "https://ntfy.sh/your-private-topic", "headers": { "Title": "mary" } }
```

The ping deliberately contains **no command text, no paths, and no project identifiers** — only "approval waiting", the tool name, and a timestamp. URLs may not contain credentials, query strings, or fragments, and only the bounded printable `Title`, `Priority`, and `Tags` headers are accepted. The URL must be `https`; plaintext `http` needs an explicit `"allowHttp": true` for a trusted LAN/self-hosted endpoint. Configuration is cached after its first valid load, and each request has a five-second wall-clock deadline.

The *answer* still happens at the terminal. The host's permission prompt has no remote answer channel, and replacing the physically present human's button with a remote channel would swap the gate's final defense line for that channel's authentication strength. If a channel with device-bound authentication and ledger binding exists someday, revisit this deliberately — not as a side effect of wanting convenience.

## Enforcement boundary — read this before trusting the gate

A normal skills-directory installation is **not a trust boundary**.

The agent may be able to edit files under `~/.claude/skills/mary/`, change user or project settings, or disable hooks. Self-protection makes an obvious edit to Mary's enforcement files visible, but it cannot make user-writable files tamper-proof. Treat the default installation as a useful approval checkpoint, not as administrator-enforced isolation.

A hardened deployment requires both:

1. plugin files and their distribution source to be controlled by an administrator and inaccessible to the agent; and
2. the exact managed plugin ID to be force-enabled in Claude Code managed settings, optionally with `allowManagedHooksOnly`.

Example shape for an administrator-managed marketplace deployment:

```json
{
  "enabledPlugins": {
    "mary@your-managed-marketplace": true
  },
  "allowManagedHooksOnly": true
}
```

Do **not** substitute `mary@skills-dir` and assume that the user-writable checkout has become hardened.

A one-command managed deployment ships with the repo:

```
# Windows — elevated PowerShell
powershell -ExecutionPolicy Bypass -File scripts\install-managed.ps1 [-Tier gate|full] [-AllowManagedHooksOnly]

# macOS / Linux
sudo sh scripts/install-managed.sh [--tier gate|full] [--allow-managed-hooks-only]
```

Both copy the hook scripts to an administrator-owned folder **and** register them with absolute paths in `managed-settings.json` — a managed registration pointing at user-writable scripts would be hollow. Existing managed settings are validated **before** anything is copied and backed up before being touched; an existing `hooks` section is never replaced without an explicit force flag; re-runs replace the deployed scripts folder instead of nesting into it; and the written file is parse-checked (written without a BOM — a BOM can make a strict JSON parser reject the file and silently turn the deployment into a no-op).

Without `allowManagedHooksOnly`, a plugin install of Mary registers the same hooks a second time: ledger events double up and pings send twice. Either pass the flag or disable the user-space plugin's hooks.

Managed settings locations are:

- Windows: `C:\Program Files\ClaudeCode\managed-settings.json`
- Linux and WSL: `/etc/claude-code/managed-settings.json`
- macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`

`allowManagedHooksOnly` blocks user, project, and other non-managed plugin hooks. Enable it only after considering every hook your environment requires.

The managed install protects the **code**, not the **ledger**: `~/.claude/mary/approvals.jsonl` must stay writable by the user account the hooks run as, so it remains editable by anything with the user's file access. Every ledger write path the gate recognizes (redirection, `tee`, `sed -i`, interpreter one-liners) is gated, so an agent's forgery *attempt* surfaces as an approval dialog — but the ledger is evidence of what the hooks observed, not a tamper-proof audit log. This boundary is spelled out in [`docs/threat-model.md`](docs/threat-model.md).

Even a properly managed installation covers only the hook events, tool names, and action patterns that Mary observes. Deciding whether a task is multi-step or whether a factual judgment controls the outcome remains a semantic decision that no pattern-only dispatcher can fully enforce.

For Claude Code's current plugin and managed-settings behavior, see the official [plugin documentation](https://code.claude.com/docs/en/plugins), [plugin reference](https://code.claude.com/docs/en/plugins-reference), and [configuration reference](https://code.claude.com/docs/en/configuration).

## State and record files

Mary keeps runtime state outside the repository in `~/.claude/mary/`. Files are created as needed.

| File | Role |
|---|---|
| `RULES.md` | Approved standing rules and previously confirmed facts. There is one shared file. |
| `FAILLOG.md` | Observed failures, rejected counterexamples, counters, task IDs, and rule-promotion status. There is one shared file. |
| `_work-<slug>.md` | One active task record per workstream. Multiple files may exist at the same time. Completed task files are removed; paused, blocked, failed, or abandoned records remain. |
| `approvals.jsonl` | Append-only approval and execution-result ledger written by the hooks. |
| `notify.json` | Optional. Webhook for the "approval waiting" ping (`mary-approval-notifier.js`). Absent → no traffic. |
| `_trifecta-<session>.json` | Per-session marker: this session ingested untrusted external content. Written by the sentinel, read by the gate, auto-removed after 7 days. (The one place session-scoped state is the right shape — ingestion is a session property; tasks and the ledger span sessions.) |

These files stay on the user's computer and are not pushed to this repository.

## How Mary learns from failures

Mary does not discard a failure when a task ends.

1. It records the failure, evidence, canonical key, scope, and stable `task_id` in `FAILLOG.md`.
2. It counts a task exactly once, even if the same task spans several sessions or changes terminal state.
3. When the same failure key is reproduced in two different task IDs, it becomes a rule candidate.
4. Mary shows the proposed one-line rule and its two supporting cases.
5. Only a rule the user approves is added to `RULES.md`.
6. A bad standing rule can later be revised or removed.

Rejected counterexamples are stored separately and never count toward promotion. Promotion scope is limited to the scopes actually observed; it is not silently generalized to all work.

> `FAILLOG.md` describes failures observed while Mary was active. It is not a complete estimate of every failure the model produced.

## Repository structure

The plugin components must stay together.

| File | Role |
|---|---|
| `.claude-plugin/plugin.json` | Plugin identity, version, component paths, and metadata |
| `skills/mary/SKILL.md` | Mary's executable task procedure |
| `skills/mary/LAYERS.md` | Canonical failure keys and aliases |
| `agents/mary-critic.md` | Read-only adversarial reviewer used by stage 4-2 |
| `scripts/mary-stats.js` | Read-only auditor that recomputes counters and promotion candidates |
| `hooks/hooks.json` | Registers the `PreToolUse` gate (the default gate tier; the observability hooks are registered by the full-tier managed install) |
| `scripts/hooks/mary-irreversible-gate.js` | Recognizes gated actions, returns `ask` for them, and emits no decision for non-matches; adds cross-session and trifecta context warnings |
| `scripts/hooks/mary-outcome-recorder.js` | Records the observed result for a matching approval |
| `scripts/hooks/mary-session-report.js` | Reports unresolved approvals as `unknown` at session start |
| `scripts/hooks/mary-trifecta-sentinel.js` | Records per-session ingestion of untrusted external content (never blocks, never decides) |
| `scripts/hooks/mary-approval-notifier.js` | Optional webhook ping when a permission prompt appears (no command content) |
| `scripts/hooks/lib/ledger.js` | Normalizes requests and maintains the append-only ledger |
| `scripts/mary-reconcile.js` | Closes an open approval after human observation of the real side effects |
| `scripts/install-managed.ps1` / `install-managed.sh` | One-command administrator (managed-settings) deployment |
| `tests/gate.test.js` | Regression tests for the gate, ledger, result binding, and session report |
| `tests/stats.test.js` | Regression tests for the counter auditor and promotion-candidate logic |
| `docs/threat-model.md` | What is enforced, known bypasses (closed and open), what the ledger can and cannot prove |
| `CHANGELOG.md` | Release history |
| `.github/workflows/test.yml` | CI — both test suites on Node 20/22, Linux and Windows |

## Design principles

- **Think freely, commit strictly.** Exploration stays open; consequential conclusions require evidence.
- **Keep reversible work autonomous.** Escalate ambiguity, high impact, and hard-to-reverse decisions—not every ordinary step.
- **Separate fact from judgment.** Verify facts; expose the premises and reversal conditions behind judgment.
- **Treat model critique as perspective, not proof.** Independent evidence comes from execution, tests, measurements, primary sources, and authorized reviewers.
- **Observe effects before reporting success.** A missing result is `unknown`, not automatically failure.
- **Sessions are disposable; files are assets.** Work state and failure history survive session boundaries.
- **Let bad rules come back down.** A promoted rule is not permanent truth.

## Current limitations

- Automatic activation can be missed or applied unnecessarily.
- The workflow asks Claude to draft the specification first, which can anchor the user to the model's initial framing.
- A mechanism that confirms the user's key conditions before Claude recommends an option in Guarded work is not implemented yet.
- The decision-retrace engine is specified but not implemented.
- The hook recognizes a defined set of tools and patterns; it does not mediate every possible tool, command, external send, or business-system write.
- The Bash self-protection check pairs a protected-path mention with a write indicator. It is a visibility heuristic, not a parser; a sufficiently indirect shell command can still avoid it.
- Whether the host emits `PermissionDenied` for a manual user denial is not fully documented; the hook reference describes the event as firing "when a tool call is denied by the auto mode classifier". **Observed so far — macOS build 2026-07-26 (9 asked / 0 denied), and a Windows ledger spanning 2026-07-24 → 07-29 (171 asked / 0 denied over 999 records): the event has never been emitted** — manual denials stayed `unknown`. A denial that is never observed stays open and is reported as `unknown` at the next session start. Since 0.4.2, `mary-reconcile.js --outcome denied` records that as a refusal rather than as a lost outcome, and the session-start report warns that some unknowns may be refusals rather than actions to chase down. The hook still cannot tell the two apart on its own.
- Cross-session warnings match by working-directory string. Two clones of the same remote in different folders are shared external state the gate cannot see.
- The trifecta sentinel observes two legs (untrusted input, external send). Private-data access, the third, is not reliably detectable from tool calls and is deliberately not claimed.
- A separate LLM reviewer may share the generator's biases. It is not a substitute for observable evidence.

## Development status

**Current version: Rv.0 / plugin 0.4.5 · Experimental** — release history in [`CHANGELOG.md`](CHANGELOG.md)

Working now:

- six-stage task procedure;
- Standard and Guarded task grades;
- evidence verification → counterexample → fix → re-verification;
- automatic matching to the user's language;
- multiple concurrent `_work-<slug>.md` records;
- failure logging, counters, and user-approved rule promotion;
- recognized irreversible-action gating through `PreToolUse`, including shell-wrapper and encoding laundering patterns;
- approval-to-result binding through `PostToolUse`, `PostToolUseFailure`, and `PermissionDenied`;
- gated-calls-only ledger recording, with no tool response bodies stored;
- unresolved approval reporting through `SessionStart`, and `reconciled` closure after human observation;
- cross-session and lethal-trifecta context warnings in the approval text;
- verification-receipt auditing in `mary-stats.js`, including round-over-round continuity — what share of a round's checks were re-run later, a check that passed and then failed, and rounds that share no check at all;
- a rotating counterexample axis (specification · state and structure · boundary and regression · operation), so repeated rounds stop re-finding the same layer of defects;
- a stagnation stop: two consecutive rounds that close no completion condition are reported to the user rather than looped on;
- an optional "approval waiting" webhook ping (`Notification` hook, no command content);
- one-command managed (administrator) deployment scripts;
- a bundled read-only critic agent and a deterministic counter auditor;
- a published threat model ([`docs/threat-model.md`](docs/threat-model.md)) covering demonstrated-and-closed bypasses and the surfaces open by construction;
- secret masking on stored ledger copies, plugin-root-anchored self-protection, a parsed (not string-matched) `--dry-run` exemption, and command-word quote normalization;
- continuous integration (GitHub Actions, Node 20/22 on Linux and Windows, every matrix leg run to completion); and
- 305 regression checks across the gate, ledger, reconcile CLI, sentinel, notifier, auditor, and session reporting — including a negatives group asserting that the reading and switching forms (`git checkout main`, `git restore --staged`, `git gc`, `psql -c "select 1"`, `gh api -X GET`, `gcloud … list`) must *not* ask; and
- a 287-command decision snapshot (`tests/decisions.test.js`): every pinned judgment — `ask` with its category, or `defer` — fails CI if it moves in either direction, so a weakened decision can only ship through a deliberate snapshot regeneration whose diff shows exactly what moved; and a pin that contradicts its corpus section's declared intent ("must ask" / "must stay defer") fails even the regeneration — a snapshot pins the gate's actual output, so without this a regenerated snapshot pins the gate's bugs as expected behavior.

In development:

- **Decision retrace engine** — specification complete, implementation in progress.

Before a stable release:

- validate Mary on 5–10 real product, legal, and research tasks;
- confirm that a fresh session follows the same procedure;
- verify installation and execution on macOS;
- confirm across hosts and platforms whether `PermissionDenied` is emitted on a manual denial (the macOS build observed on 2026-07-26 did not emit it);
- measure missed and unnecessary automatic activation;
- expand regression coverage beyond recognized shell patterns;
- submit to the Anthropic community plugin marketplace ([anthropics/claude-plugins-community](https://github.com/anthropics/claude-plugins-community)); and
- test the decision-retrace engine against its counterexample scenarios.

Later:

- installation methods for Codex and ChatGPT;
- a read-only critique agent;
- evidence-based criteria for ending and restarting long sessions; and
- dedicated image and PDF verification procedures.

## Support Mary

If Mary helps with real work, consider giving the repository a ⭐ **Star**.

Stars are optional and do not affect installation, features, or support.

## License

Mary is released under the [MIT License](./LICENSE).
