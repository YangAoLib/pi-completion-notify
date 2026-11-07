# Windows Terminal capture/focus helper. Uses only built-in UI Automation; no external commands.
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('capture', 'focus', 'selftest')]
  [string]$Mode = 'capture'
)

$ErrorActionPreference = 'Stop'
$WT_CLASS = 'CASCADIA_HOSTING_WINDOW_CLASS'
$MAX_JSON = 8192

try { [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}
try { [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false) } catch {}

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WtNative {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, StringBuilder lpClassName, int nMaxCount);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
}
"@

function Write-Result($Value) {
  [Console]::Out.WriteLine(($Value | ConvertTo-Json -Compress -Depth 4))
}

function Get-WindowClass([IntPtr]$Handle) {
  if ($Handle -eq [IntPtr]::Zero) { return '' }
  $buffer = New-Object System.Text.StringBuilder 256
  if ([WtNative]::GetClassName($Handle, $buffer, $buffer.Capacity) -le 0) { return '' }
  return $buffer.ToString()
}

function Test-WtHandle([IntPtr]$Handle) {
  return ((Get-WindowClass $Handle) -eq $WT_CLASS)
}

function Get-WtWindows {
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, $WT_CLASS)
  return @($root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition))
}

function Get-AncestorWindow($Element) {
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $current = $Element
  while ($null -ne $current) {
    if ($current.Current.ClassName -eq $WT_CLASS) { return $current }
    $current = $walker.GetParent($current)
  }
  return $null
}

function Get-TabView($Window) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'TabView')
  $view = $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($null -ne $view) { return $view }
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Tab)
  return $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Get-TabItems($Window) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::TabItem)
  return @($Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
}

function Get-SelectedTab($Window) {
  foreach ($tab in (Get-TabItems $Window)) {
    try {
      $pattern = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      if ($pattern.Current.IsSelected) { return $tab }
    } catch {}
  }
  $view = Get-TabView $Window
  if ($null -ne $view) {
    try {
      $pattern = $view.GetCurrentPattern([System.Windows.Automation.SelectionPattern]::Pattern)
      $selected = $pattern.Current.GetSelection()
      if ($selected.Count -gt 0) { return $selected[0] }
    } catch {}
  }
  return $null
}

function Get-TabIndex($Tab) {
  $position = $Tab.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::PositionInSetProperty)
  if ($position -is [int] -and $position -gt 0) { return $position - 1 }
  return -1
}

