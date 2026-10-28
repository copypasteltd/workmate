import { open, rename, lstat, realpath, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { check } from "./protocol.mjs";

export class NodeJournal {
  constructor(directory) { this.directory = directory; }
  async initialize() {
    check(process.platform === "linux" && process.getuid?.() === 0, "ROOT_NATIVE_LINUX_HOST_REQUIRED");
    check(path.isAbsolute(this.directory) && this.directory !== "/", "NODE_STATE_PATH_INVALID");
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(this.directory);
    check(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0 && await realpath(this.directory) === this.directory, "NODE_STATE_PERMISSION_INVALID");
    // The CLI runs under native flock --no-fork. Its kernel lock is released
    // automatically on crashes; a stale PID file is never used as authority.
    return this.load();
  }
  async load() {
    const file = path.join(this.directory, "state.json");
    try {
      const stat = await lstat(file); check(stat.isFile() && !stat.isSymbolicLink() && stat.uid === 0 && (stat.mode & 0o077) === 0, "NODE_STATE_FILE_INVALID");
      check(stat.size <= 64_000_000, "NODE_STATE_TOO_LARGE");
      const value = JSON.parse(await readFile(file, "utf8")); check(value?.format === 1 && Array.isArray(value.commands), "NODE_STATE_FORMAT_INVALID"); return value;
    } catch (error) { if (error.code !== "ENOENT") throw error; return { format: 1, current: null, commands: [] }; }
  }
  async save(value) {
    check(Buffer.byteLength(JSON.stringify(value)) <= 64_000_000, "NODE_STATE_TOO_LARGE");
    const temporary = path.join(this.directory, "state-" + randomUUID() + ".tmp"), handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); } finally { await handle.close(); }
    await rename(temporary, path.join(this.directory, "state.json"));
    const directory = await open(this.directory, "r"); try { await directory.sync(); } finally { await directory.close(); }
  }
  async close() {}
}
