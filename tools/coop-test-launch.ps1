# Coop two-browser launcher (Windows PowerShell).
# Opens Chrome twice side-by-side: host window (normal profile) on the
# left, joiner (incognito + isolated profile) on the right. Both load
# the production game with ?coop=1 so the lobby auto-shows.
#
# Usage:
#   .\tools\coop-test-launch.ps1                # production
#   .\tools\coop-test-launch.ps1 -Url 'https://2831b7fd.cold-exit.pages.dev/?coop=1'
#   .\tools\coop-test-launch.ps1 -Local         # http://localhost:8080

param(
  [string]$Url = '',
  [switch]$Local
)

if ($Local)        { $Url = 'http://localhost:8080/?coop=1' }
elseif (-not $Url) { $Url = 'https://cold-exit.pages.dev/?coop=1' }

# Locate Chrome
$candidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$chrome = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) {
  Write-Error 'Chrome not found. Install Chrome or set $env:CHROME_BIN.'
  exit 1
}

$tmp = $env:TEMP
$hostProfile = Join-Path $tmp 'cold-exit-coop-host'
$joinProfile = Join-Path $tmp 'cold-exit-coop-joiner'
New-Item -ItemType Directory -Force -Path $hostProfile | Out-Null
New-Item -ItemType Directory -Force -Path $joinProfile | Out-Null

Write-Host "Launching coop test on: $Url" -ForegroundColor Cyan

$common = @(
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=Translate',
  '--new-window'
)

# Host window (left)
$hostArgs = $common + @(
  "--user-data-dir=$hostProfile",
  '--window-position=0,40',
  '--window-size=900,1000',
  $Url
)
Start-Process -FilePath $chrome -ArgumentList $hostArgs

Start-Sleep -Milliseconds 500

# Joiner window (right) — incognito with isolated profile
$joinArgs = $common + @(
  '--incognito',
  "--user-data-dir=$joinProfile",
  '--window-position=920,40',
  '--window-size=900,1000',
  $Url
)
Start-Process -FilePath $chrome -ArgumentList $joinArgs

Write-Host "Both windows launched."
Write-Host "  HOST (left):  click 'Host new room' - share URL is auto-copied to clipboard."
Write-Host "  JOIN (right): paste the room code OR the share URL into the join field."
