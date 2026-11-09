<#
.SYNOPSIS
  Smoke test for the phase-5c governance pages: Tokens, Access, Policies,
  Rotation, Settings -- plus the mint-once flow and chain-visible search.

.DESCRIPTION
  Signs in as owner (who has every capability) and asserts each page
  renders with its key markers. Hits /api/search to prove the palette's
  backing endpoint responds. Mints a token and asserts the plaintext is
  returned exactly once with no-store headers.

  Needs the dev server running and the seed applied.
#>

param(
  [string]$BaseUrl  = "http://localhost:3000",
  [string]$Email    = "owner@acme.test",
  [string]$Password = "demo-password-change-me"
)

$ErrorActionPreference = "Stop"

Write-Host "=== smoke-pages-5c.ps1 ===" -ForegroundColor Cyan
Write-Host "BaseUrl: $BaseUrl"
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
  Write-Host "FAIL: login threw -- is the dev server running?" -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor DarkRed
  exit 1
}
Check "login returned 200" ($login.StatusCode -eq 200) ""
$csrfCookie = $session.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "sop_csrf" } | Select-Object -First 1
$csrf = if ($csrfCookie) { $csrfCookie.Value } else { "" }

# --- Each page renders ---------------------------------------------------

$pages = @(
  @{ path = "/tokens";   markers = @("Tokens", "Active", "plaintext shown exactly once at mint") },
  @{ path = "/access";   markers = @("Access", "Pending requests", "Active grants", "Members") },
  @{ path = "/policies"; markers = @("Policies", "Configured for this org", "Catalogue", "deny_plaintext_in_cicd") },
  @{ path = "/rotation"; markers = @("Rotation", "Overdue", "Due soon", "No rotation policy") },
  @{ path = "/settings"; markers = @("Settings", "Organization", "Encryption posture", "Session") }
)

foreach ($p in $pages) {
  try {
    $res = Invoke-WebRequest -Uri "$BaseUrl$($p.path)" -WebSession $session -UseBasicParsing
    Check "GET $($p.path) returns 200" ($res.StatusCode -eq 200) "status=$($res.StatusCode)"
    foreach ($m in $p.markers) {
      Check "$($p.path) contains '$m'" ($res.Content -match [regex]::Escape($m)) ""
    }
  } catch {
    Check "GET $($p.path) returned 200" $false "threw: $($_.Exception.Message)"
  }
}

# --- Search endpoint (palette backing) ------------------------------------

$search = Invoke-WebRequest -Uri "$BaseUrl/api/search?q=stripe" -WebSession $session -UseBasicParsing
Check "GET /api/search?q=stripe returns 200" ($search.StatusCode -eq 200) ""
$searchBody = $search.Content | ConvertFrom-Json
Check "search returned three sections" (
  ($searchBody.PSObject.Properties.Name -contains "secrets") -and
  ($searchBody.PSObject.Properties.Name -contains "paths") -and
  ($searchBody.PSObject.Properties.Name -contains "actors")
) ""

# --- Mint a token (plaintext-once + no-store) -----------------------------

$mintBody = @{
  name           = "smoke-5c-$(Get-Date -Format 'yyyyMMddHHmmss')"
  principal      = "ci/smoke"
  scopes         = @("secrets:read")
  environmentIds = $null
  expiresInDays  = 1
} | ConvertTo-Json -Compress

$mint = Invoke-WebRequest -Uri "$BaseUrl/api/tokens" -Method POST `
  -WebSession $session -ContentType "application/json" `
  -Headers @{ "x-sop-csrf" = $csrf } -Body $mintBody -UseBasicParsing
Check "POST /api/tokens returns 201" ($mint.StatusCode -eq 201) "status=$($mint.StatusCode)"
$minted = $mint.Content | ConvertFrom-Json
Check "mint response plaintext starts with sop_live_" ($minted.plaintext -like "sop_live_*") ""
Check "mint response has no-store cache-control"       ($mint.Headers["cache-control"] -match "no-store") "header=$($mint.Headers['cache-control'])"

# --- Revoke the just-minted token -----------------------------------------

$tokenId = $minted.token.id
$revoke = Invoke-WebRequest -Uri "$BaseUrl/api/tokens/$tokenId" -Method DELETE `
  -WebSession $session -Headers @{ "x-sop-csrf" = $csrf } -UseBasicParsing
Check "DELETE /api/tokens/<id> returns 204" ($revoke.StatusCode -eq 204) "status=$($revoke.StatusCode)"

# --- Report ---------------------------------------------------------------

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
  Write-Host "smoke-pages-5c: PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "smoke-pages-5c: FAIL" -ForegroundColor Red
  exit 1
}
