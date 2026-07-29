# Changelog

## 0.4.4 — 2026-07-29

Pre-merge hardening. Before 0.4.3 reached `main`, an independent adversarial
review attacked the release delta; twelve findings came back and all twelve
were confirmed by execution. None was a regression against `main` — every one
was a gap in the new protections or a defect in the new auditing — but the
release said "closed" about routes that were open, so they were fixed before
merging rather than after.

### The finding that matters most: the snapshot pinned its own bugs

`2>&1 "rm" -rf /d` executed for real and the gate deferred — `commandParts`
split on the `&` of the redirection, so the segment's command word became `1`
and the redirection walker never ran. The case sat in the corpus **inside the
A1 section that existed to prove redirections fixed**, pinned `defer`, and
267/267 green was agreement with the bug. Same shape twice more: the
`echo "please truncate the file"` false positive was pinned `ask` inside a
"must stay defer" block, and `ln -sf …` was pinned `defer` inside "must stay
ask" (correctly — the corpus runs outside the plugin root — but the placement
asserted the opposite of the pin).

The fix is structural, not just the three cases: corpus section headers now
carry their intent, and `decisions.test.js` fails — `--update` mode included —
whenever a pin contradicts the block it sits in. That audit immediately caught
five more misplaced pins beyond the review's findings (`echo "git push"`,
`psql -f migrate.sql`, `npm publish --dry-run`, `git checkout HEAD~1 -- `,
`git restore --staged file.txt`); each was fixed or moved with its reason
written next to it.

### Gate

- fd-duplication before the command word (`2>&1 "rm"`, `1>&2 "rm"`, `>&2`,
  `&>>log`) now asks; a lone background `&` still separates commands.
- `git checkout main -f` / `--force` (flag after the ref) and pathspec
  checkouts (`git checkout ./subdir`, `.github/…` — a ref cannot begin with a
  dot) now ask; `git checkout feature/topic` still defers.
- `aws` global flags before the service (`aws --profile prod rds delete-…`)
  are walked by name; unknown globals keep erring toward defer.
- `gh api` with a field flag (`-f`/`-F`/`--field`) is an implicit POST and
  asks unless the method is explicitly GET.
- `GIT tag -d` asks regardless of command casing (`/i` — unlike `branch -D`,
  tag deletion has no case distinction to preserve).
- False positives closed by replacing quoted spans with an inert placeholder
  before matching: `echo "please truncate the file"`,
  `git commit -m "add FLUSHALL guard"`, `echo "git push"` (open since 0.4.2).
  A quoted command word still asks (`"truncate" -s 0 f`), and quoted `FLUSHALL`
  next to a Redis client still asks. A placeholder rather than deletion:
  erasing `-C "/repo"`'s value let the option pattern consume `push` as the
  value — the snapshot differential caught that regression during this fix.

### Auditor (mary-stats)

- The no-continuity warning fired only when **zero** checks were ever re-run
  across the whole file; `R1{a} R2{b} R3{a}` passed silently, and an in-round
  duplicate counted as "carried". Rounds now dedupe internally, and any round
  that re-runs nothing from every earlier round is warned about by number.
- The check-identity key kept only `[a-z0-9가-힣]`: it merged `mass > 500`
  with `mass < 500` (manufacturing the exact false flip the normalization
  exists to prevent) and normalized a Japanese or Chinese receipt to the empty
  string, silently disabling the continuity audit. The key now keeps letters
  and digits of every script plus comparison operators.

### Corrections to 0.4.3's own text

- "267 commands" was 265 — two corpus entries were duplicates; nobody diffed
  the corpus against the snapshot key count. The corpus is now 287 unique
  cases and the duplicates are gone.
- "seven new stats cases" was eight (31 → 39).
- The continuity measurement was cited with two different value sets
  (CHANGELOG: "8 of 64 over 6 rounds"; code comment: "5 of 54 over 5 rounds").
  Re-measured 2026-07-29 with the fixed key on the same two records:
  4 of 30 items over 3 rounds and 14 of 132 over 18 rounds — "about 90 % never
  re-run" stands, and both texts now cite this measurement.
- Test fixtures that carried working-project vocabulary were genericized.

Tests: 249 gate + 43 stats unit checks, 287-case decision snapshot with the
section-intent audit. The snapshot regeneration diff for this release shows
2 weakened (both documented false positives), 3 strengthened, 22 new pins.

## 0.4.3 — 2026-07-29

