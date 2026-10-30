// Company-owned launcher: preserve Chromium CDP descriptors while assigning a suspended
// browser to a native Windows job before any renderer is created.
using System;
using System.ComponentModel;
using System.Diagnostics;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Security.Cryptography;
internal static class CloudBrowserHost {
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct Startup {
    public int Size; public IntPtr Reserved, Desktop, Title; public int X,Y,XSize,YSize,XChars,YChars,Fill,Flags;
    public short Show, ReservedSize; public IntPtr ReservedPointer, Input, Output, Error;
  }
  [StructLayout(LayoutKind.Sequential)] struct StartupEx { public Startup Basic; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr Process, Thread; public uint Pid,Tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimits { public long ProcessTime,JobTime; public uint Flags; public UIntPtr MinWorkingSet,MaxWorkingSet; public uint ActiveProcesses; public UIntPtr Affinity; public uint PriorityClass,SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct IoCounters { public ulong ReadOps,WriteOps,OtherOps,ReadBytes,WriteBytes,OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public BasicLimits Basic; public IoCounters Io; public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory; }
  [StructLayout(LayoutKind.Sequential)] struct CpuRate { public uint Flags, Rate; }
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref CpuRate cpu,uint bytes);
  [DllImport("kernel32.dll")] static extern uint SetErrorMode(uint mode);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)] static extern void GetStartupInfo(out Startup value);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr h,uint mask,uint flags);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int type,ref Limits limits,uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j,int type,IntPtr output,uint size,out uint written);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr j,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr a,int c,int f,ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr a,uint f,IntPtr kind,IntPtr value,IntPtr size,IntPtr prior,IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr a);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string exe,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref StartupEx startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool TerminateProcess(IntPtr h,uint code);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint access,out IntPtr token);
  [DllImport("advapi32.dll",SetLastError=true)] static extern bool GetTokenInformation(IntPtr token,int kind,IntPtr data,int size,out int returned);
  [DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr token);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthorityCount(IntPtr sid);
  [DllImport("advapi32.dll")] static extern IntPtr GetSidSubAuthority(IntPtr sid,uint index);
  static void Check(bool value) { if(!value)throw new Win32Exception(Marshal.GetLastWin32Error()); }
  static string Quote(string value) { var b=new StringBuilder("\"");int n=0;foreach(char c in value){if(c=='\\'){n++;continue;}if(c=='"'){b.Append('\\',n*2+1);b.Append(c);n=0;continue;}b.Append('\\',n);n=0;b.Append(c);}return b.Append('\\',n*2).Append('"').ToString(); }
  static object Token(uint pid) {
    IntPtr p=OpenProcess(0x1000,false,pid), t=IntPtr.Zero, data=Marshal.AllocHGlobal(512); int n; int level=-1, container=-1; bool restricted=false;
    try { if(p!=IntPtr.Zero && OpenProcessToken(p,8,out t)) { restricted=IsTokenRestricted(t); if(GetTokenInformation(t,29,data,512,out n))container=Marshal.ReadInt32(data);if(GetTokenInformation(t,25,data,512,out n)){IntPtr sid=Marshal.ReadIntPtr(data);uint count=Marshal.ReadByte(GetSidSubAuthorityCount(sid));level=Marshal.ReadInt32(GetSidSubAuthority(sid,count-1));} } }
    finally { if(t!=IntPtr.Zero)CloseHandle(t);if(p!=IntPtr.Zero)CloseHandle(p);Marshal.FreeHGlobal(data); }
    return new {pid=pid,integrity_rid=level,appcontainer=container,restricted=restricted};
  }
  static object[] Snapshot(IntPtr job) {
    var list=new List<object>();IntPtr memory=Marshal.AllocHGlobal(8+64*IntPtr.Size);uint returned;
    try { Check(QueryInformationJobObject(job,3,memory,(uint)(8+64*IntPtr.Size),out returned));int count=Marshal.ReadInt32(memory,4);for(int i=0;i<count;i++)list.Add(Token((uint)Marshal.ReadIntPtr(memory,8+i*IntPtr.Size).ToInt64())); }
    finally {Marshal.FreeHGlobal(memory);}return list.ToArray();
  }
  static void SafePath(string full) {var dir=new DirectoryInfo(full);while(dir!=null){if((dir.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("REPARSE_PATH");dir=dir.Parent;}}
  static void Save(string file, object value) { string temp=file+".tmp";File.WriteAllText(temp,new JavaScriptSerializer().Serialize(value),new UTF8Encoding(false));if(File.Exists(file))File.Replace(temp,file,null);else File.Move(temp,file); }
  // Mutable telemetry can be interrupted during replacement when a controller
  // crashes. Persist ownership once, before creating or resuming any browser,
  // so reclamation never depends on that replace operation having completed.
  static void SaveOwner(string file, object value) { byte[] bytes=new UTF8Encoding(false).GetBytes(new JavaScriptSerializer().Serialize(value));using(var stream=new FileStream(file,FileMode.CreateNew,FileAccess.Write,FileShare.Read)){stream.Write(bytes,0,bytes.Length);stream.Flush(true);} }
  public static int Main(string[] args) {
    if(args.Length==2&&args[0]=="--inspect-job") {IntPtr inspected=IntPtr.Zero;try{string folder=Path.GetFullPath(args[1]);SafePath(folder);Guid id;if(!Guid.TryParse(Path.GetFileName(folder),out id))throw new ArgumentException("ROOT");string name="Local\\CopyPasteBrowser-"+Path.GetFileName(folder);inspected=OpenJobObject(4,false,name);bool exists=inspected!=IntPtr.Zero;if(!exists&&Marshal.GetLastWin32Error()!=2)throw new Win32Exception(Marshal.GetLastWin32Error());object[] processes=exists?Snapshot(inspected):new object[0];Console.WriteLine(new JavaScriptSerializer().Serialize(new{schema=1,job_name=name,job_exists=exists,job_empty=processes.Length==0,processes=processes}));return 0;}catch(Exception){return 74;}finally{if(inspected!=IntPtr.Zero)CloseHandle(inspected);}}
    SetErrorMode(3); FileStream pinned=null; IntPtr job=IntPtr.Zero,attributes=IntPtr.Zero,handles=IntPtr.Zero,parent=IntPtr.Zero;ProcessInfo process=new ProcessInfo(); bool resumed=false,timeout=false,parentGone=false,cancelled=false,jobEmpty=false;int result=74;string failure=null;
    string root=Environment.GetEnvironmentVariable("COPYPASTE_BROWSER_ROOT"); string receipt=root==null?null:Path.Combine(root,"host-receipt.json");var timer=Stopwatch.StartNew();object[] snapshot=new object[0];
    try {
      string exe=Environment.GetEnvironmentVariable("COPYPASTE_CHROMIUM_BINARY");int deadline=int.Parse(Environment.GetEnvironmentVariable("COPYPASTE_BROWSER_DEADLINE_MS"));uint parentId=uint.Parse(Environment.GetEnvironmentVariable("COPYPASTE_BROWSER_PARENT_PID"));
      Guid id; if(root==null||!Guid.TryParse(Path.GetFileName(root),out id)||!File.Exists(exe)||deadline<100||deadline>36000)throw new ArgumentException("CONFIG");
      SafePath(root); SafePath(Path.GetDirectoryName(exe)); if((File.GetAttributes(exe)&FileAttributes.ReparsePoint)!=0)throw new IOException("REPARSE_IMAGE");
      pinned=new FileStream(exe,FileMode.Open,FileAccess.Read,FileShare.Read); using(var sha=SHA256.Create()) { string digest=BitConverter.ToString(sha.ComputeHash(pinned)).Replace("-","").ToLowerInvariant();if(digest!=Environment.GetEnvironmentVariable("COPYPASTE_BROWSER_SHA256"))throw new IOException("IMAGE_HASH"); }
      bool data=false,pipe=false; foreach(string a in args) { if(a.Contains("no-sandbox")||a.Contains("disable-gpu-sandbox")||a.Contains("disable-web-security")||a.StartsWith("--remote-debugging-port")||a=="--single-process"||a.StartsWith("--allow-file-access"))throw new ArgumentException("UNSAFE_ARGUMENT");if(a.StartsWith("--user-data-dir=")){if(a.Substring(16)!=Path.Combine(root,"profile"))throw new ArgumentException("PROFILE");data=true;}if(a=="--remote-debugging-pipe")pipe=true;} if(!data||!pipe)throw new ArgumentException("ARGUMENTS");
      parent=OpenProcess(0x100000,false,parentId);Check(parent!=IntPtr.Zero);
      SaveOwner(Path.Combine(root,"host-owner.json"),new{schema=1,boundary="chromium-native-sandbox-nested-job-v1",execution_id=Path.GetFileName(root),job_name="Local\\CopyPasteBrowser-"+Path.GetFileName(root),host_pid=Process.GetCurrentProcess().Id,controller_pid=parentId});
      Startup incoming;GetStartupInfo(out incoming);if(incoming.ReservedPointer==IntPtr.Zero||incoming.ReservedSize<4)throw new ArgumentException("FD_TABLE");int count=Marshal.ReadInt32(incoming.ReservedPointer);if(count!=5||incoming.ReservedSize<4+count+count*IntPtr.Size)throw new ArgumentException("FD_COUNT");
      var valid=new List<IntPtr>();for(int i=0;i<count;i++){IntPtr h=Marshal.ReadIntPtr(incoming.ReservedPointer,4+count+i*IntPtr.Size);if(h!=IntPtr.Zero && h.ToInt64()!=-1){Check(SetHandleInformation(h,1,1));valid.Add(h);}}
      handles=Marshal.AllocHGlobal(valid.Count*IntPtr.Size);for(int i=0;i<valid.Count;i++)Marshal.WriteIntPtr(handles,i*IntPtr.Size,valid[i]);
      IntPtr size=IntPtr.Zero;InitializeProcThreadAttributeList(IntPtr.Zero,1,0,ref size);attributes=Marshal.AllocHGlobal(size);Check(InitializeProcThreadAttributeList(attributes,1,0,ref size));Check(UpdateProcThreadAttribute(attributes,0,new IntPtr(0x20002),handles,new IntPtr(valid.Count*IntPtr.Size),IntPtr.Zero,IntPtr.Zero));
      job=CreateJobObject(IntPtr.Zero,"Local\\CopyPasteBrowser-"+Path.GetFileName(root));Check(job!=IntPtr.Zero);if(Marshal.GetLastWin32Error()==183)throw new IOException("JOB_ALREADY_EXISTS");var limits=new Limits();limits.Basic.Flags=0x2000|8|0x100|0x200;limits.Basic.ActiveProcesses=20;limits.ProcessMemory=new UIntPtr(512UL*1024*1024);limits.JobMemory=new UIntPtr(1536UL*1024*1024);Check(SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))));var cpu=new CpuRate{Flags=5,Rate=5000};Check(SetInformationJobObject(job,15,ref cpu,(uint)Marshal.SizeOf(typeof(CpuRate))));
      var startup=new StartupEx {Basic=incoming,Attributes=attributes};startup.Basic.Size=Marshal.SizeOf(typeof(StartupEx));startup.Basic.Flags=0x101;startup.Basic.Show=0;
      var command=new StringBuilder(Quote(exe));foreach(string a in args)command.Append(' ').Append(Quote(a));
      Check(CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08080004,IntPtr.Zero,root,ref startup,out process));Check(AssignProcessToJobObject(job,process.Process));
      Check(ResumeThread(process.Thread)!=0xffffffff);resumed=true;CloseHandle(process.Thread);process.Thread=IntPtr.Zero;
      long nextSnapshot=0;
      while(WaitForSingleObject(process.Process,50)==258){if(timer.ElapsedMilliseconds>=nextSnapshot){snapshot=Snapshot(job);Save(receipt,new {running=true,job_name="Local\\CopyPasteBrowser-"+Path.GetFileName(root),host_pid=Process.GetCurrentProcess().Id,pid=process.Pid,processes=snapshot});nextSnapshot=timer.ElapsedMilliseconds+250;}if(File.Exists(Path.Combine(root,"cancel"))){cancelled=true;break;}if(timer.ElapsedMilliseconds>=deadline){timeout=true;break;}if(WaitForSingleObject(parent,0)==0){parentGone=true;break;}}
      Check(TerminateJobObject(job,1223));WaitForSingleObject(process.Process,5000);for(int attempt=0;attempt<60;attempt++){if(Snapshot(job).Length==0){jobEmpty=true;break;}Thread.Sleep(50);}if(!jobEmpty)throw new IOException("JOB_NOT_EMPTY");uint code;Check(GetExitCodeProcess(process.Process,out code));result=unchecked((int)code);
    } catch(Exception e){failure=e is Win32Exception?"WIN32_"+((Win32Exception)e).NativeErrorCode:e.Message;Console.Error.WriteLine("BROWSER_HOST_FAILED:"+failure);}
    finally {if(!resumed&&process.Process!=IntPtr.Zero)TerminateProcess(process.Process,74);if(job!=IntPtr.Zero)CloseHandle(job);if(parent!=IntPtr.Zero)CloseHandle(parent);if(process.Thread!=IntPtr.Zero)CloseHandle(process.Thread);if(process.Process!=IntPtr.Zero)CloseHandle(process.Process);if(attributes!=IntPtr.Zero){DeleteProcThreadAttributeList(attributes);Marshal.FreeHGlobal(attributes);}if(handles!=IntPtr.Zero)Marshal.FreeHGlobal(handles);if(pinned!=null)pinned.Dispose();if(receipt!=null)Save(receipt,new{schema=1,boundary="chromium-native-sandbox-nested-job-v1",running=false,job_name="Local\\CopyPasteBrowser-"+Path.GetFileName(root),host_pid=Process.GetCurrentProcess().Id,process_id=process.Pid,processes=snapshot,resumed=resumed,timed_out=timeout,cancelled=cancelled,parent_gone=parentGone,elapsed_ms=timer.ElapsedMilliseconds,exit_code=result,job_empty=jobEmpty,process_limit=20,process_memory_limit_bytes=512UL*1024*1024,job_memory_limit_bytes=1536UL*1024*1024,kill_on_close=true,cpu_rate_percent=50,failure=failure});}
    return result;
  }
}
