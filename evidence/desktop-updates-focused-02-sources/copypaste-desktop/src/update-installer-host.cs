using System;
using System.IO;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text.RegularExpressions;

// Runs under the existing Windows user, never requests elevation or executes a shell.
class CopyPasteInstallerHost {
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct FileInfo {
  public uint cbStruct; [MarshalAs(UnmanagedType.LPWStr)] public string pcwszFilePath;
  public IntPtr hFile; public IntPtr pgKnownSubject;
 }
 [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct TrustData {
  public uint cbStruct; public IntPtr pPolicyCallbackData; public IntPtr pSIPClientData;
  public uint dwUIChoice; public uint fdwRevocationChecks; public uint dwUnionChoice; public IntPtr pFile;
  public uint dwStateAction; public IntPtr hWVTStateData; public IntPtr pwszURLReference;
  public uint dwProvFlags; public uint dwUIContext; public IntPtr pSignatureSettings;
 }
 [DllImport("wintrust.dll", ExactSpelling=true, PreserveSig=true)]
 static extern int WinVerifyTrust(IntPtr hwnd, [In] ref Guid action, [In, Out] ref TrustData data);
 static string Hex(byte[] bytes) { return BitConverter.ToString(bytes).Replace("-", "").ToLowerInvariant(); }
 static void Demand(bool ok, string code) { if (!ok) throw new InvalidOperationException(code); }
 static void Verify(FileStream file, string target, string hash, string signer) {
  using (SHA256 sha = SHA256.Create()) { Demand(Hex(sha.ComputeHash(file)) == hash, "UPDATE_ARTIFACT_MISMATCH"); }
  file.Position = 0;
  FileInfo info = new FileInfo { cbStruct=(uint)Marshal.SizeOf(typeof(FileInfo)), pcwszFilePath=target, hFile=file.SafeFileHandle.DangerousGetHandle() };
  IntPtr pointer = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(FileInfo)));
  Marshal.StructureToPtr(info, pointer, false);
  TrustData data = new TrustData { cbStruct=(uint)Marshal.SizeOf(typeof(TrustData)), dwUIChoice=2,
   fdwRevocationChecks=1, dwUnionChoice=1, pFile=pointer, dwStateAction=1, dwProvFlags=0x80 };
  Guid action = new Guid("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");
  try {
   Demand(WinVerifyTrust(new IntPtr(-1), ref action, ref data) == 0, "UPDATE_AUTHENTICODE_INVALID");
   using (X509Certificate2 certificate = new X509Certificate2(X509Certificate.CreateFromSignedFile(target)))
   using (SHA256 sha = SHA256.Create()) { Demand(Hex(sha.ComputeHash(certificate.RawData)) == signer, "UPDATE_SIGNER_MISMATCH"); }
  } finally {
   data.dwStateAction=2; WinVerifyTrust(new IntPtr(-1), ref action, ref data);
   Marshal.DestroyStructure(pointer, typeof(FileInfo)); Marshal.FreeHGlobal(pointer);
  }
 }
 public static int Main(string[] args) {
  try {
   Demand(args.Length == 4 || args.Length == 5, "UPDATE_HOST_ARGUMENT_INVALID");
   bool install = args[0] == "install";
   Demand(args[0] == "inspect" || install, "UPDATE_HOST_ARGUMENT_INVALID");
   Demand((install && args.Length == 5) || (!install && args.Length == 4), "UPDATE_HOST_ARGUMENT_INVALID");
   string target = Path.GetFullPath(args[1]);
   Demand(Regex.IsMatch(args[2], "^[a-f0-9]{64}$") && Regex.IsMatch(args[3], "^[a-f0-9]{64}$"), "UPDATE_HOST_ARGUMENT_INVALID");
   Demand((File.GetAttributes(target) & FileAttributes.ReparsePoint) == 0, "UPDATE_CACHE_INVALID");
   // FileShare.Read denies concurrent write, rename and delete throughout verification/start.
   using (FileStream file = new FileStream(target, FileMode.Open, FileAccess.Read, FileShare.Read)) {
    Verify(file, target, args[2], args[3]);
    if (!install) { Console.WriteLine("VERIFIED"); return 0; }
    int parentId; Demand(Int32.TryParse(args[4], out parentId) && parentId > 0 && parentId != Process.GetCurrentProcess().Id, "UPDATE_PARENT_INVALID");
    using (Process parent = Process.GetProcessById(parentId)) {
     Console.WriteLine("READY"); Console.Out.Flush();
     Demand(Console.ReadLine() == "COMMIT", "UPDATE_COMMIT_REQUIRED");
     Demand(parent.WaitForExit(60000), "UPDATE_PARENT_STILL_RUNNING");
     Verify(file, target, args[2], args[3]);
     ProcessStartInfo start = new ProcessStartInfo(target, "/S --updated") { UseShellExecute=false, CreateNoWindow=true, WorkingDirectory=Path.GetDirectoryName(target) };
     using (Process child = Process.Start(start)) { Demand(child != null, "UPDATE_INSTALLER_START_FAILED"); }
    }
   }
   return 0;
  } catch (Exception e) {
   string message = e is InvalidOperationException && Regex.IsMatch(e.Message, "^UPDATE_[A-Z_]+$") ? e.Message : "UPDATE_INSTALLER_VERIFICATION_FAILED";
   Console.Error.WriteLine(message); return 1;
  }
 }
}
