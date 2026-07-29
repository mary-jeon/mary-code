#!/usr/bin/env node
/**
 * Mary — PreToolUse irreversible-action gate
 *
 * Enforces SKILL.md's "irreversible actions require prior approval" rule with a hook,
 * not with prose.
 *
 * Design principles (all deliberate):
 *
 *  1. fail-CLOSED. If the gate cannot judge a call, it does not wave it through — it asks.
 *     Parse failures and unexpected exceptions all end in "ask". There is no
 *     fail-open path ("hook died, let it pass").
 *
 *  2. Regexes are never the sole basis for approval. A pattern is only a signal that
 *     confirmation is needed; no pattern ever produces an automatic allow. At the
 *     process boundary a non-match emits no hook decision (exit 0 with empty stdout),
 *     so Claude Code's normal permission flow remains authoritative.
 *
 *  3. No automatic-approval paths. No session cache, no timeout, no
 *     "second call passes". Remembering an answer to skip the next question is
 *     approval reuse by construction.
 *
 *  4. Self-protection. Attempts to modify this hook's own enforcement files must also
 *     pass the gate. Write-family tools are judged by path; Bash is judged by a
 *     "protected path mentioned + write indicator present" heuristic. The Bash side is
 *     not complete — no string-level inspection reads full shell semantics. This is
 *     not a trust boundary; it makes an obvious bypass visible (see README).
 *
 *  5. Every "ask" attempts an append-only ledger record. If persistence fails, the
 *     gate still asks and makes the unaudited state explicit in the dialog instead of
 *     pretending that an approval/outcome binding exists.
 *
 * Output contract:
 *   recognized risk / malformed input → exit 0 + native `ask` JSON
 *   no registered risk recognized     → exit 0 + no stdout (no hook decision)
 * exit 2 is never used. A hard block would take the choice away from the user.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { requestHash, append, openApprovalsDetailed, maskSecrets, compactRequest, normalizeCwd, MARY_DIR } = require('./lib/ledger');

const HOOK_ID = 'mary:pre:irreversible-gate';

/* ── Command segmentation ───────────────────────────────────────────
 * Some judgments must be per-segment, not per-line. A negative condition tested
 * against the whole line ("push unless --dry-run appears somewhere") is pierced
 * by `git push origin main && echo "--dry-run"` — the exempting string lives in
 * a DIFFERENT command. Splitting is naive about quotes; that only errs toward
 * asking, never toward passing.
 */
function splitSegments(cmd) {
  return String(cmd).split(/&&|\|\||[;|\n]/);
}

/* git accepts global options between `git` and the subcommand
 * (`git -C /repo push`). Requiring adjacency would exempt exactly those forms.
 *
 * A value may be quoted and contain spaces (`git -c core.pager="less -n" push`),
 * so an option value is "a quoted run or a bare run of non-space" rather than
 * plain \S+ — otherwise the whole GIT prefix fails to match and the push
 * becomes invisible to the registry rather than merely unexempted. */
const GIT_VAL = '(?:"[^"]*"|\'[^\']*\'|\\S)+';
const GIT = '\\bgit(?:\\s+(?:-C\\s+' + GIT_VAL + '|-c\\s+' + GIT_VAL
  + '|--git-dir(?:=|\\s+)' + GIT_VAL + '|--work-tree(?:=|\\s+)' + GIT_VAL
  + '|--namespace(?:=|\\s+)' + GIT_VAL + '|--no-pager|--paginate|-[pP]))*\\s+';
const GIT_PUSH_RE = new RegExp(GIT + 'push\\b', 'i');
/* Command-position form. `GIT` alone starts with `\bgit`, which also matches the
 * word inside quoted argument text — `echo "git push"` used to ask because of
 * it (closed in 0.4.4: the push entry now matches against stripQuotedSpans).
 * New entries use this form so they do not add that noise: a gate that cries
 * wolf trains the user to approve without reading. */
const GIT_CMD = '(?:^|[\\s;&|])' + GIT;
/* A dry-run exemption is only honoured when the flag is a real argument of the
 * push itself. Testing the raw segment for /--dry-run|-n/ is exempted by three
 * shapes that all still push for real:
 *
 *   git push origin main # --dry-run      the flag is in a comment
 *   git push -o -n origin main            -n is the VALUE of --push-option
 *   git -c core.pager="less -n" push …    -n belongs to a config value
 *
 * So: drop comments, tokenize quote-aware, look only at tokens after `push`,
 * and respect options that consume the next token. Every branch here only ever
 * withholds the exemption, so a parse we get wrong errs toward asking. */

/** Truncate each line at an unquoted `#` that begins a word (`echo a#b` is safe). */
function stripComments(s) {
  let out = '', q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < s.length) { out += c + s[++i]; continue; }
      if (c === q) q = null;
      out += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; out += c; continue; }
    if (c === '\\' && i + 1 < s.length) { out += c + s[++i]; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) {
      while (i < s.length && s[i] !== '\n') i++;
      if (i < s.length) out += '\n';
      continue;
    }
    out += c;
  }
  return out;
}

/** Split on whitespace, honouring quotes and backslash escapes. */
function tokenize(s) {
  const out = [];
  let cur = '', q = null, started = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < s.length) { cur += s[++i]; continue; }
      if (c === q) { q = null; continue; }
      cur += c;
      continue;
    }
    if (c === '"' || c === "'") { q = c; started = true; continue; }
    if (c === '\\' && i + 1 < s.length) { cur += s[++i]; started = true; continue; }
    if (/\s/.test(c)) { if (cur || started) { out.push(cur); cur = ''; started = false; } continue; }
    cur += c;
    started = true;
  }
  if (cur || started) out.push(cur);
  return out;
}

/* git push options whose value is the FOLLOWING token. A value is never a flag,
 * so `-o -n` is a push option named "-n", not a dry run. */
const PUSH_VALUE_LONG = new Set(['--push-option', '--repo', '--exec', '--receive-pack']);
const PUSH_VALUE_SHORT = 'o';

