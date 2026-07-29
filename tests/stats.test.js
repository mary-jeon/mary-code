#!/usr/bin/env node
/**
 * mary-stats auditor tests
 *
 *   node tests/stats.test.js
 */

'use strict';

const assert = require('assert');
const path = require('path');

const { parseFaillog, parseWork, parseReceipts, receiptContinuity, analyze } =
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

console.log('\n[verification receipts — SKILL 4-4, the auditor is the consumer]');
const RECEIPT_OK = '## Receipt\n```json\n' + JSON.stringify({
  receipt: 'verification', task_id: '20260725-x-001',
  items: [{ check: 'tests pass', cmd: 'node tests/gate.test.js', observed: '52 passed / 0 failed', pass: true }],
}) + '\n```\n';
const RECEIPT_FAILING = '```json\n' + JSON.stringify({
  receipt: 'verification', task_id: '20260725-x-002',
  items: [{ check: 'render ok', cmd: 'open page', observed: 'console error', pass: false }],
}) + '\n```\n';
const RECEIPT_INVALID = '```json\n' + JSON.stringify({
  receipt: 'verification', task_id: '20260725-x-003',
  items: [{ check: 'claimed without running anything', pass: true }],
}) + '\n```\n';

t('a well-formed receipt parses clean', () => {
  const rs = parseReceipts(RECEIPT_OK);
  assert.strictEqual(rs.length, 1);
  assert.deepStrictEqual(rs[0].errors, []);
  assert.strictEqual(rs[0].failing, 0);
});
t('ordinary json blocks are not receipts', () => {
  assert.strictEqual(parseReceipts('```json\n{"a":1}\n```').length, 0);
});
t('a failing item is reported and blocks completed', () => {
  const w = parseWork('---\nstatus: active\ncounted_status: none\ntask_id: 20260725-x-002\n---\n' + RECEIPT_FAILING, '_work-r2.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('failing item')));
});
t('a receipt item without cmd/observed is invalid — that is the phantom-execution shape', () => {
  const w = parseWork('---\nstatus: active\ncounted_status: none\ntask_id: 20260725-x-003\n---\n' + RECEIPT_INVALID, '_work-r3.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('receipt invalid')));
});
t('a valid receipt adds no warnings', () => {
  const w = parseWork('---\nstatus: active\ncounted_status: none\ntask_id: 20260725-x-001\n---\n' + RECEIPT_OK, '_work-r1.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(!rr.warnings.some(x => x.includes('receipt')));
});
t('a receipt-like block with broken JSON is loud, not silent', () => {
  const rs = parseReceipts('```json\n{ "receipt": "verification", broken\n```');
  assert.strictEqual(rs.length, 1);
  assert.ok(rs[0].errors.some(e => e.includes('not valid JSON')));
});
t('fence-case and spacing variants still parse (```JSON, ``` json)', () => {
  const body = JSON.stringify({ receipt: 'verification', items: [{ check: 'c', cmd: 'x', observed: 'y', pass: true }] });
  assert.strictEqual(parseReceipts('```JSON\n' + body + '\n```').length, 1);
  assert.strictEqual(parseReceipts('``` json \n' + body + '\n```').length, 1);
});
t('completed without any receipt is reported — the most likely failure is not writing one', () => {
  const w = parseWork('---\nstatus: completed\ncounted_status: completed\ntask_id: 20260725-x-004\ngrade: Guarded\n---\nno receipt here\n', '_work-r4.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('no verification receipt')));
});
t('completed with a valid receipt is not flagged as missing', () => {
  const receipt = '```json\n' + JSON.stringify({
    receipt: 'verification', task_id: '20260725-x-005',
    items: [{ check: 'c', cmd: 'x', observed: 'y', pass: true }],
  }) + '\n```\n';
  const w = parseWork('---\nstatus: completed\ncounted_status: completed\ntask_id: 20260725-x-005\n---\n' + receipt, '_work-r5.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(!rr.warnings.some(x => x.includes('_work-r5.md')));
});

/* 4-4 requires re-running 4-1 after a fix. Whether that happened is computable
 * from the receipts, and on real records it mostly had not: ~90 % of checks were
 * run once and never again, so a regression had nowhere to show up. */
console.log('\n[receipt continuity across rounds — SKILL 4-4 re-verification]');
const receiptOf = (task, items) => '```json\n' + JSON.stringify({
  receipt: 'verification', task_id: task, items,
}) + '\n```\n';
const item = (check, pass) => ({ check, cmd: 'ran it', observed: 'output', pass });
const workWith = (file, task, ...receipts) =>
  parseWork(`---\nstatus: active\ncounted_status: none\ntask_id: ${task}\n---\n` + receipts.join('\n'), file);

t('one receipt cannot be compared and is not flagged', () => {
  const w = workWith('_work-k1.md', '20260729-k-001', receiptOf('20260729-k-001', [item('a', true)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.strictEqual(w.continuity, null);
  assert.ok(!rr.warnings.some(x => x.includes('_work-k1.md')));
});
t('a check that passed and later fails is a definite contradiction', () => {
  const w = workWith('_work-k2.md', '20260729-k-002',
    receiptOf('20260729-k-002', [item('render has no console error', true)]),
    receiptOf('20260729-k-002', [item('render has no console error', false)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('_work-k2.md') && x.includes('FAILS in receipt')),
    'a fix that broke a previously passing check must be reported');
});
t('wording drift does not hide the same check', () => {
  const w = workWith('_work-k3.md', '20260729-k-003',
    receiptOf('20260729-k-003', [item('Render: no console error.', true)]),
    receiptOf('20260729-k-003', [item('render — no console error', false)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('FAILS in receipt')));
});
t('rounds that share nothing at all contradict 4-4', () => {
  const w = workWith('_work-k4.md', '20260729-k-004',
    receiptOf('20260729-k-004', [item('mass total', true), item('torque margin', true)]),
    receiptOf('20260729-k-004', [item('render ok', true), item('row count', true)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('_work-k4.md') && x.includes('re-run in a later one')));
  assert.strictEqual(w.continuity.carried, 0);
});
t('re-running earlier checks clears the warning and reports a rate', () => {
  const w = workWith('_work-k5.md', '20260729-k-005',
    receiptOf('20260729-k-005', [item('mass total', true), item('torque margin', true)]),
    receiptOf('20260729-k-005', [item('mass total', true), item('render ok', true)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(!rr.warnings.some(x => x.includes('_work-k5.md')));
  assert.strictEqual(w.continuity.carried, 1);
  assert.strictEqual(w.continuity.rounds, 2);
  assert.strictEqual(w.continuity.rate, 25); // 1 of 4 items
});
t('receiptContinuity is a pure function over parsed receipts', () => {
  const rs = parseReceipts(
    receiptOf('t', [item('x', true)]) + receiptOf('t', [item('x', false), item('y', true)]));
  const c = receiptContinuity(rs);
  assert.strictEqual(c.rounds, 2);
  assert.strictEqual(c.total, 3);
  assert.strictEqual(c.carried, 1);
  assert.strictEqual(c.flips.length, 1);
  assert.strictEqual(c.flips[0].from, 1);
  assert.strictEqual(c.flips[0].to, 2);
});
t('two long checks sharing a prefix are different checks', () => {
  // A truncated identity key would merge these and emit a false pass→fail
  // warning; the full normalized string must keep them apart.
  const prefix = 'the assembled fixture renders with zero console errors and the total mass stays under the';
  const w = workWith('_work-k7.md', '20260729-k-007',
    receiptOf('20260729-k-007', [item(prefix + ' 500 kg design limit', true)]),
    receiptOf('20260729-k-007', [item(prefix + ' 450 kg stretch target', false),
                                 item(prefix + ' 500 kg design limit', true)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.strictEqual(w.continuity.flips.length, 0,
    'distinct checks must not be merged into a false pass→fail flip');
  assert.ok(!rr.warnings.some(x => x.includes('_work-k7.md') && x.includes('FAILS')));
});
t('a later round re-running an OLD check does not excuse the round between', () => {
  // R1{a} R2{b} R3{a}: whole-file carried is 1, but round 2's fix was never
  // re-checked against anything — the 0.4.3 code warned only on carried === 0
  // and this shape passed silently.
  const w = workWith('_work-k8.md', '20260729-k-008',
    receiptOf('20260729-k-008', [item('alpha', true)]),
    receiptOf('20260729-k-008', [item('beta', true)]),
    receiptOf('20260729-k-008', [item('alpha', true)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.deepStrictEqual(w.continuity.coldRounds, [2]);
  assert.ok(rr.warnings.some(x => x.includes('_work-k8.md') && x.includes('re-ran nothing')));
});
t('an in-round duplicate is one check and cannot satisfy continuity', () => {
  const w = workWith('_work-k9.md', '20260729-k-009',
    receiptOf('20260729-k-009', [item('gamma: 0 errors', true), item('gamma — 0 errors', true)]),
    receiptOf('20260729-k-009', [item('delta', true)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.strictEqual(w.continuity.total, 2, 'the duplicate collapses within its round');
  assert.strictEqual(w.continuity.carried, 0);
  assert.ok(rr.warnings.some(x => x.includes('_work-k9.md') && x.includes('re-run in a later one')));
});
t('a comparison operator makes a different check, not a false flip', () => {
  const w = workWith('_work-k10.md', '20260729-k-010',
    receiptOf('20260729-k-010', [item('mass > 500', true)]),
    receiptOf('20260729-k-010', [item('mass < 500', false), item('mass > 500', true)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.strictEqual(w.continuity.flips.length, 0,
    'operator-only differences are different checks, not a pass→fail flip');
  assert.ok(!rr.warnings.some(x => x.includes('_work-k10.md') && x.includes('FAILS')));
});
t('a receipt in any script keeps its continuity audit', () => {
  // The old identity key kept only [a-z0-9가-힣]; a Japanese receipt normalized
  // to the empty string and the file silently lost its audit entirely.
  const w = workWith('_work-k11.md', '20260729-k-011',
    receiptOf('20260729-k-011', [item('描画エラーなし', true)]),
    receiptOf('20260729-k-011', [item('描画エラーなし', false)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(w.continuity, 'a non-Korean CJK receipt must not normalize to nothing');
  assert.strictEqual(w.continuity.flips.length, 1);
});
t('an unparseable receipt does not break continuity', () => {
  const w = workWith('_work-k6.md', '20260729-k-006',
    receiptOf('20260729-k-006', [item('a', true)]),
    '```json\n{ "receipt": "verification", broken\n```\n',
    receiptOf('20260729-k-006', [item('a', true)]));
  const rr = analyze({ faillog: fl, works: [w] });
  assert.strictEqual(w.continuity.carried, 1, 'the two readable rounds still compare');
  assert.ok(rr.warnings.some(x => x.includes('not valid JSON')));
});

console.log('\n[counted_status literals — SKILL 5.3 canonical strings (B1)]');
t('user-stopped is the canonical literal for paused', () => {
  const w = parseWork('---\nstatus: paused\ncounted_status: user-stopped\ntask_id: 20260727-b1-001\n---\n', '_work-b1a.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(!rr.warnings.some(x => x.includes('_work-b1a.md')));
});
t('abandoned belongs to the same bucket', () => {
  const w = parseWork('---\nstatus: abandoned\ncounted_status: user-stopped\ntask_id: 20260727-b1-002\n---\n', '_work-b1b.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(!rr.warnings.some(x => x.includes('_work-b1b.md')));
});
t('legacy "stopped" is accepted as an alias', () => {
  const w = parseWork('---\nstatus: paused\ncounted_status: stopped\ntask_id: 20260727-b1-003\n---\n', '_work-b1c.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(!rr.warnings.some(x => x.includes('_work-b1c.md')));
});
t('a wrong bucket still warns', () => {
  const w = parseWork('---\nstatus: completed\ncounted_status: user-stopped\ntask_id: 20260727-b1-004\n---\n', '_work-b1d.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('_work-b1d.md') && x.includes('counted_status')));
});

console.log('\n[judgment-only completion — SKILL stage 5 note ② (B2)]');
t('judgment-only completed without a receipt is clean', () => {
  const w = parseWork('---\nstatus: completed\ncounted_status: completed\ntask_id: 20260727-b2-001\nverification: judgment-only\n---\nno receipt\n', '_work-b2a.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(!rr.warnings.some(x => x.includes('no verification receipt')));
});
t('the flag does not exempt a failing receipt', () => {
  const w = parseWork('---\nstatus: completed\ncounted_status: completed\ntask_id: 20260725-x-002\nverification: judgment-only\n---\n' + RECEIPT_FAILING, '_work-b2b.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('failing item')));
});

console.log('\n[receipt binding — a pasted-in receipt is not this task\'s evidence (C5)]');
t('a receipt from another task is flagged', () => {
  const w = parseWork('---\nstatus: completed\ncounted_status: completed\ntask_id: 20260727-c5-001\n---\n' + RECEIPT_OK, '_work-c5a.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('does not match _work task_id')));
});
t('a matching receipt is not flagged', () => {
  const w = parseWork('---\nstatus: completed\ncounted_status: completed\ntask_id: 20260725-x-001\n---\n' + RECEIPT_OK, '_work-c5b.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(!rr.warnings.some(x => x.includes('does not match _work task_id')));
});

console.log(`\n${pass} passed / ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
