#!/usr/bin/env node
/**
 * Mary — PreToolUse irreversible-action gate
 *
 * Enforces SKILL.md's "irreversible actions require prior approval" rule with a hook,
 * not with prose.
 *
 * Design principles (all deliberate):
 *
 *  1. fail-CLOSED. If the gate cannot judge a call, it does not wave it through — it asks.
 *     Parse failures and unexpected exceptions all end in "ask". There is no
 *     fail-open path ("hook died, let it pass").
 *
 *  2. Regexes are never the sole basis for approval. A pattern is only a signal that
 *     confirmation is needed; no pattern ever produces an automatic allow.
 *     A non-match is not "allow" — it is "defer": the decision returns to the host's
 *     normal permission flow.
 *
 *  3. No automatic-approval paths. No session cache, no timeout, no
 *     "second call passes". Remembering an answer to skip the next question is
 *     approval reuse by construction.
 *
 *  4. Self-protection. Attempts to modify this hook's own enforcement files must also
 *     pass the gate. Write-family tools are judged by path; Bash is judged by a
 *     "protected path mentioned + write indicator present" heuristic. The Bash side is
 *     not complete — no string-level inspection reads full shell semantics. This is
 *     not a trust boundary; it makes an obvious bypass visible (see README).
 *
 *  5. Every "ask" is recorded in the ledger — the only record binding approval to
 *     execution (lib/ledger.js). A failed write to the ledger never changes the
 *     decision: the gate still asks.
 *
 * Output contract: exit 0 + stdout JSON.
 *   permissionDecision: "ask"   → show the user a permission dialog
 *                       "defer" → hand off to the host's normal permission flow
 * exit 2 is never used. A hard block would take the choice away from the user.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { requestHash, append, openApprovals, maskSecrets, maskDeep, MARY_DIR } = require('./lib/ledger');

const HOOK_ID = 'mary:pre:irreversible-gate';

/* ── Command segmentation ───────────────────────────────────────────
 * Some judgments must be per-segment, not per-line. A negative condition tested
 * against the whole line ("push unless --dry-run appears somewhere") is pierced
 * by `git push origin main && echo "--dry-run"` — the exempting string lives in
 * a DIFFERENT command. Splitting is naive about quotes; that only errs toward
 * asking, never toward passing.
 */
function splitSegments(cmd) {
  return String(cmd).split(/&&|\|\||[;|\n]/);
}

/* git accepts global options between `git` and the subcommand
 * (`git -C /repo push`). Requiring adjacency would exempt exactly those forms. */
const GIT = '\\bgit(?:\\s+(?:-C\\s+\\S+|-c\\s+\\S+|--git-dir(?:=|\\s+)\\S+|--work-tree(?:=|\\s+)\\S+|--namespace(?:=|\\s+)\\S+|--no-pager|--paginate|-[pP]))*\\s+';
const GIT_PUSH_RE = new RegExp(GIT + 'push\\b', 'i');
const DRY_RUN_RE = /(^|\s)(--dry-run|-n)\b/;

/* ── Action registry ────────────────────────────────────────────────
 * The tool name is the first-order judgment. Command patterns are only a
 * second-order signal inside Bash. Category vocabulary matches SKILL.md stage 0 (a).
 * An entry carries either `re` (tested against the whole command) or `test`
 * (a predicate, for judgments that need segmentation).
 */
