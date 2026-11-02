import {lstat, readFile} from "node:fs/promises";
import path from "node:path";

/** Availability requires a real, delegated service boundary, not just binaries. */
export async function assertLinuxNativeBoundary() {
  if (process.platform !== "linux") return;
  const root=process.env.COPYPASTE_NATIVE_CGROUP_ROOT;
  if (!root || !/^\/sys\/fs\/cgroup\/system\.slice\/workmate-(?:api|candidate-[a-z0-9-]+|native-qualification-[a-z0-9-]+)\.service\/executions$/.test(root) || !process.getuid?.())
    throw new Error("LINUX_DELEGATION_UNAVAILABLE");
  const info=await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid!==process.getuid())
    throw new Error("LINUX_DELEGATION_OWNER");
  const controllers=(await readFile(path.join(root,"cgroup.subtree_control"),"utf8")).split(/\s+/);
  if (!["cpu","memory","pids"].every(v=>controllers.includes(v)) || !/^NoNewPrivs:\s+1$/m.test(await readFile("/proc/self/status","utf8")))
    throw new Error("LINUX_LIMITS_UNAVAILABLE");
}
