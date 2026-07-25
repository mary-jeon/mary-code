#!/usr/bin/env node
/**
 * Mary — FAILLOG / _work auditor (read-only)
 *
 *   node scripts/mary-stats.js
 *
 * Recomputes counter arithmetic and rule-promotion candidacy in code instead of
 * trusting the model's memory. The judgment SKILL.md stage 5 requires ("same key
 * in two different task_ids") is mechanical, and mechanical computation performed
 * by an LLM is itself an error source (L4 plan-execution-mismatch). So it lives here.
 *
 * This script fixes nothing. It only reports inconsistencies — whether to fix them
 * is decided by the procedure (stage 5).
 *
 * Honest limitation: the FAILLOG body is lossy compression. Promoted failures are
 * collapsed from two lines into one, so a body recount is a **lower bound** on the
 * counters, not an equation. Therefore a body-count/counter mismatch alone is not
 * an error; only a counter that is *smaller* than the body count is reported as a
 * definite contradiction.
 *
 * Labels are matched bilingually (English and Korean) so ledgers created by
 * earlier Korean skeletons keep auditing cleanly.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const MARY_DIR = process.env.MARY_DIR || path.join(HOME, '.claude', 'mary');

function readIfExists(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}

/* ── FAILLOG parsing ─────────────────────────────────────────────── */

const COUNTER_KEYS = [
  ['tasks',     /^-\s*(harness tasks run|실행된 하네스 작업)\s*[:：]\s*(\d+)/],
  ['completed', /^-\s*(verified complete[^:：]*|검증 완료[^:：]*)[:：]\s*(\d+)/],
  ['blocked',   /^-\s*(blocked\/failed[^:：]*|차단·실패[^:：]*)[:：]\s*(\d+)/],
  ['stopped',   /^-\s*(user-stopped[^:：]*|사용자 중단[^:：]*)[:：]\s*(\d+)/],
  ['failures',  /^-\s*(failures found|발견된 실패)\s*[:：]\s*(\d+)/],
  ['rejected',  /^-\s*(rejected counterexamples|기각된 반례)\s*[:：]\s*(\d+)/],
];

function parseFaillog(text) {
  const counters = {};
  for (const line of text.split('\n')) {
    for (const [key, re] of COUNTER_KEYS) {
      const m = line.match(re);
      if (m && counters[key] === undefined) counters[key] = Number(m[2]);
    }
  }

  // Entries: "- YYYY-MM-DD | task:ID | L<n>/<key> | scope: X | failure:|rejected: …"
  // Continuation lines (indented, starting with |) belong to the same entry.
  const entries = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (/^-\s*\d{4}-\d{2}-\d{2}\s*\|/.test(line)) {
      if (cur) entries.push(cur);
      cur = line;
    } else if (cur && /^\s+\|/.test(line)) {
      cur += ' ' + line.trim();
    } else {
      if (cur) entries.push(cur);
      cur = null;
    }
  }
  if (cur) entries.push(cur);

  const parsed = entries.map(e => {
    const task = (e.match(/task:\s*([\w가-힣.-]+)/) || [])[1] || null;
    const key = (e.match(/\bL(?:\d+(?:-[A-Z])?|\?)\/[a-z0-9?-]+/i) || [])[0] || null;
    const scope = (e.match(/scope:\s*([^\s|]+)/) || [])[1] || null;
    const kind = /\|\s*(rejected|기각)\s*[:：]/.test(e) ? 'rejected'
               : /\|\s*(failure|실패)\s*[:：]/.test(e) ? 'failure' : 'unknown';
    return { task, key, scope, kind, raw: e };
  });

  return { counters, entries: parsed };
}

/* ── _work parsing ───────────────────────────────────────────────── */

