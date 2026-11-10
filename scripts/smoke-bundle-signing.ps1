<#
.SYNOPSIS
  Smoke test for M8 -- Ed25519 signatures on pull-mode sync bundles.

.DESCRIPTION
  Walks the full bundle-signing flow against a running dev server:

    1. Login as owner (cookie + CSRF).
    2. Bootstrap the org's BundleKey via POST /api/bundle-keys. Accepts
       201 (first run) OR 409 already_exists (subsequent runs).
    3. Find a pull-mode sync target from GET /api/sync.
    4. GET /api/sync/:id/bundle. Capture body bytes + X-Signature-Bundle
       + X-Signature-Key-Id. Resolve the matching public key from
       GET /api/bundle-keys. Verify the Ed25519 signature over the body
       bytes -- shells out to Node (stdlib only). Expect OK.
    5. Flip one byte in the body. Verify. Expect FAIL (the whole point
       of signing is that this test fails).
    6. POST /api/bundle-keys/rotate. Assert previousId is not null and
       a new active key id is returned.
    7. GET /api/bundle-keys. Assert the previous key is still listed
       with active=false and revokedAt set (the grace window).
    8. GET /api/sync/:id/bundle again. Assert X-Signature-Key-Id is
       the new key id. Verify over body bytes.

  NODE_ENV: this smoke expects `pnpm dev` on the host (NODE_ENV=development
  so session cookies are not Secure). Running against the Docker prod
  container fails at login because Invoke-WebRequest drops Secure cookies
  over plain HTTP -- see PROGRESS.md decisions log, 2026-11-10.

.PARAMETER BaseUrl
  Dashboard origin. Default http://localhost:3000.

.PARAMETER Email
  Login email. Default owner@acme.test (OWNER role has bundle_key.manage).

.PARAMETER Password
  Login password. Default demo-password-change-me (seed default).
#>

param(
  [string]$BaseUrl  = "http://localhost:3000",
  [string]$Email    = "owner@acme.test",
  [string]$Password = "demo-password-change-me"
)

$ErrorActionPreference = "Stop"

Write-Host "=== smoke-bundle-signing.ps1 ===" -ForegroundColor Cyan
Write-Host "BaseUrl:  $BaseUrl"
Write-Host "Email:    $Email"
Write-Host ""

$checks = @()
$pass = $true

function Check {
  param(
    [string]$Label,
    [bool]$Ok,
    [string]$Detail = ""
  )
  $script:checks += [pscustomobject]@{ Check = $Label; Ok = $Ok; Detail = $Detail }
  if (-not $Ok) { $script:pass = $false }
}

# --- Node-backed Ed25519 verifier. Writes a tiny .mjs to a temp path and -
# --- invokes it with (bodyPath, sigB64, pubB64). Prints OK or BAD.      --

$verifierJs = @'
import { createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
const [, , bodyPath, sigB64, pubB64] = process.argv;
const body = readFileSync(bodyPath);
const prefix = Buffer.from("302a300506032b6570032100", "hex");
const spki = Buffer.concat([prefix, Buffer.from(pubB64, "base64")]);
const key = createPublicKey({ key: spki, format: "der", type: "spki" });
const ok = verify(null, body, key, Buffer.from(sigB64, "base64"));
process.stdout.write(ok ? "OK" : "BAD");
'@

$verifierPath = Join-Path $env:TEMP ("secretops-verify-{0}.mjs" -f ([guid]::NewGuid().ToString("N")))
Set-Content -Path $verifierPath -Value $verifierJs -Encoding UTF8

function Test-Ed25519Signature {
  param(
    [byte[]]$BodyBytes,
    [string]$SignatureB64,
    [string]$PublicKeyB64
  )
  $bodyPath = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllBytes($bodyPath, $BodyBytes)
    $out = & node $verifierPath $bodyPath $SignatureB64 $PublicKeyB64 2>&1
    return ($out -join "") -eq "OK"
  } finally {
    Remove-Item $bodyPath -ErrorAction SilentlyContinue
  }
}

# --- Raw bundle fetch -- HttpWebRequest so we keep exact body bytes ------

