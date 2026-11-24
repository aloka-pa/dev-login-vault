# Runs ELEVATED (Windows asks "Allow changes?") to replace the hosts file with a file the helper prepared.
# Exit codes: 0 written; 2 the prepared file was altered after it was prepared; 3 the hosts file changed in the
# meantime; 1 anything else. A backup of the previous hosts file is kept next to it as hosts.dev-login-vault.bak.
param(
  [Parameter(Mandatory = $true)][string]$Source,
  [Parameter(Mandatory = $true)][string]$Sha256,
  [Parameter(Mandatory = $true)][string]$BeforeSha256,
  [string]$Target = (Join-Path $env:SystemRoot 'System32\drivers\etc\hosts'),
  [switch]$SkipFlush
)
$ErrorActionPreference = 'Stop'
try {
  $hash = { param($path) (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToUpperInvariant() }
  if ((& $hash $Source) -ne $Sha256.ToUpperInvariant()) { exit 2 }
  if ((& $hash $Target) -ne $BeforeSha256.ToUpperInvariant()) { exit 3 }

  Copy-Item -LiteralPath $Target -Destination "$Target.dev-login-vault.bak" -Force
  # Writing the bytes into the existing file keeps its permissions.
  [System.IO.File]::WriteAllBytes($Target, [System.IO.File]::ReadAllBytes($Source))
  if (-not $SkipFlush) { ipconfig /flushdns | Out-Null }
  exit 0
} catch {
  exit 1
}
