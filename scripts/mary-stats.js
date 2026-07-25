#!/usr/bin/env node
/**
 * Mary — FAILLOG·_work 검산기 (읽기 전용)
 *
 *   node scripts/mary-stats.js
 *
 * 카운터 산술과 승격 후보 판정을 모델의 기억이 아니라 코드로 재계산한다.
 * SKILL.md 5단계가 요구하는 판정("같은 키가 서로 다른 task_id 에서 2회")은
 * 기계적인 계산인데, 기계적인 계산을 LLM이 하면 그 자체가 오류원이 된다
 * (L4 plan-execution-mismatch). 그래서 여기로 옮겼다.
 *
 * 아무것도 고치지 않는다. 불일치를 보고만 한다 — 고칠지는 절차(5단계)가 판정한다.
 *
 * 한계(정직하게): FAILLOG 본문은 손실 압축이다. 승격된 실패는 두 줄이 한 줄로
 * 압축되므로 본문 재집계는 누적 카운터의 **하한**이지 등식이 아니다.
 * 그래서 본문 개수와 카운터가 다르다는 것만으로 오류로 판정하지 않고,
 * 카운터가 본문 개수보다 **작을 때만** 확실한 모순으로 보고한다.
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

/* ── FAILLOG 파싱 ─────────────────────────────────────────────── */

const COUNTER_KEYS = [
  ['tasks',     /^-\s*실행된 하네스 작업\s*[:：]\s*(\d+)/],
  ['completed', /^-\s*검증 완료[^:：]*[:：]\s*(\d+)/],
  ['blocked',   /^-\s*차단·실패[^:：]*[:：]\s*(\d+)/],
  ['stopped',   /^-\s*사용자 중단[^:：]*[:：]\s*(\d+)/],
  ['failures',  /^-\s*발견된 실패\s*[:：]\s*(\d+)/],
  ['rejected',  /^-\s*기각된 반례\s*[:：]\s*(\d+)/],
];

function parseFaillog(text) {
  const counters = {};
  for (const line of text.split('\n')) {
    for (const [key, re] of COUNTER_KEYS) {
      const m = line.match(re);
      if (m && counters[key] === undefined) counters[key] = Number(m[1]);
    }
  }

  // 항목: "- YYYY-MM-DD | task:ID | L<n>/<key> | scope: X | 실패:|기각: …"
  // 연속 줄(들여쓰기 | 로 시작)은 같은 항목의 일부다.
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
    const kind = /\|\s*기각\s*[:：]/.test(e) ? 'rejected'
               : /\|\s*실패\s*[:：]/.test(e) ? 'failure' : 'unknown';
    return { task, key, scope, kind, raw: e };
  });

  return { counters, entries: parsed };
}

/* ── _work 파싱 ───────────────────────────────────────────────── */

function parseWork(text, file) {
  const grab = k => {
    const m = text.match(new RegExp(`^${k}\\s*:\\s*(.+)$`, 'm'));
    return m ? m[1].trim() : null;
  };
  return { file, status: grab('status'), counted: grab('counted_status'), task: grab('task_id') };
}

/* ── 분석 ─────────────────────────────────────────────────────── */

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

  // 승격 후보: 실패만, other 제외, 서로 다른 task 2개 이상
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

  // 확실한 모순만 경고한다 (본문은 손실 압축이므로 하한 비교)
  const c = faillog.counters;
  if (c.failures !== undefined && c.failures < failures.length) {
    report.warnings.push(`발견된 실패 카운터(${c.failures})가 본문 실패 항목 수(${failures.length})보다 작다`);
  }
  if (c.rejected !== undefined && c.rejected < rejected.length) {
    report.warnings.push(`기각된 반례 카운터(${c.rejected})가 본문 기각 항목 수(${rejected.length})보다 작다`);
  }
  const sum = (c.completed || 0) + (c.blocked || 0) + (c.stopped || 0);
  if (c.tasks !== undefined && sum > c.tasks) {
    report.warnings.push(`칸 합계(${sum})가 실행된 하네스 작업(${c.tasks})보다 크다 — 분모가 어긋났다`);
  }

  // _work 정합성
  const seen = new Map();
  for (const w of works) {
    if (!w.task) { report.warnings.push(`${w.file}: task_id 없음`); continue; }
    if (seen.has(w.task)) report.warnings.push(`task_id 중복: ${w.task} (${seen.get(w.task)}, ${w.file})`);
    seen.set(w.task, w.file);
    const expect = BUCKET[w.status];
    if (expect && w.counted && w.counted !== expect && w.counted !== 'none') {
      report.warnings.push(`${w.file}: status=${w.status} 인데 counted_status=${w.counted} (기대: ${expect} 또는 none)`);
    }
  }

  return report;
}

/* ── 출력 ─────────────────────────────────────────────────────── */

function main() {
  const faillogText = readIfExists(path.join(MARY_DIR, 'FAILLOG.md'));
  if (faillogText === null) {
    console.log(`FAILLOG.md 없음 (${MARY_DIR}) — 검산할 것이 없다.`);
    return;
  }
  const works = [];
  try {
    for (const f of fs.readdirSync(MARY_DIR)) {
      if (/^_work-.*\.md$/.test(f)) works.push(parseWork(readIfExists(path.join(MARY_DIR, f)) || '', f));
    }
  } catch { /* 폴더를 못 읽으면 works 는 빈 채로 간다 */ }

  const r = analyze({ faillog: parseFaillog(faillogText), works });

  console.log('# mary-stats — 재계산 결과 (읽기 전용)\n');
  console.log('기록된 카운터:', JSON.stringify(r.counters));
  console.log('본문 재집계  :', `실패 ${r.recount.failures}건(하한) · 기각 ${r.recount.rejected}건(하한)`);
  console.log('\n진행 중 _work:', r.works.length ? '' : '없음');
  for (const w of r.works) console.log(`  - ${w.file} · status=${w.status} · counted=${w.counted} · task=${w.task}`);
  console.log('\n승격 후보 (서로 다른 task 2회 이상, other 제외):', r.candidates.length ? '' : '없음');
  for (const cd of r.candidates) console.log(`  - ${cd.key} · tasks: ${cd.tasks.join(', ')} · scopes: ${cd.scopes.join(', ') || '?'}`);
  console.log('\n경고:', r.warnings.length ? '' : '없음');
  for (const w of r.warnings) console.log(`  ! ${w}`);
}

if (require.main === module) main();

module.exports = { parseFaillog, parseWork, analyze };
