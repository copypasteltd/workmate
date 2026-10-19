import {
  mkdir,
  readFile,
  readdir,
  realpath,
  lstat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { zipSync } from "fflate";
import { hash, Problem } from "./lib.js";
export function validateSourcePath(relative: string) {
  if (
    !relative ||
    relative.length > 500 ||
    relative.includes(":") ||
    relative.includes("\0") ||
    relative
      .split(/[\\/]/)
      .some(
        (p) =>
          !p ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(p),
      ) ||
    path.isAbsolute(relative) ||
    relative
      .split(/[\\/]/)
      .some((p) =>
        ["..", ".git", ".codex", ".agents", "node_modules"].includes(p),
      ) ||
    relative
      .split(/[\\/]/)
      .some((p) => p.startsWith(".env") && p !== ".env.example")
  )
    throw new Problem(
      400,
      "UNSAFE_CODE_PATH",
      "Choose a relative source path inside this task workspace",
    );
  return relative.replaceAll("\\", "/");
}
export class CodeWorkspace {
  constructor(private root: string) {}
  private async file(relative: string) {
    relative = validateSourcePath(relative);
    await mkdir(this.root, { recursive: true });
    const root = await realpath(this.root),
      file = path.resolve(root, relative);
    const r = path.relative(root, file);
    if (r.startsWith("..") || path.isAbsolute(r))
      throw new Error("Code path escaped the task workspace");
    let cursor = root;
    for (const p of r.split(path.sep)) {
      cursor = path.join(cursor, p);
      try {
        if ((await lstat(cursor)).isSymbolicLink())
          throw new Error("Links are not allowed in source workspaces");
      } catch (e: any) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    return file;
  }
  async read(relative: string) {
    const file = await this.file(relative),
      bytes = await readFile(file);
    if (bytes.length > 1_000_000) throw new Error("Source file exceeds 1 MB");
    return {
      path: relative,
      content: bytes.toString("utf8"),
      sha256: hash(bytes),
    };
  }
  async write(relative: string, content: string, expected?: string) {
    const file = await this.file(relative);
    if (Buffer.byteLength(content) > 1_000_000)
      throw new Error("Source file exceeds 1 MB");
    let prior: Buffer | undefined;
    try {
      prior = await readFile(file);
    } catch (e: any) {
      if (e.code !== "ENOENT") throw e;
    }
    if (prior && (!expected || hash(prior) !== expected))
      throw new Problem(
        409,
        "CODE_VERSION_CONFLICT",
        "Read the current file and supply its exact hash before editing",
      );
    if (!prior && expected)
      throw new Problem(
        409,
        "CODE_VERSION_CONFLICT",
        "Source file no longer exists",
      );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, content, { flag: prior ? "w" : "wx" });
    return {
      path: relative,
      bytes: Buffer.byteLength(content),
      sha256: hash(content),
    };
  }
  async list() {
    await mkdir(this.root, { recursive: true });
    const files: { path: string; sha256: string; bytes: number }[] = [];
    let total = 0;
    const walk = async (dir: string) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (e.isSymbolicLink()) throw new Error("Source contains a link");
        const file = path.join(dir, e.name);
        if (e.isDirectory()) await walk(file);
        else {
          const b = await readFile(file);
          total += b.length;
          if (files.length >= 500 || total > 20_000_000)
            throw new Error("Source package exceeds 500 files or 20 MB");
          files.push({
            path: path.relative(this.root, file).replaceAll("\\", "/"),
            sha256: hash(b),
            bytes: b.length,
          });
        }
      }
    };
    await walk(this.root);
    return files;
  }
  async bundle() {
    const files = await this.list();
    if (!files.length) throw new Error("Write source files before packaging");
    const data: Record<string, Uint8Array> = {};
    for (const f of files)
      data[f.path] = await readFile(await this.file(f.path));
    data["copypaste-manifest.json"] = Buffer.from(
      JSON.stringify(
        {
          files,
          execution_validation: "not_executed",
          note: "Source is packaged. Run the project checks in an authorized native test environment.",
        },
        null,
        2,
      ),
    );
    return { bytes: Buffer.from(zipSync(data, { level: 6 })), files };
  }
}
