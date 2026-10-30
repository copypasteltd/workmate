import { lstat, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { atomicFile } from "./files.js";
import { removalMarked } from "./removal-fence.js";
import { exclusive } from "./lock.js";

const pauseFile = "native-host-paused.json";
export async function nativeHostDisabled(root: string) {
  if (await removalMarked(root)) return true;
  try {
    await lstat(path.join(root, pauseFile));
    return true;
  } catch (error: any) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export async function assertNativeHostEnabled(root: string) {
  if (await nativeHostDisabled(root)) throw new Error("DESKTOP_DISCONNECTED");
}
export async function pauseNativeHosts(root: string) {
  await exclusive(root, () =>
    atomicFile(
      path.join(root, pauseFile),
      Buffer.from('{"protocol":"copypaste.native-host-pause.v1"}\n'),
    ),
  );
}
export async function resumeNativeHosts(root: string) {
  await exclusive(root, async () => {
    const file = path.join(root, pauseFile);
    const info = await lstat(file).catch((e: any) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (!info) return;
    if (
      info.isSymbolicLink() ||
      !info.isFile() ||
      (await readFile(file, "utf8")) !==
        '{"protocol":"copypaste.native-host-pause.v1"}\n'
    )
      throw new Error("NATIVE_HOST_PAUSE_INVALID");
    await rm(file);
  });
}
export async function registerNativeHostLease(root: string) {
  const instance = randomUUID(),
    dir = path.join(root, "native-hosts"),
    name = process.pid + "-" + instance + ".json";
  await exclusive(root, async () => {
    await assertNativeHostEnabled(root);
    await mkdir(dir, { recursive: true });
    if ((await lstat(dir)).isSymbolicLink())
      throw new Error("NATIVE_HOST_LEASE_INVALID");
    await atomicFile(
      path.join(dir, name),
      Buffer.from(
        JSON.stringify({
          protocol: "copypaste.native-host-lease.v1",
          pid: process.pid,
          instance,
        }),
      ),
    );
  });
  return async () => {
    await rm(path.join(dir, name), { force: true });
  };
}
export async function waitNativeHosts(root: string, timeout = 10000) {
  const dir = path.join(root, "native-hosts"),
    deadline = Date.now() + timeout;
  for (;;) {
    let names: string[];
    try {
      if ((await lstat(dir)).isSymbolicLink())
        throw new Error("NATIVE_HOST_LEASE_INVALID");
      names = await readdir(dir);
    } catch (error: any) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    let live = 0;
    for (const name of names) {
      const match = /^([1-9][0-9]*)-([a-f0-9-]{36})\.json$/.exec(name);
      if (!match) throw new Error("NATIVE_HOST_LEASE_INVALID");
      const file = path.join(dir, name),
        info = await lstat(file).catch((e: any) => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
      if (!info) continue;
      if (info.isSymbolicLink() || !info.isFile() || info.size > 1024)
        throw new Error("NATIVE_HOST_LEASE_INVALID");
      let value: any;
      try {
        value = JSON.parse(await readFile(file, "utf8"));
      } catch (e: any) {
        if (e.code === "ENOENT") continue;
        throw e;
      }
      if (
        value.protocol !== "copypaste.native-host-lease.v1" ||
        String(value.pid) !== match[1] ||
        value.instance !== match[2]
      )
        throw new Error("NATIVE_HOST_LEASE_INVALID");
      try {
        process.kill(value.pid, 0);
        live++;
      } catch (e: any) {
        if (e.code !== "ESRCH") throw e;
        await rm(file, { force: true });
      }
    }
    if (!live) return;
    if (Date.now() >= deadline) throw new Error("NATIVE_HOST_STILL_RUNNING");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
