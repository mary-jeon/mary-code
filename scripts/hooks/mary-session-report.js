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

const { openApprovals } = require('./lib/ledger');

const MAX_SHOWN = 5;

function buildContext() {
  let open;
  try {
    open = openApprovals();
  } catch {
    return null;
  }
  if (!open.length) return null;

  const lines = open.slice(-MAX_SHOWN).map(a => {
    const when = String(a.ts || '').replace('T', ' ').slice(0, 16);
    const what = a.request && a.request.command
      ? String(a.request.command).slice(0, 120)
      : (a.request && (a.request.file_path || a.request.notebook_path)) || '(no content)';
    return `- ${when} · ${a.tool || '?'} · ${a.category || 'uncategorized'}\n  ${what}\n  request_hash: ${a.request_hash}`;
  });

  const more = open.length > MAX_SHOWN ? `\n(${open.length - MAX_SHOWN} more not shown)` : '';

  return [
    `[mary] ${open.length} approval(s) have no recorded outcome.`,
    '',
    ...lines,
    more,
    '',
    'The state of these items is **unknown** — not failed; the outcome was never observed.',
    '**Do not retry automatically.** The action may in fact have run.',
    'First observe the real side effects to establish whether it ran, then report the result to the user.',
    `Ledger: ~/.claude/mary/approvals.jsonl`,
  ].filter(Boolean).join('\n');
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
