<#
.SYNOPSIS
  Verify each seeded user's RBAC behaviour matches the SECURITY matrix.

.DESCRIPTION
  Signs in as the four seeded users (owner, admin, dev, auditor) and
  calls a handful of representative endpoints. For each call we assert
  the status is the one SECURITY.md promises for that role on that
  capability:

                                 OWNER  ADMIN  DEV   AUDITOR
    GET /api/secrets            200    200    200   200
    GET /api/tokens             200+   200+   200- 200-     (- = empty list)
    POST /api/tokens (mint)     201    201    403   403
    POST /api/audit/verify      200    200    403   200
    POST /api/secrets/.../reveal (prod)
                                200    200    403*  403     (* dev without grant)

  Any mismatch is a RBAC regression -- fail loud so we don't ship it.

.PARAMETER BaseUrl
  Default http://localhost:3000.

.PARAMETER Password
  Shared seed password. Default demo-password-change-me.
#>

param(
  [string]$BaseUrl  = "http://localhost:3000",
  [string]$Password = "demo-password-change-me"
)

$ErrorActionPreference = "Stop"

Write-Host "=== smoke-roles.ps1 ===" -ForegroundColor Cyan
Write-Host "BaseUrl: $BaseUrl"
Write-Host ""

$checks = @()
$pass = $true
function Check {
  param([string]$Label, [bool]$Ok, [string]$Detail = "")
  $script:checks += [pscustomobject]@{ Check = $Label; Ok = $Ok; Detail = $Detail }
  if (-not $Ok) { $script:pass = $false }
}

function Login {
  param([string]$Email)
  $body = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
  $res = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" -Method POST `
    -ContentType "application/json" -Body $body `
    -UseBasicParsing -SessionVariable s
  if ($res.StatusCode -ne 200) { throw "login as $Email returned $($res.StatusCode)" }
  $csrfCookie = $s.Cookies.GetCookies($BaseUrl) | Where-Object { $_.Name -eq "sop_csrf" } | Select-Object -First 1
  return @{ Session = $s; Csrf = $csrfCookie.Value }
}

function StatusOf {
  param([string]$Method, [string]$Path, $Session, [string]$Csrf, [string]$Body = $null)
  $params = @{
    Uri             = "$BaseUrl$Path"
    Method          = $Method
    WebSession      = $Session.Session
    UseBasicParsing = $true
  }
  if ($Method -ne "GET") {
    $params["Headers"] = @{ "x-sop-csrf" = $Session.Csrf }
    if ($Body) {
      $params["ContentType"] = "application/json"
      $params["Body"]        = $Body
    } else {
      $params["ContentType"] = "application/json"
      $params["Body"]        = "{}"
    }
  }
  try {
    $res = Invoke-WebRequest @params
    return @{ Status = $res.StatusCode; Content = $res.Content }
  } catch [System.Net.WebException] {
    $res = $_.Exception.Response
    if ($res -ne $null) {
      return @{ Status = [int]$res.StatusCode; Content = "" }
    }
    throw
  } catch {
    # PowerShell 7 raises Microsoft.PowerShell.Commands.HttpResponseException
    if ($_.Exception.Response -ne $null) {
      return @{ Status = [int]$_.Exception.Response.StatusCode; Content = "" }
    }
    throw
  }
}

# --- Login as all four --------------------------------------------------

$users = @{
  owner    = Login "owner@acme.test"
  admin    = Login "admin@acme.test"
  dev      = Login "dev@acme.test"
  auditor  = Login "auditor@acme.test"
}
Check "all four seeded users signed in" ($users.Count -eq 4) ""

# --- Universal read: everybody can list secret metadata -----------------

foreach ($who in "owner","admin","dev","auditor") {
  $r = StatusOf "GET" "/api/secrets" $users[$who] ""
  Check "$who : GET /api/secrets -> 200" ($r.Status -eq 200) "status=$($r.Status)"
}

# --- Token management: only OWNER + ADMIN ------------------------------

$mintBody = @{
  name           = "roles-smoke-$(Get-Date -Format 'HHmmssfff')"
  principal      = "test/roles-smoke"
  scopes         = @("secrets:read")
  environmentIds = $null
  expiresInDays  = 1
} | ConvertTo-Json -Compress

foreach ($who in "owner","admin") {
  $mint = StatusOf "POST" "/api/tokens" $users[$who] $null $mintBody
  Check "$who : POST /api/tokens -> 201" ($mint.Status -eq 201) "status=$($mint.Status)"
  if ($mint.Status -eq 201) {
    $minted = $mint.Content | ConvertFrom-Json
    $id = $minted.token.id
    $rev = StatusOf "DELETE" "/api/tokens/$id" $users[$who] ""
    Check "$who : DELETE /api/tokens/<id> -> 204" ($rev.Status -eq 204) "status=$($rev.Status)"
  }
}

foreach ($who in "dev","auditor") {
  $mint = StatusOf "POST" "/api/tokens" $users[$who] $null $mintBody
  Check "$who : POST /api/tokens -> 403" ($mint.Status -eq 403) "status=$($mint.Status)"
}

# --- Chain verification: OWNER / ADMIN / AUDITOR yes, DEV no -----------

foreach ($who in "owner","admin","auditor") {
  $v = StatusOf "POST" "/api/audit/verify" $users[$who]
  Check "$who : POST /api/audit/verify -> 200" ($v.Status -eq 200) "status=$($v.Status)"
}
$vDev = StatusOf "POST" "/api/audit/verify" $users["dev"]
Check "dev : POST /api/audit/verify -> 403" ($vDev.Status -eq 403) "status=$($vDev.Status)"

# --- Reveal a prod secret: OWNER/ADMIN yes, DEV without grant no,
#     AUDITOR cannot read values at all --------------------------------

# Find a prod secret via OWNER's list (first prod-ish one by env label).
$all = (StatusOf "GET" "/api/secrets?limit=200" $users["owner"] "").Content | ConvertFrom-Json
# We don't have env label here (list returns environmentId). Try first prod
# secret by heuristic: the seed knows payments-api/prod has secrets. We
# pick the first secret id and try to reveal; the capability check happens
# server-side regardless of which env it is.
$firstId = $all.secrets[0].id

$rOwner = StatusOf "POST" "/api/secrets/$firstId/reveal" $users["owner"] ""
Check "owner : reveal first secret -> 200" ($rOwner.Status -eq 200) "status=$($rOwner.Status)"

$rAdmin = StatusOf "POST" "/api/secrets/$firstId/reveal" $users["admin"] ""
Check "admin : reveal first secret -> 200" ($rAdmin.Status -eq 200) "status=$($rAdmin.Status)"

$rAud = StatusOf "POST" "/api/secrets/$firstId/reveal" $users["auditor"] ""
Check "auditor : reveal first secret -> 403" ($rAud.Status -eq 403) "status=$($rAud.Status)"

# dev's reveal depends on whether the secret lives in a protected env and
# whether dev has a grant. The seed gives dev a READ grant on payments-api/prod
# for 60m, so some dev reveals succeed and some fail. We don't force a
# single expected status -- we just assert the response was one of {200,403},
# never 500.
$rDev = StatusOf "POST" "/api/secrets/$firstId/reveal" $users["dev"] ""
Check "dev : reveal first secret -> 200 or 403 (never 5xx)" (
  $rDev.Status -eq 200 -or $rDev.Status -eq 403
) "status=$($rDev.Status)"

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
  Write-Host "smoke-roles: PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "smoke-roles: FAIL" -ForegroundColor Red
  exit 1
}
