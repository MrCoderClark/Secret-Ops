<#
.SYNOPSIS
  Smoke test for the SecretOps dashboard shell + Overview page (M5a).

.DESCRIPTION
  Hits the running dev server (default http://localhost:3000) and asserts:
    - GET /login returns 200 and contains the sign-in form markers
    - POST /api/auth/login with owner credentials returns 200 and sets
      sop_session + sop_csrf cookies plus a csrfToken in the body
    - GET /overview with that session returns 200 and contains every mock
      section marker: "Overview", "Secrets under management", "Drift
      detected", "Rotation overdue", "Audit chain", "Sync posture",
      "Rotation runway", "Recent activity"
    - POST /api/auth/logout returns 204 and expires both cookies

  Needs the app to be running (pnpm dev on the host, or docker compose
  --profile full up -d). The seed must have been applied so the owner
  account exists.

.PARAMETER BaseUrl
  Dashboard origin. Default http://localhost:3000.

.PARAMETER Email
  Login email. Default owner@acme.test.

.PARAMETER Password
  Login password. Default demo-password-change-me (seed default).

.EXAMPLE
  .\scripts\smoke-dashboard.ps1

.EXAMPLE
  .\scripts\smoke-dashboard.ps1 -BaseUrl http://localhost:3001 -Email admin@acme.test
#>

param(
  [string]$BaseUrl  = "http://localhost:3000",
  [string]$Email    = "owner@acme.test",
  [string]$Password = "demo-password-change-me"
)

$ErrorActionPreference = "Stop"

Write-Host "=== smoke-dashboard.ps1 ===" -ForegroundColor Cyan
Write-Host "BaseUrl:  $BaseUrl"
Write-Host "Email:    $Email"
Write-Host ""

$checks = @()
$pass = $true

function Check {
  param(
    [string]$Label,
    [bool]$Ok,
    [string]$Detail = "",
    [switch]$Skip,
    [string]$SkipReason = ""
  )
  if ($Skip) {
    $script:checks += [pscustomobject]@{ Check = $Label; Ok = $null; Detail = $SkipReason }
    return
  }
  $script:checks += [pscustomobject]@{ Check = $Label; Ok = $Ok; Detail = $Detail }
  if (-not $Ok) { $script:pass = $false }
}

# --- Preflight: is the server up? -----------------------------------------

try {
  $health = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 5
  Check "server is reachable (/api/health 200)" ($health.StatusCode -eq 200) "status=$($health.StatusCode)"
} catch {
  Write-Host "FAIL: could not reach $BaseUrl/api/health -- is the dev server running?" -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor DarkRed
  exit 1
}

# --- Login page renders ---------------------------------------------------

$loginPage = Invoke-WebRequest -Uri "$BaseUrl/login" -UseBasicParsing
Check "GET /login returns 200" ($loginPage.StatusCode -eq 200) "status=$($loginPage.StatusCode)"
Check "/login contains 'Sign in'" ($loginPage.Content -match 'Sign in') ""
Check "/login contains password field" ($loginPage.Content -match 'type="password"') ""

# --- Login ----------------------------------------------------------------

$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
$login = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body $loginBody -UseBasicParsing -SessionVariable session

Check "POST /api/auth/login returns 200" ($login.StatusCode -eq 200) "status=$($login.StatusCode)"
$sessionCookie = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "sop_session" } | Select-Object -First 1
$csrfCookie    = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "sop_csrf" }    | Select-Object -First 1
Check "login set sop_session cookie" ($null -ne $sessionCookie -and $sessionCookie.Value.Length -gt 0) ""
Check "login set sop_csrf cookie"    ($null -ne $csrfCookie    -and $csrfCookie.Value.Length -gt 0)    ""

$loginJson = $null
try { $loginJson = $login.Content | ConvertFrom-Json } catch { }
Check "login response has csrfToken" ($null -ne $loginJson -and -not [string]::IsNullOrEmpty($loginJson.csrfToken)) ""
Check "login response names the user" ($null -ne $loginJson.user -and $loginJson.user.email -eq $Email) `
  "saw email=$($loginJson.user.email)"

# --- Overview page renders with all mock sections -------------------------

$overview = Invoke-WebRequest -Uri "$BaseUrl/overview" -WebSession $session -UseBasicParsing
Check "GET /overview returns 200" ($overview.StatusCode -eq 200) "status=$($overview.StatusCode)"

$markers = @(
  "Overview",
  "Secrets under management",
  "Drift detected",
  "Rotation overdue",
  "Audit chain",
  "Sync posture",
  "Rotation runway",
  "Recent activity"
)
foreach ($m in $markers) {
  Check "/overview contains '$m'" ($overview.Content -match [regex]::Escape($m)) ""
}

# --- Logout clears cookies ------------------------------------------------

$logout = Invoke-WebRequest -Uri "$BaseUrl/api/auth/logout" -Method POST `
  -WebSession $session -UseBasicParsing
Check "POST /api/auth/logout returns 204" ($logout.StatusCode -eq 204) "status=$($logout.StatusCode)"

# Server replies with Set-Cookie clearing both; new cookies in the session
# have max-age=0 / empty value.
$sessionAfter = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "sop_session" } | Select-Object -First 1
$csrfAfter    = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "sop_csrf" }    | Select-Object -First 1
Check "sop_session cleared after logout" `
  ($null -eq $sessionAfter -or [string]::IsNullOrEmpty($sessionAfter.Value)) `
  "value=$($sessionAfter.Value)"
Check "sop_csrf cleared after logout" `
  ($null -eq $csrfAfter -or [string]::IsNullOrEmpty($csrfAfter.Value)) `
  "value=$($csrfAfter.Value)"

# --- Report ---------------------------------------------------------------

Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
foreach ($c in $checks) {
  if ($null -eq $c.Ok)        { $tag = "SKIP"; $color = "Yellow" }
  elseif ($c.Ok)              { $tag = "PASS"; $color = "Green" }
  else                        { $tag = "FAIL"; $color = "Red" }
  if ($c.Detail) { $detail = " -- $($c.Detail)" } else { $detail = "" }
  Write-Host ("  [{0}] {1}{2}" -f $tag, $c.Check, $detail) -ForegroundColor $color
}
Write-Host ""
if ($pass) {
  Write-Host "smoke-dashboard: PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "smoke-dashboard: FAIL" -ForegroundColor Red
  exit 1
}
