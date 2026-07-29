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

const { requestHash, append, openApprovals, normalizeCwd } = require('./lib/ledger');

/* The response body is never stored. Command output can contain tokens and
 * credentials (L17 prompt-log-retention-leak), and the event field already says
 * whether it worked. Only the size is kept, as a trace that something was observed. */
function responseBytes(res) {
  if (res == null) return null;
  const s = typeof res === 'string' ? res : JSON.stringify(res);
  return Buffer.byteLength(s, 'utf8');
}

const EVENT_MAP = new Map([
  ['PostToolUse', 'succeeded'],
  ['PostToolUseFailure', 'failed'],
  ['PermissionDenied', 'denied'],
]);

function eventOf(hookEventName) {
  return EVENT_MAP.get(hookEventName) || null;
}

function recordOutcome(p, deps = {}) {
  const appendRecord = deps.append || append;
  const findOpen = deps.openApprovals || openApprovals;
  const event = eventOf(p.hook_event_name);
  if (!event) return { matched: false, recorded: false };

  const hash = requestHash(p.tool_name, p.tool_input);
  const cwd = normalizeCwd(p.cwd);
  const isOpen = findOpen().some(a => {
    if (p.tool_use_id && a.tool_use_id === p.tool_use_id) return true;
    return !a.tool_use_id && hash && p.session_id && cwd &&
      a.request_hash === hash && a.session === p.session_id &&
      normalizeCwd(a.cwd) === cwd;
  });
  if (!isOpen) return { matched: false, recorded: false };

  const recorded = appendRecord({
    event,
    session: p.session_id || null,
    cwd,
    tool: p.tool_name || null,
    tool_use_id: p.tool_use_id || null,
    request_hash: hash,
    response_bytes: responseBytes(p.tool_response),
  });
  return { matched: true, recorded };
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    try {
      const result = recordOutcome(JSON.parse(raw || '{}'));
      if (result.matched && !result.recorded) {
        process.stderr.write('[mary:post:outcome-recorder] Approval outcome could not be written to the ledger; it remains unknown.\n');
      }
    } catch {
      /* a recording failure must not interfere with the work */
    }
    process.exit(0);
  });
}

process.on('uncaughtException', () => process.exit(0));

if (require.main === module) main();
module.exports = { eventOf, recordOutcome, responseBytes };
