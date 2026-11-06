#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/landlock.h>
#include <linux/seccomp.h>
#include <signal.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <limits.h>

/* Ubuntu 22.04 may expose ABI 1 headers on a newer kernel. The bit is used
 * only after the kernel reports ABI >= 2; ABI 1 never receives this flag. */
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif

/* Native supervisor, no VM/container. No source content or credentials logged. */
static volatile sig_atomic_t stopped=0;
static void stop(int sig){(void)sig;stopped=1;}
static int add_path(int rules,const char *name,__u64 access,int required){
 int fd=open(name,O_PATH|O_CLOEXEC);if(fd<0)return required?-1:0;
 struct stat info;if(fstat(fd,&info)){close(fd);return -1;}
 if(!S_ISDIR(info.st_mode))access&=LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_WRITE_FILE|LANDLOCK_ACCESS_FS_EXECUTE;
 struct landlock_path_beneath_attr rule={.allowed_access=access,.parent_fd=fd};
 int result=syscall(SYS_landlock_add_rule,rules,LANDLOCK_RULE_PATH_BENEATH,&rule,0);close(fd);return result;
}
static int isolate(const char *work){
 int abi=syscall(SYS_landlock_create_ruleset,NULL,0,LANDLOCK_CREATE_RULESET_VERSION);if(abi<1)return -1;
 __u64 read=LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_READ_DIR|LANDLOCK_ACCESS_FS_EXECUTE;
 __u64 all=read|LANDLOCK_ACCESS_FS_WRITE_FILE|LANDLOCK_ACCESS_FS_REMOVE_DIR|LANDLOCK_ACCESS_FS_REMOVE_FILE|
  LANDLOCK_ACCESS_FS_MAKE_DIR|LANDLOCK_ACCESS_FS_MAKE_REG|LANDLOCK_ACCESS_FS_MAKE_SOCK;
 if(abi>=2)all|=LANDLOCK_ACCESS_FS_REFER;
 struct landlock_ruleset_attr set={.handled_access_fs=all|LANDLOCK_ACCESS_FS_MAKE_CHAR|LANDLOCK_ACCESS_FS_MAKE_BLOCK|LANDLOCK_ACCESS_FS_MAKE_FIFO|LANDLOCK_ACCESS_FS_MAKE_SYM};
 int rules=syscall(SYS_landlock_create_ruleset,&set,sizeof(set),0);if(rules<0)return -1;
 const char *paths[]={"/usr","/lib","/lib64","/etc/fonts","/etc/libreoffice","/etc/ld.so.cache","/etc/localtime","/etc/locale.alias","/etc/passwd","/etc/group","/etc/nsswitch.conf","/dev/urandom","/dev/random"};
 for(size_t i=0;i<sizeof(paths)/sizeof(paths[0]);i++)if(add_path(rules,paths[i],read,0)){close(rules);return -1;}
 if(add_path(rules,"/dev/null",LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_WRITE_FILE,1)||add_path(rules,"/dev/zero",LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_WRITE_FILE,1)){close(rules);return -1;}
 if(add_path(rules,work,all,1)||prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)||syscall(SYS_landlock_restrict_self,rules,0)){close(rules);return -1;}
 close(rules);
 /* Deny internet sockets before Office starts. Private Unix sockets are allowed. */
 #if defined(__x86_64__)
 const unsigned arch=AUDIT_ARCH_X86_64;
 #elif defined(__aarch64__)
 const unsigned arch=AUDIT_ARCH_AARCH64;
 #else
 return -1;
 #endif
 struct sock_filter code[]={
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)),
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,arch,1,0),BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,SYS_socket,0,4),
  BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,args[0])),
  BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,2,1,0),BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,10,0,1),
  BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|(EPERM&SECCOMP_RET_DATA)),
  BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)
 };
 struct sock_fprog program={.len=(unsigned short)(sizeof(code)/sizeof(code[0])),.filter=code};
 return prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&program);
}
static long long millis(void){struct timespec now;clock_gettime(CLOCK_MONOTONIC,&now);return (long long)now.tv_sec*1000+now.tv_nsec/1000000;}
static int convert_inside(char **argv){
 /* /tmp and /work refer to this conversion's same private inode tree. Older
  * LibreOffice releases choose /tmp for IPC even when TMPDIR is set. */
 const char *work="/work";if(chdir(work))return 73;
 umask(077);clearenv();setenv("PATH","/usr/bin:/bin",1);setenv("LANG","C.UTF-8",1);
 setenv("TMPDIR",work,1);setenv("XDG_CACHE_HOME",work,1);setenv("XDG_CONFIG_HOME",work,1);setenv("SAL_USE_VCLPLUGIN","svp",1);
 if(isolate(work))return 74;
 char profile[PATH_MAX+32];if(snprintf(profile,sizeof(profile),"-env:UserInstallation=%s",argv[3])>=(int)sizeof(profile))return 73;
 char *args[]={argv[2],profile,"--headless","--invisible","--nologo","--nodefault","--norestore","--nolockcheck","--convert-to","pdf","--outdir",argv[4],argv[5],NULL};
 /* soffice.bin requests one normal restart (81) while initializing a fresh
  * profile. Keep that restart inside the same private job and deadline. */
 for(int attempt=0;attempt<2;attempt++){
  pid_t office=fork();if(office<0)return 73;
  if(office==0){execv(argv[2],args);_exit(73);}
  int status=0;while(waitpid(office,&status,0)<0){if(errno!=EINTR)return 73;}
  int result=WIFEXITED(status)?WEXITSTATUS(status):72;
  if(result!=81||attempt==1)return result;
 }
 return 73;
}
int main(int argc,char **argv){
 if(argc==7&&!strcmp(argv[1],"--inside"))return convert_inside(argv);
 if(argc==2&&!strcmp(argv[1],"--probe")){
  if(geteuid()==0)return 73;
  int abi=syscall(SYS_landlock_create_ruleset,NULL,0,LANDLOCK_CREATE_RULESET_VERSION);
  if(abi<1)return 74;
  puts("workmate-office-native-linux-1");return 0;
 }
 if(argc!=7||geteuid()==0)return 73;
 char *end;long parent=strtol(argv[1],&end,10);if(*end||parent<2||parent!=getppid())return 73;
 char office[PATH_MAX],work[PATH_MAX],input[PATH_MAX],output[PATH_MAX];
 if(!realpath(argv[2],office)||!realpath(argv[6],work)||!realpath(argv[5],input)||!realpath(argv[4],output))return 73;
 size_t n=strlen(work);if(strncmp(input,work,n)||input[n]!='/'||strncmp(output,work,n)||output[n]!='/'||strncmp(argv[3],"file:///",8))return 73;
 struct stat info;if(stat(work,&info)||info.st_uid!=geteuid())return 73;
 if(prctl(PR_SET_PDEATHSIG,SIGTERM)||getppid()!=parent)return 73;
 struct sigaction action={0};action.sa_handler=stop;sigemptyset(&action.sa_mask);
 sigaction(SIGTERM,&action,NULL);sigaction(SIGINT,&action,NULL);sigaction(SIGHUP,&action,NULL);
 pid_t supervisor=getpid(),child=fork();if(child<0)return 73;
 if(child==0){
  if(setpgid(0,0)||prctl(PR_SET_PDEATHSIG,SIGKILL)||getppid()!=supervisor)_exit(73);
  struct rlimit cpu={40,42},memory={(rlim_t)3*1024*1024*1024,(rlim_t)3*1024*1024*1024},files={256,256},size={45*1024*1024,45*1024*1024};
  if(setrlimit(RLIMIT_CPU,&cpu)||setrlimit(RLIMIT_AS,&memory)||setrlimit(RLIMIT_NOFILE,&files)||setrlimit(RLIMIT_FSIZE,&size)||chdir(work))_exit(73);
  char self[PATH_MAX],inside_input[PATH_MAX];ssize_t length=readlink("/proc/self/exe",self,sizeof(self)-1);if(length<1||length>=(ssize_t)sizeof(self)-1)_exit(73);self[length]='\0';
  const char *name=strrchr(input,'/');if(!name||snprintf(inside_input,sizeof(inside_input),"/work%s",name)>=(int)sizeof(inside_input))_exit(73);
  clearenv();setenv("PATH","/usr/bin:/bin",1);setenv("LANG","C.UTF-8",1);
  char *args[96];int count=0;
  #define ARG(value) args[count++]=(char *)(value)
  ARG("/usr/bin/bwrap");ARG("--unshare-all");ARG("--die-with-parent");ARG("--cap-drop");ARG("ALL");
  const char *runtime_paths[]={"/usr","/lib","/lib64","/etc/fonts","/etc/libreoffice","/etc/ld.so.cache","/etc/localtime","/etc/locale.alias","/etc/passwd","/etc/group","/etc/nsswitch.conf"};
  for(size_t i=0;i<sizeof(runtime_paths)/sizeof(runtime_paths[0]);i++)if(access(runtime_paths[i],F_OK)==0){ARG("--ro-bind");ARG(runtime_paths[i]);ARG(runtime_paths[i]);}
  ARG("--proc");ARG("/proc");ARG("--dev");ARG("/dev");
  ARG("--bind");ARG(work);ARG("/work");ARG("--bind");ARG(work);ARG("/tmp");
  ARG("--ro-bind");ARG(self);ARG("/office-host");ARG("--chdir");ARG("/work");
  ARG("/office-host");ARG("--inside");ARG(office);ARG("file:///work/profile");ARG("/work/output");ARG(inside_input);ARG("/work");args[count]=NULL;
  execv(args[0],args);_exit(73);
  #undef ARG
 }
 setpgid(child,child);long long deadline=millis()+48000;int status=0,result=72;
 while(!stopped&&getppid()==parent&&millis()<deadline){
  pid_t done=waitpid(child,&status,WNOHANG);if(done==child){result=WIFEXITED(status)?WEXITSTATUS(status):72;break;}
  if(done<0&&errno!=EINTR)break;
  struct timespec delay={.tv_sec=0,.tv_nsec=100000000};nanosleep(&delay,NULL);
 }
 kill(-child,SIGKILL);while(waitpid(child,&status,0)<0&&errno==EINTR){}
 return result;
}
