#!/usr/bin/env node
/**
 * mary-stats auditor tests
 *
 *   node tests/stats.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { parseFaillog, parseWork, analyze } =
  require(path.join(__dirname, '..', 'scripts', 'mary-stats.js'));

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); pass++; }
  catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); fail++; }
}

const FAILLOG_EN = `# FAILLOG — observed failures

## Totals

- harness tasks run: 5
- verified complete (completed): 2
- blocked/failed: 1
- user-stopped (paused/abandoned): 1
- failures found: 4
- rejected counterexamples: 1

## Unresolved failures

- 2026-07-01 | task:20260701-alpha-001 | L17/cache-staleness | scope: web-research
  | failure: judged a stale cache to be current
  | evidence: URL
- 2026-07-10 | task:20260710-beta-002 | L17/cache-staleness | scope: pdf-review
  | failure: same failure reproduced
- 2026-07-12 | task:20260710-beta-002 | L17/cache-staleness | scope: pdf-review
  | failure: repeat within the same task — not counted as recurrence
- 2026-07-15 | task:20260715-gamma-003 | L2/other | scope: code
  | failure: unnamed phenomenon — other is excluded from promotion

## Rejected counterexamples

- 2026-07-16 | task:20260716-delta-004 | L17/cache-staleness | scope: web-research
  | rejected: did not reproduce
  | reason: the origin had updated, not the cache
`;

// Ledgers created by earlier Korean skeletons must keep auditing cleanly.
const FAILLOG_KO = `# FAILLOG — 관측된 실패 기록

## 누적

- 실행된 하네스 작업: 3
- 검증 완료(completed): 1
- 차단·실패(blocked/failed): 1
- 사용자 중단(paused/abandoned): 1
- 발견된 실패: 2
- 기각된 반례: 1

## 미해결 실패

- 2026-07-01 | task:20260701-alpha-001 | L17/cache-staleness | scope: web-research
  | 실패: 오래된 캐시를 최신으로 판정
- 2026-07-10 | task:20260710-beta-002 | L17/cache-staleness | scope: pdf-review
  | 실패: 같은 실패 재현

## 기각한 반례

- 2026-07-16 | task:20260716-delta-004 | L3/omission-hallucination | scope: web-research
  | 기각: 재현 안 됨
  | 사유: 원문이 갱신된 것
`;

console.log('\n[FAILLOG parsing — English skeleton]');
const fl = parseFaillog(FAILLOG_EN);
t('reads the counters', () => {
  assert.deepStrictEqual(fl.counters,
    { tasks: 5, completed: 2, blocked: 1, stopped: 1, failures: 4, rejected: 1 });
});
t('entry counts: 4 failures · 1 rejected', () => {
  assert.strictEqual(fl.entries.filter(e => e.kind === 'failure').length, 4);
  assert.strictEqual(fl.entries.filter(e => e.kind === 'rejected').length, 1);
});
t('extracts task, key, scope', () => {
  const first = fl.entries[0];
  assert.strictEqual(first.task, '20260701-alpha-001');
  assert.strictEqual(first.key, 'L17/cache-staleness');
  assert.strictEqual(first.scope, 'web-research');
});

console.log('\n[FAILLOG parsing — Korean skeleton (backward compatibility)]');
const flKo = parseFaillog(FAILLOG_KO);
t('reads Korean counters', () => {
  assert.deepStrictEqual(flKo.counters,
    { tasks: 3, completed: 1, blocked: 1, stopped: 1, failures: 2, rejected: 1 });
});
t('classifies Korean failure/rejected markers', () => {
  assert.strictEqual(flKo.entries.filter(e => e.kind === 'failure').length, 2);
  assert.strictEqual(flKo.entries.filter(e => e.kind === 'rejected').length, 1);
});

console.log('\n[promotion candidates — SKILL stage 5.4, mechanized]');
const works = [
  parseWork('---\nstatus: blocked\ncounted_status: blocked-failed\ntask_id: 20260710-beta-002\n---\n', '_work-beta.md'),
];
const r = analyze({ faillog: fl, works });
t('two distinct tasks → candidate', () => {
  assert.strictEqual(r.candidates.length, 1);
  assert.strictEqual(r.candidates[0].key, 'L17/cache-staleness');
});
t('repeats within one task count once', () => {
  assert.deepStrictEqual(r.candidates[0].tasks.sort(),
    ['20260701-alpha-001', '20260710-beta-002']);
});
t('rejected entries never count toward promotion', () => {
  assert.ok(!r.candidates[0].tasks.includes('20260716-delta-004'));
});
t('scopes are only the observed ones (union candidate)', () => {
  assert.deepStrictEqual(r.candidates[0].scopes.sort(), ['pdf-review', 'web-research']);
});

console.log('\n[contradiction detection]');
t('consistent state produces no warnings', () => {
  assert.deepStrictEqual(r.warnings, []);
});
t('counter < body count → contradiction warning', () => {
  const broken = parseFaillog(FAILLOG_EN.replace('failures found: 4', 'failures found: 2'));
  const rr = analyze({ faillog: broken, works: [] });
  assert.ok(rr.warnings.some(w => w.includes('failures counter')));
});
t('bucket sum > denominator → contradiction warning', () => {
  const broken = parseFaillog(FAILLOG_EN.replace('harness tasks run: 5', 'harness tasks run: 3'));
  const rr = analyze({ faillog: broken, works: [] });
  assert.ok(rr.warnings.some(w => w.includes('denominator')));
});
t('status vs counted_status mismatch → warning', () => {
  const w = parseWork('---\nstatus: paused\ncounted_status: blocked-failed\ntask_id: 20260720-x-005\n---\n', '_work-x.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('_work-x.md')));
});
t('duplicate task_id → warning', () => {
  const a = parseWork('---\nstatus: active\ncounted_status: none\ntask_id: 20260720-dup-006\n---\n', '_work-a.md');
  const b = parseWork('---\nstatus: active\ncounted_status: none\ntask_id: 20260720-dup-006\n---\n', '_work-b.md');
  const rr = analyze({ faillog: fl, works: [a, b] });
  assert.ok(rr.warnings.some(x => x.includes('duplicate')));
});

console.log(`\n${pass} passed / ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
