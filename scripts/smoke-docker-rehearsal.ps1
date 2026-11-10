<#
.SYNOPSIS
  Docker full-profile rehearsal for the M7 release gate.

.DESCRIPTION
  Runs the full-stack rehearsal end-to-end so the operator does not have to
  chain `docker compose` commands by hand. Steps, each a PASS/FAIL:

    1. docker compose --profile full build (app, worker)
    2. docker compose --profile full up -d
    3. wait for /api/health on BaseUrl (<= HealthTimeoutSec, default 60)
    4. verify _prisma_migrations matches web/prisma/migrations on disk
    5. invoke `prisma migrate deploy` inside the app container
       (via node_modules/.bin/prisma -- NOT via pnpm, which re-runs install
       at runtime and dies on corepack upgrades + overlayfs symlinks)
    6. optional: invoke `tsx prisma/seed.ts` inside the app container
       (-RunSeed; off by default -- seed bails on an existing Acme org)
    7. optional: docker compose --profile full down (-Down)

  Exits 0 only if every non-skipped step passes.

.PARAMETER BaseUrl
  Dashboard origin for the health probe. Default http://localhost:3000.

.PARAMETER HealthTimeoutSec
  Seconds to wait for /api/health to return 200. Default 60.

.PARAMETER SkipBuild, SkipUp, SkipHealth, SkipMigrate, SkipDbCheck
  Opt out of individual steps while iterating.

.PARAMETER RunSeed
  Also invoke tsx prisma/seed.ts in the container. Off by default because
  the seed bails on an existing Acme org, so a re-run is noise.

.PARAMETER Down
  After every other step, bring the stack down with `docker compose
  --profile full down`. Off by default so follow-up commands can still
  exec into the stack.
#>

param(
  [string]$BaseUrl           = "http://localhost:3000",
  [int]   $HealthTimeoutSec  = 60,
  [switch]$SkipBuild,
  [switch]$SkipUp,
  [switch]$SkipHealth,
  [switch]$SkipDbCheck,
  [switch]$SkipMigrate,
  [switch]$RunSeed,
  [switch]$Down
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot

$steps   = @()
$started = Get-Date

function Step {
  param([string]$Name, [scriptblock]$Body)
  Write-Host ""
  Write-Host "--- $Name ---" -ForegroundColor Yellow
  $t0 = Get-Date
  $ok = $false
  try {
    & $Body
    $ok = ($LASTEXITCODE -eq 0) -or ($null -eq $LASTEXITCODE)
  } catch {
    Write-Host "  threw: $($_.Exception.Message)" -ForegroundColor DarkRed
  }
  $dt = (Get-Date) - $t0
  $script:steps += [pscustomobject]@{
    Step     = $Name
    Ok       = $ok
    Duration = ("{0:N1}s" -f $dt.TotalSeconds)
  }
  $tag = if ($ok) { "PASS" } else { "FAIL" }
  $col = if ($ok) { "Green" } else { "Red" }
  Write-Host ("  --> {0} ({1:N1}s)" -f $tag, $dt.TotalSeconds) -ForegroundColor $col
}

Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "  SecretOps Docker rehearsal" -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host "BaseUrl:          $BaseUrl"
Write-Host "HealthTimeoutSec: $HealthTimeoutSec"
Write-Host "RunSeed:          $RunSeed"
Write-Host "Down:             $Down"
Write-Host ""

# --- 1. Build ------------------------------------------------------------

if (-not $SkipBuild) {
  Step "build (app + worker)" {
    docker compose --profile full build app worker
  }
}

# --- 2. Up ---------------------------------------------------------------

if (-not $SkipUp) {
  Step "up -d" {
    docker compose --profile full up -d
  }
  Step "docker compose ps" {
    docker compose ps
  }
}

# --- 3. Health ----------------------------------------------------------

if (-not $SkipHealth) {
  Step "wait for /api/health" {
    $deadline = (Get-Date).AddSeconds($HealthTimeoutSec)
    $okNow = $false
    while ((Get-Date) -lt $deadline) {
      try {
        $r = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 3
        if ($r.StatusCode -eq 200) {
          Write-Host "  $($r.Content)"
          $okNow = $true
          break
        }
      } catch { }
      Start-Sleep -Seconds 2
    }
    if (-not $okNow) {
      Write-Host "  no 200 after ${HealthTimeoutSec}s -- last app logs:" -ForegroundColor DarkRed
      docker compose logs --tail=50 app
      throw "health never came up"
    }
  }
}

# --- 4. Migration drift check -------------------------------------------

if (-not $SkipDbCheck) {
  Step "migrations-on-disk match _prisma_migrations" {
    $diskDir = Join-Path $repoRoot "web\prisma\migrations"
    $onDisk  = Get-ChildItem $diskDir -Directory |
               Where-Object { $_.Name -ne "migration_lock.toml" } |
               Select-Object -ExpandProperty Name | Sort-Object
    $dbRaw = docker compose exec -T postgres psql -U secretops -d secretops `
             -tAc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name;"
    $inDb = @($dbRaw -split "`r?`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" }) | Sort-Object

    Write-Host ("  on disk: " + ($onDisk -join ", "))
    Write-Host ("  in db:   " + ($inDb -join ", "))
    if (($onDisk -join "|") -ne ($inDb -join "|")) {
      throw "drift: on-disk migrations do not match _prisma_migrations"
    }
  }
}

# --- 5. prisma migrate deploy (via .bin shim, not pnpm) -----------------

if (-not $SkipMigrate) {
  Step "docker exec prisma migrate deploy" {
    docker compose exec -T app node_modules/.bin/prisma migrate deploy
  }
}

# --- 6. optional: seed --------------------------------------------------

if ($RunSeed) {
  Step "docker exec tsx prisma/seed.ts" {
    docker compose exec -T app tsx prisma/seed.ts
  }
}

# --- 7. optional: down --------------------------------------------------

if ($Down) {
  Step "down" {
    docker compose --profile full down
  }
}

# --- Report -------------------------------------------------------------

$total = (Get-Date) - $started
Write-Host ""
Write-Host "================================================================" -ForegroundColor Cyan
Write-Host ("  Rehearsal summary ({0:N1}s total)" -f $total.TotalSeconds) -ForegroundColor Cyan
Write-Host "================================================================" -ForegroundColor Cyan
foreach ($s in $steps) {
  $tag = if ($s.Ok) { "PASS" } else { "FAIL" }
  $col = if ($s.Ok) { "Green" } else { "Red" }
  Write-Host ("  [{0}] {1,-44} {2,8}" -f $tag, $s.Step, $s.Duration) -ForegroundColor $col
}

Pop-Location

$failedArr   = @($steps | Where-Object { -not $_.Ok })
$failedCount = $failedArr.Count
$totalCount  = @($steps).Count
Write-Host ""
if ($failedCount -eq 0) {
  Write-Host "smoke-docker-rehearsal: PASS ($totalCount steps)" -ForegroundColor Green
  exit 0
} else {
  Write-Host ("smoke-docker-rehearsal: FAIL ({0}/{1} steps failed)" -f $failedCount, $totalCount) -ForegroundColor Red
  foreach ($f in $failedArr) {
    Write-Host ("  - {0}" -f $f.Step) -ForegroundColor Red
  }
  exit 1
}
