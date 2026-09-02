# Mary

> **Rv.0 / plugin 0.5.0 · Experimental · Claude Code**
>
> **English** (canonical) · [한국어](./README.ko.md)

**AI sounds convincing even when it is wrong.**

Mary is a hallucination-prevention harness for Claude Code. It does not change the model. It changes how a task is framed, executed, checked, and recorded, so that one plausible-but-wrong claim is caught before it becomes the foundation of everything after it.

Mary is a procedure, not a daemon. **It installs no hooks and runs nothing in the background.** It never interrupts a session on its own, and it never asks a question while you are away unless the next step would destroy something.

## What is in 0.5.0

- **A six-stage skill** (`/mary`) that separates verifiable claims from judgment, verifies the claims against observable evidence, attacks its own output, fixes, and re-verifies before anything is called done.
- **Production rules for the places hallucination is actually born**: an unsourced number is labeled `unverified` rather than filled in; changing an input means recomputing every dependent before "final"; a verdict must read the produced artifact, not the parameter that was supposed to produce it; omissions are found by enumeration, never by inspection.
- **A read-only critic agent** (`mary-critic`) that attacks the deliverable against its specification on a rotating axis, so repeated rounds stop re-finding the same layer of defects.
- **A failure record that survives sessions** (`FAILLOG.md`), a deterministic auditor (`mary-stats.js`) that recomputes its counters instead of trusting the model's arithmetic, and **user-approved promotion** of repeated failures into standing rules (`RULES.md`).
- **A delegation rule**: once you have said "go ahead", Mary does not ask again until an irreversible action is next. Asking for approval on a reversible step is treated as the same failure as skipping approval on an irreversible one.