function parseWork(text, file) {
  const grab = k => {
    const m = text.match(new RegExp(`^${k}\\s*:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  return { file, status: grab('status'), counted: grab('counted_status'), task: grab('task_id') };
}

/* ── Analysis ────────────────────────────────────────────────────── */

const BUCKET = {
  completed: 'completed',
  blocked: 'blocked-failed', failed: 'blocked-failed',
  paused: 'stopped', abandoned: 'stopped',
  draft: 'none', active: 'none',
};

function analyze({ faillog, works }) {
  const report = { candidates: [], warnings: [], recount: {}, counters: faillog.counters, works };

  const failures = faillog.entries.filter(e => e.kind === 'failure');
  const rejected = faillog.entries.filter(e => e.kind === 'rejected');
  report.recount = { failures: failures.length, rejected: rejected.length };

  // Promotion candidates: failures only, no /other, two or more distinct tasks
  const byKey = new Map();
  for (const f of failures) {
    if (!f.key || /\/other$/i.test(f.key) || !f.task) continue;
    if (!byKey.has(f.key)) byKey.set(f.key, new Map());
    byKey.get(f.key).set(f.task, f.scope);
  }
  for (const [key, tasks] of byKey) {
    if (tasks.size >= 2) {
      const scopes = [...new Set([...tasks.values()].filter(Boolean))];
      report.candidates.push({ key, tasks: [...tasks.keys()], scopes });
    }
  }

  // Only definite contradictions are warned about (body is lossy → lower bound)
  const c = faillog.counters;
  if (c.failures !== undefined && c.failures < failures.length) {
    report.warnings.push(`failures counter (${c.failures}) is smaller than the number of failure entries in the body (${failures.length})`);
  }
  if (c.rejected !== undefined && c.rejected < rejected.length) {
    report.warnings.push(`rejected counter (${c.rejected}) is smaller than the number of rejected entries in the body (${rejected.length})`);
  }
  const sum = (c.completed || 0) + (c.blocked || 0) + (c.stopped || 0);
  if (c.tasks !== undefined && sum > c.tasks) {
    report.warnings.push(`bucket sum (${sum}) exceeds harness tasks run (${c.tasks}) — the denominator is off`);
  }

  // _work consistency
  const seen = new Map();
  for (const w of works) {
    if (!w.task) { report.warnings.push(`${w.file}: task_id missing`); continue; }
    if (seen.has(w.task)) report.warnings.push(`duplicate task_id: ${w.task} (${seen.get(w.task)}, ${w.file})`);
    seen.set(w.task, w.file);
    const expect = BUCKET[w.status];
    if (expect && w.counted && w.counted !== expect && w.counted !== 'none') {
      report.warnings.push(`${w.file}: status=${w.status} but counted_status=${w.counted} (expected: ${expect} or none)`);
    }
  }

  return report;
}

/* ── Output ──────────────────────────────────────────────────────── */

function main() {
  const faillogText = readIfExists(path.join(MARY_DIR, 'FAILLOG.md'));
  if (faillogText === null) {
    console.log(`FAILLOG.md not found (${MARY_DIR}) — nothing to audit.`);
    return;
  }
  const works = [];
  try {
    for (const f of fs.readdirSync(MARY_DIR)) {
      if (/^_work-.*\.md$/.test(f)) works.push(parseWork(readIfExists(path.join(MARY_DIR, f)) || '', f));
    }
  } catch { /* if the directory is unreadable, works stays empty */ }

  const r = analyze({ faillog: parseFaillog(faillogText), works });

  console.log('# mary-stats — recomputed (read-only)\n');
  console.log('recorded counters:', JSON.stringify(r.counters));
  console.log('body recount     :', `failures ${r.recount.failures} (lower bound) · rejected ${r.recount.rejected} (lower bound)`);
  console.log('\nactive _work files:', r.works.length ? '' : 'none');
  for (const w of r.works) console.log(`  - ${w.file} · status=${w.status} · counted=${w.counted} · task=${w.task}`);
  console.log('\npromotion candidates (2+ distinct tasks, /other excluded):', r.candidates.length ? '' : 'none');
  for (const cd of r.candidates) console.log(`  - ${cd.key} · tasks: ${cd.tasks.join(', ')} · scopes: ${cd.scopes.join(', ') || '?'}`);
  console.log('\nwarnings:', r.warnings.length ? '' : 'none');
  for (const w of r.warnings) console.log(`  ! ${w}`);
}

if (require.main === module) main();

module.exports = { parseFaillog, parseWork, analyze };