/** True only when `push` in this segment carries a genuine dry-run flag. */
function gitPushIsDryRun(seg) {
  const tok = tokenize(stripComments(seg));
  const i0 = tok.indexOf('push');
  let i = i0;
  if (i < 0) return false;
  for (i += 1; i < tok.length; i++) {
    const t = tok[i];
    if (t === '--') return false;                       // rest are refspecs
    if (t === '--dry-run' || t.startsWith('--dry-run=')) return true;
    if (PUSH_VALUE_LONG.has(t)) { i++; continue; }      // consume the value
    if (/^--/.test(t)) continue;
    if (/^-.+/.test(t)) {
      let consumes = false;
      for (let k = 1; k < t.length; k++) {
        if (t[k] === PUSH_VALUE_SHORT) {
          // `-o` takes a value: the rest of the cluster, or the next token.
          consumes = k === t.length - 1;
          break;
        }
        if (t[k] === 'n') return true;
      }
      if (consumes) i++;
      continue;
    }
    if (t === '-') continue;
  }
  return false;
}

/* `git restore` overwrites the working tree from the index or a commit — the
 * uncommitted edits it discards were never recorded anywhere, so nothing can
 * bring them back. The one exception is `--staged` WITHOUT `--worktree`: that
 * only unstages, leaving file contents untouched, which is why it is exempted
 * rather than the whole subcommand being registered. */
const GIT_RESTORE_RE = new RegExp(GIT_CMD + 'restore\\b', 'i');

function gitRestoreIsUnstageOnly(seg) {
  const tok = tokenize(stripComments(seg));
  const i0 = tok.indexOf('restore');
  if (i0 < 0) return false;
  let staged = false;
  for (let i = i0 + 1; i < tok.length; i++) {
    const t = tok[i];
    if (t === '--') break;
    if (t === '--staged' || t === '-S') staged = true;
    if (t === '--worktree' || t === '-W') return false;
  }
  return staged;
}

/* ── Command-position normalization (H-3) ───────────────────────────
 * Every pattern below anchors on `(^|[\s;&|])name`, which the shell's own
 * quote removal defeats: `"rm" -rf /d`, `'rm' -rf /d` and `r\m -rf /d` all
 * execute rm, but none of them contain the bare word `rm` at a word boundary.
 *
 * Normalizing the WHOLE string would be worse than the bug: `echo "rm -rf /"`
 * would become a deletion. Quotes are only removed from the FIRST word of each
 * segment — the command position — where quoting has no meaning other than
 * evading a matcher. Argument quoting is left exactly as written.
 *
 * The normalized string is matched IN ADDITION to the raw one, so this can
 * only ever add an ask, never remove one. */
/* Commands that run another command, so the word AFTER them is still a command
 * position. `git` is here because the registry matches its subcommand as a
 * word (`git "push"` hides the subcommand the same way quoting hides `rm`). */
const CMD_POSITION_PREFIX = new Set([
  'sudo', 'doas', 'env', 'command', 'time', 'nohup', 'setsid', 'nice', 'ionice',
  'timeout', 'stdbuf', 'xargs', 'watch', 'flock', 'taskset', 'su', 'pkexec',
  'runuser', 'chrt', 'exec', 'git',
]);

/* Wrapper options that consume the following token. Without this grammar,
 * `sudo -u root "rm"` stops at `root` and never reaches the real command.
 * Attached/equals values do not consume another token. */
const WRAPPER_VALUE_OPTIONS = new Map([
  ['sudo', new Set(['-u', '--user', '-g', '--group', '-h', '--host', '-p', '--prompt',
    '-C', '--close-from', '-R', '--chroot', '-T', '--command-timeout', '-r', '--role',
    '-t', '--type'])],
  ['doas', new Set(['-u'])],
  ['env', new Set(['-u', '--unset', '-C', '--chdir', '-S', '--split-string'])],
  ['nice', new Set(['-n', '--adjustment'])],
  ['ionice', new Set(['-c', '--class', '-n', '--classdata', '-t', '--ignore'])],
  ['timeout', new Set(['-k', '--kill-after', '-s', '--signal'])],
  ['stdbuf', new Set(['-i', '--input', '-o', '--output', '-e', '--error'])],
  ['xargs', new Set(['-a', '--arg-file', '-E', '--eof', '-I', '--replace', '-L',
    '--max-lines', '-n', '--max-args', '-P', '--max-procs', '-s', '--max-chars'])],
  ['watch', new Set(['-n', '--interval', '-x', '--exec', '-e', '--errexit'])],
  ['flock', new Set(['-w', '--wait', '-E', '--conflict-exit-code'])],
  ['taskset', new Set(['-c', '--cpu-list'])],
  ['pkexec', new Set(['--user'])],
  ['runuser', new Set(['-u', '--user', '-g', '--group', '-G', '--supp-group'])],
  ['chrt', new Set(['-p', '--pid', '-T', '--sched-runtime', '-P', '--sched-period',
    '-D', '--sched-deadline'])],
  ['git', new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace',
    '--exec-path'])],
]);

/* Wrappers with a required positional operand before the nested command. */
const WRAPPER_POSITIONAL_OPERANDS = new Map([
  ['timeout', 1], // duration
  ['flock', 1],   // lock file or file descriptor
  ['chrt', 1],    // priority for the common policy+priority form
]);

function wrapperOptionConsumesNext(wrapper, word) {
  if (word.includes('=')) return false;
  return WRAPPER_VALUE_OPTIONS.get(wrapper)?.has(word) || false;
}

/* A redirection may PRECEDE the command word (`>/dev/null "rm" -rf /d` runs rm)
 * and may sit between a wrapper and its nested command (`sudo >/dev/null "rm"`).
 * Without this the normalizer stops at the redirection and never reaches the
 * command word — the H-3 anchors are defeated again by a different route.
 * Operator alone (`> out.txt`) also consumes the following word; operator with
 * an attached target (`>/dev/null`, `2>&1`) does not. */
