import { spawn } from "node:child_process";
import path from "node:path";
export type RegistrationState = "registered" | "removed" | "absent" | "foreign";
const productionKey =
  "Software\\Google\\Chrome\\NativeMessagingHosts\\hk.copypaste.agent";
// Registration and removal share one per-user/per-key mutex across installations.
// The manifest ownership comparison happens inside that same critical section.
const script = String.raw`$ErrorActionPreference='Stop';[Console]::InputEncoding=[Text.UTF8Encoding]::new($false);[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
$b=[Console]::In.ReadToEnd()|ConvertFrom-Json
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$hash=[Security.Cryptography.SHA256]::Create();$tag=[BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($sid+$b.key))).Replace('-','');$hash.Dispose()
$mutex=[Threading.Mutex]::new($false,('Local\CopyPasteChromeHost_'+$tag));$held=$false;$key=$null
try {
 try {$held=$mutex.WaitOne(15000)} catch [Threading.AbandonedMutexException] {$held=$true}
 if(!$held){throw 'Registry lock unavailable'}
 if($b.operation -eq 'register') {$key=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($b.key);$key.SetValue('',$b.manifest,[Microsoft.Win32.RegistryValueKind]::String);$status='registered'}
 else {
  $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($b.key,$true)
  if($null -eq $key -or $null -eq $key.GetValue('',$null)) {$status='absent'}
  elseif($key.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or ![String]::Equals([IO.Path]::GetFullPath([string]$key.GetValue('')),[IO.Path]::GetFullPath([string]$b.manifest),[StringComparison]::OrdinalIgnoreCase)) {$status='foreign'}
  elseif($b.operation -eq 'remove') {
   $owned=$true
   if($b.launcher) {
    try {$m=[IO.File]::ReadAllText($b.manifest)|ConvertFrom-Json;$owned=($m.name -eq 'hk.copypaste.agent' -and $m.type -eq 'stdio' -and [String]::Equals([IO.Path]::GetFullPath([string]$m.path),[IO.Path]::GetFullPath([string]$b.launcher),[StringComparison]::OrdinalIgnoreCase))}catch{$owned=$false}
   }
   if($owned){$key.DeleteValue('',$false);$status='removed'}else{$status='foreign'}
  }
  else {$status='registered'}
 }
 [Console]::Out.Write((@{status=$status}|ConvertTo-Json -Compress))
} finally {if($null -ne $key){$key.Dispose()};if($held){$mutex.ReleaseMutex()};$mutex.Dispose()}`;

export async function chromeRegistration(
  operation: "register" | "remove" | "inspect",
  manifest: string,
  testKey?: string,
  expectedLauncher?: string,
): Promise<RegistrationState> {
  if (!path.isAbsolute(manifest)) throw new Error("CHROME_MANIFEST_INVALID");
  if (expectedLauncher && !path.isAbsolute(expectedLauncher))
    throw new Error("CHROME_MANIFEST_INVALID");
  if (testKey && !/^Software\\CopyPaste\\Tests\\[a-f0-9-]{36}$/.test(testKey))
    throw new Error("CHROME_TEST_KEY_INVALID");
  const result = await new Promise<string>((resolve, reject) => {
    const child = spawn(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let output = "",
      settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else resolve(output);
    };
    const timer = setTimeout(
      () => finish(new Error("CHROME_REGISTRATION_UNAVAILABLE")),
      22000,
    );
    child.stdout.on("data", (bytes) => {
      output += bytes.toString("utf8");
      if (output.length > 4096)
        finish(new Error("CHROME_REGISTRATION_UNAVAILABLE"));
    });
    child.stderr.on("data", () => {});
    child.once("error", () =>
      finish(new Error("CHROME_REGISTRATION_UNAVAILABLE")),
    );
    child.once("close", (code) =>
      finish(
        code === 0 ? undefined : new Error("CHROME_REGISTRATION_UNAVAILABLE"),
      ),
    );
    child.stdin.on("error", () =>
      finish(new Error("CHROME_REGISTRATION_UNAVAILABLE")),
    );
    child.stdin.end(
      JSON.stringify({
        operation,
        manifest: path.resolve(manifest),
        key: testKey ?? productionKey,
        launcher: expectedLauncher,
      }),
    );
  });
  const value = JSON.parse(result);
  if (
    !value ||
    !["registered", "removed", "absent", "foreign"].includes(value.status)
  )
    throw new Error("CHROME_REGISTRATION_UNAVAILABLE");
  return value.status;
}
