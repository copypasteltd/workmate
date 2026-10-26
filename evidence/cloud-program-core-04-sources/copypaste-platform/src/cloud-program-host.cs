// Company-owned Windows execution boundary. No hypervisor, VM, WSL or Docker.
// A new AppContainer has no network capabilities. The job owns one suspended
// process and prohibits child creation before any customer instruction runs.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

internal static class CloudProgramHost {
  [StructLayout(LayoutKind.Sequential)] struct Security { public int Length; public IntPtr Descriptor; public int Inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
    public int Size; public string Reserved, Desktop, Title; public int X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
    public short Show, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Basic; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
  [StructLayout(LayoutKind.Sequential)] struct Capabilities { public IntPtr Sid, Entries; public uint Count, Reserved; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Limits {
    public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int CreateAppContainerProfile(string name, string display, string description, IntPtr capabilities, uint count, out IntPtr sid);
  [DllImport("userenv.dll", CharSet = CharSet.Unicode)] static extern int DeleteAppContainerProfile(string name);
  [DllImport("advapi32.dll")] static extern IntPtr FreeSid(IntPtr sid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr prior, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref Limits limits, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string executable, StringBuilder command, IntPtr pa, IntPtr ta, bool inherit, uint flags, IntPtr environment, string directory, ref StartupEx startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref Security attributes, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern uint SetErrorMode(uint mode);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string name, uint access, uint share, ref Security attributes, uint creation, uint flags, IntPtr template);

  static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero && handle.ToInt64() != -1) CloseHandle(handle); handle = IntPtr.Zero; }
  static string Quote(string value) {
    var text = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { text.Append('\\', slashes * 2 + 1); text.Append(c); slashes = 0; continue; }
      text.Append('\\', slashes); slashes = 0; text.Append(c);
    }
    return text.Append('\\', slashes * 2).Append('"').ToString();
  }
  static void SafePath(string full) {
    var cursor = new DirectoryInfo(full);
    while (cursor != null) {
      if ((cursor.Attributes & FileAttributes.ReparsePoint) != 0) throw new IOException("REPARSE_PATH");
      cursor = cursor.Parent;
    }
  }
  static void Grant(string folder, SecurityIdentifier sid, FileSystemRights rights) {
    var acl = Directory.GetAccessControl(folder);
    acl.AddAccessRule(new FileSystemAccessRule(sid, rights, InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit, PropagationFlags.None, AccessControlType.Allow));
    Directory.SetAccessControl(folder, acl);
  }
  static Thread Pump(IntPtr handle, Stream destination) {
    var thread = new Thread(() => {
      try {
        using (var file = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(handle, true), FileAccess.Read)) {
          byte[] buffer = new byte[8192]; int size;
          while ((size = file.Read(buffer, 0, buffer.Length)) > 0) { destination.Write(buffer, 0, size); destination.Flush(); }
        }
      } catch (IOException) { }
    }); thread.IsBackground = true; thread.Start(); return thread;
  }
  static void Attribute(IntPtr list, int kind, IntPtr value, int bytes) {
    Check(UpdateProcThreadAttribute(list, 0, new IntPtr(kind), value, new IntPtr(bytes), IntPtr.Zero, IntPtr.Zero));
  }
  public static int Main(string[] args) {
    if (args.Length == 2 && args[0] == "--cleanup") {
      try {
        string folder = Path.GetFullPath(args[1]); Guid folderId;
        if (!Path.IsPathRooted(args[1]) || !Guid.TryParse(Path.GetFileName(folder), out folderId)) return 74;
        SafePath(folder);
        var owner = new JavaScriptSerializer().Deserialize<System.Collections.Generic.Dictionary<string, object>>(File.ReadAllText(Path.Combine(folder, "owner.json")));
        string name = owner["profile_name"] as string;
        if (name == null || !System.Text.RegularExpressions.Regex.IsMatch(name, "^cpsoftware-[a-f0-9]{32}$")) return 74;
        int previous = Convert.ToInt32(owner["host_pid"]);
        try { if (!Process.GetProcessById(previous).HasExited) return 74; } catch (ArgumentException) { }
        int status = DeleteAppContainerProfile(name);
        // A previous host may have completed deletion before losing its receipt.
        return status >= 0 || status == unchecked((int)0x80070002) || status == unchecked((int)0x80070003) ? 0 : 74;
      } catch { return 74; }
    }
    IntPtr sid = IntPtr.Zero, attributes = IntPtr.Zero, capsMemory = IntPtr.Zero, childPolicy = IntPtr.Zero, handlesMemory = IntPtr.Zero, environment = IntPtr.Zero;
    IntPtr job = IntPtr.Zero, outputRead = IntPtr.Zero, outputWrite = IntPtr.Zero, errorRead = IntPtr.Zero, errorWrite = IntPtr.Zero, input = IntPtr.Zero;
    var process = new ProcessInfo(); var clock = Stopwatch.StartNew();
    bool created = false, resumed = false, timedOut = false, cancelled = false, profileDeleted = false;
    string profile = "cpsoftware-" + Guid.NewGuid().ToString("N"), root = null, failure = null;
    int result = 74; FileStream pinned = null;
    try {
      SetErrorMode(0x8003);
      int timeout;
      if (args.Length < 5 || !Path.IsPathRooted(args[0]) || !Path.IsPathRooted(args[1]) || args[2].Length != 64 || !Int32.TryParse(args[3], out timeout) || timeout < 100 || timeout > 120000) throw new ArgumentException("INPUT");
      root = Path.GetFullPath(args[0]); string work = Path.Combine(root, "work"), executable = Path.GetFullPath(args[1]);
      Guid ignored;
      if (!Guid.TryParse(Path.GetFileName(root), out ignored) || !Directory.Exists(work) || !executable.StartsWith(root + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("ROOT");
      SafePath(work); SafePath(Path.GetDirectoryName(executable));
      if ((File.GetAttributes(executable) & FileAttributes.ReparsePoint) != 0) throw new IOException("REPARSE_IMAGE");
      pinned = new FileStream(executable, FileMode.Open, FileAccess.Read, FileShare.Read);
      using (var algorithm = SHA256.Create()) {
        string actual = BitConverter.ToString(algorithm.ComputeHash(pinned)).Replace("-", "").ToLowerInvariant();
        if (!String.Equals(actual, args[2], StringComparison.Ordinal)) throw new IOException("IMAGE_HASH");
      }
      int hr = CreateAppContainerProfile(profile, profile, "CopyPaste customer code; no network or child processes", IntPtr.Zero, 0, out sid);
      if (hr < 0) Marshal.ThrowExceptionForHR(hr); created = true;
      var identity = new SecurityIdentifier(sid);
      Grant(root, identity, FileSystemRights.ReadAndExecute);
      Grant(work, identity, FileSystemRights.Modify);
      File.WriteAllText(Path.Combine(root, "owner.json"), new JavaScriptSerializer().Serialize(new { profile_name = profile, host_pid = Process.GetCurrentProcess().Id }), new UTF8Encoding(false));
      for (int kind = -10; kind >= -12; kind--) Check(SetHandleInformation(GetStdHandle(kind), 1, 0));
      job = CreateJobObject(IntPtr.Zero, null); Check(job != IntPtr.Zero);
      var limits = new Limits();
      limits.Basic.Flags = 0x2000 | 0x8 | 0x100 | 0x200; // kill on close, one process, per-process and job memory
      limits.Basic.ActiveProcesses = 1; limits.ProcessMemory = new UIntPtr(512UL * 1024 * 1024); limits.JobMemory = limits.ProcessMemory;
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(Limits))));
      var security = new Security { Length = Marshal.SizeOf(typeof(Security)), Inherit = 1 };
      Check(CreatePipe(out outputRead, out outputWrite, ref security, 0)); Check(CreatePipe(out errorRead, out errorWrite, ref security, 0));
      Check(SetHandleInformation(outputRead, 1, 0)); Check(SetHandleInformation(errorRead, 1, 0));
      input = CreateFile("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero); Check(input.ToInt64() != -1);
      IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 3, 0, ref size);
      attributes = Marshal.AllocHGlobal(size); Check(InitializeProcThreadAttributeList(attributes, 3, 0, ref size));
      capsMemory = Marshal.AllocHGlobal(Marshal.SizeOf(typeof(Capabilities)));
      Marshal.StructureToPtr(new Capabilities { Sid = sid }, capsMemory, false);
      Attribute(attributes, 0x20009, capsMemory, Marshal.SizeOf(typeof(Capabilities)));
      childPolicy = Marshal.AllocHGlobal(4); Marshal.WriteInt32(childPolicy, 1); Attribute(attributes, 0x2000E, childPolicy, 4);
      handlesMemory = Marshal.AllocHGlobal(IntPtr.Size * 3);
      Marshal.WriteIntPtr(handlesMemory, 0, input); Marshal.WriteIntPtr(handlesMemory, IntPtr.Size, outputWrite); Marshal.WriteIntPtr(handlesMemory, IntPtr.Size * 2, errorWrite);
      Attribute(attributes, 0x20002, handlesMemory, IntPtr.Size * 3);
      string windows = Environment.GetEnvironmentVariable("SystemRoot") ?? "C:\\Windows";
      string temp = Path.Combine(work, ".tmp"); Directory.CreateDirectory(temp);
      var variables = new string[] { "APPDATA=" + temp, "HOME=" + work, "LOCALAPPDATA=" + temp, "PATH=" + Path.GetDirectoryName(executable), "SystemRoot=" + windows, "TEMP=" + temp, "TMP=" + temp, "USERPROFILE=" + work };
      Array.Sort(variables, StringComparer.OrdinalIgnoreCase);
      environment = Marshal.StringToHGlobalUni(String.Join("\0", variables) + "\0\0");
      var startup = new StartupEx { Basic = new Startup { Size = Marshal.SizeOf(typeof(StartupEx)), Flags = 0x101, Show = 0, Input = input, Output = outputWrite, Error = errorWrite }, Attributes = attributes };
      var command = new StringBuilder(Quote(executable)); for (int i = 4; i < args.Length; i++) command.Append(' ').Append(Quote(args[i]));
      Check(CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x0008040C, environment, work, ref startup, out process));
      Check(AssignProcessToJobObject(job, process.Process));
      Close(ref outputWrite); Close(ref errorWrite); Close(ref input);
      var wire = Console.OpenStandardOutput(); byte[] header = Encoding.ASCII.GetBytes("CPCLOUD1 " + process.Pid + "\n"); wire.Write(header, 0, header.Length); wire.Flush();
      var output = Pump(outputRead, wire); outputRead = IntPtr.Zero;
      var error = Pump(errorRead, Console.OpenStandardError()); errorRead = IntPtr.Zero;
      var watcher = new Thread(() => { try { Console.In.ReadLine(); } catch (IOException) { } cancelled = true; TerminateJobObject(job, 1223); }); watcher.IsBackground = true; watcher.Start();
      Check(ResumeThread(process.Thread) != 0xffffffff); resumed = true; Close(ref process.Thread);
      uint waited = WaitForSingleObject(process.Process, (uint)timeout);
      if (waited == 258) { timedOut = true; Check(TerminateJobObject(job, 1460)); WaitForSingleObject(process.Process, 10000); }
      else Check(waited == 0);
      uint code; Check(GetExitCodeProcess(process.Process, out code)); result = unchecked((int)code);
      TerminateJobObject(job, 1223); output.Join(5000); error.Join(5000);
    } catch (Exception e) { failure = e is Win32Exception ? "WIN32_" + ((Win32Exception)e).NativeErrorCode : e.GetType().Name; Console.Error.WriteLine("COPYPASTE_CLOUD_HOST_FAILED:" + failure); result = 74; }
    finally {
      if (!resumed && process.Process != IntPtr.Zero) TerminateProcess(process.Process, 74);
      Close(ref job); Close(ref process.Thread); Close(ref process.Process);
      Close(ref outputRead); Close(ref outputWrite); Close(ref errorRead); Close(ref errorWrite); Close(ref input);
      if (attributes != IntPtr.Zero) { DeleteProcThreadAttributeList(attributes); Marshal.FreeHGlobal(attributes); }
      foreach (IntPtr pointer in new IntPtr[] { capsMemory, childPolicy, handlesMemory, environment }) if (pointer != IntPtr.Zero) Marshal.FreeHGlobal(pointer);
      if (pinned != null) pinned.Dispose();
      if (created) profileDeleted = DeleteAppContainerProfile(profile) >= 0;
      if (sid != IntPtr.Zero) FreeSid(sid);
      if (root != null && Directory.Exists(root)) {
        File.WriteAllText(Path.Combine(root, "host-receipt.json"), new JavaScriptSerializer().Serialize(new { schema = 1, process_id = process.Pid, exit_code = result, resumed = resumed, timed_out = timedOut, cancelled = cancelled, elapsed_ms = clock.ElapsedMilliseconds, profile_name = profile, profile_created = created, profile_deleted = profileDeleted, no_network_capabilities = true, child_processes_prohibited = true, memory_limit_bytes = 512UL * 1024 * 1024, failure = failure }), new UTF8Encoding(false));
      }
    }
    return result;
  }
}
