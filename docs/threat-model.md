# Threat model

What the gate and ledger actually enforce, who they defend against, the bypasses we
know about, and what the records can and cannot prove. Everything here is testable;
where a claim has a regression test, the test name is given.

A security mechanism whose limits are secret fails twice: once when the limit is
found, and once more when the user discovers it was known and unstated. This file
exists so the second failure cannot happen.

## 1. What is enforced

- **Irreversible-action gating.** `PreToolUse` intercepts `Bash | Write | Edit |
  MultiEdit | NotebookEdit` calls. Registered irreversible shapes (deletion,
  overwrite, external send, deployment, gate bypass, ledger closure,
  enforcement-config change) return `ask` — a human sees a dialog before the call
  runs. Everything else returns `defer` (the host's normal permission flow), never
  `allow`.
- **Approval→outcome binding.** Every `ask` appends an `asked` record with a
  canonical request hash. `PostToolUse` / `PostToolUseFailure` /
  `PermissionDenied` append the closing record with the same hash. An approval
  with no closing record is **unknown** — reported at every session start until a
  human closes it with observed evidence (`mary-reconcile`, evidence mandatory).
- **Fail-closed judgment.** Unreadable stdin, broken JSON, a missing tool name, an
  empty command, an internal exception — every failure to judge ends in `ask`,
  never in a pass. (Tests: `[fail-closed — cannot judge is not a pass]`.)

## 2. What is deliberately NOT enforced

- **No automatic allow.** No pattern ever whitelists a call. A non-match is a
  defer, not an approval.
- **No hard block.** The gate never exits 2. Removing the human's ability to say
  "yes, do it" would just move the bypass to "disable the plugin".
- **No approval reuse.** No session cache, no timeout window, no "the same command
  passed last time".

## 3. The one ungated surface

Tools outside the hook matcher (`Bash | Write | Edit | MultiEdit | NotebookEdit`,
plus `WebFetch | WebSearch` for the sentinel) **never reach the gate at all** —
there is no fail-closed path for a call the host never routes to us. This includes
MCP-provided tools, the Agent tool, and any future tool the host adds. That is the
single place where "no decision" and "defer" are indistinguishable by
construction. Mitigation: the matcher list is short, explicit, and lives in
`hooks/hooks.json` — which is itself a SELF_PROTECTED file.

## 4. Attacker classes

| Class | Example | Defense |
|---|---|---|
| **Careless agent** | runs `rm -rf` on the wrong dir mid-plan | gate asks; human reads target/scope/rollback |
| **Instruction-injected agent** | web page tells it to `curl -F` a secrets file out | gate asks; trifecta sentinel escalates the dialog when the session has ingested untrusted content |
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

### Open, by construction

- **The regex layer is a router, not a classifier.** A command shape nobody
  registered defers. The gate reduces the attack surface to "invent a genuinely
  novel shape"; it does not close it. Novel shapes found in use belong in this
  file and in the pattern table, in that order.
- **Segmentation is quote-naive.** `splitSegments` does not parse shell quoting.
  Splitting inside a quoted string can only create *extra* segments, which errs
  toward asking — never toward passing.
- **Relative self-protection depends on `cwd`.** A relative mention of
  `scripts/hooks/` is protected only when the call's working directory is inside
  the plugin root. A payload with no `cwd` (not observed from Claude Code, which
  always sends it) would skip that branch; absolute mentions and the generic
  entries (settings, managed-settings, ledger) are protected regardless.
- **Secret masking is pattern-based.** The stored ledger copy masks known token
  shapes (`Authorization:` headers, `key=value` assignments, AWS/GitHub/Slack/JWT
  shapes). An unrecognized secret format is stored in plaintext. Masked entries
  carry `redacted: true`; the hash is over the raw input, so masking never breaks
  approval→outcome matching.

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

Can prove (assuming hooks were installed and running):

- that a matching gate dialog was **presented** (`asked` + the exact sentence shown),
- that the host later reported the call **succeeded / failed / was denied**
  (closing record, hash-and-session matched),
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

Every input the gate can *identify* ends in `ask` or `defer` — including every
error path. There is no code path that maps "could not judge" to a pass. The only
silent non-decision is §3: a call the host never routes to the gate, which no
hook-side code can convert into a judgment. If you find a second one, it is a bug
of the highest severity this project recognizes — report it.
