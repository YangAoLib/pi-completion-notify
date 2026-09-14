# 不修改 WezTerm 本体或系统通知权限；支持预览，不删除备份。
[CmdletBinding(SupportsShouldProcess = $true)]
param()
$ErrorActionPreference = 'Stop'
$Programs = [Environment]::GetFolderPath('Programs')
$Shortcut = Join-Path $Programs 'Pi Completion Notify.lnk'
if(Test-Path -LiteralPath $Shortcut) {
  $Shell = New-Object -ComObject Shell.Application
  try {
    $Item = $Shell.NameSpace($Programs).ParseName('Pi Completion Notify.lnk')
    $Expected = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'bin/CompletionToast.exe'))
    $Actual = $Item.ExtendedProperty('System.Link.TargetParsingPath')
    if($Item.ExtendedProperty('System.AppUserModel.ID') -ne 'Pi.CompletionNotify' -or
       -not $Actual -or [IO.Path]::GetFullPath($Actual) -ne $Expected) {
      throw '快捷方式身份或目标不属于当前安装，拒绝删除'
    }
  } finally { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($Shell) }
  if($PSCmdlet.ShouldProcess($Shortcut, '删除完成通知快捷方式')) { Remove-Item -LiteralPath $Shortcut }
}
$Binary = Join-Path $PSScriptRoot 'bin/CompletionToast.exe'
if((Test-Path -LiteralPath $Binary) -and $PSCmdlet.ShouldProcess($Binary, '删除通知辅助程序')) { Remove-Item -LiteralPath $Binary }
Write-Output '卸载后请移除 WezTerm 配置中的本扩展加载段，并退出 Pi 后移走扩展目录。'
