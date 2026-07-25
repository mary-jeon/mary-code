#!/usr/bin/env node
/**
 * Mary — PreToolUse untrusted-input sentinel (lethal-trifecta leg observer)
 *
 * LAYERS L12 (lethal trifecta): private-data access + untrusted input +
 * external send in one agent context. SKILL.md already states the rule in
 * prose ("report which leg was cut"); this hook makes one leg **observable**
 * instead of remembered.
 *
 * What it does — and all it does: when this session ingests untrusted external
 * content (WebFetch, WebSearch, or a fetch-shaped Bash command), it records a
 * per-session marker file. Later, when the irreversible gate asks about an
 * *external send* in the same session, the gate reads that marker and adds a
 * trifecta warning to the text the human approves.
 *
 * Registered on PostToolUse, not PreToolUse — deliberately. A fetch the user
 * DENIED never ran and ingested nothing; marking it would poison the session
 * signal with false positives. PostToolUse only fires for calls that executed.
 *
 * Deliberate limits:
 *  - This hook never blocks and never decides. It emits no permissionDecision.
 *    The defense line stays the human approval button, not this pattern match.
 *  - Only two of the three legs are observable here (untrusted input, external
 *    send). Private-data access is not reliably detectable from tool calls —
 *    claiming to detect it would be false confidence, so we do not.
 *  - The marker is per-session state. This is the one place session-scoped
 *    files are the right shape: "has ingested untrusted content" is a property
 *    of a session, unlike tasks (task_id) and the ledger, which span sessions.
 *  - Markers older than 7 days are removed opportunistically.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { MARY_DIR } = require('./lib/ledger');

/* Fetch-shaped Bash commands count as ingestion regardless of HTTP method —
 * a POST's *response* is still untrusted input. The gate separately classifies
 * data-bearing requests as external send; both can be true. */
const BASH_FETCH = /\b(curl|wget|Invoke-WebRequest|Invoke-RestMethod|iwr|irm)\b/i;
const INGEST_TOOLS = new Set(['WebFetch', 'WebSearch']);
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function markerPath(sessionId) {
  return path.join(MARY_DIR, `_trifecta-${String(sessionId).replace(/[^A-Za-z0-9-]/g, '')}.json`);
}

function cleanupStale() {
  try {
    const now = Date.now();
    for (const f of fs.readdirSync(MARY_DIR)) {
      if (!/^_trifecta-.*\.json$/.test(f)) continue;
      const p = path.join(MARY_DIR, f);
      try { if (now - fs.statSync(p).mtimeMs > MAX_AGE_MS) fs.unlinkSync(p); } catch {}
    }
  } catch {}
}

function record(sessionId, source) {
  try {
    fs.mkdirSync(MARY_DIR, { recursive: true });
    const p = markerPath(sessionId);
    let m = { first_seen: new Date().toISOString(), sources: {} };
    try { m = JSON.parse(fs.readFileSync(p, 'utf8')); } catch {}
    m.sources = m.sources || {};
    m.sources[source] = (m.sources[source] || 0) + 1;
    m.last_seen = new Date().toISOString();
    fs.writeFileSync(p, JSON.stringify(m), 'utf8');
  } catch { /* observation is best-effort; never interfere with the call */ }
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    try {
      const p = JSON.parse(raw || '{}');
      const tool = String(p.tool_name || '');
      const sid = p.session_id;
      if (sid) {
        if (INGEST_TOOLS.has(tool)) record(sid, tool);
        else if (tool === 'Bash' && BASH_FETCH.test(String((p.tool_input || {}).command || ''))) {
          record(sid, 'Bash-fetch');
        }
      }
      cleanupStale();
    } catch { /* never interfere */ }
    process.exit(0); // no stdout: this hook has no opinion on the decision
  });
}

process.on('uncaughtException', () => process.exit(0));

if (require.main === module) main();

module.exports = { markerPath, BASH_FETCH };