const BASH_PATTERNS = [
  // rm is deletion regardless of flags. Matching only -r/-f would let
  // "rm single-file" slip past the gate. The optional path prefix catches
  // absolute invocations (/bin/rm) that a bare prefix class would miss.
  { re: /(^|[\s;&|])(\S*[\\/])?rm\s/i,                   category: 'deletion' },
  { re: /(^|[\s;&|])(\S*[\\/])?(rmdir|del|Remove-Item|Clear-Content)\b/i, category: 'deletion' },
  { re: /(^|[\s;&|])find\b[^\n]*\s-delete\b/i,           category: 'deletion' },
  { re: /(^|[\s;&|])(\S*[\\/])?shred\b/i,                category: 'deletion' },
  { re: /(^|[\s;&|])(\S*[\\/])?truncate\b/i,             category: 'overwrite' },
  // Per-segment: --dry-run only exempts the segment it appears in. Tested
  // against segments so a real push cannot hide behind an exempting string
  // in a neighboring command. -n is git's own short form of --dry-run.
  { test: cmd => splitSegments(cmd).some(s => GIT_PUSH_RE.test(s) && !DRY_RUN_RE.test(s)),
    category: 'external send' },
  { re: new RegExp(GIT + '(reset\\s+--hard|clean\\s+-\\w*[fdx])', 'i'), category: 'overwrite' },
  { re: new RegExp(GIT + '(commit|push)\\b[^\\n]*--no-verify', 'i'),    category: 'gate bypass' },
  // Only -D. Lowercase -d refuses to delete unmerged branches, so it is close to
  // reversible. Case matters here — no /i flag.
  { re: new RegExp(GIT + 'branch\\s+(\\S+\\s+)*-\\w*D'),                category: 'deletion' },
  { re: new RegExp(GIT + 'branch\\b[^\\n]*(--delete\\s+--force|--force\\s+--delete)', 'i'), category: 'deletion' },
  { re: /\bgh\s+(repo|release|gist)\s+delete\b/i,        category: 'deletion' },
  { re: /\bgh\s+api\b[^\n]*(-X|--method)[\s=]+DELETE\b/i, category: 'external send' },
  { re: /\b(drop\s+table|delete\s+from|truncate\s+table)\b/i, category: 'business-system write' },
  { re: /\bdd\s+if=/i,                                   category: 'overwrite' },
  // Upload forms are sends like POST bodies are: -F/--form (multipart),
  // -T/--upload-file (PUT), --json (implicit POST), --data-* variants.
  { re: /(^|[\s;&|])(curl|wget|Invoke-WebRequest)\b[^\n]*(-X\s*(POST|PUT|DELETE|PATCH)|--data(-\w+)?\b|-d\s|-F\s|--form\b|-T\s|--upload-file\b|--json\b)/i,
    category: 'external send' },
  // Remote sync/copy: rsync --delete removes files on the receiver; an
  // explicit user@host: target is an external send regardless of flags.
  { re: /\brsync\b[^\n]*--delete\b/i,                    category: 'deletion' },
  { re: /\b(scp|rsync)\b[^\n]*\s\S+@\S+:/i,              category: 'external send' },
  { re: /\baws\s+s3\s+(rm|rb)\b/i,                       category: 'deletion' },
  { re: /\baws\s+s3\s+sync\b[^\n]*--delete\b/i,          category: 'deletion' },
  { re: /\b(npm|yarn|pnpm)\s+publish\b/i,                category: 'deployment' },
  { re: /\b(docker\s+push|kubectl\s+(apply|delete)|terraform\s+(apply|destroy))\b/i, category: 'deployment' },
  // One layer of shell wrapping or encoding neutralizes every pattern above
  // (L12 encoding-obfuscation). The wrapped content cannot be judged, so the
  // wrapping itself is treated as "cannot judge → ask".
  { re: /\b(bash|sh|zsh|dash)\s+-c\b/i,                  category: 'gate bypass' },
  // Interpreter one-liners are shell wrapping with a different binary:
  // `python -c "shutil.rmtree(…)"` deletes like rm and `node -e` can append to
  // any file — including this gate's own ledger. Judging them differently from
  // `bash -c` would contradict the rule above.
  { re: /\b(python3?|node|nodejs|deno|bun|perl|ruby|php)(\.exe)?\b[^\n]*\s(-c|-e|--eval)\b/i,
    category: 'gate bypass' },
  { re: /\b(powershell|pwsh)(\.exe)?\b[^\n]*\s-e(nc|ncodedcommand)?\b/i, category: 'gate bypass' },
  { re: /(^|[\s;&|])(iex|invoke-expression)\b/i,         category: 'gate bypass' },
  { re: /(^|[\s;&|])eval\s/i,                            category: 'gate bypass' },
  { re: /\|\s*(bash|sh|zsh|pwsh|powershell)(\.exe)?\s*($|[\s;&|])/i, category: 'gate bypass' },
  // `ssh host <command>` executes an unreadable command on a remote machine —
  // the same "cannot judge the wrapped content" situation as bash -c.
  // A bare `ssh host` (interactive session) is not matched.
  { re: /(^|[\s;&|])ssh\s+(-\w+\s+)*[\w.@-]+\s+\S/i,     category: 'gate bypass' },
  // Closing a ledger entry is itself consequential: the approval dialog is where
  // a human sees the hash, outcome, and evidence before the closure is written.
  { re: /\bmary-reconcile(\.js)?\b/i,                    category: 'ledger closure' },
];

