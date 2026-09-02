# The optional approval gate

> **Not installed by default since 0.5.0.** Mary the plugin registers no hooks and runs nothing in the background. Everything on this page describes an *optional* component you register yourself, and only if you want a permission prompt in front of recognized irreversible shell actions. The code, tests, and threat model remain in the repository so the option stays available and reviewable.

## Registering it

Add this to `~/.claude/settings.json` (user scope) with the absolute path of your checkout. The exec form (`command` + `args`) avoids an intermediate shell:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit",
        "hooks": [
          { "type": "command", "command": "node",
            "args": ["/absolute/path/to/mary-code/scripts/hooks/mary-irreversible-gate.js"],
            "timeout": 10 }
        ]
      }
    ]
  }
}
```

Remove the block to turn it off. The observability hooks (outcome recorder, trifecta sentinel, approval notifier, session report) can be registered the same way from `scripts/hooks/`; the managed installers (`scripts/install-managed.ps1 -Tier gate|full`, `scripts/install-managed.sh --tier gate|full`) register them into administrator-managed settings.

A lighter alternative that needs no code at all: Claude Code's own permission rules. `"permissions": { "ask": ["Bash(git push:*)", "Bash(rm:*)"] }` in settings prompts for exactly those command shapes with no extra process. It is string-matched, so it does not close the wrapper and quoting bypasses the gate parses for — see the threat model — but for a personal checkpoint it is often enough.

## Known open findings (2026-09-02 field review, reproduced, not yet fixed)

- The `PowerShell` tool was not in the original matcher; the registration above adds it, but the gate itself routes only `Bash` command strings through the pattern table, so PowerShell commands are still not classified.
- `powershell -Command "…"`, `pwsh -c "…"`, `cmd /c "…"` are unregistered wrappers and pass.
- A backslash-newline continuation splits a command word (`r\⏎m -rf …`) and defeats every word anchor; the command still executes.
- Git-Bash drive spelling (`/c/Users/…`) is not recognized by the plugin-root anchor, so a Write to the gate script under that spelling passes; `C:/…` asks.
- stdin-fed interpreters (`python - <<EOF`, `node - <<EOF`, `echo … | python`, `node < file.js`) pass while `-c`/`-e` ask.
- The interpreter one-liner rule is line-scoped: a later `-c`/`-e` anywhere on the line (`… | head -c 4000`, `pip install -e .`) asks as a false positive.
- `rm` at the end of the string (`… | xargs rm`) passes.
- Under the gate-only registration nothing ever closes an `asked` record, so the cross-session warning count grows without bound.

Field data behind the decision to unregister by default: on the author's machine, 460 of 727 prompts over five weeks were the "gate bypass" category (mostly `python -c` one-liners), all approved, none dangerous.

---

## What the gate actually enforces (as documented for 0.4.5)


| Layer | Role |
|---|---|
| **Workflow rule** | The skill instructs Claude to hold every irreversible action until the target, scope, rollback path, and user approval are clear. |
| **Hook gate** | The `PreToolUse` hook independently asks before the specific actions it can recognize in registered tool calls. |

The gate's job is **routing to a human, not classification.** No pattern set reads full shell semantics, so the goal is not "recognize every dangerous command" — it is impossible. The goal is: route recognized risk, and everything the gate cannot judge, to the person; and never let a pattern produce an automatic allow. The actual defense line is the human approval button, which no encoding trick can pattern-match its way past — the patterns only decide when a human has to look.

The gate hook, once registered, receives `Bash`, `Write`, `Edit`, `MultiEdit`, and `NotebookEdit` calls (add `PowerShell` on Windows, see the note above). It asks for permission when it recognizes:

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

The Bash self-protection check is a heuristic. No string-level inspection reads full shell semantics; it exists to make an obvious bypass visible, not to make one impossible. The known bypass surfaces — the ones demonstrated and since closed, and the ones open by construction — are published in [`threat-model.md`](threat-model.md).

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

Since 0.5.0 the plugin registers neither tier. The gate tier is the registration block at the top of this page; the full tier is selected at managed installation (`install-managed.ps1 -Tier full` / `install-managed.sh --tier full`), or by registering the four observability hooks yourself in user settings. Sections below that describe outcome recording, `unknown` reporting, trifecta warnings, or pings describe **full-tier** behavior.

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

The managed install protects the **code**, not the **ledger**: `~/.claude/mary/approvals.jsonl` must stay writable by the user account the hooks run as, so it remains editable by anything with the user's file access. Every ledger write path the gate recognizes (redirection, `tee`, `sed -i`, interpreter one-liners) is gated, so an agent's forgery *attempt* surfaces as an approval dialog — but the ledger is evidence of what the hooks observed, not a tamper-proof audit log. This boundary is spelled out in [`threat-model.md`](threat-model.md).

Even a properly managed installation covers only the hook events, tool names, and action patterns that Mary observes. Deciding whether a task is multi-step or whether a factual judgment controls the outcome remains a semantic decision that no pattern-only dispatcher can fully enforce.

For Claude Code's current plugin and managed-settings behavior, see the official [plugin documentation](https://code.claude.com/docs/en/plugins), [plugin reference](https://code.claude.com/docs/en/plugins-reference), and [configuration reference](https://code.claude.com/docs/en/configuration).


## Files the gate and its observers create in `~/.claude/mary/`

| File | Role |
|---|---|
| `notify.json` | Optional. Webhook for the "approval waiting" ping (`mary-approval-notifier.js`). Absent → no traffic. |
| `_trifecta-<session>.json` | Per-session marker: this session ingested untrusted external content. Written by the sentinel, read by the gate, auto-removed after 7 days. (The one place session-scoped state is the right shape — ingestion is a session property; tasks and the ledger span sessions.) |

