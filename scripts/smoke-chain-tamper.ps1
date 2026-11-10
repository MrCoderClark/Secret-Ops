<#
.SYNOPSIS
  Prove the audit chain verifier catches tampering.

.DESCRIPTION
  The hash-chained audit log is the product's marquee security property.
  This test exercises it end-to-end:

    1. Call POST /api/audit/verify -- expect ok=true on a clean seed.
    2. Flip ONE byte of ONE hash in the database, directly via psql
       inside the postgres container (bypassing the service layer so
       recordEvent cannot repair the chain).
    3. Call verify again -- expect ok=false with firstFailureSeq set to
       the seq we tampered OR the next one (the break propagates forward).
    4. Restore the original hash from the saved value.
    5. Call verify a third time -- expect ok=true again.

  The script leaves the database in the state it found it in, even when
  an intermediate assertion fails (finally block restores the row).

.PARAMETER BaseUrl
  Default http://localhost:3000.

.PARAMETER Email
  The seeded user whose org we verify. Default owner@acme.test.

.PARAMETER Password
  Default demo-password-change-me.

.PARAMETER PgService
  The postgres SERVICE name in docker-compose.yml (not the container name).
  Default "postgres" -- what compose.yml defines.

.PARAMETER PgUser
  Default secretops.

.PARAMETER PgDb
  Default secretops.

.PARAMETER TargetSeq
  Which seq to tamper. Default 3 (safely in the middle of seeded events).
#>

param(
  [string]$BaseUrl   = "http://localhost:3000",
  [string]$Email     = "owner@acme.test",
  [string]$Password  = "demo-password-change-me",
  [string]$PgService = "postgres",
  [string]$PgUser    = "secretops",
  [string]$PgDb      = "secretops",
  [int]$TargetSeq    = 3
)

$ErrorActionPreference = "Stop"

Write-Host "=== smoke-chain-tamper.ps1 ===" -ForegroundColor Cyan
Write-Host "BaseUrl:   $BaseUrl"
Write-Host "PgService: $PgService"
Write-Host "TargetSeq: $TargetSeq"
Write-Host ""

$checks = @()
$pass = $true
function Check {
  param([string]$Label, [bool]$Ok, [string]$Detail = "")
  $script:checks += [pscustomobject]@{ Check = $Label; Ok = $Ok; Detail = $Detail }
  if (-not $Ok) { $script:pass = $false }
}

function Psql {
  param([string]$Sql)
  # Pipe the SQL via stdin. That way PowerShell does not try to pass the
  # script as an argv (which strips the inner double-quotes around
  # "organizationId" and Postgres then lowercases the unquoted identifier).
  # -t removes column headers, -A turns off aligned output.
  $raw = $Sql | docker compose exec -T $PgService psql -U $PgUser -d $PgDb -t -A 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "psql failed: $raw"
  }
  return ($raw -join "`n").Trim()
}

# --- Preflight -----------------------------------------------------------

try {
  $probe = Psql "SELECT 1;"
  if ($probe -notmatch "^1") { throw "unexpected probe output: $probe" }
} catch {
  Write-Host "FAIL: could not reach postgres via 'docker compose exec $PgService psql'. Is the stack up?" -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor DarkRed
  exit 1
}

# --- Login + initial verify ---------------------------------------------

$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
$login = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" -Method POST `
  -ContentType "application/json" -Body $loginBody `
  -UseBasicParsing -SessionVariable session
Check "login returned 200" ($login.StatusCode -eq 200) ""
$csrfCookie = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "sop_csrf" } | Select-Object -First 1
$csrf = if ($csrfCookie) { $csrfCookie.Value } else { "" }

$orgId = Psql "SELECT id FROM organizations WHERE slug = 'acme' LIMIT 1;"
Check "found acme organization id" ($orgId.Length -gt 10) "orgId=$orgId"

$verify1 = Invoke-WebRequest -Uri "$BaseUrl/api/audit/verify" -Method POST `
  -WebSession $session -ContentType "application/json" `
  -Headers @{ "x-sop-csrf" = $csrf } -Body "{}" -UseBasicParsing
Check "clean chain verifies ok=true" (($verify1.Content | ConvertFrom-Json).ok -eq $true) ""

# --- Save, tamper, verify, restore --------------------------------------

$originalHash = Psql "SELECT hash FROM access_events WHERE `"organizationId`" = '$orgId' AND seq = $TargetSeq;"
Check "fetched original hash for seq $TargetSeq" ($originalHash.Length -eq 64) "len=$($originalHash.Length)"

$tamperedHash = "0" * 64

try {
  $null = Psql "UPDATE access_events SET hash = '$tamperedHash' WHERE `"organizationId`" = '$orgId' AND seq = $TargetSeq;"
  Write-Host "  [tamper] flipped hash on seq $TargetSeq to all-zeros" -ForegroundColor Yellow

  $verify2 = Invoke-WebRequest -Uri "$BaseUrl/api/audit/verify" -Method POST `
    -WebSession $session -ContentType "application/json" `
    -Headers @{ "x-sop-csrf" = $csrf } -Body "{}" -UseBasicParsing
  $v2 = $verify2.Content | ConvertFrom-Json
  Check "tampered chain verifies ok=false" ($v2.ok -eq $false) "firstFailureSeq=$($v2.firstFailureSeq) reason=$($v2.reason)"
  Check "firstFailureSeq is at or after tampered seq" ($v2.firstFailureSeq -ge $TargetSeq) "failure=$($v2.firstFailureSeq) tampered=$TargetSeq"
  Check "verifier returned a reason" ($null -ne $v2.reason -and $v2.reason.Length -gt 0) "reason=$($v2.reason)"
} finally {
  $null = Psql "UPDATE access_events SET hash = '$originalHash' WHERE `"organizationId`" = '$orgId' AND seq = $TargetSeq;"
  Write-Host "  [restore] original hash written back" -ForegroundColor DarkGray
}

$verify3 = Invoke-WebRequest -Uri "$BaseUrl/api/audit/verify" -Method POST `
  -WebSession $session -ContentType "application/json" `
  -Headers @{ "x-sop-csrf" = $csrf } -Body "{}" -UseBasicParsing
Check "restored chain verifies ok=true" (($verify3.Content | ConvertFrom-Json).ok -eq $true) ""

# --- Report --------------------------------------------------------------

Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
foreach ($c in $checks) {
  if ($null -eq $c.Ok)   { $tag = "SKIP"; $color = "Yellow" }
  elseif ($c.Ok)         { $tag = "PASS"; $color = "Green" }
  else                   { $tag = "FAIL"; $color = "Red" }
  if ($c.Detail) { $detail = " -- $($c.Detail)" } else { $detail = "" }
  Write-Host ("  [{0}] {1}{2}" -f $tag, $c.Check, $detail) -ForegroundColor $color
}
Write-Host ""
if ($pass) {
  Write-Host "smoke-chain-tamper: PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "smoke-chain-tamper: FAIL" -ForegroundColor Red
  exit 1
}
