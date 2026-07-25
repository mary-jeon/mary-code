#!/usr/bin/env node
/**
 * Mary — PostToolUse / PostToolUseFailure / PermissionDenied outcome recorder
 *
 * Writes the closing record for what the gate asked about: how it actually ended.
 * Without this, the ledger stops at "it was approved" and nobody knows
 * "so did it work?".
 *
 * **Calls the gate never asked about are not recorded.** A closing record is
 * appended only when an open `asked` entry with the same request_hash exists.
 * Otherwise this file becomes a general tool log instead of an approval ledger —
 * it grows without bound, and the head of every command's output accumulates in
 * plaintext, collecting secrets. (An early implementation that recorded
 * unconditionally exhibited exactly this defect.)
 *
 * This hook blocks nothing. The tool has already run. So it makes no judgment,
 * and it fails silently — a recording failure must not interfere with the work.
 *
 * If an outcome never arrives (killed session, host failure), the approval stays
 * open. That state is **unknown**, not "failed", and it is reported at the next
 * session start. unknown is never grounds for an automatic retry — the action may
 * in fact have run.
 *
 * PermissionDenied: when the host emits this event, the denial is closed as
 * `denied`. In environments that do not emit it, a denial stays `unknown` —
 * the same behavior as before.
 */

'use strict';

const { requestHash, append, openApprovals } = require('./lib/ledger');

/* The response body is never stored. Command output can contain tokens and
 * credentials (L17 prompt-log-retention-leak), and the event field already says
 * whether it worked. Only the size is kept, as a trace that something was observed. */
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

      // No open asked entry → this call never went through the gate. Do not record.
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
      /* a recording failure must not interfere with the work */
    }
    process.exit(0);
  });
}

process.on('uncaughtException', () => process.exit(0));

if (require.main === module) main();
