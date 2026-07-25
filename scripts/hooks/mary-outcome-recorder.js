#!/usr/bin/env node
/**
 * Mary — PostToolUse / PostToolUseFailure / PermissionDenied 결과 기록
 *
 * 게이트가 물어본 것이 실제로 어떻게 끝났는지 원장에 닫는 기록을 남긴다.
 * 이것이 없으면 "승인했다"까지만 남고 "그래서 됐는가"는 아무도 모른다.
 *
 * **게이트가 묻지 않은 호출은 기록하지 않는다.** 같은 request_hash 의 열린 asked 가
 * 있을 때만 닫는 기록을 덧붙인다. 그러지 않으면 이 파일은 승인 원장이 아니라
 * 전체 도구 로그가 된다 — 무한히 자라고, 모든 명령 출력의 앞부분이 평문으로 쌓여
 * 민감정보가 원장에 축적된다. (무조건 기록하는 초기 구현에서 실제로 관측된 결함이다.)
 *
 * 이 훅은 아무것도 막지 않는다. 도구는 이미 실행된 뒤다.
 * 그래서 판정을 하지 않고, 실패해도 조용히 끝난다 — 기록 실패가 작업을 방해하면 안 된다.
 *
 * 결과가 끝내 오지 않으면(세션 강제 종료·호스트 장애) 그 승인은 열린 채 남는다.
 * 그 상태는 "실패"가 아니라 **unknown** 이고, 다음 세션 시작 때 보고된다.
 * unknown 을 자동 재시도의 근거로 쓰지 않는다 — 실제로 실행됐을 수 있기 때문이다.
 *
 * PermissionDenied: 호스트가 이 이벤트를 내면 거부를 denied 로 닫는다.
 * 이벤트가 오지 않는 환경에서는 거부가 unknown 으로 남는다 — 기존 동작과 같다.
 */

'use strict';

const { requestHash, append, openApprovals } = require('./lib/ledger');

/* 응답 본문은 저장하지 않는다. 명령 출력에는 토큰·자격증명이 섞일 수 있고
 * (L17 prompt-log-retention-leak), 성패는 event 필드가 이미 말한다.
 * 관측했다는 흔적으로 크기만 남긴다. */
function responseBytes(res) {
  if (res == null) return null;
  const s = typeof res === 'string' ? res : JSON.stringify(res);
  return Buffer.byteLength(s, 'utf8');
}

function eventOf(hookEventName) {
  if (hookEventName === 'PostToolUseFailure') return 'failed';
  if (hookEventName === 'PermissionDenied') return 'denied';
  return 'succeeded';
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    try {
      const p = JSON.parse(raw || '{}');
      const hash = requestHash(p.tool_name, p.tool_input);

      // 열린 asked 가 없으면 이 호출은 게이트를 거치지 않은 것이다. 기록하지 않는다.
      const isOpen = openApprovals().some(a => a.request_hash === hash);
      if (!isOpen) return process.exit(0);

      append({
        event: eventOf(p.hook_event_name),
        session: p.session_id || null,
        tool: p.tool_name || null,
        tool_use_id: p.tool_use_id || null,
        request_hash: hash,
        response_bytes: responseBytes(p.tool_response),
      });
    } catch {
      /* 기록 실패는 작업을 막지 않는다 */
    }
    process.exit(0);
  });
}

process.on('uncaughtException', () => process.exit(0));

if (require.main === module) main();
