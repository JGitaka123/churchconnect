# ChurchConnect - one-click Cloudflare Pages deploy (PowerShell).
# Run via DEPLOY-CF.bat (double-click) or:  powershell -ExecutionPolicy Bypass -File .\DEPLOY-CF.ps1
# Note: ErrorActionPreference stays 'Continue' - native commands (npx/wrangler)
# print normal progress to stderr, and PS 5.1 would abort on that otherwise.
$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

function Check-LastExit($stepName) {
  if ($LASTEXITCODE -ne 0) {
    throw ("{0} failed (exit code {1}). Read the error above, fix it, then run again." -f $stepName, $LASTEXITCODE)
  }
}

# Read one KEY=value line from a dotenv-style file (server\.env). Returns $null
# when the key is missing, so optional delivery secrets stay optional.
function Read-EnvValue($file, $name) {
  if (-not (Test-Path $file)) { return $null }
  foreach ($line in [System.IO.File]::ReadAllLines($file)) {
    if ($line -match "^\s*$name\s*=(.*)$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $null
}

Write-Host ""
Write-Host "============================================================"
Write-Host "  ChurchConnect - Cloudflare Pages one-click deploy"
Write-Host "============================================================"
Write-Host ""

Write-Host "[1/5] Installing dependencies..."
& npm.cmd install
Check-LastExit 'npm install'

Push-Location server
& npm.cmd install
Check-LastExit 'server npm install'
Pop-Location

Write-Host ""
Write-Host "[2/5] Building the app + API into dist/..."
& npm.cmd run build
Check-LastExit 'Build'

Write-Host "  Checking the built Worker bundle..."
$workerPath = Join-Path $PSScriptRoot 'dist\_worker.js'
if (-not (Test-Path $workerPath)) { throw 'dist/_worker.js is missing - the build did not produce it.' }
$workerText = [System.IO.File]::ReadAllText($workerPath)
if ($workerText -notmatch 'setRandomFallback') { throw 'dist/_worker.js is missing the bcrypt random-source fix - delete dist and re-run.' }
if ($workerText -notmatch 'createRequire') { throw 'dist/_worker.js is missing the require shim - delete dist and re-run.' }
if ($workerText -match 'hashSync\(\s*[''\"]timing-equalizer') { throw 'dist/_worker.js still contains a startup-time bcrypt call - delete dist and re-run the build.' }
Write-Host '  OK - the Worker bundle contains the Cloudflare fixes.'

Write-Host ""
Write-Host "[3/5] Logging into Cloudflare (a browser window will open)..."
& npx.cmd --yes wrangler@4 login
Check-LastExit 'Cloudflare login'

Write-Host ""
Write-Host "[4/5] Making sure the Pages project exists (already exists = fine)..."
# cmd /c keeps wrangler's stderr out of PowerShell's error handling; any
# failure here just means the project already exists.
& cmd /c "npx --yes wrangler@4 pages project create churchconnect --production-branch main 2>nul"
Write-Host "  (an 'already exists' message here is fine - continuing)"

Write-Host ""
Write-Host "[5/5] Setting secrets and deploying..."
Write-Host "  Tip: paste the Neon URL exactly as shown in Neon (Connect ->"
Write-Host "       Connection string). It should contain no backslashes."
$db = Read-Host "Neon connection string"
if ([string]::IsNullOrWhiteSpace($db)) { throw 'A connection string is required - re-run and paste it.' }
# Clean up common paste issues: the Neon string never contains backslashes (earlier
# copies sometimes include \_ escapes), and the pooled URL may end with
# &channel_binding=require which the serverless driver does not need.
if ($db -match '\\') {
  Write-Host '  (removed stray backslashes from the connection string)'
  $db = $db -replace '\\', ''
}
$db = $db -replace '&channel_binding=[^&]*', ''
# Drop any quotes or spaces a copy-paste can sneak in, then sanity-check.
$db = $db.Trim().Trim('"')
if ([string]::IsNullOrWhiteSpace($db)) { throw 'The connection string was empty after cleaning - re-run and paste it again.' }
if ($db -notmatch '^postgres(ql)?://') { throw 'That does not look like a Postgres connection string (it must start with postgresql://) - re-run and paste the Neon string exactly as shown.' }

$jwt = Read-Host "JWT secret (press Enter to auto-generate one)"
if ([string]::IsNullOrWhiteSpace($jwt)) {
  $jwt = (& node -e "console.log(require('crypto').randomBytes(48).toString('hex'))").Trim()
}

$secrets = [ordered]@{
  DATABASE_URL  = $db
  DB_DRIVER     = 'neon'
  NODE_ENV      = 'production'
  BCRYPT_ROUNDS = '4'
  CORS_ORIGINS  = 'https://churchconnect.pages.dev'
  JWT_SECRET    = $jwt
}

# Pull the email/SMS delivery secrets from server\.env so MFA and password
# reset codes actually send after deployment (production fails closed without
# them). Values are optional - only configured channels are uploaded.
$serverEnv = Join-Path $PSScriptRoot 'server\.env'
$emailKey = Read-EnvValue $serverEnv 'EMAIL_API_KEY'
$emailFrom = Read-EnvValue $serverEnv 'EMAIL_FROM'
$emailFromName = Read-EnvValue $serverEnv 'EMAIL_FROM_NAME'
$smsUsername = Read-EnvValue $serverEnv 'SMS_USERNAME'
$smsApiKey = Read-EnvValue $serverEnv 'SMS_API_KEY'
$smsFrom = Read-EnvValue $serverEnv 'SMS_FROM'
if ($emailKey) { $secrets['EMAIL_API_KEY'] = $emailKey }
if ($emailFrom) { $secrets['EMAIL_FROM'] = $emailFrom }
if ($emailFromName) { $secrets['EMAIL_FROM_NAME'] = $emailFromName }
if ($smsUsername) { $secrets['SMS_USERNAME'] = $smsUsername }
if ($smsApiKey) { $secrets['SMS_API_KEY'] = $smsApiKey }
if ($smsFrom) { $secrets['SMS_FROM'] = $smsFrom }
if (-not $emailKey -and -not $smsUsername -and -not $smsApiKey) {
  Write-Host ""
  Write-Host "  NOTE: no EMAIL_API_KEY / SMS_API_KEY found in server\.env - MFA and"
  Write-Host "        password-reset codes will NOT be deliverable in production until"
  Write-Host "        you add one (see server\.env.example)."
}

$tmp = Join-Path $env:TEMP ("cf-secrets-" + [guid]::NewGuid().ToString('N') + '.json')
try {
  $secrets | ConvertTo-Json | Set-Content -Path $tmp -Encoding UTF8
  Write-Host ""
  Write-Host "Uploading your secrets to Cloudflare..."
  & npx.cmd --yes wrangler@4 pages secret bulk $tmp --project-name churchconnect
  Check-LastExit 'Uploading secrets'
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Deploying..."
& npx.cmd --yes wrangler@4 pages deploy dist --project-name churchconnect --branch main --commit-dirty=true
Check-LastExit 'Deploy'

Write-Host ""
Write-Host "Verifying the live API (up to ~30 seconds)..."
$liveOk = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    $r = Invoke-WebRequest -Uri 'https://churchconnect.pages.dev/api/health' -UseBasicParsing -TimeoutSec 20
    if ($r.Content -match '"status"\s*:\s*"ok"') { $liveOk = $true; break }
    Write-Host "  attempt ${i}: got a response but not the expected JSON yet - retrying..."
  } catch {
    Write-Host "  attempt ${i}: not ready yet - retrying..."
  }
  Start-Sleep -Seconds 3
}

Write-Host ""
Write-Host "============================================================"
if ($liveOk) {
  Write-Host "  LIVE BACKEND CONFIRMED:"
  Write-Host "    https://churchconnect.pages.dev/api/health -> $($r.Content.Trim())"
} else {
  Write-Host "  DEPLOY FINISHED, BUT THE API IS NOT ANSWERING YET."
  Write-Host "  Open https://churchconnect.pages.dev/api/health in your browser."
  Write-Host "  JSON = success. Dashboard page = the Worker failed to start."
  Write-Host "  If it is the dashboard, re-run this script and paste the output."
}
Write-Host "============================================================"
Write-Host ""
Write-Host "Press Enter to close..."
Read-Host | Out-Null