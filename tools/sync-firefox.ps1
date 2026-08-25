# Copies the shared extension files from chrome/ into firefox/.
#
# The two builds run byte-identical JS, HTML, icons and vendored libraries. Only
# manifest.json differs, so that one file is never touched here:
#
#   chrome/manifest.json   -> "background": { "service_worker": ... }
#   firefox/manifest.json  -> "background": { "scripts": [...] }
#                             + browser_specific_settings (gecko id, min version)
#
# `chrome.*` needs no shim: Firefox implements that namespace for MV3 and
# returns promises when no callback is passed, which is the style this codebase
# uses. Run this after any change under chrome/, then re-run the checks:
#
#   powershell -ExecutionPolicy Bypass -File .\tools\sync-firefox.ps1
#   node tools\check-wiring.js

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$src  = Join-Path $root 'chrome'
$dst  = Join-Path $root 'firefox'

$shared = @(
  'background.js',
  'content.js',
  'themes.js',
  'helpers.js',
  'popup.html',
  'popup.js',
  'settings.html',
  'settings.js',
  'icons\icon16.png',
  'icons\icon48.png',
  'icons\icon128.png',
  'icons\upi-qr.png',
  'lib\beautify.min.js',
  'lib\closebrackets.min.js',
  'lib\codemirror-javascript.min.js',
  'lib\codemirror.min.css',
  'lib\codemirror.min.js',
  'lib\dracula.min.css',
  'lib\matchbrackets.min.js',
  'lib\searchcursor.min.js'
)

New-Item -ItemType Directory -Force -Path (Join-Path $dst 'icons') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $dst 'lib')   | Out-Null

$copied = 0
foreach ($rel in $shared) {
  $from = Join-Path $src $rel
  $to   = Join-Path $dst $rel
  if (-not (Test-Path $from)) {
    Write-Host ("MISSING  {0} (skipped)" -f $rel) -ForegroundColor Yellow
    continue
  }
  Copy-Item -Path $from -Destination $to -Force
  Write-Host ("synced   {0}" -f $rel)
  $copied++
}

Write-Host ""
Write-Host ("{0} file(s) synced into firefox\. manifest.json left alone." -f $copied)