What changed from 0.4.x: the `PreToolUse` approval gate and its observability hooks are **no longer installed**. They remain in the repository as an opt-in extra — see [Optional approval gate](#optional-approval-gate) — because on the author's own machine 460 of 727 prompts over five weeks were false alarms, all approved, and the gate ended up switched off, which is worse than never having had it.

## How Mary works

```text
0. Risk check       List irreversible actions; separate verifiable claims from judgment
1. Specification    Goal, completion conditions, exclusions, and how each will be checked
2. Alternatives     Three genuinely different approaches, each with its collapse condition
3. Safe execution   Reversible work first; irreversible actions held; production rules apply
4. Verification     Verify → counterexample (critic) → fix → re-verify, with a receipt
   4.5 Execution    Show target and scope → approve → re-check state → execute → observe
5. Learning log     Record outcomes; a failure seen in two tasks becomes a rule candidate
```

Mary distinguishes two kinds of conclusions:

- **Verifiable claims** must be checked with observable evidence: execution, tests, measurements, diffs, original sources, or confirmation from an authorized reviewer. "I checked it" in prose is not evidence; the verification receipt binds each claim to the command that ran and what it printed.
- **Judgment domains** such as design, strategy, and preference are not presented as verified. Mary states the recommendation, its key premise, what would overturn it, and who owns the remaining value decision. The premises behind a judgment are usually factual, and they are researched before the recommendation is made.

A critique from another model is a separate perspective, not independent verification. Evidence must be inspectable outside the model's own claims.

The canonical failure keys and stage mappings are documented in [`skills/mary/LAYERS.md`](./skills/mary/LAYERS.md).

## The rules that prevent hallucination

These are the parts of the procedure that were added because the failure record showed where plausible-but-wrong output actually comes from. They are in `SKILL.md` stages 3 and 4-1.

| Rule | Failure it blocks |
|---|---|
| An unsourced value is an assumption and is written as `unverified`. An empty cell beats an invented one. Next to an assumption: what would confirm it, and whether it errs on the safe side | Spurious precision, confabulation: a coefficient inferred from a category ("it is a ball valve, so ≈0.05") that later turns out non-conservative |
| Changing an input means searching the whole artifact for every dependent and recomputing before "final" | Repo-scale incoherence: the local edit is right, the three places that read it are now wrong |
| A computed value that no verdict consumes is a defect signal | Weak verifier: the artifact computes the clearance and the verdict next to it is a literal `pass` |
| Verdict inputs are independent of the thing judged: read from the produced artifact, never from the parameter that produced it | Weak verifier: a check that reads its own input always passes |
| Every reported number is read off the artifact, never hand-computed from components or copied from a summary; final numbers are re-run once before the closing report | Phantom execution: a hand-off that states values the artifact does not show |
| Omissions are found by enumerating the required items from the source and matching each one; inspection cannot find what is absent | Omission: recounts, exception sweeps, and render checks all pass with the item gone |
| Time pressure shrinks the size of the output, never the procedure | Instruction drift: "I only have an hour" read as permission to skip a stage |
| A granted mandate holds for the session; reporting never ends the turn; only an irreversible action stops | Premature closure and the opposite failure, over-asking, which trains the user to switch the harness off |

## When to use it

After installation, invoke the skill directly in Claude Code:

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
| **Standard** | Reversible, lower-impact work | Claude proceeds autonomously and performs the necessary verification. Automatic activation may compress exploration and presentation, but not verification or approval. |
| **Guarded** | Irreversible actions; legal, employment, tax, or high-cost work; hard-to-reverse design decisions | Verifiable claims require observable evidence. Important judgments and irreversible actions require user confirmation. |

Guarded work does not reduce exploration. It raises the evidence and approval required before a decision is finalized.

### Unattended runs

Tell Mary to proceed ("go ahead", "decide yourself", "I'll be away") and it will not ask again for confirmations at stages 1 and 2. It records the interpretation and option it chose and continues. The only things that stop an unattended run are an irreversible action, which always waits for you, and a stagnation stop: two consecutive verification rounds that close no completion condition are reported rather than looped on.

## Installation

Mary requires a recent version of **Claude Code** with plugin support. **Node.js** is needed only for the optional auditor script (`mary-stats.js`) and the optional gate; the skill itself has no dependency.

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

If you use **Code → Download ZIP** instead of Git, extract the complete repository and rename the extracted folder to `mary` so that `~/.claude/skills/mary/.claude-plugin/plugin.json` exists.

### Updating

```bash
git -C ~/.claude/skills/mary pull --ff-only        # macOS / Linux
git -C "$HOME\.claude\skills\mary" pull --ff-only   # Windows PowerShell
```

Then restart Claude Code or run `/reload-plugins`.

## State and record files

Mary keeps runtime state outside the repository in `~/.claude/mary/`. Files are created as needed and never pushed to this repository.

| File | Role |
|---|---|
| `RULES.md` | Approved standing rules and previously confirmed facts. One shared file. |
| `FAILLOG.md` | Observed failures, rejected counterexamples, counters, task IDs, and rule-promotion status. One shared file. |
| `_work-<slug>.md` | One active task record per workstream. Completed task files are removed; paused, blocked, failed, or abandoned records remain, which is what makes "continue" at the next session real. |

## How Mary learns from failures

1. It records the failure, evidence, canonical key, scope, and stable `task_id` in `FAILLOG.md`.
2. It counts a task exactly once, even if the same task spans several sessions or changes terminal state.
3. When the same failure key is reproduced in two different task IDs, it becomes a rule candidate.
4. Mary shows the proposed one-line rule and its two supporting cases.
5. Only a rule the user approves is added to `RULES.md`.
6. A bad standing rule can later be revised or removed.

Rejected counterexamples are stored separately and never count toward promotion. Promotion scope is limited to the scopes actually observed; it is not silently generalized to all work.

The rules in the table above are the ones that reached promotion on the author's own record and were general enough to ship in the procedure itself.

> `FAILLOG.md` describes failures observed while Mary was active. It is not a complete estimate of every failure the model produced.

## Optional approval gate

The repository still contains a `PreToolUse` hook that asks for permission before recognized irreversible shell actions (deletion, `git push`, destructive git, remote sync, package publication, destructive SQL, edits to its own configuration), plus optional hooks that bind each approval to its observed outcome. **None of it is installed by the plugin.** If you want it, register it yourself following [`docs/gate.md`](docs/gate.md); that page also lists the bypasses reproduced in the 2026-09 review that have not been fixed, and the threat model is in [`docs/threat-model.md`](docs/threat-model.md).

A lighter checkpoint that needs no code is Claude Code's own permission rules, for example `"permissions": { "ask": ["Bash(git push:*)"] }`. It is string-matched and does not close the wrapper and quoting bypasses the gate parses for, but for a personal checkpoint it is often enough.

## Repository structure

| File | Role |
|---|---|
| `.claude-plugin/plugin.json` | Plugin identity, version, component paths (skill and agent only) |
| `skills/mary/SKILL.md` | Mary's executable task procedure |
| `skills/mary/LAYERS.md` | Canonical failure keys and aliases |
| `agents/mary-critic.md` | Read-only adversarial reviewer used by stage 4-2 |
| `scripts/mary-stats.js` | Read-only auditor that recomputes counters, promotion candidates, and receipt continuity |
| `tests/stats.test.js` | Regression tests for the auditor |
| `docs/gate.md` | The optional approval gate: how to register it, what it enforces, known open findings |
| `docs/threat-model.md` | Threat model of the optional gate and ledger |
| `scripts/hooks/`, `scripts/mary-reconcile.js`, `scripts/install-managed.*`, `tests/gate.test.js`, `tests/decisions.*` | The optional gate, its observers, installers, and tests. Not loaded by the plugin |
| `CHANGELOG.md` | Release history |
| `.github/workflows/test.yml` | CI — auditor and gate test suites on Node 20/22, Linux and Windows |

## Design principles

- **Think freely, commit strictly.** Exploration stays open; consequential conclusions require evidence.
- **Keep reversible work autonomous.** Escalate ambiguity, high impact, and hard-to-reverse decisions, not every ordinary step.
- **Separate fact from judgment.** Verify facts; expose the premises and reversal conditions behind judgment.
- **Treat model critique as perspective, not proof.** Independent evidence comes from execution, tests, measurements, primary sources, and authorized reviewers.
- **Observe effects before reporting success.** A missing result is `unknown`, not automatically failure.
- **Sessions are disposable; files are assets.** Work state and failure history survive session boundaries.
- **Let bad rules come back down.** A promoted rule is not permanent truth.
- **A harness that gets switched off protects nothing.** Nothing in Mary runs unasked, and nothing asks unless the next step is irreversible.

## Current limitations

- Automatic activation can be missed or applied unnecessarily.
- The workflow asks Claude to draft the specification first, which can anchor the user to the model's initial framing.
- Nothing enforces the procedure mechanically. Mary is instructions plus records; a model that ignores the skill is not stopped by it. The optional gate exists for the one class of action, irreversible shell commands, where a mechanical check is worth its cost to some users.
- A separate LLM reviewer may share the generator's biases. It is not a substitute for observable evidence.
- The decision-retrace engine (reopen only the decisions that depended on an invalidated premise) is specified but not implemented.

## Development status

**Current version: Rv.0 / plugin 0.5.0 · Experimental** — release history in [`CHANGELOG.md`](CHANGELOG.md)

Before a stable release: validate Mary on 5–10 real product, legal, and research tasks; confirm that a fresh session follows the same procedure; measure missed and unnecessary automatic activation; submit to the Anthropic community plugin marketplace.

Later: installation methods for Codex and ChatGPT; evidence-based criteria for ending and restarting long sessions; dedicated image and PDF verification procedures; the decision-retrace engine.

## Support Mary

If Mary helps with real work, consider giving the repository a ⭐ **Star**. Stars are optional and do not affect installation, features, or support.

## License

Mary is released under the [MIT License](./LICENSE).