function Invoke-RawBundle {
  param(
    [string]$Url,
    [System.Net.CookieContainer]$CookieContainer
  )
  $req = [System.Net.HttpWebRequest]::Create($Url)
  $req.Method = "GET"
  $req.CookieContainer = $CookieContainer
  $req.KeepAlive = $false
  $res = $req.GetResponse()
  try {
    $stream = $res.GetResponseStream()
    $mem = [System.IO.MemoryStream]::new()
    $stream.CopyTo($mem)
    return [pscustomobject]@{
      Status    = [int]$res.StatusCode
      Bytes     = $mem.ToArray()
      Signature = $res.Headers["x-signature-bundle"]
      KeyId     = $res.Headers["x-signature-key-id"]
    }
  } finally {
    $res.Close()
  }
}

# --- Preflight ------------------------------------------------------------

try {
  $health = Invoke-WebRequest -Uri "$BaseUrl/api/health" -UseBasicParsing -TimeoutSec 5
  Check "server is reachable" ($health.StatusCode -eq 200) "status=$($health.StatusCode)"
} catch {
  Write-Host "FAIL: could not reach $BaseUrl/api/health -- is pnpm dev running?" -ForegroundColor Red
  Write-Host "  $_" -ForegroundColor DarkRed
  Remove-Item $verifierPath -ErrorAction SilentlyContinue
  exit 1
}

# --- Login ---------------------------------------------------------------

$loginBody = @{ email = $Email; password = $Password } | ConvertTo-Json -Compress
$login = Invoke-WebRequest -Uri "$BaseUrl/api/auth/login" `
  -Method POST -ContentType "application/json" `
  -Body $loginBody -UseBasicParsing -SessionVariable session
Check "login returns 200" ($login.StatusCode -eq 200) "status=$($login.StatusCode)"

$loginJson = $login.Content | ConvertFrom-Json
$csrf = $loginJson.csrfToken
Check "login response carries csrfToken" (-not [string]::IsNullOrEmpty($csrf)) ""

# --- Bootstrap ------------------------------------------------------------

