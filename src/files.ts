import path from "node:path";
import { constants } from "node:fs";
import {
  open,
  realpath,
  lstat,
  readdir,
  readFile,
  rename,
  mkdir,
} from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";

export interface Grant {
  id: string;
  root: string;
  label: string;
  operations: string[];
  expires_at: string;
}
export interface FileCommand {
  operation: "file.list" | "file.read" | "file.write";
  grant_id: string;
  path: string;
  content?: string;
  request_id: string;
  expires_at?: string;
}
export interface Journal {
  grants: Grant[];
  completed: Record<string, { digest: string; result: unknown }>;
}
const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const publicGrant = ({ root, ...g }: Grant) => g;
export function newGrant(root: string, write = false): Grant {
  return {
    id: randomUUID(),
    root,
    label: path.basename(root),
    operations: write
      ? ["file.list", "file.read", "file.write"]
      : ["file.list", "file.read"],
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  };
}
export async function resolveInGrant(
  root: string,
  relative: string,
  create = false,
) {
  if (
    typeof relative !== "string" ||
    relative.length > 1000 ||
    relative.includes("\0") ||
    relative.includes(":") ||
    path.isAbsolute(relative) ||
    relative.startsWith("\\") ||
    relative.split(/[\\/]/).some((p) => p === "..") ||
    (relative !== "." &&
      relative
        .split(/[\\/]/)
        .some(
          (p) =>
            /[. ]$/.test(p) ||
            /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
        ))
  )
    throw new Error("Unsafe relative path");
  const canonical = await realpath(root);
  const target = path.resolve(canonical, relative || ".");
  const within = (p: string) => {
    const r = path.relative(canonical, p);
    return !r.startsWith("..") && !path.isAbsolute(r);
  };
  if (!within(target)) throw new Error("Path leaves the selected folder");
  // Refuse every reparse/symbolic link below the grant, including junctions.
  let cursor = canonical;
  const parts = path
    .relative(canonical, target)
    .split(path.sep)
    .filter(Boolean);
  for (let i = 0; i < parts.length; i++) {
    cursor = path.join(cursor, parts[i]);
    try {
      const s = await lstat(cursor);
      if (s.isSymbolicLink()) throw new Error("Links are not allowed");
    } catch (e: any) {
      if (e.code === "ENOENT" && create && i === parts.length - 1) break;
      throw e;
    }
  }
  const check = await realpath(create ? path.dirname(target) : target);
  if (!within(check))
    throw new Error("Resolved path leaves the selected folder");
  return target;
}
export class LocalFiles {
  private pending = Promise.resolve();
  constructor(
    private load: () => Promise<Journal>,
    private save: (j: Journal) => Promise<void>,
    private exclusive?: <T>(fn: () => Promise<T>) => Promise<T>,
  ) {}
  async serial<T>(fn: () => Promise<T>): Promise<T> {
    const before = this.pending;
    let done!: () => void;
    this.pending = new Promise((r) => (done = r));
    await before;
    try {
      return this.exclusive ? await this.exclusive(fn) : await fn();
    } finally {
      done();
    }
  }
  async grants() {
    return (await this.load()).grants
      .filter((g) => Date.parse(g.expires_at) > Date.now())
      .map(publicGrant);
  }
  async grant(root: string, write = false) {
    return this.serial(async () => {
      const j = await this.load();
      j.grants = j.grants.filter((g) => Date.parse(g.expires_at) > Date.now());
      if (j.grants.length >= 20)
        throw new Error("Revoke an existing folder first");
      const g = newGrant(await realpath(root), write);
      j.grants.push(g);
      await this.save(j);
      return publicGrant(g);
    });
  }
  async revoke(id: string) {
    return this.serial(async () => {
      const j = await this.load();
      j.grants = j.grants.filter((g) => g.id !== id);
      await this.save(j);
    });
  }
  async revokeAll() {
    return this.serial(async () => {
      const j = await this.load();
      j.grants = [];
      j.completed = {};
      await this.save(j);
    });
  }
  async execute(command: FileCommand) {
    return this.serial(async () => {
      if (!/^[\w-]{16,100}$/.test(command.request_id))
        throw new Error("Invalid request identifier");
      if (
        command.expires_at &&
        (!Number.isFinite(Date.parse(command.expires_at)) ||
          Date.parse(command.expires_at) <= Date.now())
      )
        throw new Error("Command expired");
      const j = await this.load(),
        g = j.grants.find(
          (g) =>
            g.id === command.grant_id && Date.parse(g.expires_at) > Date.now(),
        );
      if (!g || !g.operations.includes(command.operation))
        throw new Error("Folder permission expired, revoked or denied");
      const d = digest(command),
        previous = j.completed[command.request_id];
      if (previous) {
        if (previous.digest !== d)
          throw new Error("Request identifier reused with different input");
        return previous.result;
      }
      const target = await resolveInGrant(
        g.root,
        command.path,
        command.operation === "file.write",
      );
      let result: unknown;
      if (command.operation === "file.list") {
        const entries = await readdir(target, { withFileTypes: true });
        result = {
          items: entries
            .filter((e) => !e.isSymbolicLink())
            .slice(0, 500)
            .map((e) => ({
              name: e.name,
              type: e.isDirectory() ? "directory" : "file",
            })),
          truncated: entries.length > 500,
        };
      } else if (command.operation === "file.read") {
        const f = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
          const stat = await f.stat();
          if (!stat.isFile() || stat.size > 5_000_000)
            throw new Error("Choose a regular file smaller than 5 MB");
          const bytes = await f.readFile();
          result = {
            name: path.basename(target),
            base64: bytes.toString("base64"),
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
        } finally {
          await f.close();
        }
      } else if (command.operation === "file.write") {
        if (
          typeof command.content !== "string" ||
          Buffer.byteLength(command.content) > 2_000_000
        )
          throw new Error("Text output must be smaller than 2 MB");
        // Create only. Existing user files are never overwritten by a cloud command.
        const f = await open(target, "wx", 0o600);
        try {
          await f.writeFile(command.content);
          await f.sync();
        } finally {
          await f.close();
        }
        result = {
          name: path.basename(target),
          created: true,
          bytes: Buffer.byteLength(command.content),
        };
      } else throw new Error("Unsupported local operation");
      j.completed[command.request_id] = { digest: d, result };
      const ids = Object.keys(j.completed);
      for (const id of ids.slice(0, Math.max(0, ids.length - 2000)))
        delete j.completed[id];
      // Bound retained read payloads as well as record count.
      for (const id of Object.keys(j.completed)) {
        if (Buffer.byteLength(JSON.stringify(j.completed)) <= 16_000_000) break;
        delete j.completed[id];
      }
      await this.save(j);
      return result;
    });
  }
}
export async function atomicFile(filename: string, bytes: Buffer) {
  await mkdir(path.dirname(filename), { recursive: true });
  const temp = filename + "." + randomUUID() + ".tmp";
  await (
    await import("node:fs/promises")
  ).writeFile(temp, bytes, { mode: 0o600 });
  await rename(temp, filename);
}
