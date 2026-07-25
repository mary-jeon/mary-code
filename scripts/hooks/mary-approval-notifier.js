#!/usr/bin/env node
/**
 * Mary — Notification hook: remote "approval is waiting" ping
 *
 * Problem: an approval gate that only exists in the terminal makes the human
 * sit at the terminal. This hook fires when Claude Code shows a permission
 * prompt (Notification event, `permission_prompt` matcher) and POSTs a short
 * ping to a webhook the user configured — e.g. an ntfy.sh topic their phone
 * subscribes to.
 *
 * What this is NOT: remote *approval*. The host's permission prompt is local
 * terminal UI; there is no remote answer channel. Replacing the physically
 * present human's button with a remote channel would swap the gate's final
 * defense line for that channel's authentication strength — a decision, not a
 * default. So: the phone learns *that* something is waiting; the answer still
 * happens at the terminal.
 *
 * Privacy (deliberate): the ping body contains NO command text, NO paths, and
 * NO project identifiers — only "approval waiting", the tool name if available,
 * and a timestamp. Command text can contain secrets, folder names can identify
 * clients and projects, and a push service is an external party.
 *
 * Configuration: ~/.claude/mary/notify.json
 *   { "url": "https://ntfy.sh/<your-topic>", "headers": { "Title": "mary" } }
 * The URL must be https; plaintext http is accepted only with "allowHttp": true
 * (e.g. an ntfy instance on your own LAN).
 * No file → this hook does nothing. Failures are silent and never block.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { MARY_DIR } = require('./lib/ledger');

const TIMEOUT_MS = 5000;

function loadConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(path.join(MARY_DIR, 'notify.json'), 'utf8'));
    if (!c || typeof c.url !== 'string') return null;
    if (/^https:\/\//i.test(c.url)) return c;
    if (/^http:\/\//i.test(c.url) && c.allowHttp === true) return c;
    return null;
  } catch { return null; }
}

function buildBody(payload) {
  const tool = payload.tool_name ? String(payload.tool_name) : null;
  return [
    'mary: approval waiting (permission prompt)',
    tool ? `tool: ${tool}` : null,
    new Date().toISOString(),
  ].filter(Boolean).join('\n');
}

function post(cfg, body, done) {
  try {
    const url = new URL(cfg.url);
    const mod = url.protocol === 'https:' ? require('https') : require('http');
    const req = mod.request(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...(cfg.headers || {}) },
      timeout: TIMEOUT_MS,
    }, res => { res.resume(); res.on('end', done); res.on('error', done); });
    req.on('timeout', () => { try { req.destroy(); } catch {} done(); });
    req.on('error', done);
    req.end(body);
  } catch { done(); }
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    const cfg = loadConfig();
    if (!cfg) return process.exit(0);
    let payload = {};
    try { payload = JSON.parse(raw || '{}'); } catch {}
    post(cfg, buildBody(payload), () => process.exit(0));
  });
}

process.on('uncaughtException', () => process.exit(0));

if (require.main === module) main();

module.exports = { buildBody, loadConfig };
