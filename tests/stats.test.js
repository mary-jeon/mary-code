#!/usr/bin/env node
/**
 * mary-stats 검산기 테스트
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

const FAILLOG = `# FAILLOG — 관측된 실패 기록

## 누적

- 실행된 하네스 작업: 5
- 검증 완료(completed): 2
- 차단·실패(blocked/failed): 1
- 사용자 중단(paused/abandoned): 1
- 발견된 실패: 4
- 기각된 반례: 1

## 미해결 실패

- 2026-07-01 | task:20260701-alpha-001 | L17/cache-staleness | scope: web-research
  | 실패: 오래된 캐시를 최신으로 판정
  | 증거: URL
- 2026-07-10 | task:20260710-beta-002 | L17/cache-staleness | scope: pdf-review
  | 실패: 같은 실패 재현
- 2026-07-12 | task:20260710-beta-002 | L17/cache-staleness | scope: pdf-review
  | 실패: 같은 task 안의 반복 — 재발로 세지 않는다
- 2026-07-15 | task:20260715-gamma-003 | L2/other | scope: code
  | 실패: 이름 없는 현상 — other 는 승격 계산 제외

## 기각한 반례

- 2026-07-16 | task:20260716-delta-004 | L17/cache-staleness | scope: web-research
  | 기각: 재현 안 됨
  | 사유: 캐시가 아니라 원출처가 갱신된 것
`;

console.log('\n[FAILLOG 파싱]');
const fl = parseFaillog(FAILLOG);
t('카운터를 읽는다', () => {
  assert.deepStrictEqual(fl.counters,
    { tasks: 5, completed: 2, blocked: 1, stopped: 1, failures: 4, rejected: 1 });
});
t('항목 수: 실패 4 · 기각 1', () => {
  assert.strictEqual(fl.entries.filter(e => e.kind === 'failure').length, 4);
  assert.strictEqual(fl.entries.filter(e => e.kind === 'rejected').length, 1);
});
t('task·key·scope 를 뽑는다', () => {
  const first = fl.entries[0];
  assert.strictEqual(first.task, '20260701-alpha-001');
  assert.strictEqual(first.key, 'L17/cache-staleness');
  assert.strictEqual(first.scope, 'web-research');
});

console.log('\n[승격 후보 판정 — SKILL 5단계 4번의 기계화]');
const works = [
  parseWork('---\nstatus: blocked\ncounted_status: blocked-failed\ntask_id: 20260710-beta-002\n---\n', '_work-beta.md'),
];
const r = analyze({ faillog: fl, works });
t('서로 다른 task 2회 → 후보', () => {
  assert.strictEqual(r.candidates.length, 1);
  assert.strictEqual(r.candidates[0].key, 'L17/cache-staleness');
});
t('같은 task 안의 반복은 1회로 센다', () => {
  assert.deepStrictEqual(r.candidates[0].tasks.sort(),
    ['20260701-alpha-001', '20260710-beta-002']);
});
t('기각은 후보 계산에 안 들어간다', () => {
  // 기각 항목의 task(delta-004)가 후보의 tasks 에 없어야 한다
  assert.ok(!r.candidates[0].tasks.includes('20260716-delta-004'));
});
t('scope 는 관측된 것만 (합집합 후보)', () => {
  assert.deepStrictEqual(r.candidates[0].scopes.sort(), ['pdf-review', 'web-research']);
});

console.log('\n[모순 검출]');
t('정합 상태에서는 경고 없음', () => {
  assert.deepStrictEqual(r.warnings, []);
});
t('카운터 < 본문 개수 → 모순 경고', () => {
  const broken = parseFaillog(FAILLOG.replace('발견된 실패: 4', '발견된 실패: 2'));
  const rr = analyze({ faillog: broken, works: [] });
  assert.ok(rr.warnings.some(w => w.includes('발견된 실패')));
});
t('칸 합계 > 분모 → 모순 경고', () => {
  const broken = parseFaillog(FAILLOG.replace('실행된 하네스 작업: 5', '실행된 하네스 작업: 3'));
  const rr = analyze({ faillog: broken, works: [] });
  assert.ok(rr.warnings.some(w => w.includes('분모')));
});
t('status 와 counted_status 어긋남 → 경고', () => {
  const w = parseWork('---\nstatus: paused\ncounted_status: blocked-failed\ntask_id: 20260720-x-005\n---\n', '_work-x.md');
  const rr = analyze({ faillog: fl, works: [w] });
  assert.ok(rr.warnings.some(x => x.includes('_work-x.md')));
});
t('task_id 중복 → 경고', () => {
  const a = parseWork('---\nstatus: active\ncounted_status: none\ntask_id: 20260720-dup-006\n---\n', '_work-a.md');
  const b = parseWork('---\nstatus: active\ncounted_status: none\ntask_id: 20260720-dup-006\n---\n', '_work-b.md');
  const rr = analyze({ faillog: fl, works: [a, b] });
  assert.ok(rr.warnings.some(x => x.includes('중복')));
});

console.log(`\n${pass} 통과 / ${fail} 실패\n`);
process.exit(fail === 0 ? 0 : 1);
