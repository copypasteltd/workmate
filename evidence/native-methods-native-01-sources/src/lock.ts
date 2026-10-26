import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
export async function exclusive<T>(
  root: string,
  fn: () => Promise<T>,
): Promise<T> {
  const parent = path.resolve(root),
    lock = path.join(parent, "folders.lock");
  await mkdir(parent, { recursive: true });
  let held = false;
  for (let n = 0; n < 100; n++) {
    try {
      await mkdir(lock);
      held = true;
      await writeFile(path.join(lock, "owner"), String(process.pid));
      break;
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
      let pid = Number(
        await readFile(path.join(lock, "owner"), "utf8").catch(() => ""),
      );
      if (pid > 0) {
        try {
          process.kill(pid, 0);
        } catch (e: any) {
          if (e.code === "ESRCH" && path.dirname(lock) === parent)
            await rm(lock, { recursive: true, force: true });
        }
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  if (!held) throw new Error("Another local file operation is still running");
  try {
    return await fn();
  } finally {
    if (path.dirname(lock) !== parent) throw new Error("Invalid lock path");
    await rm(lock, { recursive: true, force: true });
  }
}
