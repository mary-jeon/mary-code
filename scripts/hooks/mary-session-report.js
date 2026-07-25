#!/usr/bin/env node
/**
 * Mary — SessionStart 미결 승인 보고
 *
 * 결과가 끝내 오지 않은 승인을 세션 시작 때 Claude 의 컨텍스트에 넣는다.
 * SKILL.md 는 "재개 시 진행 중인 작업을 확인한다"고 요구하는데, 그 확인이
 * 에이전트의 기억이 아니라 **원장** 에서 나오게 하는 것이 이 훅의 목적이다.
 *
 * 열린 승인은 "안 됐다"가 아니라 **모른다** 는 뜻이다.
 * 그래서 재시도하라고 지시하지 않고, 결과를 먼저 관측하라고 지시한다.
 */

'use strict';

const { openApprovals } = require('./lib/ledger');

const MAX_SHOWN = 5;

function buildContext() {
  let open;
  try {
    open = openApprovals();
  } catch {
    return null;
  }
  if (!open.length) return null;

  const lines = open.slice(-MAX_SHOWN).map(a => {
    const when = String(a.ts || '').replace('T', ' ').slice(0, 16);
    const what = a.request && a.request.command
      ? String(a.request.command).slice(0, 120)
      : (a.request && (a.request.file_path || a.request.notebook_path)) || '(내용 없음)';
    return `- ${when} · ${a.tool || '?'} · ${a.category || '분류 없음'}\n  ${what}\n  request_hash: ${a.request_hash}`;
  });

  const more = open.length > MAX_SHOWN ? `\n(외 ${open.length - MAX_SHOWN}건 더 있음)` : '';

  return [
    `[mary] 결과가 기록되지 않은 승인 ${open.length}건이 있습니다.`,
    '',
    ...lines,
    more,
    '',
    '이 항목들의 상태는 **unknown** 입니다 — 실패한 것이 아니라 결과를 모르는 것입니다.',
    '**자동으로 재시도하지 마십시오.** 실제로 실행됐을 수 있습니다.',
    '먼저 부작용을 직접 관측해 실행 여부를 확인하고, 그 결과를 사용자에게 보고하십시오.',
    `원장: ~/.claude/mary/approvals.jsonl`,
  ].filter(Boolean).join('\n');
}

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => process.exit(0));
  process.stdin.on('end', () => {
    const ctx = buildContext();
    if (ctx) {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: ctx },
      }));
    }
    process.exit(0);
  });
}

process.on('uncaughtException', () => process.exit(0));

if (require.main === module) main();

module.exports = { buildContext };