function Find-ListView($Window) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, 'TabListView')
  $list = $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
  if ($null -ne $list) { return $list }
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'ListView')
  return $Window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Find-TabByName($Window, [string]$Name) {
  if ([string]::IsNullOrWhiteSpace($Name)) { return $null }
  $list = Find-ListView $Window
  if ($null -ne $list) {
    try {
      $pattern = $list.GetCurrentPattern([System.Windows.Automation.ItemContainerPattern]::Pattern)
      $item = $pattern.FindItemByProperty($null, [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
      if ($null -ne $item) { return $item }
    } catch {}
  }
  foreach ($tab in (Get-TabItems $Window)) {
    if ($tab.Current.Name -eq $Name) { return $tab }
  }
  return $null
}

function Find-TabByIndex($Window, [int]$Index) {
  if ($Index -lt 0) { return $null }
  foreach ($tab in (Get-TabItems $Window)) {
    if ((Get-TabIndex $tab) -eq $Index) { return $tab }
  }
  return $null
}

function Get-TermControls($Window) {
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, 'TermControl')
  return @($Window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
}

function Get-NormalizedRect($Element) {
  $window = Get-AncestorWindow $Element
  if ($null -eq $window) { return $null }
  $rect = $Element.Current.BoundingRectangle
  $frame = $window.Current.BoundingRectangle
  if ($frame.Width -le 0 -or $frame.Height -le 0) { return $null }
  return @(
    [math]::Round(($rect.Left - $frame.Left) / $frame.Width, 4),
    [math]::Round(($rect.Top - $frame.Top) / $frame.Height, 4),
    [math]::Round($rect.Width / $frame.Width, 4),
    [math]::Round($rect.Height / $frame.Height, 4)
  )
}

function Find-TermControl($Window, $Target) {
  $terms = @(Get-TermControls $Window)
  if ($terms.Count -eq 0) { return $null }
  if ($null -ne $Target.termRuntimeId) {
    $expected = ($Target.termRuntimeId | ForEach-Object { [int]$_ }) -join ','
    foreach ($term in $terms) {
      $actual = ($term.GetRuntimeId() | ForEach-Object { [int]$_ }) -join ','
      if ($actual -eq $expected) { return $term }
    }
  }
  if ($null -ne $Target.termRect) {
    $best = $null
    $bestDelta = 1.0
    foreach ($term in $terms) {
      $rect = Get-NormalizedRect $term
      if ($null -eq $rect) { continue }
      $delta = 0.0
      for ($i = 0; $i -lt 4; $i++) {
        $value = [math]::Abs([double]$rect[$i] - [double]$Target.termRect[$i])
        if ($value -gt $delta) { $delta = $value }
      }
      if ($delta -lt $bestDelta) { $best = $term; $bestDelta = $delta }
    }
    if ($null -ne $best -and $bestDelta -le 0.08) { return $best }
  }
  return $null
}

function Test-TabMatch($Window, [string]$Name, [int]$Index, $Target) {
  if ($null -ne $Target.termRuntimeId -or $null -ne $Target.termRect) {
    return ($null -ne (Find-TermControl $Window $Target))
  }
  $selected = Get-SelectedTab $Window
  if ($null -eq $selected) { return $false }
  if (-not [string]::IsNullOrWhiteSpace($Name)) { return ($selected.Current.Name -eq $Name) }
  return ((Get-TabIndex $selected) -eq $Index)
}

function Select-Tab($Window, [int]$Index, [string]$Name, $Target) {
  $fallback = $false
  $byIndex = Find-TabByIndex $Window $Index
  if ($null -ne $byIndex) {
    try {
      $pattern = $byIndex.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $pattern.Select()
      $fallback = $true
      Start-Sleep -Milliseconds 200
      if (Test-TabMatch $Window $Name $Index $Target) { return $true }
    } catch {}
  }
  $byName = Find-TabByName $Window $Name
  if ($null -ne $byName) {
    try {
      $pattern = $byName.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
      $pattern.Select()
      $fallback = $true
      Start-Sleep -Milliseconds 200
      if (Test-TabMatch $Window $Name $Index $Target) { return $true }
    } catch {}
  }
  return $fallback
}

function Focus-Window([IntPtr]$Handle) {
  [void][WtNative]::ShowWindow($Handle, 3)
  if ([WtNative]::SetForegroundWindow($Handle)) { return }
  $foreground = [WtNative]::GetForegroundWindow()
  if ($foreground -eq [IntPtr]::Zero) { return }
  [uint32]$foregroundProcess = 0
  [uint32]$targetProcess = 0
  $foregroundThread = [WtNative]::GetWindowThreadProcessId($foreground, [ref]$foregroundProcess)
  [void][WtNative]::GetWindowThreadProcessId($Handle, [ref]$targetProcess)
  $currentThread = [WtNative]::GetCurrentThreadId()
  if ($foregroundThread -eq 0 -or $currentThread -eq 0) { return }
  [void][WtNative]::AttachThreadInput($currentThread, $foregroundThread, $true)
  [void][WtNative]::SetForegroundWindow($Handle)
  [void][WtNative]::AttachThreadInput($currentThread, $foregroundThread, $false)
}

function Capture {
  $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  $term = $null
  $window = $null
  if ($null -ne $focused) {
    if ($focused.Current.ClassName -eq 'TermControl') { $term = $focused }
    $window = Get-AncestorWindow $focused
  }
  if ($null -eq $window) {
    $handle = [WtNative]::GetForegroundWindow()
    if (-not (Test-WtHandle $handle)) {
      Write-Result @{ ok = $false; reason = 'no-focused-window' }
      return
    }
    $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  }
  if ($null -eq $window) {
    Write-Result @{ ok = $false; reason = 'no-focused-window' }
    return
  }
  $tab = Get-SelectedTab $window
  if ($null -eq $tab) {
    Start-Sleep -Milliseconds 100
    $tab = Get-SelectedTab $window
  }
  if ($null -eq $tab) {
    Write-Result @{ ok = $false; reason = 'no-selected-tab' }
    return
  }
  [int64]$handleValue = $window.Current.NativeWindowHandle
  if ($handleValue -le 0) {
    Write-Result @{ ok = $false; reason = 'no-window-handle' }
    return
  }
  $result = [ordered]@{
    ok = $true
    version = 1
    hwnd = $handleValue
    tabIndex = (Get-TabIndex $tab)
    tabName = [string]$tab.Current.Name
    capturedAt = [int64]([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds())
  }
  if ($null -eq $term) {
    foreach ($candidate in (Get-TermControls $window)) {
      if ($candidate.Current.HasKeyboardFocus) { $term = $candidate; break }
    }
  }
  if ($null -ne $term) {
    $runtime = @($term.GetRuntimeId() | ForEach-Object { [int]$_ })
    if ($runtime.Count -gt 0) { $result.termRuntimeId = $runtime }
    $rect = Get-NormalizedRect $term
    if ($null -ne $rect) { $result.termRect = $rect }
  }
  Write-Result $result
}

function Focus {
  $raw = [Console]::In.ReadToEnd()
  if ([string]::IsNullOrWhiteSpace($raw) -or $raw.Length -gt $MAX_JSON) {
    Write-Result @{ ok = $false; tabSelected = $false; paneFocused = $false; reason = 'invalid-input' }
    return
  }
  try { $target = $raw | ConvertFrom-Json } catch {
    Write-Result @{ ok = $false; tabSelected = $false; paneFocused = $false; reason = 'invalid-input' }
    return
  }
  [int64]$handleValue = 0
  if (-not [int64]::TryParse([string]$target.hwnd, [ref]$handleValue)) { $handleValue = 0 }
  [int]$tabIndex = -1
  if (-not [int]::TryParse([string]$target.tabIndex, [ref]$tabIndex)) { $tabIndex = -1 }
  $tabName = [string]$target.tabName
  if ($tabName.Length -gt 512) {
    Write-Result @{ ok = $false; tabSelected = $false; paneFocused = $false; reason = 'invalid-input' }
    return
  }
  if ($null -ne $target.termRect -and @($target.termRect).Count -ne 4) { $target.termRect = $null }
  if ($null -ne $target.termRuntimeId -and @($target.termRuntimeId).Count -eq 0) { $target.termRuntimeId = $null }

  $window = $null
  $handle = [IntPtr]$handleValue
  if (Test-WtHandle $handle) { $window = [System.Windows.Automation.AutomationElement]::FromHandle($handle) }
  if ($null -eq $window) {
    foreach ($candidate in (Get-WtWindows)) {
      if ($null -ne (Find-TabByName $candidate $tabName) -or $null -ne (Find-TabByIndex $candidate $tabIndex)) {
        $window = $candidate
        break
      }
    }
  }
  if ($null -eq $window) {
    Write-Result @{ ok = $false; tabSelected = $false; paneFocused = $false; reason = 'window-not-found' }
    return
  }
  [int64]$windowValue = $window.Current.NativeWindowHandle
  $windowHandle = [IntPtr]$windowValue
  if ($windowValue -le 0) {
    Write-Result @{ ok = $false; tabSelected = $false; paneFocused = $false; reason = 'window-not-found' }
    return
  }
  Focus-Window $windowHandle
  Start-Sleep -Milliseconds 150
  $selected = Select-Tab $window $tabIndex $tabName $target
  $paneFocused = $false
  if ($selected) {
    $term = $null
    if ($null -ne $target.termRuntimeId -or $null -ne $target.termRect) {
      try { $term = Find-TermControl $window $target } catch { $term = $null }
    }
    if ($null -eq $term) {
      try { $terms = @(Get-TermControls $window) } catch { $terms = @() }
      if ($terms.Count -eq 1) { $term = $terms[0] }
    }
    if ($null -ne $term) {
      try {
        $term.SetFocus()
        Start-Sleep -Milliseconds 100
        $paneFocused = $term.Current.HasKeyboardFocus
      } catch {}
    }
  }
  Focus-Window $windowHandle
  Write-Result @{
    ok = $selected
    tabSelected = $selected
    paneFocused = $paneFocused
    reason = $(if ($selected) { '' } else { 'tab-not-found' })
  }
}

function SelfTest {
  $windows = @(Get-WtWindows)
  $tabs = 0
  foreach ($window in $windows) { $tabs += @(Get-TabItems $window).Count }
  Write-Result @{ ok = $true; windows = $windows.Count; tabs = $tabs }
}

try {
  switch ($Mode) {
    'capture' { Capture }
    'focus' { Focus }
    'selftest' { SelfTest }
  }
} catch {
  Write-Result @{ ok = $false; reason = $_.Exception.Message }
  exit 1
}
