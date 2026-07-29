#!/usr/bin/env node
/**
 * Gate decision snapshot test
 *
 *   node tests/decisions.test.js            compare against decisions.snapshot.json
 *   node tests/decisions.test.js --update   regenerate the snapshot (deliberate act)
 *
 * The unit suite (gate.test.js) asserts individual behaviors. This test asserts
 * the distribution: every command in decisions.cases.js has its full decision —
 * `ask:<category>` or `defer` — pinned in the snapshot, and no code change may
 * move one without regenerating the snapshot in the same commit. The diff of
 * that regeneration IS the review artifact: it lists exactly which judgments
 * moved and in which direction.
 *
 * Direction matters, so mismatches are reported in three classes:
 *   WEAKENED    ask → defer   the gate stopped asking — each needs its own
 *                             justification in the CHANGELOG
 *   STRENGTHENED defer → ask  new asks — intended coverage or new noise?
 *   RELABELED   category-only the decision held, its stated reason changed
 *
 * A case present in the corpus but missing from the snapshot fails too: an
 * unpinned decision is a decision that can drift silently, which is the exact
 * thing this file exists to prevent.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// decide() never writes, but the module's ledger import resolves MARY_DIR at
// load time — point it somewhere disposable so no environment can interfere.
process.env.MARY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'mary-decisions-'));

const ROOT = path.join(__dirname, '..');
const { decide } = require(path.join(ROOT, 'scripts', 'hooks', 'mary-irreversible-gate.js'));
const cases = require('./decisions.cases.js');
const SNAPSHOT = path.join(__dirname, 'decisions.snapshot.json');

// Outside the plugin root on every platform (the C:/other-project fixture bug
// from PR #1 is exactly the mistake to not repeat here), so relative
// self-protection never depends on where the suite happens to run.
const CWD = path.resolve(ROOT, '..', 'decision-corpus-project');

function judge(cmd) {
  const v = decide({ tool_name: 'Bash', tool_input: { command: cmd }, cwd: CWD });
  return v.decision === 'ask' ? 'ask:' + (v.category || '') : 'defer';
}

const current = {};
for (const c of cases) current[c] = judge(c);

/* ── Section-intent audit ──────────────────────────────────────────────
 * The snapshot pins the gate's ACTUAL output — regeneration turns whatever the
 * gate says into "expected". The 0.4.3 release proved the failure mode: a
 * working bypass (`2>&1 "rm"`) sat pinned as `defer` INSIDE the corpus section
 * that existed to prove redirections were fixed, and 267/267 green was
 * agreement with the bug. So the corpus section headers carry their intent
 * ("must ask" / "must stay defer"), and a pin that contradicts the header of
 * the block it sits in fails — in --update mode too. A case a header cannot
 * cover does not belong in that section; move it, don't exempt it. */
function sectionMismatches(decisions) {
  const src = fs.readFileSync(path.join(__dirname, 'decisions.cases.js'), 'utf8');
  const intentOf = h =>
    /must (stay )?ask|asks\b/i.test(h) ? 'ask' :
    /must stay defer|benign/i.test(h) ? 'defer' : null;
  let intent = null;
  const bad = [];
  for (const line of src.split('\n')) {
    const h = /\/\/ ── (.+?) ─*$/.exec(line.trim());
    if (h) { intent = intentOf(h[1]); continue; }
    for (const m of line.matchAll(/'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)"/g)) {
      const c = (m[1] !== undefined ? m[1] : m[2]).replace(/\\(.)/g, '$1');
      if (!(c in decisions) || intent === null) continue;
      const d = decisions[c] === 'defer' ? 'defer' : 'ask';
      if (d !== intent) bad.push(`${c}\n      section says "${intent}", gate says ${decisions[c]}`);
    }
  }
  return bad;
}
const sectionBad = sectionMismatches(current);
if (sectionBad.length) {
  console.error(`\n  SECTION INTENT VIOLATED (${sectionBad.length}) — a pin contradicts the corpus block it sits in:`);
  for (const b of sectionBad) console.error(`    ${b}`);
  console.error('\nFix the gate or move the case to a correctly-labeled section — do not --update over this.\n');
  process.exit(1);
}

if (process.argv.includes('--update')) {
  fs.writeFileSync(SNAPSHOT, JSON.stringify(current, null, 1) + '\n');
  const asks = Object.values(current).filter(v => v.startsWith('ask')).length;
  console.log(`snapshot updated: ${cases.length} cases (${asks} ask / ${cases.length - asks} defer)`);
  console.log('The git diff of decisions.snapshot.json is the review artifact — read it before committing.');
  process.exit(0);
}

let snapshot;
try {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
} catch {
  console.error('decisions.snapshot.json missing or unreadable.');
  console.error('Generate it deliberately: node tests/decisions.test.js --update');
  process.exit(1);
}

const weakened = [], strengthened = [], relabeled = [], unpinned = [], stale = [];
for (const c of cases) {
  const want = snapshot[c];
  const got = current[c];
  if (want === undefined) { unpinned.push(c); continue; }
  if (want === got) continue;
  const wantD = want.startsWith('ask') ? 'ask' : 'defer';
  const gotD = got.startsWith('ask') ? 'ask' : 'defer';
  if (wantD === gotD) relabeled.push(`${c}\n      ${want} → ${got}`);
  else if (gotD === 'defer') weakened.push(`${c}   (was ${want})`);
  else strengthened.push(`${c}   (now ${got})`);
}
for (const c of Object.keys(snapshot)) if (!current[c]) stale.push(c);

const matched = cases.length - weakened.length - strengthened.length - relabeled.length - unpinned.length;
console.log(`\n[decision snapshot] ${matched}/${cases.length} pinned decisions hold`);

const section = (title, items, advice) => {
  if (!items.length) return;
  console.log(`\n  ${title} (${items.length}) — ${advice}`);
  for (const i of items) console.log(`    ${i}`);
};
section('WEAKENED ask → defer', weakened,
  'the gate stopped asking; justify each in the CHANGELOG, then --update');
section('STRENGTHENED defer → ask', strengthened,
  'new asks; confirm they are intended coverage, not noise, then --update');
section('RELABELED (category only)', relabeled,
  'same decision, different stated reason; confirm and --update');
section('UNPINNED (in corpus, not in snapshot)', unpinned,
  'new cases must be pinned: --update');
section('STALE (in snapshot, not in corpus)', stale,
  'cases were removed; removing coverage is a decision too: --update');

const failed = weakened.length + strengthened.length + relabeled.length + unpinned.length + stale.length;
console.log(failed === 0
  ? `\n${cases.length} decisions match the snapshot / 0 moved\n`
  : `\n${failed} decision(s) moved or unpinned — regenerate deliberately with --update and review the diff\n`);
process.exit(failed === 0 ? 0 : 1);
