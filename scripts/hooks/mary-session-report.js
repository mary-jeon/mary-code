#!/usr/bin/env node
/**
 * Mary — SessionStart unresolved-approval report
 *
 * Puts approvals that never received an outcome into Claude's context at session
 * start. SKILL.md requires "check in-progress work on resume"; this hook makes
 * that check come from the **ledger**, not from the agent's memory.
 *
 * An open approval means "we do not know" — not "it did not happen".
 * So the instruction is to observe the outcome first, never to retry.
 */

'use strict';

const { openApprovalsDetailed } = require('./lib/ledger');

const MAX_SHOWN = 5;

function buildContext() {
  let result;
  try { result = openApprovalsDetailed(); }
  catch { return '[mary] Approval ledger could not be inspected. Treat approval state as unknown.'; }

  const { approvals: open, integrity } = result;
  const integrityLines = [];
  if (integrity.readError) integrityLines.push(`- ledger read error: ${integrity.readError}`);
  if (integrity.parseErrors.length) {
    integrityLines.push(`- ${integrity.parseErrors.length} malformed ledger line(s): ${integrity.parseErrors.map(e => e.line).join(', ')}`);
  }
  if (!open.length && !integrityLines.length) return null;

  const lines = open.slice(0, MAX_SHOWN).map(a => {
    const when = String(a.ts || '').replace('T', ' ').slice(0, 16);
    const identity = a.tool_use_id ? `tool_use_id: ${a.tool_use_id}` : `request_hash: ${a.request_hash}`;
    return `- ${when} · ${a.tool || '?'} · ${a.category || 'uncategorized'}\n  ${identity}`;
  });
  const more = open.length > MAX_SHOWN ? `\n(${open.length - MAX_SHOWN} more not shown)` : '';

  return [
    integrityLines.length ? '[mary] WARNING: approval ledger integrity could not be established.' : null,
    ...integrityLines,
    integrityLines.length ? 'Do not interpret missing records as proof that no approval is open.' : null,
    open.length ? `[mary] ${open.length} approval(s) have no recorded outcome.` : null,
    '',
    ...lines,
    more,
    open.length ? '' : null,
    open.length ? 'The state of these items is **unknown** — not failed; the outcome was never observed.' : null,
    open.length ? '**Do not retry automatically.** The action may in fact have run.' : null,
    open.length ? 'First observe the real side effects, then reconcile by request hash using the local ledger.' : null,
    'Ledger: ~/.claude/mary/approvals.jsonl',
  ].filter(v => v !== null && v !== undefined).join('\n');
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    const ctx = buildContext();
    if (ctx) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx },
      }));
    }
    process.exit(0);
  });
}

process.on('uncaughtException', () => process.exit(0));

if (require.main === module) main();

module.exports = { buildContext };