Workflow-side release. External feedback proposed three changes to the procedure;
each claim was checked against the project's own records first. Two were adopted
with the diagnosis kept and the prescription changed, one was rejected on the
evidence and replaced by the gap that was actually there.

### 4-4 — re-verification now has to carry the previous round forward

The measurement that drove this: verification receipts already accumulate in the
`_work` file, so how much each round re-checks is computable. Across the author's
own records, **8 of 64 items (13 %) over 6 rounds** on one task and **14 of 132
(11 %) over 18 rounds** on another were ever re-run in a later round. About nine
in ten checks were performed once and never again — so *"the fix broke something
that used to pass"* had nowhere to appear, and "no regression recorded" was not
evidence of no regression. The narrative record shows the regressions happening
anyway (a literal `pass` removed in one round and still present the next;
`shell:true` implicated in round 3 and found again in round 4).

- SKILL 4-4 now requires the new receipt to **carry the previous round's items
  forward** with this round's observed values, and to state in one line what was
  dropped and why when that is too expensive. A silent drop reads as "still
  verified".
- `mary-stats.js` computes and reports it: the re-check share per `_work` file,
  a **warning** when a check that passed in an earlier receipt fails in a later
  one, and a **warning** when two or more rounds share no check at all (which
  contradicts 4-4 outright). Check identity survives wording drift.

### 4-2 — the review axis rotates by round number

Counterexample rounds used one open-ended "attack this" instruction every time,
which re-finds the same layer of defects: long lists every round while a defect
on another layer survives all of them. Rounds now rotate `A → B → C → D`:
specification conformance · state and structure (what the last fix changed
elsewhere) · boundary and regression · operation and downstream. The axis is
named in the instruction, recorded in `_work.md`, and `agents/mary-critic.md`
carries the same table plus an instruction to mark findings from outside the
named axis.

Rotation is fixed by round number, **not triggered by a rejection rate**. The
feedback proposed the latter; a rejection rate that decides when to change axis
is also a number the generator can satisfy by rejecting a valid finding, and
rejecting a valid finding is worse than the problem it would fix. (The rate was
also the wrong instrument on the evidence: the 0 % rejection round recorded that
every finding was confirmed *by reproduction*, which is a critic being right, not
a blind spot.)

### 4-4 — stagnation is now a stopping condition

The feedback attributed a non-terminating task to completion conditions being
qualitative. The records do not support that: the task's conditions included
`0 items`, `0 console errors`, `3 open items`, and later quantitative
percentage thresholds. The harness gave a stop criterion; the answer was "not yet".
The real gap was next to it — nothing noticed that the loop was not moving. So:
**two consecutive rounds that close no completion condition → stop and report**
(which conditions remain open, what the last two rounds changed, and the choice
between continue / narrow the conditions / `paused`). Reporting only; the harness
never narrows its own completion conditions.

### Review pass over this release's own gate additions

A second-model review attacked the 0.4.2/0.4.3 changes before release and found
three of the new patterns colliding with ordinary text — the cry-wolf direction
the project warns about — plus one gap against this release's own rationale:

- `truncate <word>` and `drop database|schema|index|view` matched English prose:
  `git commit -m "truncate long lines"` and `git commit -m "drop database
  support"` asked. The bare-object SQL forms now count only when a DB client
  (`psql`, `mysql`, `sqlite3`, `mongosh`, …) appears in the same command; the
  classic keyword forms (`drop table`, `delete from`, `truncate table`) still
  match anywhere.
- `delete` in VALUE position read as the delete verb: `az group show --name
  delete` and `gcloud … list --filter delete` asked. The words between the CLI
  name and `delete` must now all be bare words, so a flag's value cannot be the
  verb. Cost: `az --output json group delete` (flag before the verb) defers —
  errs toward defer, not toward a false ask.
- `git switch -f|--force|--discard-changes` discards local modifications — the
  same uncommitted-work destruction as `checkout -f`, reached through the
  subcommand that replaced it — and was not registered. Now it is; a plain
  `git switch <branch>` refuses to lose changes and stays defer.

### The decision snapshot becomes part of the suite

The instrument that caught the most this release cycle was not the unit suite —
it was the differential corpus: judge every command, change the code, prove
exactly which judgments moved. PR #3 ran one with 534 cases; 0.4.2 and the 0.4.3
review each ran one with ~250. Until now that corpus lived in a session
scratchpad and evaporated with the session.

- `tests/decisions.cases.js` — 267 commands, benign and gated, including every
  bypass and false positive closed since 0.4.0.