$bootstrap = $null
$bootstrapStatus = 0
try {
  $bootstrap = Invoke-WebRequest -Uri "$BaseUrl/api/bundle-keys" `
    -Method POST -ContentType "application/json" -Body "{}" `
    -Headers @{ "x-sop-csrf" = $csrf } `
    -WebSession $session -UseBasicParsing
  $bootstrapStatus = $bootstrap.StatusCode
} catch [System.Net.WebException] {
  if ($_.Exception.Response) {
    $bootstrapStatus = [int]$_.Exception.Response.StatusCode
  } else { throw }
}
Check "POST /api/bundle-keys bootstraps or 409s" ($bootstrapStatus -eq 201 -or $bootstrapStatus -eq 409) `
  "status=$bootstrapStatus"

# --- List current keys ---------------------------------------------------

$keysResp = Invoke-WebRequest -Uri "$BaseUrl/api/bundle-keys" `
  -WebSession $session -UseBasicParsing
$keysJson = $keysResp.Content | ConvertFrom-Json
$activeKey = $keysJson.keys | Where-Object { $_.active } | Select-Object -First 1
Check "GET /api/bundle-keys lists an active key" ($null -ne $activeKey) `
  "id=$($activeKey.id)"

# --- Find a pull-mode target ---------------------------------------------

$syncResp = Invoke-WebRequest -Uri "$BaseUrl/api/sync" -WebSession $session -UseBasicParsing
$syncJson = $syncResp.Content | ConvertFrom-Json
$pullTarget = $syncJson.targets | Where-Object { $_.pullMode -eq $true } | Select-Object -First 1
Check "seed has at least one pull-mode target" ($null -ne $pullTarget) `
  "picked $($pullTarget.name) ($($pullTarget.id))"

# --- Fetch and verify the bundle -----------------------------------------

$bundle = Invoke-RawBundle -Url "$BaseUrl/api/sync/$($pullTarget.id)/bundle" -CookieContainer $session.Cookies
Check "bundle status 200" ($bundle.Status -eq 200) "status=$($bundle.Status)"
Check "bundle carries X-Signature-Bundle" (-not [string]::IsNullOrEmpty($bundle.Signature)) ""
Check "bundle carries X-Signature-Key-Id"  (-not [string]::IsNullOrEmpty($bundle.KeyId)) `
  "keyId=$($bundle.KeyId)"
Check "signing key id is the active key"   ($bundle.KeyId -eq $activeKey.id) ""

$matchedKey = $keysJson.keys | Where-Object { $_.id -eq $bundle.KeyId } | Select-Object -First 1
Check "signing key id resolves in GET /api/bundle-keys" ($null -ne $matchedKey) ""

$ok = Test-Ed25519Signature -BodyBytes $bundle.Bytes -SignatureB64 $bundle.Signature -PublicKeyB64 $matchedKey.publicKey
Check "signature verifies over body bytes" $ok ""

# --- Tamper detection ----------------------------------------------------

$tampered = [byte[]]::new($bundle.Bytes.Length)
[Array]::Copy($bundle.Bytes, $tampered, $bundle.Bytes.Length)
# Flip the last byte -- anywhere works, this is the least likely to land
# on structural JSON that breaks the parser before we even sign-check.
$tampered[$tampered.Length - 1] = $tampered[$tampered.Length - 1] -bxor 0x01
$ok = Test-Ed25519Signature -BodyBytes $tampered -SignatureB64 $bundle.Signature -PublicKeyB64 $matchedKey.publicKey
Check "signature FAILS on tampered body" (-not $ok) ""

# --- Rotation ------------------------------------------------------------

$rotateResp = Invoke-WebRequest -Uri "$BaseUrl/api/bundle-keys/rotate" `
  -Method POST -ContentType "application/json" -Body "{}" `
  -Headers @{ "x-sop-csrf" = $csrf } `
  -WebSession $session -UseBasicParsing
$rotateJson = $rotateResp.Content | ConvertFrom-Json
Check "rotate returns 200"            ($rotateResp.StatusCode -eq 200) ""
Check "rotate returns a new key id"   (-not [string]::IsNullOrEmpty($rotateJson.key.id) -and $rotateJson.key.id -ne $activeKey.id) ""
Check "rotate reports previousId"     ($rotateJson.previousId -eq $activeKey.id) `
  "previousId=$($rotateJson.previousId)"

# --- Grace window: old key still listed, new key active ------------------

$keysAfter = (Invoke-WebRequest -Uri "$BaseUrl/api/bundle-keys" -WebSession $session -UseBasicParsing).Content | ConvertFrom-Json
$old = $keysAfter.keys | Where-Object { $_.id -eq $activeKey.id } | Select-Object -First 1
$new = $keysAfter.keys | Where-Object { $_.active } | Select-Object -First 1
Check "previous key still visible"            ($null -ne $old) ""
Check "previous key marked active=false"      ($null -ne $old -and -not $old.active) ""
Check "previous key marked revokedAt"         ($null -ne $old -and -not [string]::IsNullOrEmpty($old.revokedAt)) ""
Check "exactly one active key after rotation" (@($keysAfter.keys | Where-Object { $_.active }).Count -eq 1) ""
Check "new active key id matches rotate output" ($new.id -eq $rotateJson.key.id) ""

# --- Fresh bundle fetch now uses the new key ------------------------------

$bundle2 = Invoke-RawBundle -Url "$BaseUrl/api/sync/$($pullTarget.id)/bundle" -CookieContainer $session.Cookies
Check "post-rotation bundle status 200" ($bundle2.Status -eq 200) ""
Check "post-rotation bundle uses new key" ($bundle2.KeyId -eq $new.id) `
  "signedWith=$($bundle2.KeyId)"
$ok = Test-Ed25519Signature -BodyBytes $bundle2.Bytes -SignatureB64 $bundle2.Signature -PublicKeyB64 $new.publicKey
Check "post-rotation signature verifies" $ok ""

# --- Cleanup -------------------------------------------------------------

Remove-Item $verifierPath -ErrorAction SilentlyContinue

# --- Report --------------------------------------------------------------

Write-Host ""
Write-Host "=== Results ===" -ForegroundColor Cyan
foreach ($c in $checks) {
  if ($c.Ok) { $tag = "PASS"; $color = "Green" } else { $tag = "FAIL"; $color = "Red" }
  if ($c.Detail) { $detail = " -- $($c.Detail)" } else { $detail = "" }
  Write-Host ("  [{0}] {1}{2}" -f $tag, $c.Check, $detail) -ForegroundColor $color
}
Write-Host ""
if ($pass) {
  Write-Host "smoke-bundle-signing: PASS" -ForegroundColor Green
  exit 0
} else {
  Write-Host "smoke-bundle-signing: FAIL" -ForegroundColor Red
  exit 1
}
