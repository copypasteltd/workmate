// Trusted Windows guardian. A suspended process joins a kill-on-close Job Object
// before its first instruction; the guardian never shares the job handle.
using System;
using System.ComponentModel;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Security.Cryptography;

internal static class LocalProgramHost {
  [StructLayout(LayoutKind.Sequential)] struct Security { public int Length; public IntPtr Descriptor; public int Inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
    public int Size; public string Reserved, Desktop, Title; public int X, Y, XSize, YSize, XChars, YChars, Fill, Flags;
    public short Show, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid, Tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
    public long ProcessTime, JobTime; public uint Flags; public UIntPtr MinWorkingSet, MaxWorkingSet; public uint ActiveProcesses;
    public UIntPtr Affinity; public uint PriorityClass, SchedulingClass;
  }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
    public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
  }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits limits, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CreateProcess(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inherit, uint flags, IntPtr environment, string directory, ref Startup startup, out ProcessInfo info);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool GetExitCodeProcess(IntPtr process, out uint code);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CreatePipe(out IntPtr read, out IntPtr write, ref Security attributes, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr CreateFile(string name, uint access, uint share, ref Security attributes, uint creation, uint flags, IntPtr template);

  static void Check(bool value) { if (!value) throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static void Close(ref IntPtr handle) { if (handle != IntPtr.Zero && handle.ToInt64() != -1) CloseHandle(handle); handle = IntPtr.Zero; }
  // Windows argv quoting: embedded quotes and trailing backslashes remain data.
  static string Quote(string value) {
    var result = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); slashes = 0; continue; }
      result.Append('\\', slashes); slashes = 0; result.Append(c);
    }
    result.Append('\\', slashes * 2); result.Append('"'); return result.ToString();
  }
  static Thread Pump(IntPtr handle, Stream destination) {
    var thread = new Thread(() => {
      try {
        using (var file = new FileStream(new Microsoft.Win32.SafeHandles.SafeFileHandle(handle, true), FileAccess.Read, 8192, false)) {
          var buffer = new byte[8192]; int size;
          while ((size = file.Read(buffer, 0, buffer.Length)) > 0) { destination.Write(buffer, 0, size); destination.Flush(); }
        }
      } catch (IOException) { /* Parent output closed: main-process EOF cancels the job. */ }
    });
    thread.IsBackground = true; thread.Start(); return thread;
  }
  public static int Main(string[] args) {
    IntPtr job = IntPtr.Zero, stdoutRead = IntPtr.Zero, stdoutWrite = IntPtr.Zero, stderrRead = IntPtr.Zero, stderrWrite = IntPtr.Zero, input = IntPtr.Zero;
    var process = new ProcessInfo(); bool resumed = false; FileStream pinned = null;
    try {
      if (args.Length < 2 || !Path.IsPathRooted(args[0]) || args[1].Length != 64) return 74;
      // Deny replacement/writes while hashing, creating and running the image.
      pinned = new FileStream(args[0], FileMode.Open, FileAccess.Read, FileShare.Read);
      using (var algorithm = SHA256.Create()) {
        string actual = BitConverter.ToString(algorithm.ComputeHash(pinned)).Replace("-", "").ToLowerInvariant();
        if (!String.Equals(actual, args[1], StringComparison.Ordinal)) return 74;
      }
      // The real child must not keep the guardian's input pipe alive after the
      // Desktop dies. Only its dedicated output pipes and NUL stdin inherit.
      for (int kind = -10; kind >= -12; kind--) Check(SetHandleInformation(GetStdHandle(kind), 1, 0));
      job = CreateJobObject(IntPtr.Zero, null); if (job == IntPtr.Zero) throw new Win32Exception();
      var limits = new ExtendedLimits(); limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
      Check(SetInformationJobObject(job, 9, ref limits, (uint)Marshal.SizeOf(typeof(ExtendedLimits))));
      var attributes = new Security { Length = Marshal.SizeOf(typeof(Security)), Inherit = 1 };
      Check(CreatePipe(out stdoutRead, out stdoutWrite, ref attributes, 0));
      Check(CreatePipe(out stderrRead, out stderrWrite, ref attributes, 0));
      Check(SetHandleInformation(stdoutRead, 1, 0)); Check(SetHandleInformation(stderrRead, 1, 0));
      input = CreateFile("NUL", 0x80000000, 3, ref attributes, 3, 0, IntPtr.Zero);
      if (input.ToInt64() == -1) throw new Win32Exception();
      var startup = new Startup { Size = Marshal.SizeOf(typeof(Startup)), Flags = 0x100, Input = input, Output = stdoutWrite, Error = stderrWrite };
      var command = new StringBuilder(Quote(args[0])); for (int i = 2; i < args.Length; i++) { command.Append(' '); command.Append(Quote(args[i])); }
      Check(CreateProcess(args[0], command, IntPtr.Zero, IntPtr.Zero, true, 0x08000004, IntPtr.Zero, Environment.CurrentDirectory, ref startup, out process));
      Check(AssignProcessToJobObject(job, process.Process));
      Close(ref stdoutWrite); Close(ref stderrWrite); Close(ref input);
      // Written before ResumeThread, so the program cannot forge its first PID.
      var wire = Console.OpenStandardOutput(); var header = Encoding.ASCII.GetBytes("CPPROGRAM1 " + process.Pid + "\n"); wire.Write(header, 0, header.Length); wire.Flush();
      var output = Pump(stdoutRead, wire); stdoutRead = IntPtr.Zero;
      var error = Pump(stderrRead, Console.OpenStandardError()); stderrRead = IntPtr.Zero;
      var cancelled = new Thread(() => {
        try { Console.In.ReadLine(); } catch (IOException) { }
        // An explicit stop or Desktop-process EOF kills exactly this job tree.
        TerminateJobObject(job, 1223);
      }); cancelled.IsBackground = true; cancelled.Start();
      if (ResumeThread(process.Thread) == 0xffffffff) throw new Win32Exception(); resumed = true; Close(ref process.Thread);
      WaitForSingleObject(process.Process, 0xffffffff);
      uint code; Check(GetExitCodeProcess(process.Process, out code));
      // A program's successful exit is not permission to leave descendants.
      TerminateJobObject(job, 1223);
      output.Join(5000); error.Join(5000);
      return unchecked((int)code);
    } catch (Exception) {
      Console.Error.WriteLine("COPYPASTE_PROGRAM_HOST_FAILED"); return 74;
    } finally {
      if (!resumed && process.Process != IntPtr.Zero) TerminateProcess(process.Process, 74);
      Close(ref job); Close(ref process.Thread); Close(ref process.Process);
      Close(ref stdoutRead); Close(ref stdoutWrite); Close(ref stderrRead); Close(ref stderrWrite); Close(ref input);
      if (pinned != null) pinned.Dispose();
    }
  }
}
