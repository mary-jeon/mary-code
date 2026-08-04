<#
Mary — managed (administrator) deployment · Windows

  Run from an ELEVATED PowerShell, inside the repo:
    powershell -ExecutionPolicy Bypass -File scripts\install-managed.ps1 [-Tier gate|full] [-AllowManagedHooksOnly] [-Force]

Tiers (-Tier, default: gate):
  gate  registers ONLY the PreToolUse irreversible-action gate — the prevention layer.
        One hook process per gated tool call, nothing else. No outcome ledger closure,
        no trifecta warning, no session-start unknown report, no approval ping.
  full  registers the whole observability set as well (outcome recorder, trifecta
        sentinel, approval notifier, session report). This is what approval→outcome
        binding and unknown-reporting require — at the cost of 2-3 hook processes
        per tool call. Choose it deliberately.

What this does — and why it exists:
  A skills-directory install is NOT a trust boundary: the agent can edit user-space
  files, so there the gate only makes bypasses visible. Enforcement requires the hook
  scripts and their registration to live where the agent cannot write:

    1. copies scripts/ to an administrator-owned folder
       (default: C:\Program Files\ClaudeCode\mary\)
    2. registers the hooks with absolute paths in
       C:\Program Files\ClaudeCode\managed-settings.json
    3. with -AllowManagedHooksOnly, also blocks all non-managed hooks
       (user, project, and other plugins' hooks stop loading — check what you rely on first)

  Without -AllowManagedHooksOnly, a plugin install of Mary registers the same hooks
  a second time: prompts appear once but ledger events double up and pings send twice.
  Either pass the flag or disable the user-space plugin's hooks.

Re-run behavior: safe for upgrades. The target scripts folder is replaced (not
nested into), settings are validated before anything is copied, the previous
managed-settings.json is backed up, and the written file is parse-checked; on
validation failure the backup is restored.

Honest limits (unchanged by this script):
  - Without administrator rights this deployment is impossible; the user-space gate
    stays "visibility, not enforcement", and that is the honest maximum there.
  - Even managed, the gate covers only the tools and patterns it recognizes.
#>

[CmdletBinding()]
param(
  [string]$InstallDir = 'C:\Program Files\ClaudeCode\mary',
  [ValidateSet('gate', 'full')][string]$Tier = 'gate',
  [switch]$AllowManagedHooksOnly,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$Managed = 'C:\Program Files\ClaudeCode\managed-settings.json'

$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Administrator rights required. Without them a managed deployment is not possible — the user-space install remains visibility, not enforcement (see README "Enforcement boundary").'
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'node not found on PATH. The hooks are Node scripts; install Node.js first.'
}

$RepoRoot = Split-Path -Parent $PSScriptRoot
foreach ($rel in 'scripts\hooks\mary-irreversible-gate.js', 'scripts\hooks\lib\ledger.js', 'hooks\hooks.json') {
  if (-not (Test-Path (Join-Path $RepoRoot $rel))) { throw "Not a Mary repo checkout: missing $rel" }
}

# ── 1. Validate existing settings BEFORE touching anything on disk ──
$settings = [ordered]@{}
$backup = $null
if (Test-Path $Managed) {
  $existing = Get-Content $Managed -Raw | ConvertFrom-Json   # throws on corrupt JSON — deliberate
  if ($existing.PSObject.Properties['hooks'] -and -not $Force) {
    throw 'managed-settings.json already registers hooks. Re-run with -Force to REPLACE the hooks section (a backup keeps the old one), or merge by hand. Nothing was copied or changed.'
  }
  foreach ($p in $existing.PSObject.Properties) { $settings[$p.Name] = $p.Value }
  $backup = "$Managed.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $Managed $backup
  Write-Host "Existing managed-settings.json backed up to $backup"
} else {
  New-Item -ItemType Directory -Force -Path (Split-Path $Managed) | Out-Null
}

# ── 2. Copy scripts — REPLACE the target, never nest into it (re-run safety) ──
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
$destScripts = Join-Path $InstallDir 'scripts'
if (Test-Path $destScripts) { Remove-Item -Recurse -Force $destScripts }
Copy-Item -Recurse (Join-Path $RepoRoot 'scripts') $destScripts

# ── 3. Build the hook registration (absolute paths) ──
$H = Join-Path $destScripts 'hooks'
function HookCmd([string]$script) { @{ type = 'command'; command = "node `"$(Join-Path $H $script)`"" } }

$gate     = HookCmd 'mary-irreversible-gate.js'
$WriteTools = 'Bash|Write|Edit|MultiEdit|NotebookEdit'

# gate tier: prevention only. Every registration below the gate is observability —
# it never blocks and never decides — and each one is a hook process on the hot path.
$maryHooks = @{
  PreToolUse = @(
    @{ matcher = $WriteTools; hooks = @($gate) }
  )
}

if ($Tier -eq 'full') {
  $sentinel = HookCmd 'mary-trifecta-sentinel.js'   # PostToolUse: a denied fetch ingested nothing
  $recorder = HookCmd 'mary-outcome-recorder.js'
  $notifier = HookCmd 'mary-approval-notifier.js'
  $report   = HookCmd 'mary-session-report.js'

  $maryHooks.PostToolUse = @(
    @{ matcher = $WriteTools;               hooks = @($recorder) },
    @{ matcher = 'WebFetch|WebSearch|Bash'; hooks = @($sentinel) }
  )
  $maryHooks.PostToolUseFailure = @(@{ matcher = $WriteTools; hooks = @($recorder) })
  $maryHooks.PermissionDenied   = @(@{ matcher = $WriteTools; hooks = @($recorder) })
  $maryHooks.Notification       = @(@{ matcher = 'permission_prompt'; hooks = @($notifier) })
  $maryHooks.SessionStart       = @(@{ matcher = '*'; hooks = @($report) })
}

$settings['hooks'] = $maryHooks
if ($AllowManagedHooksOnly) { $settings['allowManagedHooksOnly'] = $true }

# ── 4. Write WITHOUT a BOM (PS 5.1 Set-Content -Encoding UTF8 adds one, and a
#       BOM can make strict JSON parsers reject the file — silently turning the
#       whole managed deployment into a no-op), then parse-check what was written ──
$json = $settings | ConvertTo-Json -Depth 10
[System.IO.File]::WriteAllText($Managed, $json, [System.Text.UTF8Encoding]::new($false))

& node -e "JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8'))" $Managed
if ($LASTEXITCODE -ne 0) {
  if ($backup) { Copy-Item $backup $Managed -Force }
  throw "Written managed-settings.json failed JSON.parse validation$(if ($backup) { ' — backup restored' })."
}

Write-Host ''
Write-Host 'Managed deployment complete (written file passed JSON.parse).'
Write-Host "  hook scripts : $H\"
Write-Host "  registration : $Managed"
Write-Host "  tier         : $(if ($Tier -eq 'full') { 'full — gate + outcome recorder + trifecta sentinel + notifier + session report' } else { 'gate — PreToolUse gate only. NOT active: approval→outcome binding, trifecta warnings, unknown reports, pings (re-run with -Tier full to add them)' })"
Write-Host "  managed-only : $(if ($AllowManagedHooksOnly) { 'ON — non-managed hooks (user/project/plugins) will not load' } else { 'off — user-space hooks still load alongside; a plugin install of Mary would then run every hook twice' })"
Write-Host ''
Write-Host 'Remaining honest limits: the gate covers only recognized tools and patterns,'
Write-Host 'and semantic risk classification stays with the human approval button.'
Write-Host 'Restart Claude Code sessions for managed settings to take effect.'