- `tests/decisions.snapshot.json` — the pinned decision for each:
  `ask:<category>` or `defer`.
- `tests/decisions.test.js` — fails, with direction, when any decision moves:
  **WEAKENED** (ask → defer: each needs its own CHANGELOG justification),
  **STRENGTHENED** (defer → ask: intended coverage or new noise?),
  **RELABELED** (category only), plus unpinned and stale cases. Regenerating is
  a deliberate act (`--update`), and the git diff of the snapshot is the review
  artifact. Runs in CI next to the unit suites.

### Fixes from the same review

- `checkKey` (receipt continuity) truncated check identity to 60 normalized
  characters, so two long checks sharing a prefix could merge into one — and a
  false merge becomes a false pass→fail warning. Full-string identity now;
  regression test included.

### Tests

- 253 → 266 unit checks (gate 227, stats 39) plus the 267-case decision
  snapshot. The seven new stats cases cover a pass→fail flip across rounds,
  wording drift between rounds, rounds sharing nothing, a single receipt being
  uncomparable, an unparseable receipt in the middle not breaking the comparison
  around it, and prefix-sharing long checks staying distinct. The five new gate
  cases pin the review findings above, positives and negatives both.

## 0.4.2 — 2026-07-29

Self-review release, run against the 0.4.1 code. Everything here was found by
re-reading the harness after the external contributions landed; nothing in 0.4.1
was reverted or rewritten. Method borrowed from that review: reproduce against
the shipped hook under an isolated `MARY_DIR`, then prove the change is monotone
with a differential corpus (248 cases, old gate vs new: **172 unchanged, 75 now
ask, 1 now defers** — the single removal is the false positive listed below).

### Gate — the H-3 root cause reached by three more routes

Each was confirmed twice: the gate returned `defer`, and the shell was confirmed
to execute the command word for real (with `echo` substituted for `rm`).

- **A redirection may precede the command word.** `>/dev/null "rm" -rf /d`,
  `2>/dev/null "rm" …`, `<in.txt "rm" …`, `> out.txt "rm" …` all run `rm`, but
  `unquoteCommandWord` stopped at the redirection and never reached the quoted
  name. Redirections are now walked through, in the leading position and between
  a wrapper and its nested command (`sudo >/dev/null "rm"`); a detached target
  (`> out.txt`) consumes the following word.
- **`$'rm' -rf /d`** — ANSI-C quoting. `bareCommandName` unquoted it to `$rm`,
  which failed its plain-name test, so no substitution happened. A `$` directly
  before an opening quote is now dropped first; `$"rm"` likewise.

### Gate — registry gaps

Irreversible in practice, no pattern registered. Grouped by what they destroy:

- **Uncommitted work** — `git checkout -- .` / `git checkout .` /
  `git checkout -f`, `git restore` (exempting `--staged` without `--worktree`,
  which only unstages). `git reset --hard` and `git clean` were registered; these
  reach the same place through a different subcommand, and what they discard was
  never committed, so no reflog entry can bring it back.
- **The recovery net itself** — `git stash clear`/`drop`, `git reflog expire`,
  `git gc --prune`, `git filter-branch`/`filter-repo`, `git tag -d`,
  `git update-ref -d`, `git worktree remove`, `git submodule deinit`.
- **Databases** — `drop database`, `drop schema`, `drop index`, `drop view`
  (only `drop table` was registered), plus `FLUSHALL`/`FLUSHDB` and mongo's
  `dropDatabase()` / `drop()` / `deleteMany({})`.
- **Registries** — `npm unpublish`/`deprecate`, `cargo publish`/`yank`,
  `gem push`, `twine upload`, `poetry publish`, `dotnet nuget push`,
  `mvn deploy`. Taking a published version back is not a rollback: the name
  stays reserved and downstream lockfiles break immediately.
- **GitHub through `gh`** — `gh api` with POST/PUT/PATCH (only DELETE was
  registered), `gh pr merge`/`close`, `gh release create`, `gh secret set`.
- **Cloud** — `aws <service> delete-*`/`terminate-*`, `gcloud … delete`,
  `az … delete`, `helm uninstall`/`delete`, `docker … prune`.
- **Whole volumes** — `mkfs`, `diskpart`/`fdisk`/`parted`, `Format-Volume` and
  friends, and Windows `rd /s /q` (`rmdir` was registered, its alias was not).

