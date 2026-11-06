using System;
using System.Runtime.InteropServices;
using System.Text;
// A private native process job. Killing this helper closes the job and every
// converter child; the Office process is assigned before its first instruction.
class WorkmateDocumentPreview {
  [StructLayout(LayoutKind.Sequential)] struct Startup { public uint cb; public IntPtr reserved,desktop,title; public uint x,y,xs,ys,xc,yc,fill,flags; public ushort show,extra; public IntPtr bytes,input,output,error; }
  [StructLayout(LayoutKind.Sequential)] struct ProcessInfo { public IntPtr process,thread; public uint pid,tid; }
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long processTime,jobTime; public uint flags; public UIntPtr minimum,maximum; public uint active; public UIntPtr affinity; public uint priority,scheduling; }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong readOps,writeOps,otherOps,readBytes,writeBytes,otherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public Basic basic; public IO io; public UIntPtr processMemory,jobMemory,peakProcess,peakJob; }
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref Startup startup,out ProcessInfo process);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr attrs,string name);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job,int kind,ref Limits limits,uint size);
  [DllImport("kernel32.dll",SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
  [DllImport("kernel32.dll")] static extern uint ResumeThread(IntPtr thread);
  [DllImport("kernel32.dll")] static extern uint WaitForSingleObject(IntPtr handle,uint milliseconds);
  [DllImport("kernel32.dll")] static extern bool GetExitCodeProcess(IntPtr process,out uint exit);
  [DllImport("kernel32.dll")] static extern bool TerminateProcess(IntPtr process,uint exit);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
  [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr OpenProcess(uint access,bool inherit,uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr GetStdHandle(int kind);
  [DllImport("kernel32.dll")] static extern uint SetErrorMode(uint mode);
  static string Quote(string value) {
    var b=new StringBuilder("\"");int slashes=0;
    foreach(char c in value){if(c=='\\'){slashes++;continue;}if(c=='"'){b.Append('\\',slashes*2+1);b.Append(c);}else{b.Append('\\',slashes);b.Append(c);}slashes=0;}
    b.Append('\\',slashes*2);return b.Append('"').ToString();
  }
  static int Main(string[] args) {
    if(args.Length!=6)return 64;
    uint parentId;if(!uint.TryParse(args[0],out parentId)||parentId==0)return 64;
    IntPtr parent=OpenProcess(0x00100000,false,parentId),job=IntPtr.Zero;ProcessInfo p=new ProcessInfo();
    if(parent==IntPtr.Zero)return 65;
    try {
      job=CreateJobObject(IntPtr.Zero,null);if(job==IntPtr.Zero)return 66;
      var limits=new Limits();limits.basic.flags=0x2000|0x200|0x8;limits.basic.active=8;limits.jobMemory=(UIntPtr)(1024UL*1024*1024);
      if(!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(typeof(Limits))))return 67;
      var extension=System.IO.Path.GetExtension(args[4]).ToLowerInvariant();
      var filter=extension==".pptx"?"impress_pdf_Export":extension==".xlsx"?"calc_pdf_Export":"writer_pdf_Export";
      var startup=new Startup();startup.cb=(uint)Marshal.SizeOf(typeof(Startup));startup.flags=1|0x100;startup.show=0;
      startup.input=GetStdHandle(-10);startup.output=GetStdHandle(-11);startup.error=GetStdHandle(-12);
      // Headless conversion must not inherit company credentials, proxy settings,
      // graphics probes or an interactive Windows error dialog from the API.
      SetErrorMode(0x8003);
      string systemRoot=Environment.GetEnvironmentVariable("SystemRoot");
      if(String.IsNullOrEmpty(systemRoot))return 68;
      string environment="PATH="+System.IO.Path.GetDirectoryName(args[1])+";"+System.IO.Path.Combine(systemRoot,"System32")+"\0SAL_DISABLEGL=1\0SAL_DISABLESKIA=1\0SAL_DISABLE_OPENCL=1\0SystemRoot="+systemRoot+"\0TEMP="+args[5]+"\0TMP="+args[5]+"\0WINDIR="+systemRoot+"\0\0";
      IntPtr block=Marshal.StringToHGlobalUni(environment);
      // Run the pinned binary itself. The console bootstrap may request a
      // private-profile restart while retaining its wrapper process. Exit81
      // permits one restart in this same profile, job and total deadline.
      var end=DateTime.UtcNow.AddSeconds(45);
      try {
        for(int attempt=0;attempt<2;attempt++) {
          var command=new StringBuilder(Quote(args[1])+" -env:UserInstallation="+Quote(args[2])+" --headless --invisible --nologo --nodefault --nofirststartwizard --norestore --convert-to "+Quote("pdf:"+filter)+" --outdir "+Quote(args[3])+" "+Quote(args[4]));
          if(!CreateProcess(args[1],command,IntPtr.Zero,IntPtr.Zero,true,0x08000000|0x4|0x400,block,args[5],ref startup,out p))return 68;
          if(!AssignProcessToJobObject(job,p.process)){TerminateProcess(p.process,69);return 69;}
          ResumeThread(p.thread);CloseHandle(p.thread);p.thread=IntPtr.Zero;
          bool restart=false;
          while(DateTime.UtcNow<end) {
            if(WaitForSingleObject(parent,0)==0)return 70;
            if(WaitForSingleObject(p.process,100)!=0)continue;
            uint exit;if(!GetExitCodeProcess(p.process,out exit))return 71;
            if(exit!=81||attempt!=0)return (int)exit;
            CloseHandle(p.process);p.process=IntPtr.Zero;restart=true;break;
          }
          if(!restart)return 72;
        }
        return 71;
      } finally {Marshal.FreeHGlobal(block);}
    } finally {if(job!=IntPtr.Zero)CloseHandle(job);if(p.thread!=IntPtr.Zero)CloseHandle(p.thread);if(p.process!=IntPtr.Zero)CloseHandle(p.process);CloseHandle(parent);}
  }
}
