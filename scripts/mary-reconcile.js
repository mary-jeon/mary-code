#!/usr/bin/env node
/**
 * Mary — close an open approval after observing its real side effects
 *
 *   node scripts/mary-reconcile.js --list
 *   node scripts/mary-reconcile.js <request_hash> --outcome ran|not-run|superseded \
 *       --evidence "<what was actually observed>" [--note "<context>"]
 *
 * An approval whose outcome was never recorded is **unknown** — not failed.
 * unknown never resolves by itself: someone has to observe the side effects
 * (file state, git history, remote refs) and write down what they saw.
 * This CLI is that write-down. It appends a `reconciled` event; it never edits
 * or deletes existing lines (the ledger stays append-only).
 *
 * Rules (all deliberate):
 *  - evidence is mandatory. A closure without observation is exactly the
 *    phantom-execution failure (L11) the ledger exists to prevent.
 *  - refuses to close a hash that has no open `asked` entry. Closing what was
 *    never asked would turn the ledger into fiction.
 *  - closes ONE open instance per invocation. If the same hash was asked
 *    multiple times, each instance needs its own observation.
 *  - `reconciled` grants nothing. It only stops a resolved unknown from being
 *    re-reported every session start. It is never a basis for retry or approval.
 */

'use strict';

const { append, openApprovals } = require('./hooks/lib/ledger');

const OUTCOMES = new Set(['ran', 'not-run', 'superseded']);

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--list') args.list = true;
    else if (a === '--outcome' || a === '--evidence' || a === '--note') {
      args[a.slice(2)] = argv[++i];
    } else args._.push(a);
  }
  return args;
}

function fmt(a) {
  const when = String(a.ts || '').replace('T', ' ').slice(0, 16);
  const what = a.request && a.request.command
    ? String(a.request.command).slice(0, 100)
    : (a.request && (a.request.file_path || a.request.notebook_path)) || '(no content)';
  return `- ${when} · ${a.tool || '?'} · ${a.category || 'uncategorized'} · ${a.request_hash}\n    ${what}`;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const open = openApprovals();

  if (args.list || args._.length === 0) {
    if (!open.length) { console.log('No open approvals. Nothing to reconcile.'); return; }
    // Reading the ledger is itself recorded in the ledger: invoking this CLI is
    // a gated action, so its own `asked` entry is appended BEFORE the command
    // runs, and the outcome recorder closes it only after it exits. A fold
    // computed here therefore sees this very call as one open approval. That is
    // the append-only design working, not a leak — but unmarked it reads as
    // "one more thing to close". Mark the newest matching entry.
    const selfRe = /\bmary-reconcile(\.js)?\b/i;
    let selfIdx = -1;
    open.forEach((a, i) => {
      const cmd = a.request && a.request.command;
      if (cmd && selfRe.test(String(cmd))) selfIdx = i;
    });
    console.log(`${open.length} open approval(s):\n`);
    open.forEach((a, i) => {
      console.log(fmt(a) + (i === selfIdx
        ? '\n    ↑ likely this very call — its own gate entry; the outcome recorder closes it when this command exits'
        : ''));
    });
    console.log('\nClose one after observing its side effects:');
    console.log('  node scripts/mary-reconcile.js <request_hash> --outcome ran|not-run|superseded --evidence "..."');
    return;
  }

  let hash = String(args._[0]);
  if (!hash.startsWith('sha256:')) hash = 'sha256:' + hash;

  const matching = open.filter(a => a.request_hash === hash);
  if (!matching.length) {
    console.error(`No OPEN approval with hash ${hash}.`);
    console.error('Either it was already closed, or it was never asked. Run --list to see open ones.');
    process.exit(1);
  }
  if (!args.outcome || !OUTCOMES.has(args.outcome)) {
    console.error('Missing or invalid --outcome. One of: ran | not-run | superseded');
    process.exit(1);
  }
  if (!args.evidence || !String(args.evidence).trim()) {
    console.error('Missing --evidence. State what was actually observed (file state, git ref, mtime …).');
    console.error('A closure without observation is the exact failure this ledger exists to prevent.');
    process.exit(1);
  }

  // `by` records the writing tool, not a claim about who observed. This CLI
  // cannot know whether a human or an agent invoked it; the binding to a human
  // is the gate — invoking mary-reconcile through Bash is itself a gated action,
  // so the approval dialog shows the hash, outcome, and evidence to a person
  // before this line is ever written.
  const ok = append({
    event: 'reconciled',
    request_hash: hash,
    outcome: args.outcome,
    evidence: String(args.evidence).trim(),
    note: args.note ? String(args.note).trim() : undefined,
    by: 'reconcile-cli',
  });
  if (!ok) { console.error('Ledger append failed. Nothing was recorded.'); process.exit(1); }

  const left = matching.length - 1;
  console.log(`Reconciled ${hash} as "${args.outcome}".`);
  if (left > 0) console.log(`Note: ${left} more open instance(s) of this same hash remain — each needs its own observation.`);
}

if (require.main === module) main();

module.exports = { parseArgs };
