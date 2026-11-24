# Registers the Dev Login Vault hosts helper for Edge and Chrome, for the current Windows user (no admin needed).
# Usage (copy each ID from the extension's card in edge://extensions and chrome://extensions):
#   powershell -ExecutionPolicy Bypass -File native\install-hosts-helper.ps1 -ExtensionId <edge-id>,<chrome-id>
# What it changes: writes native\run-host.bat and native\dev_login_vault.hosts.json, and adds one registry key per
# browser under HKCU\Software\...\NativeMessagingHosts\dev_login_vault.hosts. Undo with uninstall-hosts-helper.ps1.
param([Parameter(Mandatory = $true)][string[]]$ExtensionId)
$ErrorActionPreference = 'Stop'

$name = 'dev_login_vault.hosts'
$ids = $ExtensionId | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim().ToLowerInvariant() } | Where-Object { $_ } | Select-Object -Unique
foreach ($id in $ids) {
  if ($id -notmatch '^[a-p]{32}$') { throw "'$id' is not an extension ID (32 letters a-p, shown on the extension's card)." }
}

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'Node.js was not found on PATH. Install Node.js 18 or later, then run this again.' }

$dir = $PSScriptRoot
$bat = Join-Path $dir 'run-host.bat'
$manifestPath = Join-Path $dir "$name.json"

Set-Content -LiteralPath $bat -Encoding ascii -Value "@echo off`r`n`"$node`" `"%~dp0host.mjs`" %*"
$manifest = [ordered]@{
  name            = $name
  description     = 'Dev Login Vault hosts-file helper'
  path            = $bat
  type            = 'stdio'
  allowed_origins = @($ids | ForEach-Object { "chrome-extension://$_/" })
}
[System.IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json), (New-Object System.Text.UTF8Encoding $false))

foreach ($browserKey in 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts', 'HKCU:\Software\Google\Chrome\NativeMessagingHosts') {
  $key = Join-Path $browserKey $name
  New-Item -Path $key -Force | Out-Null
  Set-Item -Path $key -Value $manifestPath
}

Write-Output "Hosts helper registered for Edge and Chrome (extension IDs: $($ids -join ', '))."
Write-Output 'Reload the extension, then open the padlock on a site that is in your hosts file.'