New entries anchor `git` to command position (`GIT_CMD`), so a dangerous
subcommand quoted inside argument text — `echo "git restore ."`,
`grep -rn "git stash clear" docs/` — stays `defer`. The pre-existing
`echo "git push"` false positive is unchanged and still open.

### Gate — one false positive removed

- `./deploy.sh -c config.yml` asked as `gate bypass`: `\b` matched the `sh` at
  the end of a *filename*. Meanwhile `bash deploy.sh` — the same script,
  actually run — deferred, so the ask protected nothing. The shell name now has
  to be in command position, with an optional path prefix so `/bin/sh -c` and
  `bash.exe -c` keep matching. This is the only decision in the corpus that moved
  toward `defer`.

### Ledger — a refusal is not a lost outcome

- `mary-reconcile` accepts `--outcome denied`. `PermissionDenied` fires for
  auto-mode classifier denials; a person clicking "no" has produced no closing
  record in any ledger observed so far (macOS 9 asked / 0 denied; Windows
  171 asked / 0 denied across 999 records), so a refusal stayed `unknown` and
  read as "go find out whether it ran". The session-start report now says so.

### Tests

- 197 → 253 (gate 222, stats 31). New groups: `[H-3 follow-up]`,
  `[registry gaps]`, and `[registry gaps — the reading and switching forms must
  NOT ask]`, the last one holding 40+ negatives (`git checkout main`,
  `git restore --staged`, `git gc`, `psql -c "select 1"`, `gh api -X GET`,
  `gcloud … list`) so the new coverage cannot quietly become noise.

## 0.4.1 — 2026-07-28