function patternHits(cmd) {
  return BASH_PATTERNS.filter(p => (p.re ? p.re.test(cmd) : p.test(cmd)));
}

/* ── Self-protection ────────────────────────────────────────────────
 * This hook's own enforcement configuration. Changing it must go through the user.
 * The approval ledger belongs here too — if the ledger can be edited quietly,
 * approval history stops being evidence.
 *
 * Anchoring: plugin-relative paths (scripts/, hooks/hooks.json,
 * .claude-plugin/plugin.json) are protected ONLY under this plugin's actual
 * install root. Unanchored, the same names in unrelated repositories would
 * trigger the gate constantly — and a gate that cries wolf trains the user to
 * approve without reading, which defeats the gate ("a bypassed harness is no
 * harness at all"). Host-level enforcement files (.claude/settings*.json,
 * managed-settings.json) and the ledger stay protected at ANY path — they are
 * enforcement config wherever they live.
 */
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

/** Escape a filesystem path into a slash-direction-insensitive regex source. */
function pathPattern(p) {
  return String(p).split(/[\\/]+/)
    .map(seg => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]');
}
const ROOT_RE = pathPattern(PLUGIN_ROOT);

const SELF_PROTECTED = [
  // host enforcement config + ledger: any path
  /[\\/]\.claude[\\/]settings(\.local)?\.json$/i,
  /[\\/]managed-settings\.json$/i,
  /[\\/]mary[\\/]approvals\.jsonl$/i,
  // plugin enforcement files: anchored to this plugin's install root.
  // scripts/ covers the hooks, the reconcile CLI, the receipt auditor, and the
  // managed installers — the whole ledger-integrity chain.
  new RegExp(ROOT_RE + '[\\\\/]scripts[\\\\/]', 'i'),
  new RegExp(ROOT_RE + '[\\\\/]hooks[\\\\/]hooks\\.json$', 'i'),
  new RegExp(ROOT_RE + '[\\\\/]\\.claude-plugin[\\\\/]plugin\\.json$', 'i'),
];

/* Protected-path patterns for Bash command strings.
 * Generic entries match at any path; plugin-relative entries apply only when
 * the command's working directory is inside the plugin root (relative mentions
 * elsewhere are other projects' files, not this gate's). An absolute mention of
 * the plugin root is protected from any working directory. */
const BASH_SELF_PROTECTED = [
  /\.claude[\\/]settings(\.local)?\.json/i,
  /managed-settings\.json/i,
  /mary[\\/]approvals\.jsonl/i,
];
const BASH_SELF_PROTECTED_ROOT = new RegExp(
  ROOT_RE + '[\\\\/](scripts[\\\\/]|hooks[\\\\/]hooks\\.json|\\.claude-plugin[\\\\/]plugin\\.json)', 'i');
const BASH_SELF_PROTECTED_REL = [
  /hooks[\\/]hooks\.json/i,
  /\.claude-plugin[\\/]plugin\.json/i,
  /scripts[\\/]hooks[\\/]/i,
  /scripts[\\/](mary-reconcile\.js|mary-stats\.js|install-managed\.(ps1|sh))/i,
];

