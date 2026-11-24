# Removes the Dev Login Vault hosts helper registration (current Windows user). Your hosts file is not changed.
$ErrorActionPreference = 'Stop'
$name = 'dev_login_vault.hosts'
foreach ($browserKey in 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts', 'HKCU:\Software\Google\Chrome\NativeMessagingHosts') {
  $key = Join-Path $browserKey $name
  if (Test-Path $key) { Remove-Item -Path $key -Force }
}
foreach ($file in 'run-host.bat', "$name.json") {
  $path = Join-Path $PSScriptRoot $file
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force }
}
Write-Output 'Hosts helper removed from Edge and Chrome.'
