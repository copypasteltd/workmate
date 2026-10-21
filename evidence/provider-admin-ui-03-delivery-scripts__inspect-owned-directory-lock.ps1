param([Parameter(Mandatory=$true)][string]$Directory)
$ErrorActionPreference = 'Stop'
$cpRoot = [System.IO.Path]::GetFullPath('D:\dev\copypasted\自有agent\dev\copypaste-platform\.data\test-runs\')
$cpTarget = [System.IO.Path]::GetFullPath($Directory)
if (-not $cpTarget.StartsWith($cpRoot, [System.StringComparison]::OrdinalIgnoreCase)) { throw 'Diagnostic target must be an owned test fixture' }
if (-not (Test-Path -LiteralPath $cpTarget -PathType Container)) { throw 'Diagnostic directory does not exist' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class CopyPasteRestartManager {
  [StructLayout(LayoutKind.Sequential)] public struct UniqueProcess { public uint pid; public System.Runtime.InteropServices.ComTypes.FILETIME started; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessInfo {
    public UniqueProcess process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string app;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string service;
    public uint type; public uint status; public uint session;
    [MarshalAs(UnmanagedType.Bool)] public bool restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmStartSession(out uint session, int flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmRegisterResources(uint session, uint fileCount, string[] files, uint applicationCount, UniqueProcess[] applications, uint serviceCount, string[] services);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] public static extern int RmGetList(uint session, out uint needed, ref uint count, [In, Out] ProcessInfo[] processes, out uint reason);
  [DllImport("rstrtmgr.dll")] public static extern int RmEndSession(uint session);
}
'@
[uint32]$cpSession=0
$cpKey=[System.Text.StringBuilder]::new(33)
$cpStart=[CopyPasteRestartManager]::RmStartSession([ref]$cpSession,0,$cpKey)
if ($cpStart -ne 0) { throw "Restart Manager start failed: $cpStart" }
try {
  $cpRegistration=[CopyPasteRestartManager]::RmRegisterResources($cpSession,1,[string[]]@($cpTarget),0,$null,0,$null)
  [uint32]$cpNeeded=0
  [uint32]$cpCount=0
  [uint32]$cpReason=0
  $cpResult=[CopyPasteRestartManager]::RmGetList($cpSession,[ref]$cpNeeded,[ref]$cpCount,$null,[ref]$cpReason)
  $cpProcesses=@()
  if ($cpResult -eq 234) {
    $cpCount=$cpNeeded
    $cpItems=New-Object 'CopyPasteRestartManager+ProcessInfo[]' $cpCount
    $cpResult=[CopyPasteRestartManager]::RmGetList($cpSession,[ref]$cpNeeded,[ref]$cpCount,$cpItems,[ref]$cpReason)
    if ($cpResult -eq 0) { $cpProcesses=@($cpItems | ForEach-Object { @{pid=$_.process.pid;app=$_.app;service=$_.service} }) }
  }
  @{target=$cpTarget;registration_code=$cpRegistration;list_code=$cpResult;processes=$cpProcesses;read_only=$true} | ConvertTo-Json -Depth 4
} finally { [void][CopyPasteRestartManager]::RmEndSession($cpSession) }
