'use strict';

/**
 * Mary — 승인 원장 (append-only)
 *
 * 승인과 실행을 묶는 유일한 기록이다. 규칙은 하나뿐이다: **덧붙이기만 한다.**
 * 기존 줄을 고치거나 지우지 않는다. 현재 상태는 저장하지 않고 로그를 접어서 계산한다.
 *
 * 왜 덧붙이기만 하는가 — 훅은 서로 다른 프로세스에서 동시에 돈다. 파일을 읽고 고쳐 쓰면
 * 한쪽 기록이 조용히 사라진다(갱신 손실). 한 줄씩 덧붙이면 최악의 경우에도 순서만 섞이고
 * 기록은 남는다. 상태 계산은 읽는 쪽에서 하면 된다.
 *
 * 상태 전이는 로그를 접어서 나온다:
 *   asked → succeeded | failed        (실행 결과 훅이 남긴다)
 *   asked → denied                    (사용자 거부. 호스트가 PermissionDenied 를 내면 남는다)
 *   asked → (아무것도 안 옴) = unknown  (세션이 끊겼거나 거부 이벤트가 관측되지 않았다)
 *
 * unknown 은 "모른다"는 뜻이지 "안 했다"가 아니다. 자동 재시도의 근거로 쓰면 안 된다.
 */

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOME = process.env.HOME || process.env.USERPROFILE || os.homedir();
const MARY_DIR = process.env.MARY_DIR || path.join(HOME, '.claude', 'mary');
const LEDGER = path.join(MARY_DIR, 'approvals.jsonl');

/**
 * 요청을 정규화한다. 키 순서·공백 때문에 같은 요청이 다른 해시가 되지 않게 한다.
 * 해시는 기계 대조용이다. 사람이 확인하는 것은 presented_text 다 — 둘은 다른 물건이다.
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

/** 실패해도 예외를 던지지 않는다. 기록 실패가 게이트 판정을 바꾸면 안 된다. */
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
 * 로그를 접어 결과가 오지 않은 승인을 찾는다.
 * 같은 request_hash 로 asked 가 여러 번이면 결과 개수만큼만 닫힌 것으로 본다.
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