const REDIR_OPERATOR_ONLY = /^(?:[0-9]*(?:>>|>&|>|<&|<)|&>>|&>)$/;
const REDIR_WITH_TARGET = /^(?:[0-9]*(?:>>|>&|>|<&|<)|&>>|&>)\S/;

/** Remove quoting/escaping from a word, or return null if it is not a plain name. */
function bareCommandName(word) {
  if (!/["'\\]/.test(word)) return null;
  // ANSI-C and locale quoting put a `$` in front of the quote: `$'rm'` and
  // `$"rm"` both execute rm. Dropping the `$` before an opening quote is what
  // lets the plain-name test below see the name instead of `$rm`.
  const bare = word.replace(/\$(?=["'])/g, '').replace(/"([^"]*)"|'([^']*)'|\\(.)/g,
    (_, d, s, e) => (d !== undefined ? d : s !== undefined ? s : e));
  // Only a plain command name may be substituted. Anything with shell
  // metacharacters or whitespace is an argument, not a command word.
  return /^[\w.\-+]+$|^[\\/]?(?:[\w.\-+]+[\\/])+[\w.\-+]+$/.test(bare) ? bare : null;
}

function unquoteCommandWord(seg) {
  const m = /^(\s*)((?:[A-Za-z_][\w]*=(?:"[^"]*"|'[^']*'|\S)*\s+)*)(.*)$/s.exec(seg);
  if (!m) return seg;
  const [, lead, assigns, rest0] = m;
  // A leading `(`/`{`/`!` is not part of the command name, and it is not in the
  // registry's `(^|[\s;&|])` anchor class either. Replace the run with a space:
  // the normalized string exists only to be matched.
  const open = /^[([{!]+\s*/.exec(rest0);
  const prefix = open ? ' ' : '';
  let body = open ? rest0.slice(open[0].length) : rest0;

  let out = '';
  let wrapper = null;
  let consumeWrapperValue = false;
  let consumeRedirTarget = false;
  let positionalOperands = 0;
  for (;;) {
    const ws = /^\s*/.exec(body)[0];
    const w = /^(?:"[^"]*"|'[^']*'|\\.|[^\s"'\\])+/.exec(body.slice(ws.length));
    if (!w) break;
    const word = w[0];
    const bare = bareCommandName(word);
    out += ws + (bare === null ? word : bare);
    body = body.slice(ws.length + word.length);
    const rendered = bare === null ? word : bare;
    const name = rendered.replace(/^.*[\\/]/, '').toLowerCase();

    if (consumeRedirTarget) {
      consumeRedirTarget = false;
      continue;
    }
    // A redirection is not the command word — the command word is still ahead.
    if (REDIR_OPERATOR_ONLY.test(rendered)) { consumeRedirTarget = true; continue; }
    if (REDIR_WITH_TARGET.test(rendered)) continue;

    if (consumeWrapperValue) {
      consumeWrapperValue = false;
      continue;
    }
    if (wrapper === 'env' && /^[A-Za-z_][\w]*=/.test(rendered)) continue;
    if (wrapper && /^-/.test(rendered)) {
      consumeWrapperValue = wrapperOptionConsumesNext(wrapper, rendered);
      continue;
    }
    if (wrapper && positionalOperands > 0) {
      positionalOperands--;
      continue;
    }
    if (CMD_POSITION_PREFIX.has(name)) {
      wrapper = name;
      positionalOperands = WRAPPER_POSITIONAL_OPERANDS.get(name) || 0;
      continue;
    }
    break;
  }
  return lead + assigns + prefix + out + body;
}

/** Split only on shell separators outside quotes and backslash escapes. */
function commandParts(cmd) {
  const s = String(cmd);
  const out = [];
  let start = 0, q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '\\' && q === '"' && i + 1 < s.length) { i++; continue; }
      if (c === q) q = null;
      continue;
    }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '\\' && i + 1 < s.length) { i++; continue; }
    let n = 0;
    if ((c === '&' || c === '|') && s[i + 1] === c) n = 2;
    // `&` that is part of a redirection is not a command separator: `2>&1`,
    // `>&file`, `<&0` (fd duplication, `&` preceded by `>`/`<`) and `&>`/`&>>`
    // (redirect-all, `&` followed by `>`). Splitting there cut `2>&1 "rm" -rf`
    // into a segment whose command word was `1` — the redirection walker never
    // saw the token and the quoted command word was never unquoted.
    else if (c === '&' && (s[i - 1] === '>' || s[i - 1] === '<' || s[i + 1] === '>')) continue;
    else if (c === '&' || c === '|' || c === ';' || c === '\n') n = 1;
    if (!n) continue;
    if (start < i) out.push({ text: s.slice(start, i), separator: false });
    out.push({ text: s.slice(i, i + n), separator: true });
    i += n - 1;
    start = i + 1;
  }
  if (start < s.length) out.push({ text: s.slice(start), separator: false });
  return out;
}

/** Replace quoted spans with an inert placeholder WORD. For registry words that
 * also live in ordinary English (`truncate`, `FLUSHALL`, `git push`), a quoted
 * occurrence is argument text — but a quoted COMMAND word has already been
 * unquoted into the normalized string, which patternHits tests too, so the
 * replacement removes prose without un-catching `"truncate" -s 0 f`.
 * A word, not a space: an option's quoted value must still occupy its value
 * slot — erasing it left `git -C "/repo" push` as `-C   push`, and the option
 * pattern consumed `push` as the value of `-C`. */
function stripQuotedSpans(s) {
  return String(s).replace(/"(?:\\.|[^"\\])*"|'[^']*'/g, '_q_');
}

/** The command as the shell would see it in command position, per segment. */
function normalizeCommandWords(cmd) {
  return commandParts(cmd)
    .map(p => (p.separator ? p.text : unquoteCommandWord(p.text)))
    .join('');
}
/* ── Action registry ────────────────────────────────────────────────
 * The tool name is the first-order judgment. Command patterns are only a
 * second-order signal inside Bash. Category vocabulary matches SKILL.md stage 0 (a).
 * An entry carries either `re` (tested against the whole command) or `test`
 * (a predicate, for judgments that need segmentation).
 */
const BASH_PATTERNS = [
  // rm is deletion regardless of flags. Matching only -r/-f would let
  // "rm single-file" slip past the gate. The optional path prefix catches
  // absolute invocations (/bin/rm) that a bare prefix class would miss.
  { re: /(^|[\s;&|])(\S*[\\/])?rm\s/i,                   category: 'deletion' },
  { re: /(^|[\s;&|])(\S*[\\/])?(rmdir|del|Remove-Item|Clear-Content)\b/i, category: 'deletion' },
  { re: /(^|[\s;&|])find\b[^\n]*\s-delete\b/i,           category: 'deletion' },
  { re: /(^|[\s;&|])(\S*[\\/])?shred\b/i,                category: 'deletion' },
  // `truncate` is also an English verb; the raw-string test fired inside
  // quoted prose ("please truncate the file"). Quoted spans are argument text —
  // a quoted COMMAND word has already been unquoted into the normalized string
  // patternHits also tests, so `"truncate" -s 0 f` still asks.
  { test: cmd => /(^|[\s;&|])(\S*[\\/])?truncate\b/i.test(stripQuotedSpans(cmd)),
    category: 'overwrite' },
  // Per-segment: --dry-run only exempts the segment it appears in. Tested
  // against segments so a real push cannot hide behind an exempting string
  // in a neighboring command. The exemption itself is parsed, not pattern-
  // matched, so a commented-out or borrowed `-n` cannot buy it.
  // The push MATCH ignores quoted spans (`echo "git push"` is prose — the same
  // rule as truncate/FLUSHALL below; a quoted command word is already unquoted
  // in the normalized string patternHits also feeds through here). The dry-run
  // exemption still parses the segment as given.
  { test: cmd => splitSegments(cmd).some(s => GIT_PUSH_RE.test(stripQuotedSpans(s)) && !gitPushIsDryRun(s)),
    category: 'external send' },
  { re: new RegExp(GIT + '(reset\\s+--hard|clean\\s+-\\w*[fdx])', 'i'), category: 'overwrite' },
  // Discarding uncommitted work. `git reset --hard` and `git clean` were already
  // registered; these reach the same place by a different subcommand and were
  // not. What they destroy was never committed, so no reflog entry can restore
  // it — this is strictly less recoverable than the two already covered.
  // `git checkout <branch>` and `-b` stay out: they switch, they do not discard.
  // Flags may follow the ref (`git checkout main -f` discards like `-f main`),
  // and any argument beginning with `.` is a pathspec, not a ref — a ref
  // component cannot start with a dot (git-check-ref-format) — so
  // `git checkout ./subdir` and `git checkout .github/workflows` overwrite
  // uncommitted edits under those paths.
  { re: new RegExp(GIT_CMD + 'checkout\\s+(\\S+\\s+)*(-\\w*f\\b|--force\\b|--\\s|\\.\\S*(\\s|$))', 'i'), category: 'overwrite' },
  { test: cmd => splitSegments(cmd).some(s => GIT_RESTORE_RE.test(s) && !gitRestoreIsUnstageOnly(s)),
    category: 'overwrite' },
  // `git switch -f|--force|--discard-changes` throws away local modifications on
  // the way to the other branch — the same uncommitted-work destruction as
  // `checkout -f`, reached through the subcommand that replaced it. A plain
  // `git switch <branch>` refuses to lose changes and stays defer.
  { re: new RegExp(GIT_CMD + 'switch\\s+(\\S+\\s+)*(-\\w*f\\b|--force\\b|--discard-changes\\b)', 'i'),
    category: 'overwrite' },
  { re: new RegExp(GIT_CMD + 'stash\\s+(clear|drop)\\b', 'i'),          category: 'deletion' },
  { re: new RegExp(GIT_CMD + '(filter-branch|filter-repo)\\b', 'i'),    category: 'overwrite' },
  // Destroying the recovery net itself. After these, the reflog answer to
  // "just restore it from the reflog" is gone too.
  { re: new RegExp(GIT_CMD + 'reflog\\s+expire\\b', 'i'),               category: 'deletion' },
  { re: new RegExp(GIT_CMD + 'gc\\b[^\\n]*--prune\\b', 'i'),            category: 'deletion' },
  // /i, unlike `branch -D` above: tag deletion is lowercase `-d` — there is no
  // capital/lowercase severity distinction to preserve, so command-name casing
  // (`GIT tag -d`, which Windows runs) must not change the judgment.
  { re: new RegExp(GIT_CMD + 'tag\\s+(\\S+\\s+)*(-\\w*d\\b|--delete\\b)', 'i'), category: 'deletion' },
  { re: new RegExp(GIT_CMD + 'update-ref\\s+(\\S+\\s+)*(-d\\b|--delete\\b)', 'i'), category: 'deletion' },
  { re: new RegExp(GIT_CMD + 'worktree\\s+remove\\b', 'i'),             category: 'deletion' },
  { re: new RegExp(GIT_CMD + 'submodule\\s+deinit\\b', 'i'),            category: 'deletion' },
  { re: new RegExp(GIT + '(commit|push)\\b[^\\n]*--no-verify', 'i'),    category: 'gate bypass' },
  // Only -D. Lowercase -d refuses to delete unmerged branches, so it is close to
  // reversible. Case matters here — no /i flag.
  { re: new RegExp(GIT + 'branch\\s+(\\S+\\s+)*-\\w*D'),                category: 'deletion' },
  { re: new RegExp(GIT + 'branch\\b[^\\n]*(--delete\\s+--force|--force\\s+--delete)', 'i'), category: 'deletion' },
  { re: /\bgh\s+(repo|release|gist|secret|variable)\s+delete\b/i,        category: 'deletion' },
  { re: /\bgh\s+api\b[^\n]*(-X|--method)[\s=]+DELETE\b/i, category: 'external send' },
  // Any write method through `gh api` is a business-system write with no undo
  // on the other side; only DELETE was registered.
  { re: /\bgh\s+api\b[^\n]*(-X|--method)[\s=]+(POST|PUT|PATCH)\b/i, category: 'external send' },
  // gh api switches to POST the moment a field flag appears — no -X required.
  // `gh api …/issues -f title=x` writes; only an explicit GET keeps field
  // flags read-only (they become query parameters).
  { test: cmd => /\bgh\s+api\b/i.test(cmd) && /(\s-[fF]\b|\s--(raw-)?field\b)/.test(cmd)
      && !/(-X|--method)[\s=]+GET\b/i.test(cmd),
    category: 'external send' },
  { re: /\bgh\s+(release|secret|variable)\s+(create|set)\b/i, category: 'deployment' },
  { re: /\bgh\s+pr\s+(merge|close)\b/i,                  category: 'external send' },
  // Destructive SQL, two tiers. The classic verb+keyword forms are unambiguous
  // enough to match anywhere. The bare-object forms (`DROP DATABASE prod`,
  // `TRUNCATE users`) collide with English prose — "drop database support",
  // "truncate long lines" are ordinary commit messages — so they count only
  // when a DB client appears in the same command. A gate that cries wolf on
  // commit messages trains the user to approve without reading.
  { re: /\b(drop\s+table|delete\s+from|truncate\s+table)\b/i, category: 'business-system write' },
  { test: cmd => /\b(psql|mysql|mariadb|sqlite3?|mongosh?|clickhouse-client|duckdb)\b/i.test(cmd)
      && /\b(drop\s+(database|schema|table|index|view)|delete\s+from|truncate\s+(table\s+)?\w)/i.test(cmd),
    category: 'business-system write' },
  // Same prose collision as bare-object SQL: "add FLUSHALL guard" is a commit
  // message. Unquoted occurrences ask anywhere; quoted ones only next to a
  // Redis client (`echo "FLUSHALL" | redis-cli` is a real flush).
  { test: cmd => /(^|[\s;&|])(FLUSHALL|FLUSHDB)\b/i.test(stripQuotedSpans(cmd))
      || (/\bFLUSH(ALL|DB)\b/i.test(cmd) && /\b(redis-cli|valkey-cli)\b/i.test(cmd)),
    category: 'business-system write' },
  { re: /\.(dropDatabase|dropIndexes)\s*\(|\.drop\s*\(\s*\)|deleteMany\s*\(\s*\{\s*\}\s*\)/,
    category: 'business-system write' },
  { re: /\bdd\s+if=/i,                                   category: 'overwrite' },
  // Upload forms are sends like POST bodies are: -F/--form (multipart),
  // -T/--upload-file (PUT), --json (implicit POST), --data-* variants.
  { re: /(^|[\s;&|])(curl|wget|Invoke-WebRequest)\b[^\n]*(-X\s*(POST|PUT|DELETE|PATCH)|--data(-\w+)?\b|-d\s|-F\s|--form\b|-T\s|--upload-file\b|--json\b)/i,
    category: 'external send' },
  // Remote sync/copy: rsync --delete removes files on the receiver; an
  // explicit user@host: target is an external send regardless of flags.
  { re: /\brsync\b[^\n]*--delete\b/i,                    category: 'deletion' },
  { re: /\b(scp|rsync)\b[^\n]*\s\S+@\S+:/i,              category: 'external send' },
  { re: /\baws\s+s3\s+(rm|rb)\b/i,                       category: 'deletion' },
  { re: /\baws\s+s3\s+sync\b[^\n]*--delete\b/i,          category: 'deletion' },
  // Cloud CLIs beyond s3: the verb is the last word of the subcommand
  // (`delete-object`, `terminate-instances`, `delete-db-instance`) or a bare
  // `delete` at the end of a gcloud/az command path. Listing and reading verbs
  // do not match. For gcloud/az the words between the CLI name and `delete`
  // must all be bare words (no leading `-`): otherwise `delete` in VALUE
  // position — `az group show --name delete`, `gcloud … list --filter delete` —
  // reads as the verb. The cost is missing `az --output json group delete`
  // (flag before the verb), which errs toward defer, not toward a false ask.
  // Global flags before the service (`aws --profile prod rds delete-…`) are the
  // standard multi-account spelling. The value-taking globals are enumerated by
  // name — a generic "flag plus maybe-value" guess cannot tell `--no-paginate
  // rds` (flag, then service) from `--profile prod` (flag and value). Unknown
  // globals err toward defer, the same trade the gcloud/az pattern documents.
  { re: /\baws\s+((--profile|--region|--endpoint-url|--output|--color|--cli-connect-timeout|--cli-read-timeout|--query)([=\s]+\S+)?\s+|--no-[\w-]+\s+|--debug\s+)*[a-z][\w-]*\s+(delete|terminate|destroy|remove)[\w-]*\b/i, category: 'deletion' },
  { re: /\b(gcloud|az)\s+(?:[A-Za-z][\w-]*\s+)+delete\b/i, category: 'deletion' },
  { re: /\bhelm\s+(uninstall|delete)\b/i,                category: 'deployment' },
  { re: /\bdocker\s+(system|volume|image|container|network|builder)\s+prune\b/i, category: 'deletion' },
  { re: /\b(npm|yarn|pnpm)\s+publish\b/i,                category: 'deployment' },
  // Taking a published version back is not a rollback: registries keep the name
  // reserved, downstream lockfiles break immediately, and republishing the same
  // version is refused.
  { re: /\b(npm|yarn|pnpm)\s+(unpublish|deprecate)\b/i,  category: 'deployment' },
  { re: /\bcargo\s+(publish|yank)\b/i,                   category: 'deployment' },
  { re: /\bgem\s+push\b/i,                               category: 'deployment' },
  { re: /\b(twine\s+upload|poetry\s+publish|flit\s+publish)\b/i, category: 'deployment' },
  { re: /\bdotnet\s+nuget\s+push\b/i,                    category: 'deployment' },
  { re: /\bmvn\b[^\n]*\sdeploy\b/i,                      category: 'deployment' },
  { re: /\b(docker\s+push|kubectl\s+(apply|delete)|terraform\s+(apply|destroy))\b/i, category: 'deployment' },
  // Whole-volume destruction. `dd if=` was registered; the commands that exist
  // for exactly this purpose were not.
  { re: /(^|[\s;&|])(\S*[\\/])?mkfs(\.\w+)?\b/i,         category: 'overwrite' },
  { re: /(^|[\s;&|])(\S*[\\/])?(diskpart|fdisk|parted)\b/i, category: 'overwrite' },
  { re: /\b(Format-Volume|Initialize-Disk|Clear-Disk|Remove-Partition)\b/i, category: 'overwrite' },
  // Windows `rd /s /q <dir>` is `rm -rf` under another name. `rmdir` was
  // registered; its two-letter alias was not.
  { re: /(^|[\s;&|])rd\s+\/[a-z]/i,                      category: 'deletion' },
  // One layer of shell wrapping or encoding neutralizes every pattern above
  // (L12 encoding-obfuscation). The wrapped content cannot be judged, so the
  // wrapping itself is treated as "cannot judge → ask".
  // Short options cluster: `bash -lc "…"`, `sh -ec "…"`, `zsh -ic "…"` all run
  // the string exactly like `-c` does, and long forms may precede it
  // (`bash --login -c`). Requiring a standalone `-c` matched none of them.
  // The shell name must be in command position. A bare `\b` also matches the
  // tail of a FILENAME — `./deploy.sh -c config.yml` was read as `sh -c` and
  // asked, while `bash deploy.sh` (the same script, actually run) deferred. An
  // optional path prefix keeps `/bin/sh -c` and `C:\tools\bash.exe -c` matching.
  { re: /(^|[\s;&|])(\S*[\\/])?(bash|sh|zsh|dash|ksh)(\.exe)?\b(\s+(--?[\w-]+(=\S*)?|[^\s-]\S*))*\s+-[a-zA-Z]*c\b/i, category: 'gate bypass' },
  // Interpreter one-liners are shell wrapping with a different binary:
  // `python -c "shutil.rmtree(…)"` deletes like rm and `node -e` can append to
  // any file — including this gate's own ledger. Judging them differently from
  // `bash -c` would contradict the rule above.
  // Same clustering applies to interpreters: `perl -we`, `python3 -Ic`,
  // `python -Sc`, `ruby -we`. Only options that carry CODE belong here.
  //
  // Two separate entries because case matters for one of them and not the
  // other: `-c`/`-e` are code on every interpreter here, but the uppercase
  // pair is perl's `-E` and php's `-R` specifically — folding case would make
  // `-r` (node's module preload, which runs a FILE) look like code and ask on
  // ordinary `node -r ts-node/register app.js`. The code letter must also END
  // the cluster, the way an option that takes a value does.
  { re: /\b(python3?|node|nodejs|deno|bun|perl|ruby|php)(\.exe)?\b[^\n]*\s-[a-zA-Z]*[ce](?=[\s"'=]|$)/i,
    category: 'gate bypass' },
  { re: /\b(perl|php)(\.exe)?\b[^\n]*\s-[a-zA-Z]*[ER](?=[\s"'=]|$)/,
    category: 'gate bypass' },
  { re: /\b(python3?|node|nodejs|deno|bun|perl|ruby|php)(\.exe)?\b[^\n]*\s--eval\b/i,
    category: 'gate bypass' },
  { re: /\b(powershell|pwsh)(\.exe)?\b[^\n]*\s-e(nc|ncodedcommand)?\b/i, category: 'gate bypass' },
  { re: /(^|[\s;&|])(iex|invoke-expression)\b/i,         category: 'gate bypass' },
  { re: /(^|[\s;&|])eval\s/i,                            category: 'gate bypass' },
  { re: /\|\s*(bash|sh|zsh|pwsh|powershell)(\.exe)?\s*($|[\s;&|])/i, category: 'gate bypass' },
  // `ssh host <command>` executes an unreadable command on a remote machine —
  // the same "cannot judge the wrapped content" situation as bash -c.
  // A bare `ssh host` (interactive session) is not matched.
  { re: /(^|[\s;&|])ssh\s+(-\w+\s+)*[\w.@-]+\s+\S/i,     category: 'gate bypass' },
  // Closing a ledger entry is itself consequential: the approval dialog is where
  // a human sees the hash, outcome, and evidence before the closure is written.
  { re: /\bmary-reconcile(\.js)?\b/i,                    category: 'ledger closure' },
];

function patternHits(cmd) {
  const raw = String(cmd);
  const norm = normalizeCommandWords(raw);
  const match = p => (p.re ? p.re.test(raw) : p.test(raw))
    || (norm !== raw && (p.re ? p.re.test(norm) : p.test(norm)));
  return BASH_PATTERNS.filter(match);
}

/* ── Self-protection ────────────────────────────────────────────────
 * This hook's own enforcement configuration. Changing it must go through the user.
 * The approval ledger belongs here too — if the ledger can be edited quietly,
 * approval history stops being evidence.
 *
 * Anchoring: plugin-relative paths (scripts/, hooks/hooks.json,
 * .claude-plugin/plugin.json) are protected ONLY under this plugin's actual
 * install root. Unanchored, the same names in unrelated repositories would
 * trigger the gate constantly — and a gate that cries wolf trains the user to
 * approve without reading, which defeats the gate ("a bypassed harness is no
 * harness at all"). Host-level enforcement files (.claude/settings*.json,
 * managed-settings.json) and the ledger stay protected at ANY path — they are
 * enforcement config wherever they live.
 */
const PLUGIN_ROOT = path.resolve(__dirname, '..', '..');

/** Escape a filesystem path into a slash-direction-insensitive regex source. */
function pathPattern(p) {
  return String(p).split(/[\\/]+/)
    .map(seg => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('[\\\\/]');
}
const ROOT_RE = pathPattern(PLUGIN_ROOT);

const SELF_PROTECTED = [
  // host enforcement config + ledger: any path
  /[\\/]\.claude[\\/]settings(\.local)?\.json$/i,
  /[\\/]managed-settings\.json$/i,
  /[\\/]mary[\\/]approvals\.jsonl$/i,
  // notify.json is enforcement config too: it names the URL and headers the
  // notifier POSTs to. A quiet edit turns every approval prompt into an
  // outbound ping to an attacker-chosen endpoint, so it is protected like
  // the ledger — at any path.
  /[\\/]mary[\\/]notify\.json$/i,
  // plugin enforcement files: anchored to this plugin's install root.
  // scripts/ covers the hooks, the reconcile CLI, the receipt auditor, and the
  // managed installers — the whole ledger-integrity chain.
  new RegExp(ROOT_RE + '[\\\\/]scripts[\\\\/]', 'i'),
  new RegExp(ROOT_RE + '[\\\\/]hooks[\\\\/]hooks\\.json$', 'i'),
  new RegExp(ROOT_RE + '[\\\\/]\\.claude-plugin[\\\\/]plugin\\.json$', 'i'),
];

/* Protected-path patterns for Bash command strings.
 * Generic entries match at any path; plugin-relative entries apply only when
 * the command's working directory is inside the plugin root (relative mentions
 * elsewhere are other projects' files, not this gate's). An absolute mention of
 * the plugin root is protected from any working directory. */
const BASH_SELF_PROTECTED = [
  /\.claude[\\/]settings(\.local)?\.json/i,
  /managed-settings\.json/i,
  /mary[\\/]approvals\.jsonl/i,
  /mary[\\/]notify\.json/i,
];
const BASH_SELF_PROTECTED_ROOT = new RegExp(
  ROOT_RE + '[\\\\/](scripts[\\\\/]|hooks[\\\\/]hooks\\.json|\\.claude-plugin[\\\\/]plugin\\.json)', 'i');
const BASH_SELF_PROTECTED_REL = [
  /hooks[\\/]hooks\.json/i,
  /\.claude-plugin[\\/]plugin\.json/i,
  /scripts[\\/]hooks[\\/]/i,
  /scripts[\\/](mary-reconcile\.js|mary-stats\.js|install-managed\.(ps1|sh))/i,
];

function cwdInsidePluginRoot(cwd) {
  if (!cwd) return false;
  try {
    const rel = path.relative(PLUGIN_ROOT, path.resolve(String(cwd)));
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
  } catch {
    return false;
  }
}

function mentionsProtectedPath(cmd, cwd) {
  if (BASH_SELF_PROTECTED.some(re => re.test(cmd))) return true;
  if (BASH_SELF_PROTECTED_ROOT.test(cmd)) return true;
  if (cwdInsidePluginRoot(cwd) && BASH_SELF_PROTECTED_REL.some(re => re.test(cmd))) return true;
  return false;
}

/* Signals that a command can modify files. Only used in combination with a
 * protected-path mention. Redirection excludes fd duplication like 2>&1.
 * This is a compromise that keeps read-only mentions (cat, node) unblocked —
 * which is exactly why it is not complete. ln can replace a protected file
 * with a link to attacker-chosen content, so it counts as a write. */
const BASH_WRITE_HINTS =
  /(>\s*"?[^>&\s]|\btee\b|\bsed\s+-\w*i|\b(cp|mv)\b|\bln\s|Set-Content|Add-Content|Out-File|New-Item|\bchmod\b|\battrib\b)/i;

const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

/* ── Decision (pure function; tests call this directly) ──────────── */

function decide(payload) {
  const tool = String((payload && payload.tool_name) || '');
  const input = (payload && payload.tool_input) || {};

  // An unknown tool is not deferred. Deferring it would make "unregistered tool"
  // indistinguishable from "failed to judge".
  if (!tool) {
    return { decision: 'ask', category: 'cannot judge',
      reason: 'Could not identify the tool being called (tool_name missing). Cannot judge, so confirmation is required.' };
  }

  if (tool === 'Bash') {
    const cmd = String(input.command || '');
    if (!cmd.trim()) {
      return { decision: 'ask', category: 'cannot judge',
        reason: 'This is a Bash call but the command could not be read. Cannot judge, so confirmation is required.' };
    }
    const hits = patternHits(cmd);
    if (mentionsProtectedPath(cmd, payload && payload.cwd) && BASH_WRITE_HINTS.test(cmd)) {
      hits.push({ category: 'enforcement-config change' });
    }
    if (hits.length) {
      const cats = [...new Set(hits.map(h => h.category))].join(' · ');
      return {
        decision: 'ask',
        category: cats,
        reason:
          `Classified as an irreversible action (${cats}).\n` +
          `Command: ${cmd.length > 300 ? cmd.slice(0, 300) + ' …' : cmd}\n\n` +
          `Before approving, confirm: the exact target / the blast radius / how to roll back.\n` +
          `(SKILL.md stage 3: "an irreversible operation requires showing the target, scope, and rollback path before approval")`,
      };
    }
    return { decision: 'defer', reason: 'No registered irreversible action recognized' };
  }

  if (WRITE_TOOLS.has(tool)) {
    const p = String(input.file_path || input.notebook_path || '');
    // Resolve relative paths against the call's working directory so that a
    // relative write ("scripts/hooks/x.js") from inside the plugin root is
    // judged by where it actually lands.
    let resolved = p;
    try {
      if (p && payload && payload.cwd) resolved = path.resolve(String(payload.cwd), p);
    } catch { /* an unresolvable path is judged as given */ }
    if (SELF_PROTECTED.some(re => re.test(p) || re.test(resolved))) {
      return {
        decision: 'ask',
        category: 'enforcement-config change',
        reason:
          `This modifies the harness's own enforcement configuration.\nTarget: ${p}\n\n` +
          `If this file changes, the gate itself can be neutralized. Confirm the change is intended.`,
      };
    }
    return { decision: 'defer', reason: 'No registered irreversible action recognized' };
  }

  // Unregistered tools are not treated as protected. They go to the normal flow.
  return { decision: 'defer', reason: 'No registered irreversible action recognized' };
}

/* ── Context warnings (best-effort; never change the decision) ────── */

function sessionMarkerPath(sessionId) {
  return path.join(MARY_DIR, `_trifecta-${String(sessionId).replace(/[^A-Za-z0-9-]/g, '')}.json`);
}

/**
 * Append two observations to the text the human is about to approve.
 * Both are visibility, not judgment — failing to compute them never changes
 * the decision, and neither ever produces an automatic allow or deny.
 *
 * 1. Cross-session: another session's still-open approval targeting the same
 *    working directory means the state the user just reviewed may have changed.
 *    Splitting the ledger per session would HIDE this — sharing one ledger is
 *    what makes it visible. (Limitation: matching is by cwd string; two clones
 *    of the same remote in different folders are not detected.)
 *
 * 2. Lethal trifecta (L12): this session has already ingested untrusted external
 *    content (recorded by mary-trifecta-sentinel.js) and the call being approved
 *    is an external send. Two of the three legs are observable; private-data
 *    access, the third, is not reliably detectable — so this is a warning shown
 *    to the human, never a block.
 */
function withContextWarnings(v, payload) {
  let reason = v.reason;
  try {
    const sid = payload.session_id || null;
    const cwd = normalizeCwd(payload.cwd);
    const ledgerState = openApprovalsDetailed();
    if (ledgerState.integrity.readError || ledgerState.integrity.parseErrors.length) {
      reason += '\n\n⚠ Mary could not establish approval-ledger integrity. Cross-session approval visibility may be incomplete; do not treat missing entries as proof of safety.';
    }
    if (cwd) {
      const others = ledgerState.approvals.filter(a =>
        a.session && a.session !== sid && normalizeCwd(a.cwd) === cwd);
      if (others.length) {
        reason += `\n\n⚠ ${others.length} unresolved approval(s) from other session(s) target this working directory. ` +
          `Their outcomes are unknown — the state you just reviewed may have changed. ` +
          `(Close them after observing side effects: node scripts/mary-reconcile.js)`;
      }
    }
  } catch { /* visibility is best-effort */ }
  try {
    // 'gate bypass' is included deliberately: a wrapped or encoded command cannot
    // be read, so it MAY be a send — excluding it would exempt exactly the
    // commands built to evade reading.
    if (/external send|gate bypass/.test(v.category || '') && payload.session_id) {
      const marker = sessionMarkerPath(payload.session_id);
      if (fs.existsSync(marker)) {
        let seen = '';
        try {
          const m = JSON.parse(fs.readFileSync(marker, 'utf8'));
          seen = Object.entries(m.sources || {}).map(([k, n]) => `${k}×${n}`).join(', ');
        } catch { seen = 'marker unreadable'; }
        reason += `\n\n⚠ lethal-trifecta signal (L12): this session has ingested untrusted external content` +
          (seen ? ` (${seen})` : '') +
          ` and this call is an external send — or a wrapper the gate cannot read, which may be one. ` +
          `If the session also touched private data, all three legs are present. ` +
          `Check exactly what is being sent before approving.`;
      }
    }
  } catch { /* visibility is best-effort */ }
  return reason;
}

/* ── Output ─────────────────────────────────────────────────────── */

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: `[${HOOK_ID}] ${reason}`,
    },
  }));
  process.exit(0);
}

function emitNoDecision() {
  process.exit(0);
}

/* ── Entry point ────────────────────────────────────────────────── */

function main() {
  let raw = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', c => { raw += c; });
  process.stdin.on('error', () => emit('ask', 'Could not read hook input (stdin error). Cannot judge.'));
  process.stdin.on('end', () => {
    // Empty input is not replaced with {}. That would disguise "no information"
    // as "harmless call".
    if (!raw.trim()) {
      return emit('ask', 'Hook input is empty. Nothing is known about what would run, so confirmation is required.');
    }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      // fail-closed: a parse failure is not a pass.
      return emit('ask', `Could not parse hook input (${e && e.message}). Cannot judge, so confirmation is required.`);
    }

    const v = decide(payload);
    if (v.decision === 'ask') v.reason = withContextWarnings(v, payload);

    if (v.decision !== 'ask') return emitNoDecision();

    // Record the approval request in the ledger. The displayed sentence and the
    // machine-matching identity serve different purposes. Stored request bodies
    // are compacted so source content and edit strings do not become permanent logs.
    const maskedText = maskSecrets(v.reason);
    const storedInput = compactRequest(payload.tool_input || {});
    const redacted = maskedText !== v.reason ||
      JSON.stringify(storedInput) !== JSON.stringify(payload.tool_input || {});
    const recorded = append({
      event: 'asked',
      session: payload.session_id || null,
      cwd: normalizeCwd(payload.cwd),
      tool: payload.tool_name || null,
      tool_use_id: payload.tool_use_id || null,
      category: v.category || null,
      request_hash: requestHash(payload.tool_name, payload.tool_input),
      presented_text: maskedText,
      request: storedInput,
      ...(redacted ? { redacted: true } : {}),
    });
    if (!recorded) {
      v.reason += '\n\nWARNING: Mary could not write the approval ledger. This approval and its outcome will not be auditable.';
    }

    emit('ask', v.reason);
  });
}

// Unexpected exceptions also end in confirmation, not in a pass.
process.on('uncaughtException', e => emit('ask', `Internal hook error (${e && e.message}). Cannot judge.`));

if (require.main === module) main();

module.exports = { decide, BASH_PATTERNS, SELF_PROTECTED, PLUGIN_ROOT };