External-contribution release. Every change here came from a full read-through of
the plugin by [@thegreatesthoneybee](https://github.com/thegreatesthoneybee) (PRs
#2, #3) plus the platform-portability and integration work in PRs #1 and #4. The
gate bypasses closed below are all of the same class 0.4.0 already knew about —
the command string was matched as text where the shell parses it as grammar.

### Gate — three more bypasses closed (H-1 · H-2 · H-3)

- **H-1 · the `--dry-run` exemption was a substring test.** `git push origin main
  # --dry-run`, `git push -o -n origin main` (`-n` is the *value* of
  `--push-option`), and `git -c core.pager="less -n" push` all bought the
  exemption without being a dry run. The exemption is now **parsed**: comments
  stripped, quote-aware tokenization, only tokens after `push` considered,
  options that consume a value respected. Every branch only ever *withholds* the
  exemption, so a wrong parse errs toward asking.
- **H-1b · a quoted global-option value made the push invisible.** `GIT` used
  `-c\s+\S+`, which cannot span `core.pager="less -n"` — so that push did not
  match `GIT_PUSH_RE` at all. It was not merely unexempted, it was invisible to
  the registry. Option values now accept a quoted run.
- **H-2 · short options cluster.** `bash -lc`, `sh -ec`, `zsh -ic`,
  `bash --login -c`, `python3 -Ic`, `python -Sc`, `perl -we`, `perl -E` all run
  the string exactly like `-c`; none matched a standalone `-c`. The uppercase
  pair (`perl -E`, `php -R`) is a deliberately case-sensitive entry — folding
  case would read node's `-r` (module preload, which runs a *file*) as code and
  ask on ordinary `node -r ts-node/register app.js`.
- **H-3 · quoting the command word defeated the anchors.** `"rm" -rf /d`,
  `'rm' -rf`, `r\m -rf`, `git "push"`, `sudo "rm"`, `("rm" …)` all execute, but
  none contains the bare word at a `(^|[\s;&|])` boundary. Quotes are now removed
  from the **command word only**, per segment, and the normalized string is
  matched **in addition to** the raw one — so the change can add an ask, never
  remove one. Argument quoting is untouched, which keeps `echo "rm -rf /"`,
  `git commit -m "rm -rf fix"` and `grep -r "rm" .` at `defer`.
- **H-3 follow-up (PR #4).** Command-word normalization now walks wrapper
  grammar: option values (`sudo -u root "rm"`, `env -C dir`, `timeout -k 5`,
  `git -C /repo`), `env` assignments, and required positional operands
  (`timeout 5`, `flock lock`, `chrt 1`). Segment splitting became quote-aware so
  a quoted `|`, `&&`, or `;` that is only argument text no longer splits.

### Self-protection

- `~/.claude/mary/notify.json` joined `SELF_PROTECTED` at any path. It names the
  URL and headers the approval notifier POSTs to; a quiet edit turns every
  approval prompt into an outbound ping to an attacker-chosen endpoint.

### CI

- `fail-fast: false` on the 2×2 matrix. On the released 0.4.0 tag one failing
  ubuntu/node-22 leg cancelled the other three, so **neither Windows job ever ran
  the suite** — on a gate whose whole job is cross-platform path handling.
- Tests now also run on pushes to `dev`, not only `main` and pull requests.

### Tests

- The `outside-cwd defers` fixture hardcoded `C:/other-project`, which is
  absolute only on Windows; on POSIX `path.resolve()` folded it back under the
  repo root and the gate correctly returned `ask` where the test asserted
  `defer`. The gate was right, the fixture was not. Now
  `path.resolve(ROOT, '..', 'other-project')`.
- Test count: 154 → 197 (gate 166, stats 31), green on ubuntu/windows × node 20/22.

## 0.4.0 — 2026-07-27

Hardening release. Every change traces to the 2026-07-26 external review
(ten demonstrated gate bypasses, two spec mismatches, six design concerns)
and the competitive re-survey that followed. The bypasses are published, with
mitigations, in `docs/threat-model.md`.

### Gate — bypasses closed (all with regression tests)

- `/bin/rm` and other path-prefixed deletion commands are now caught (#1).
- `git` global options (`-C`, `-c`, `--git-dir`, …) between `git` and the
  subcommand no longer evade the push / reset / clean / branch patterns (#2, #3).
- `curl`/`wget` upload forms — `-F`/`--form`, `-T`/`--upload-file`, `--json`,
  `--data-*` — are external sends (#4, #5).
- **Fail-open fix**: `--dry-run` now exempts only the command segment it appears
  in. `git push origin main && echo "--dry-run"` asks (#6). `git push -n` is
  recognized as the short dry-run form.
- Interpreter one-liners (`python|node|perl|ruby|php|deno|bun` with
  `-c`/`-e`/`--eval`) are gated as unreadable wrappers, same as `bash -c` —
  this closes both `python -c` deletion (#7) and `node -e` ledger forgery (#8).
- `ln` counts as a write hint — symlinking a gate script over asks (#9).
- `rsync --delete`, `scp`/`rsync` to `user@host:` targets, `aws s3 rm/rb/sync
  --delete`, and `ssh host <command>` are registered (#10).

### Gate — over-reach removed (C1)

- Plugin-relative self-protection paths (`scripts/`, `hooks/hooks.json`,
  `.claude-plugin/plugin.json`) are anchored to the plugin's actual install
  root. The same names in unrelated repositories no longer trigger the gate.
  Host-level files (`.claude/settings*.json`, `managed-settings.json`) and the
  ledger stay protected at any path. Relative mentions are judged against the
  call's working directory.

### Ledger, report, CLI

- Stored ledger copies (`presented_text`, `request`) are secret-masked;
  masked entries carry `redacted: true`. The hash is computed over the raw
  input, so approval→outcome binding is unaffected (C2).
- Session-start report truncation keeps the **oldest** unknowns (C3).
- `mary-reconcile --list` marks its own gate entry as "likely this very call"
  instead of presenting it as one more thing to close (C6).

### Auditor and SKILL spec

- The exact `counted_status` literals are pinned in SKILL stage 5.3
  (`none · completed · blocked-failed · user-stopped`) and the auditor now
  expects them; legacy `stopped` is accepted as an alias (B1).
- Judgment-only tasks can reach `completed`: stage 0 records
  `verification: judgment-only` in the `_work` frontmatter and the auditor
  exempts exactly that case from the receipt requirement (B2).
- A receipt whose `task_id` does not match the `_work` file's `task_id` is
  flagged — a pasted-in receipt is not this task's evidence (C5).

### Project

- `docs/threat-model.md`: what is enforced, attacker classes, the ten
  bypasses with fixes, the open surfaces (including the one ungated surface —
  tools outside the hook matcher), what the ledger can and cannot prove, and
  the C4 disclosure (managed install protects code, not the ledger file).
- GitHub Actions CI: both test suites on Node 20/22, Linux and Windows.
- Test count: 109 → 154.

## 0.3.0 — 2026-07-25

- `/mary` invocation, approval notifier, trifecta sentinel, reconcile CLI,
  managed install.

## Rv.0 — 2026-07-25

- First public release: irreversible-action gate (fail-closed, ask/defer,
  never allow), append-only approval ledger with approval→outcome binding,
  unknown-state tracking and session-start reporting, mary-critic read-only
  reviewer, FAILLOG/RULES workflow with promotion by evidence.
