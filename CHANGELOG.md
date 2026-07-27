# Changelog

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
