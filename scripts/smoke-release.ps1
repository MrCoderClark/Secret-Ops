<#
.SYNOPSIS
  Milestone 7 release gate. Runs the whole verification sweep.

.DESCRIPTION
  Chains every quality check into one invocation:

    1. pnpm typecheck
    2. pnpm build (with a placeholder DATABASE_URL so it does not need a live DB)
    3. (optional) docker compose --profile full build + up + health probe
    4. scripts/smoke-worker.ps1         (30s run, both sweeps fire)
    5. scripts/smoke-dashboard.ps1
    6. scripts/smoke-pages-5b.ps1
    7. scripts/smoke-pages-5c.ps1
    8. scripts/smoke-chain-tamper.ps1   (flip one hash, assert detection)
    9. scripts/smoke-roles.ps1          (RBAC matrix matches SECURITY.md)

  Any step failing fails the whole sweep. The dev server must be running
  on BaseUrl before invocation; this script does not start it, because
  swallowing that lifecycle makes debugging a failure much harder.

.PARAMETER BaseUrl
  Dashboard origin for HTTP checks. Default http://localhost:3000.

.PARAMETER IncludeDocker
  Also build + run `docker compose --profile full up -d`. Adds ~5 minutes
  on a cold cache. Off by default; flip on before cutting an actual release.

.PARAMETER SkipTypecheck, SkipBuild, SkipWorker, SkipPages, SkipTamper, SkipRoles
  Opt out of individual steps while iterating.
#>

param(
  [string]$BaseUrl = "http://localhost:3000",
  [switch]$IncludeDocker,
  [switch]$IncludeBuild,       # off by default -- see note below
  [switch]$SkipTypecheck,
  [switch]$SkipWorker,
  [switch]$SkipPages,
  [switch]$SkipTamper,
  [switch]$SkipRoles
)

# NOTE on -IncludeBuild: `next build` writes to .next, but `pnpm dev` (which
# the HTTP smokes require) also owns .next. Running them concurrently causes
# both to fail. Build is therefore its own separate check:
#     Ctrl+C the dev server, then from web/ run:  pnpm build
# Pass -IncludeBuild here only when you have already stopped pnpm dev AND
# are willing to let the sweep's HTTP steps fail as a consequence.

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  SecretOps release sweep (M7)" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "BaseUrl:        $BaseUrl"
Write-Host "IncludeDocker:  $IncludeDocker"
Write-Host ""

$repoRoot  = Split-Path -Parent $PSScriptRoot
$webDir    = Join-Path $repoRoot "web"
$scriptDir = $PSScriptRoot
$started   = Get-Date

$steps = @()
function Step {
  param([string]$Name, [scriptblock]$Body)
  Write-Host ""
  Write-Host "--- $Name ---" -ForegroundColor Yellow
  $t0 = Get-Date
  try {
    & $Body
    $ok = ($LASTEXITCODE -eq 0) -or ($null -eq $LASTEXITCODE)
  } catch {
    $ok = $false
    Write-Host "  threw: $($_.Exception.Message)" -ForegroundColor DarkRed
  }
  $dt = (Get-Date) - $t0
  $script:steps += [pscustomobject]@{
    Step     = $Name
    Ok       = $ok
    Duration = ("{0:N1}s" -f $dt.TotalSeconds)
  }
  if ($ok) {
    Write-Host ("  --> PASS ({0:N1}s)" -f $dt.TotalSeconds) -ForegroundColor Green
  } else {
    Write-Host ("  --> FAIL ({0:N1}s)" -f $dt.TotalSeconds) -ForegroundColor Red
  }
}

# --- 1. Typecheck ---------------------------------------------------------

if (-not $SkipTypecheck) {
  Step "typecheck" { Push-Location $webDir; try { pnpm typecheck } finally { Pop-Location } }
}

# --- 2. Build (no live DB needed) ----------------------------------------

if ($IncludeBuild) {
  Step "build (next build)" {
    Push-Location $webDir
    try {
      if (Test-Path ".next") { Remove-Item -Recurse -Force ".next" }
      $env:DATABASE_URL = "postgresql://build:build@localhost:5432/build"
      pnpm exec next build
    } finally { Pop-Location }
  }
}

# --- 3. Optional: full docker stack --------------------------------------

if ($IncludeDocker) {
  Step "docker compose --profile full build" {
    Push-Location $repoRoot
    try { docker compose --profile full build } finally { Pop-Location }
  }
  Step "docker compose --profile full up -d" {
    Push-Location $repoRoot
    try { docker compose --profile full up -d } finally { Pop-Location }
  }
  Step "wait for /api/health" {
    $deadline = (Get-Date).AddSeconds(60)
    $okNow = $false
    while ((Get-Date) -lt $deadline) {
      try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) { $okNow = $true; break }
      } catch { }
      Start-Sleep -Seconds 2
    }
    if (-not $okNow) { throw "health never came up" }
  }
}

# --- 4. Worker sweep (short) ---------------------------------------------

if (-not $SkipWorker) {
  Step "smoke-worker (30s run)" {
    & (Join-Path $scriptDir "smoke-worker.ps1") -RotationMs 10000 -DriftMs 5000 -DurationSec 30
  }
}

# --- 5-7. Page smokes ----------------------------------------------------

if (-not $SkipPages) {
  Step "smoke-dashboard"  { & (Join-Path $scriptDir "smoke-dashboard.ps1")  -BaseUrl $BaseUrl }
  Step "smoke-pages-5b"   { & (Join-Path $scriptDir "smoke-pages-5b.ps1")   -BaseUrl $BaseUrl }
  Step "smoke-pages-5c"   { & (Join-Path $scriptDir "smoke-pages-5c.ps1")   -BaseUrl $BaseUrl }
}

# --- 8. Chain tamper detection -------------------------------------------

if (-not $SkipTamper) {
  Step "smoke-chain-tamper" {
    & (Join-Path $scriptDir "smoke-chain-tamper.ps1") -BaseUrl $BaseUrl
  }
}

# --- 9. Role matrix -------------------------------------------------------

if (-not $SkipRoles) {
  Step "smoke-roles" {
    & (Join-Path $scriptDir "smoke-roles.ps1") -BaseUrl $BaseUrl
  }
}

# --- Report --------------------------------------------------------------

$total = (Get-Date) - $started
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ("  Release sweep summary ({0:N1}s total)" -f $total.TotalSeconds) -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
foreach ($s in $steps) {
  $tag = if ($s.Ok) { "PASS" } else { "FAIL" }
  $col = if ($s.Ok) { "Green" } else { "Red" }
  Write-Host ("  [{0}] {1,-32} {2,8}" -f $tag, $s.Step, $s.Duration) -ForegroundColor $col
}

$failedArr = @($steps | Where-Object { -not $_.Ok })
$failedCount = $failedArr.Count
$totalCount  = @($steps).Count
Write-Host ""
if ($failedCount -eq 0) {
  Write-Host "smoke-release: PASS ($totalCount steps)" -ForegroundColor Green
  exit 0
} else {
  Write-Host ("smoke-release: FAIL ({0}/{1} steps failed)" -f $failedCount, $totalCount) -ForegroundColor Red
  foreach ($f in $failedArr) {
    Write-Host ("  - {0}" -f $f.Step) -ForegroundColor Red
  }
  exit 1
}
