# Install Skillerr, the agentic browser, and connect it to your AI apps (Windows).
#   irm https://skillerr.com/install.ps1 | iex
#   & ([scriptblock]::Create((irm https://skillerr.com/install.ps1))) --prefer     # also make Skillerr your AI's browser
$ErrorActionPreference = 'Stop'
$version = if ($env:SKILLERR_VERSION) { $env:SKILLERR_VERSION } else { '0.1.3' }
$base = if ($env:SKILLERR_RELEASE) { $env:SKILLERR_RELEASE } else { "https://github.com/dot-skill/skillerr-releases/releases/download/v$version" }
$arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
$file = "Skillerr-Setup-$version-$arch.exe"
$tmp = Join-Path $env:TEMP $file
Write-Host "Downloading $file..."
Invoke-WebRequest -Uri "$base/$file" -OutFile $tmp -UseBasicParsing
Get-Process Skillerr -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Process -FilePath $tmp -ArgumentList '/S' -Wait
$exe = Join-Path $env:LOCALAPPDATA 'Programs\Skillerr\Skillerr.exe'
if (-not (Test-Path $exe)) { throw "Skillerr didn't install where expected ($exe)." }
Write-Host "Installed to $exe"
# Terminals inside VS Code or Cursor export ELECTRON_RUN_AS_NODE; the app must not inherit it or it starts as plain Node and exits.
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
Start-Process -FilePath $exe
if ($args -notcontains '--no-connect') {
  Write-Host 'Connecting your AI apps...'
  $env:ELECTRON_RUN_AS_NODE = '1'
  & $exe (Join-Path (Split-Path $exe) 'resources\app.asar\mcp\setup.js') @($args | Where-Object { $_ -ne '--no-connect' })
  Remove-Item Env:ELECTRON_RUN_AS_NODE
}
Write-Host 'Skillerr is ready. Ask your AI to look something up; it will open in Skillerr.'
