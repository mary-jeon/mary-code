'use strict';

/**
 * Mary — approval ledger (append-only)
 *
 * The only record that binds an approval to its execution. There is exactly one
 * rule: **append only.** Existing lines are never edited or deleted. Current state
 * is not stored — it is computed by folding the log.
 *
 * Why append-only — hooks run in separate processes, concurrently. Read-modify-write
 * silently loses one side's record (lost update). Appending one line at a time means
 * that in the worst case ordering gets shuffled, but records survive. State can be
 * computed on the reading side.
 *
 * State transitions come from folding the log:
 *   asked → succeeded | failed        (written by the outcome hook)
 *   asked → denied                    (user denial, when the host emits PermissionDenied)
 *   asked → (nothing arrives) = unknown  (session died, or the denial was never observed)
 *
 * unknown means "we do not know" — not "it did not run". It must never be used as
 * grounds for an automatic retry.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const MARY_DIR = process.env.MARY_DIR || path.join(HOME, '.claude', 'mary');
const LEDGER = path.join(MARY_DIR, 'approvals.jsonl');

/**
 * Canonicalize a request so that key order and whitespace cannot turn the same
 * request into different hashes. The hash is for machine matching; what the human
 * confirms is presented_text — they are different things.
 */
function canonicalize(toolName, toolInput) {
  const walk = v => {
    if (v === null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(walk);
    return Object.keys(v).sort().reduce((o, k) => { o[k] = walk(v[k]); return o; }, {});
  };
  return JSON.stringify({ tool: String(toolName || ''), input: walk(toolInput || {}) });
}

function requestHash(toolName, toolInput) {
  return 'sha256:' + crypto.createHash('sha256')
    .update(canonicalize(toolName, toolInput), 'utf8')
    .digest('hex').slice(0, 32);
}

/** Never throws. A failed write must not change a gate decision. */
function append(record) {
  try {
    fs.mkdirSync(MARY_DIR, { recursive: true });
    fs.appendFileSync(LEDGER, JSON.stringify({ ts: new Date().toISOString(), ...record }) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

function readAll() {
  try {
    return fs.readFileSync(LEDGER, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(l => { try { return JSON.parse(l); } catch { return null; } })
      .filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Fold the log to find approvals that never received an outcome.
 * If the same request_hash was asked multiple times, only as many are considered
 * closed as there are outcomes.
 */
function openApprovals() {
  const asked = [];
  const closed = new Map();
  for (const r of readAll()) {
    if (r.event === 'asked') asked.push(r);
    else if (r.event === 'succeeded' || r.event === 'failed' || r.event === 'denied') {
      closed.set(r.request_hash, (closed.get(r.request_hash) || 0) + 1);
    }
  }
  const remaining = new Map(closed);
  return asked.filter(a => {
    const n = remaining.get(a.request_hash) || 0;
    if (n > 0) { remaining.set(a.request_hash, n - 1); return false; }
    return true;
  });
}

module.exports = { canonicalize, requestHash, append, readAll, openApprovals, LEDGER, MARY_DIR };
