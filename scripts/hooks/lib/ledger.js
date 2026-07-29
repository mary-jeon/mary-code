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

/* ── Secret masking ─────────────────────────────────────────────────
 * The ledger stores request text in plaintext forever. A gated command like
 * `curl -H "Authorization: Bearer xxx"` would otherwise leave the token in the
 * ledger long after the command ran (L17 prompt-log-retention-leak) — the same
 * reason the outcome recorder never stores response bodies. Masking applies
 * only to the STORED copy (presented_text / request); the hash is computed over
 * the raw input, so approval→outcome matching is unaffected, and the dialog the
 * human sees is the unmasked original.
 *
 * Pattern-based masking is best-effort, not a guarantee — an unrecognized
 * secret format still lands in plaintext. That limitation is documented in
 * docs/threat-model.md rather than papered over.
 */
const SECRET_PATTERNS = [
  // header/assignment forms: keep the key, mask the value
  [/(authorization\s*[:=]\s*)(bearer\s+|basic\s+)?[^\s"'&;]+/gi, '$1$2«masked»'],
  [/\b((?:api[_-]?key|apikey|token|secret|passwd|password|access[_-]?key|client[_-]?secret)\s*[=:]\s*)[^\s"'&;]+/gi, '$1«masked»'],
  // well-known token shapes
  [/\bAKIA[0-9A-Z]{16}\b/g, '«masked»'],                             // AWS access key id
  [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, '«masked»'],                   // GitHub tokens
  [/\bsk-[A-Za-z0-9_-]{20,}\b/g, '«masked»'],                        // API secret keys (sk-…)
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '«masked»'],                 // Slack tokens
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g, '«masked»'], // JWT
];

function maskSecrets(s) {
  let out = String(s);
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Mask every string value in an object tree (used on the stored request copy). */
function maskDeep(v) {
  if (typeof v === 'string') return maskSecrets(v);
  if (Array.isArray(v)) return v.map(maskDeep);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) o[k] = maskDeep(v[k]);
    return o;
  }
  return v;
}

function normalizeCwd(cwd) {
  if (!cwd) return null;
  try { return path.resolve(String(cwd)); } catch { return String(cwd); }
}

function compactRequest(toolInput) {
  const input = toolInput && typeof toolInput === 'object' ? toolInput : {};
  const contentKeys = new Set(['content', 'old_string', 'new_string', 'cell_source', 'new_source']);
  const walk = (value, key = '') => {
    if (typeof value === 'string' && contentKeys.has(key)) {
      return {
        omitted: true,
        bytes: Buffer.byteLength(value, 'utf8'),
        sha256: crypto.createHash('sha256').update(value, 'utf8').digest('hex'),
      };
    }
    if (Array.isArray(value)) return value.map(v => walk(v));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = walk(v, k);
      return out;
    }
    return typeof value === 'string' ? maskSecrets(value) : value;
  };
  return walk(input);
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

function readLedger() {
  const result = { records: [], readError: null, parseErrors: [] };
  let text;
  try {
    text = fs.readFileSync(LEDGER, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return result;
    result.readError = error && error.message ? error.message : String(error);
    return result;
  }
  text.split('\n').forEach((line, index) => {
    if (!line) return;
    try { result.records.push(JSON.parse(line)); }
    catch (error) {
      result.parseErrors.push({ line: index + 1, error: error && error.message ? error.message : String(error) });
    }
  });
  return result;
}

function readAll() {
  return readLedger().records;
}

/** Fold the log to find approvals that never received an outcome. */
function openApprovalsDetailed() {
  const { records, readError, parseErrors } = readLedger();
  const entries = [];
  const CLOSERS = new Set(['succeeded', 'failed', 'denied', 'reconciled']);

  for (const r of records) {
    if (r.event === 'asked') {
      entries.push({ rec: r, closed: false });
      continue;
    }
    if (!CLOSERS.has(r.event)) continue;

    let target = null;
    if (r.event === 'reconciled') {
      target = entries.find(e => !e.closed && e.rec.request_hash === r.request_hash);
    } else {
      if (r.tool_use_id) {
        target = entries.find(e => !e.closed && e.rec.tool_use_id === r.tool_use_id);
      }
      if (!target && r.request_hash && r.session && r.cwd) {
        const cwd = normalizeCwd(r.cwd);
        target = entries.find(e => !e.closed && !e.rec.tool_use_id &&
          e.rec.request_hash === r.request_hash && e.rec.session === r.session &&
          normalizeCwd(e.rec.cwd) === cwd);
      }
    }
    if (target) target.closed = true;
  }

  return {
    approvals: entries.filter(e => !e.closed).map(e => e.rec),
    integrity: { readError, parseErrors },
  };
}

function openApprovals() {
  return openApprovalsDetailed().approvals;
}

module.exports = { canonicalize, requestHash, append, readAll, readLedger,
  openApprovals, openApprovalsDetailed, normalizeCwd, compactRequest,
  maskSecrets, maskDeep, LEDGER, MARY_DIR };
