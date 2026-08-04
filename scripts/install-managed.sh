#!/usr/bin/env sh
# Mary — managed (administrator) deployment · macOS / Linux
#
#   sudo sh scripts/install-managed.sh [--tier gate|full] [--allow-managed-hooks-only] [--force]
#
# Same contract as install-managed.ps1: copies scripts/ to a root-owned folder
# next to managed-settings.json and registers the hooks there with absolute
# paths. Without root this is impossible, and the user-space gate remains
# visibility, not enforcement (see README "Enforcement boundary").
#
# Tiers (--tier, default: gate):
#   gate  ONLY the PreToolUse irreversible-action gate — the prevention layer.
#         No outcome ledger closure, no trifecta warning, no unknown report, no ping.
#   full  adds the observability set (recorder, sentinel, notifier, session report)
#         — required for approval→outcome binding, at 2-3 hook processes per call.
#
# Re-run behavior: safe for upgrades. Settings are validated BEFORE anything is
# copied, the target scripts folder is replaced (not merged/nested into), the
# previous managed-settings.json is backed up, and the written file is
# parse-checked.

set -eu

case "$(uname -s)" in
  Darwin) MANAGED="/Library/Application Support/ClaudeCode/managed-settings.json" ;;
  *)      MANAGED="/etc/claude-code/managed-settings.json" ;;
esac
MANAGED_DIR=$(dirname "$MANAGED")
INSTALL_DIR="$MANAGED_DIR/mary"

ALLOW_ONLY=0; FORCE=0; TIER=gate; expect_tier=0
for a in "$@"; do
  if [ "$expect_tier" = "1" ]; then
    TIER="$a"; expect_tier=0; continue
  fi
  case "$a" in
    --allow-managed-hooks-only) ALLOW_ONLY=1 ;;
    --force) FORCE=1 ;;
    --tier) expect_tier=1 ;;
    --tier=*) TIER="${a#--tier=}" ;;
    *) echo "unknown option: $a" >&2; exit 1 ;;
  esac
done
[ "$expect_tier" = "0" ] || { echo "missing value for --tier" >&2; exit 1; }
case "$TIER" in gate|full) ;; *) echo "invalid --tier: $TIER (gate|full)" >&2; exit 1 ;; esac

[ "$(id -u)" = "0" ] || { echo "Root required (sudo). Without it a managed deployment is not possible." >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node not found on PATH." >&2; exit 1; }

REPO_ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
[ -f "$REPO_ROOT/scripts/hooks/mary-irreversible-gate.js" ] || { echo "Not a Mary repo checkout." >&2; exit 1; }

# ── 1. Validate existing settings BEFORE touching anything on disk ──
if [ -f "$MANAGED" ] && [ "$FORCE" != "1" ]; then
  rc=0
  MANAGED="$MANAGED" node -e '
    const s = JSON.parse(require("fs").readFileSync(process.env.MANAGED, "utf8"));
    process.exit(s.hooks ? 2 : 0);
  ' 2>/dev/null || rc=$?
  if [ "$rc" != "0" ]; then
    echo "managed-settings.json already registers hooks (or is unreadable). Re-run with --force to REPLACE the hooks section (a backup keeps the old one), or merge by hand. Nothing was copied or changed." >&2
    exit 1
  fi
fi

# ── 2. Copy scripts — REPLACE the target, never merge/nest (re-run safety:
#       a merge would leave deleted files behind; BSD cp would nest) ──
mkdir -p "$INSTALL_DIR"
rm -rf "$INSTALL_DIR/scripts"
cp -R "$REPO_ROOT/scripts" "$INSTALL_DIR/scripts"

# ── 3+4. Merge, write, and parse-check — in node (already required for the hooks) ──
MANAGED="$MANAGED" INSTALL_DIR="$INSTALL_DIR" ALLOW_ONLY="$ALLOW_ONLY" TIER="$TIER" node <<'EOF'
const fs = require('fs');
const path = require('path');

const managed = process.env.MANAGED;
const H = path.join(process.env.INSTALL_DIR, 'scripts', 'hooks');
const cmd = f => ({ type: 'command', command: `node "${path.join(H, f)}"` });
const WRITE_TOOLS = 'Bash|Write|Edit|MultiEdit|NotebookEdit';

// gate tier: prevention only. Everything below the gate is observability —
// never blocks, never decides — and each entry is a hook process on the hot path.
const maryHooks = {
  PreToolUse: [
    { matcher: WRITE_TOOLS, hooks: [cmd('mary-irreversible-gate.js')] },
  ],
};

if (process.env.TIER === 'full') {
  maryHooks.PostToolUse = [
    { matcher: WRITE_TOOLS, hooks: [cmd('mary-outcome-recorder.js')] },
    // PostToolUse, not PreToolUse: a denied fetch ingested nothing.
    { matcher: 'WebFetch|WebSearch|Bash', hooks: [cmd('mary-trifecta-sentinel.js')] },
  ];
  maryHooks.PostToolUseFailure = [{ matcher: WRITE_TOOLS, hooks: [cmd('mary-outcome-recorder.js')] }];
  maryHooks.PermissionDenied   = [{ matcher: WRITE_TOOLS, hooks: [cmd('mary-outcome-recorder.js')] }];
  maryHooks.Notification       = [{ matcher: 'permission_prompt', hooks: [cmd('mary-approval-notifier.js')] }];
  maryHooks.SessionStart       = [{ matcher: '*', hooks: [cmd('mary-session-report.js')] }];
}

let settings = {};
let backup = null;
if (fs.existsSync(managed)) {
  backup = `${managed}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(managed, backup);
  console.log(`Existing managed-settings.json backed up to ${backup}`);
  settings = JSON.parse(fs.readFileSync(managed, 'utf8'));
} else {
  fs.mkdirSync(path.dirname(managed), { recursive: true });
}

settings.hooks = maryHooks;
if (process.env.ALLOW_ONLY === '1') settings.allowManagedHooksOnly = true;
fs.writeFileSync(managed, JSON.stringify(settings, null, 2) + '\n', 'utf8'); // no BOM

// Parse-check what was actually written; restore the backup on failure.
try {
  JSON.parse(fs.readFileSync(managed, 'utf8'));
} catch (e) {
  if (backup) fs.copyFileSync(backup, managed);
  console.error(`Written managed-settings.json failed JSON.parse${backup ? ' — backup restored' : ''}: ${e.message}`);
  process.exit(1);
}

console.log('');
console.log('Managed deployment complete (written file passed JSON.parse).');
console.log(`  hook scripts : ${H}/`);
console.log(`  registration : ${managed}`);
console.log(`  tier         : ${process.env.TIER === 'full'
  ? 'full — gate + outcome recorder + trifecta sentinel + notifier + session report'
  : 'gate — PreToolUse gate only. NOT active: approval→outcome binding, trifecta warnings, unknown reports, pings (re-run with --tier full to add them)'}`);
console.log(`  managed-only : ${process.env.ALLOW_ONLY === '1'
  ? 'ON — non-managed hooks (user/project/plugins) will not load'
  : 'off — user-space hooks still load alongside; a plugin install of Mary would then run every hook twice'}`);
console.log('');
console.log('Remaining honest limits: the gate covers only recognized tools and patterns,');
console.log('and semantic risk classification stays with the human approval button.');
console.log('Restart Claude Code sessions for managed settings to take effect.');
EOF