function cwdInsidePluginRoot(cwd) {
  if (!cwd) return false;
  try {
    const rel = path.relative(PLUGIN_ROOT, path.resolve(String(cwd)));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function mentionsProtectedPath(cmd, cwd) {
  if (BASH_SELF_PROTECTED.some(re => re.test(cmd))) return true;
  if (BASH_SELF_PROTECTED_ROOT.test(cmd)) return true;
  if (cwdInsidePluginRoot(cwd) && BASH_SELF_PROTECTED_REL.some(re => re.test(cmd))) return true;
  return false;
}

/* Signals that a command can modify files. Only used in combination with a
 * protected-path mention. Redirection excludes fd duplication like 2>&1.
 * This is a compromise that keeps read-only mentions (cat, node) unblocked —
 * which is exactly why it is not complete. ln can replace a protected file
 * with a link to attacker-chosen content, so it counts as a write. */
const BASH_WRITE_HINTS =
  /(>\s*"?[^>&\s]|\btee\b|\bsed\s+-\w*i|\b(cp|mv)\b|\bln\s|Set-Content|Add-Content|Out-File|New-Item|\bchmod\b|\battrib\b)/i;

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/* ── Decision (pure function; tests call this directly) ──────────── */

function decide(payload) {
  const tool = String((payload && payload.tool_name) || '');
  const input = (payload && payload.tool_input) || {};

  // An unknown tool is not deferred. Deferring it would make "unregistered tool"
  // indistinguishable from "failed to judge".
  if (!tool) {
    return { decision: 'ask', category: 'cannot judge',
      reason: 'Could not identify the tool being called (tool_name missing). Cannot judge, so confirmation is required.' };
  }

  if (tool === 'Bash') {
    const cmd = String(input.command || '');
    if (!cmd.trim()) {
      return { decision: 'ask', category: 'cannot judge',
        reason: 'This is a Bash call but the command could not be read. Cannot judge, so confirmation is required.' };
    }
    const hits = patternHits(cmd);
    if (mentionsProtectedPath(cmd, payload && payload.cwd) && BASH_WRITE_HINTS.test(cmd)) {
      hits.push({ category: 'enforcement-config change' });
    }
    if (hits.length) {
      const cats = [...new Set(hits.map(h => h.category))].join(' · ');
      return {
        decision: 'ask',
        category: cats,
        reason:
          `Classified as an irreversible action (${cats}).\n` +
          `Command: ${cmd.length > 300 ? cmd.slice(0, 300) + ' …' : cmd}\n\n` +
          `Before approving, confirm: the exact target / the blast radius / how to roll back.\n` +
          `(SKILL.md stage 3: "an irreversible operation requires showing the target, scope, and rollback path before approval")`,
      };
    }
    return { decision: 'defer', reason: 'No registered irreversible action recognized' };
  }

  if (WRITE_TOOLS.has(tool)) {
    const p = String(input.file_path || input.notebook_path || '');
    // Resolve relative paths against the call's working directory so that a
    // relative write ("scripts/hooks/x.js") from inside the plugin root is
    // judged by where it actually lands.
    let resolved = p;
    try {
      if (p && payload && payload.cwd) resolved = path.resolve(String(payload.cwd), p);
    } catch { /* an unresolvable path is judged as given */ }
    if (SELF_PROTECTED.some(re => re.test(p) || re.test(resolved))) {
      return {
        decision: 'ask',
        category: 'enforcement-config change',
        reason:
          `This modifies the harness's own enforcement configuration.\nTarget: ${p}\n\n` +
          `If this file changes, the gate itself can be neutralized. Confirm the change is intended.`,
      };
    }
    return { decision: 'defer', reason: 'No registered irreversible action recognized' };
  }

  // Unregistered tools are not treated as protected. They go to the normal flow.
  return { decision: 'defer', reason: 'No registered irreversible action recognized' };
}

/* ── Context warnings (best-effort; never change the decision) ────── */

function sessionMarkerPath(sessionId) {
  return path.join(MARY_DIR, `_trifecta-${String(sessionId).replace(/[^A-Za-z0-9-]/g, '')}.json`);
}

/**
 * Append two observations to the text the human is about to approve.
 * Both are visibility, not judgment — failing to compute them never changes
 * the decision, and neither ever produces an automatic allow or deny.
 *
 * 1. Cross-session: another session's still-open approval targeting the same
 *    working directory means the state the user just reviewed may have changed.
 *    Splitting the ledger per session would HIDE this — sharing one ledger is
 *    what makes it visible. (Limitation: matching is by cwd string; two clones
 *    of the same remote in different folders are not detected.)
 *
 * 2. Lethal trifecta (L12): this session has already ingested untrusted external
 *    content (recorded by mary-trifecta-sentinel.js) and the call being approved
 *    is an external send. Two of the three legs are observable; private-data
 *    access, the third, is not reliably detectable — so this is a warning shown
 *    to the human, never a block.
 */
function withContextWarnings(v, payload) {
  let reason = v.reason;
  try {
    const sid = payload.session_id || null;
    const cwd = payload.cwd ? String(payload.cwd).toLowerCase() : null;
    if (cwd) {
      const others = openApprovals().filter(a =>
        a.session && a.session !== sid && a.cwd && String(a.cwd).toLowerCase() === cwd);
      if (others.length) {
        reason += `\n\n⚠ ${others.length} unresolved approval(s) from other session(s) target this working directory. ` +
          `Their outcomes are unknown — the state you just reviewed may have changed. ` +
          `(Close them after observing side effects: node scripts/mary-reconcile.js)`;
      }
    }
  } catch { /* visibility is best-effort */ }
  try {
    // 'gate bypass' is included deliberately: a wrapped or encoded command cannot
    // be read, so it MAY be a send — excluding it would exempt exactly the
    // commands built to evade reading.
    if (/external send|gate bypass/.test(v.category || '') && payload.session_id) {
      const marker = sessionMarkerPath(payload.session_id);
      if (fs.existsSync(marker)) {
        let seen = '';
        try {
          const m = JSON.parse(fs.readFileSync(marker, 'utf8'));
          seen = Object.entries(m.sources || {}).map(([k, n]) => `${k}×${n}`).join(', ');
        } catch { seen = 'marker unreadable'; }
        reason += `\n\n⚠ lethal-trifecta signal (L12): this session has ingested untrusted external content` +
          (seen ? ` (${seen})` : '') +
          ` and this call is an external send — or a wrapper the gate cannot read, which may be one. ` +
          `If the session also touched private data, all three legs are present. ` +
          `Check exactly what is being sent before approving.`;
      }
    }
  } catch { /* visibility is best-effort */ }
  return reason;
}

/* ── Output ─────────────────────────────────────────────────────── */

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `[${HOOK_ID}] ${reason}`,
    },
  }));
  process.exit(0);
}

