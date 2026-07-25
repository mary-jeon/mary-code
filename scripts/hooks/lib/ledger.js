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
 *   asked → reconciled                (a human observed the real side effects afterwards and
 *                                      closed it via scripts/mary-reconcile.js, evidence attached)
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
 *
 * Matching rules (each closes at most ONE open asked entry):
 *  - Chronological, floor at zero: a closing event only closes an asked entry
 *    that is already open at that point in the log. A surplus close is dropped,
 *    never banked — otherwise a stray extra outcome would silently pre-pay the
 *    NEXT time the same command is asked, and that approval could end unknown
 *    without ever being reported.
 *  - succeeded/failed/denied bind by hash AND session: an outcome observed in
 *    session B must not close session A's still-unknown approval for the same
 *    command. If the outcome has no session, or only session-less asked entries
 *    exist, it falls back to hash-only (old ledgers keep folding).
 *  - reconciled binds by hash only: a human observing side effects is not
 *    scoped to the session that asked.
 */
function openApprovals() {
  const entries = [];               // asked entries in file order
  const byHash = new Map();         // hash -> asked entries (same order)
  const CLOSERS = new Set(['succeeded', 'failed', 'denied', 'reconciled']);
  for (const r of readAll()) {
    if (r.event === 'asked') {
      const e = { rec: r, closed: false };
      entries.push(e);
      if (!byHash.has(r.request_hash)) byHash.set(r.request_hash, []);
      byHash.get(r.request_hash).push(e);
    } else if (CLOSERS.has(r.event)) {
      const q = byHash.get(r.request_hash);
      if (!q) continue;
      let target;
      if (r.event !== 'reconciled' && r.session) {
        target = q.find(e => !e.closed && e.rec.session === r.session)
              || q.find(e => !e.closed && !e.rec.session);
      } else {
        target = q.find(e => !e.closed);
      }
      if (target) target.closed = true;
    }
  }
  return entries.filter(e => !e.closed).map(e => e.rec);
}

module.exports = { canonicalize, requestHash, append, readAll, openApprovals, LEDGER, MARY_DIR };
