# 编译本机通知程序并注册独立身份，不修改系统通知开关。
$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
$Framework = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319'
$Compiler = Join-Path $Framework 'csc.exe'
if (-not (Test-Path $Compiler)) { throw '需要 Windows x64 .NET Framework 编译器' }
$Bin = Join-Path $Root 'bin'
[void](New-Item -ItemType Directory -Path $Bin -Force)
$Target = Join-Path $Bin 'CompletionToast.exe'
$Refs = @('System.Runtime','System.Runtime.WindowsRuntime','System.Runtime.InteropServices.WindowsRuntime','System.ObjectModel','System.Web.Extensions') | ForEach-Object { '/reference:' + (Join-Path $Framework ($_ + '.dll')) }
$Refs += @('Windows.UI','Windows.Foundation','Windows.Data') | ForEach-Object { '/reference:' + (Join-Path $env:WINDIR ('System32/WinMetadata/' + $_ + '.winmd')) }
& $Compiler /nologo /target:exe /platform:x64 ('/out:' + $Target) $Refs (Join-Path $Root 'CompletionToast.cs')
if ($LASTEXITCODE -ne 0) { throw '通知辅助程序编译失败' }
$Programs = [Environment]::GetFolderPath('Programs')
$Shortcut = Join-Path $Programs 'Pi Completion Notify.lnk'
if(Test-Path -LiteralPath $Shortcut) {
  $Backup = Join-Path $Root '../data/backups'
  [void](New-Item -ItemType Directory -Path $Backup -Force)
  Copy-Item -LiteralPath $Shortcut -Destination (Join-Path $Backup ('Pi Completion Notify-' + (Get-Date -Format 'yyyyMMdd-HHmmssfff') + '.lnk'))
}
Add-Type -TypeDefinition ([IO.File]::ReadAllText((Join-Path $Root 'Shortcut.cs')))
[PiCompletionNotification.Shortcut]::Create($Target, $Shortcut, 'Pi.CompletionNotify')
$Shell = New-Object -ComObject Shell.Application
try {
  $Item = $Shell.NameSpace($Programs).ParseName('Pi Completion Notify.lnk')
  if($Item.ExtendedProperty('System.AppUserModel.ID') -ne 'Pi.CompletionNotify') { throw '快捷方式身份验证失败' }
} finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Shell) }
Write-Output '已编译并注册 Pi 完成通知。请加载 WezTerm 集成并在 Pi /reload 后执行 /completion-notify test。'