/* ── Entry point ────────────────────────────────────────────────── */

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => emit('ask', 'Could not read hook input (stdin error). Cannot judge.'));
  process.stdin.on('end', () => {
    // Empty input is not replaced with {}. That would disguise "no information"
    // as "harmless call".
    if (!raw.trim()) {
      return emit('ask', 'Hook input is empty. Nothing is known about what would run, so confirmation is required.');
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      // fail-closed: a parse failure is not a pass.
      return emit('ask', `Could not parse hook input (${e && e.message}). Cannot judge, so confirmation is required.`);
    }

    const v = decide(payload);
    if (v.decision === 'ask') v.reason = withContextWarnings(v, payload);

    if (v.decision === 'ask') {
      // Record the approval request in the ledger. The sentence a human saw
      // (presented_text) and the machine-matching hash (request_hash) are stored
      // separately — they serve different purposes.
      // The STORED copies are secret-masked (the ledger is plaintext forever);
      // the hash is computed over the raw input so approval→outcome matching is
      // unaffected, and the dialog itself shows the unmasked original.
      const maskedText = maskSecrets(v.reason);
      const maskedInput = maskDeep(payload.tool_input || {});
      const redacted = maskedText !== v.reason ||
        JSON.stringify(maskedInput) !== JSON.stringify(payload.tool_input || {});
      append({
        event: 'asked',
        session: payload.session_id || null,
        cwd: payload.cwd || null,
        tool: payload.tool_name || null,
        category: v.category || null,
        request_hash: requestHash(payload.tool_name, payload.tool_input),
        presented_text: maskedText,
        request: maskedInput,
        ...(redacted ? { redacted: true } : {}),
      });
    }

    emit(v.decision, v.reason);
  });
}

// Unexpected exceptions also end in confirmation, not in a pass.
process.on('uncaughtException', e => emit('ask', `Internal hook error (${e && e.message}). Cannot judge.`));

if (require.main === module) main();

module.exports = { decide, BASH_PATTERNS, SELF_PROTECTED, PLUGIN_ROOT };
