<#
.SYNOPSIS
  Smoke test for the phase-5b high-touch pages: Secrets, Sync, Audit log.

.DESCRIPTION
  Logs in as owner and asserts each page renders with its page-specific
  markers. Also exercises the reveal POST path headless -- it is the one
  interaction that trips CSRF most often.

  Needs the dev server running (pnpm dev) and the seed applied.

.PARAMETER BaseUrl
  Default http://localhost:3000.

.PARAMETER Email
  Default owner@acme.test.

.PARAMETER Password
  Default demo-password-change-me.
#>

param(
  [string]$BaseUrl  = "http://localhost:3000",
  [string]$Email    = "owner@acme.test",
  [string]$Password = "demo-password-change-me"
)

$ErrorActionPreference = "Stop"

Write-Host "=== smoke-pages-5b.ps1 ===" -ForegroundColor Cyan
Write-Host "BaseUrl:  $BaseUrl"
Write-Host "Email:    $Email"
Write-Host ""

$checks = @()
$pass = $true

function Check {
  param([string]$Label, [bool]$Ok, [string]$Detail = "")
  $script:checks += [pscustomobject]@{ Check = $Label; Ok = $Ok; Detail = $Detail }
  if (-not $Ok) { $script:pass = $false }
}

# --- Login ---------------------------------------------------------------

try {
  $loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
  $login = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" -Method POST `
    -ContentType "application/json" -Body $loginBody `
    -UseBasicParsing -SessionVariable session
} catch {
  Write-Host "FAIL: login request threw -- is the dev server running?" -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor DarkRed
  exit 1
}
Check "login returned 200" ($login.StatusCode -eq 200) "status=$($login.StatusCode)"

$csrfCookie = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "sop_csrf" } | Select-Object -First 1
Check "login set sop_csrf" ($null -ne $csrfCookie -and $csrfCookie.Value.Length -gt 0) ""
$csrf = if ($csrfCookie) { $csrfCookie.Value } else { "" }

# --- /secrets ------------------------------------------------------------

$secrets = Invoke-WebRequest -Uri "$BaseUrl/secrets" -WebSession $session -UseBasicParsing
Check "GET /secrets returns 200" ($secrets.StatusCode -eq 200) "status=$($secrets.StatusCode)"
foreach ($m in @("Secrets", "Key", "Environment", "Fingerprint", "filter by path or key")) {
  Check "/secrets contains '$m'" ($secrets.Content -match [regex]::Escape($m)) ""
}

# A filter run should still return 200 even when the result is empty
$filtered = Invoke-WebRequest -Uri "$BaseUrl/secrets?q=zzzzzzzznoway" -WebSession $session -UseBasicParsing
Check "GET /secrets?q=<nomatch> returns 200" ($filtered.StatusCode -eq 200) ""
Check "/secrets empty state message" ($filtered.Content -match "no secrets match") ""

# --- Reveal (CSRF + plaintext path) --------------------------------------

$listJson = Invoke-WebRequest -Uri "$BaseUrl/api/secrets?limit=1" -WebSession $session -UseBasicParsing
$list = $listJson.Content | ConvertFrom-Json
Check "list endpoint returned at least one secret" ($list.secrets.Count -ge 1) "count=$($list.secrets.Count)"
if ($list.secrets.Count -ge 1) {
  $firstId = $list.secrets[0].id
  $reveal = Invoke-WebRequest -Uri "$BaseUrl/api/secrets/$firstId/reveal" `
    -Method POST -WebSession $session -ContentType "application/json" `
    -Headers @{ "x-sop-csrf" = $csrf } -Body "{}" -UseBasicParsing
  Check "POST /api/secrets/.../reveal returns 200" ($reveal.StatusCode -eq 200) ""
  $revealed = $reveal.Content | ConvertFrom-Json
  Check "reveal response has a value"       ($null -ne $revealed.value -and $revealed.value.Length -gt 0) ""
  Check "reveal response has a fingerprint" ($null -ne $revealed.fingerprint) ""
  Check "reveal response is no-store"       ($reveal.Headers["cache-control"] -match "no-store") "header=$($reveal.Headers['cache-control'])"
}

# --- /sync ---------------------------------------------------------------

$sync = Invoke-WebRequest -Uri "$BaseUrl/sync" -WebSession $session -UseBasicParsing
Check "GET /sync returns 200" ($sync.StatusCode -eq 200) "status=$($sync.StatusCode)"
foreach ($m in @("Sync", "Targets", "plan preview")) {
  Check "/sync contains '$m'" ($sync.Content -match [regex]::Escape($m)) ""
}

# --- /audit --------------------------------------------------------------

$audit = Invoke-WebRequest -Uri "$BaseUrl/audit" -WebSession $session -UseBasicParsing
Check "GET /audit returns 200" ($audit.StatusCode -eq 200) "status=$($audit.StatusCode)"
foreach ($m in @("Audit log", "Audit chain", "Re-verify", "Events", "all actions")) {
  Check "/audit contains '$m'" ($audit.Content -match [regex]::Escape($m)) ""
}

# Verify chain through the API
$verify = Invoke-WebRequest -Uri "$BaseUrl/api/audit/verify" -Method POST `
  -WebSession $session -ContentType "application/json" `
  -Headers @{ "x-sop-csrf" = $csrf } -Body "{}" -UseBasicParsing
Check "POST /api/audit/verify returns 200" ($verify.StatusCode -eq 200) ""
$verifyBody = $verify.Content | ConvertFrom-Json
Check "chain verifies ok" ($verifyBody.ok -eq $true) "checked=$($verifyBody.checked)"

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
  Write-Host "smoke-pages-5b: PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "smoke-pages-5b: FAIL" -ForegroundColor Red
  exit 1
}
