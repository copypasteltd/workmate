import { spawn } from "node:child_process";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { canonical, hash, Problem } from "./lib.js";
import { validateSourcePath } from "./code-workspace.js";

export const cloudProgramInput = z
  .object({
    program: z.enum(["node", "node_test", "node_check"]),
    entry: z.string().min(1).max(500),
    args: z
      .array(
        z
          .string()
          .max(2000)
          .refine((v) => !v.includes("\0")),
      )
      .max(32)
      .default([]),
    timeout_ms: z.number().int().min(100).max(30000).default(15000),
  })
  .strict();
export type SourceManifest = { path: string; bytes: number; sha256: string }[];
export type ProgramSource = { path: string; bytes: Buffer };

const moduleFolder = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(
  moduleFolder,
  path.basename(path.dirname(moduleFolder)) === "dist" ? "../.." : "..",
);
const profilePath = path.join(
  packageRoot,
  "contracts/cloud-program-runtime.json",
);
const boundaryFolder = path.join(packageRoot, ".data/cloud-program-host");
const hostPath = path.join(boundaryFolder, "cloud-program-host.exe");
const reserved = (p: string) =>
  p
    .split("/")
    .some((v) => [".tmp", ".copypaste-runtime"].includes(v.toLowerCase()));

export function sourceManifest(files: ProgramSource[]): SourceManifest {
  if (!files.length || files.length > 500)
    throw new Problem(413, "SOURCE_LIMIT", "Provide 1–500 source files");
  const seen = new Set<string>();
  let total = 0;
  return files
    .map((f) => {
      const p = validateSourcePath(f.path).normalize("NFC");
      if (reserved(p) || seen.has(p.toLowerCase()))
        throw new Problem(
          400,
          "UNSAFE_CODE_PATH",
          "Source paths must be unique and outside runtime folders",
        );
      seen.add(p.toLowerCase());
      total += f.bytes.length;
      if (f.bytes.length > 1_000_000 || total > 20_000_000)
        throw new Problem(
          413,
          "SOURCE_LIMIT",
          "Source files exceed the workspace limit",
        );
      return { path: p, bytes: f.bytes.length, sha256: hash(f.bytes) };
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
}
export const sourceDigest = (files: SourceManifest) =>
  hash(
    canonical([...files].sort((a, b) => a.path.localeCompare(b.path, "en"))),
  );

async function checkedRuntime() {
  const profile = JSON.parse(await readFile(profilePath, "utf8"));
  if (
    profile.platform !== process.platform ||
    profile.architecture !== process.arch ||
    profile.node_version !== process.version ||
    hash(await readFile(process.execPath)) !== profile.node_sha256
  )
    throw new Problem(
      503,
      "CLOUD_PROGRAM_RUNTIME_UNAVAILABLE",
      "The exact approved native runtime is not installed",
    );
  const manifest = JSON.parse(
    await readFile(path.join(boundaryFolder, "manifest.json"), "utf8"),
  );
  if (
    manifest.boundary !== profile.boundary ||
    manifest.sha256 !== hash(await readFile(hostPath)) ||
    manifest.source_sha256 !==
      hash(await readFile(path.join(packageRoot, "src/cloud-program-host.cs")))
  )
    throw new Problem(
      503,
      "CLOUD_PROGRAM_BOUNDARY_UNAVAILABLE",
      "Build and verify the native execution boundary before running customer code",
    );
  return {
    profile,
    host_sha256: manifest.sha256,
    host_source_sha256: manifest.source_sha256,
  };
}

export async function cloudProgramAvailable() {
  try {
    await checkedRuntime();
    return true;
  } catch {
    return false;
  }
}

async function collect(work: string, bytes: boolean) {
  const files: ProgramSource[] = [],
    manifest: SourceManifest = [];
  let total = 0,
    entries = 0,
    fileCount = 0;
  const walk = async (dir: string, depth = 0) => {
    if (depth > 24) throw new Error("OUTPUT_DEPTH_LIMIT");
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (++entries > 1000) throw new Error("OUTPUT_FILE_LIMIT");
      const full = path.join(dir, e.name),
        p = path.relative(work, full).replaceAll("\\", "/");
      const info = await lstat(full);
      if (info.isSymbolicLink() || info.nlink > 1)
        throw new Error("OUTPUT_LINK_PROHIBITED");
      const internal = reserved(p);
      if (!internal) validateSourcePath(p);
      if (info.isDirectory()) await walk(full, depth + 1);
      else {
        if (
          !info.isFile() ||
          info.size > 4_000_000 ||
          (total += info.size) > 20_000_000 ||
          ++fileCount > 500
        )
          throw new Error("OUTPUT_SIZE_LIMIT");
        if (internal) continue;
        const data = bytes ? await readFile(full) : null;
        if (data && data.length !== info.size)
          throw new Error("OUTPUT_CHANGED");
        manifest.push({
          path: p,
          bytes: info.size,
          sha256: data ? hash(data) : "",
        });
        if (data) files.push({ path: p, bytes: data });
      }
    }
  };
  await walk(work);
  return {
    files,
    manifest: manifest.sort((a, b) => a.path.localeCompare(b.path, "en")),
  };
}

/** Customer code only runs in a fresh native AppContainer. No shell, ambient
 * environment, arbitrary executable, network capability or child process. */
export async function runCloudProgram(
  dataDir: string,
  input: z.input<typeof cloudProgramInput>,
  sources: ProgramSource[],
  signal?: AbortSignal,
) {
  const a = cloudProgramInput.parse(input),
    source_manifest = sourceManifest(sources);
  const entry = validateSourcePath(a.entry).normalize("NFC");
  if (
    !/\.(?:[cm]?js|[cm]?ts)$/i.test(entry) ||
    !source_manifest.some((f) => f.path === entry) ||
    (a.program !== "node" && a.args.length)
  )
    throw new Problem(
      400,
      "CLOUD_PROGRAM_INPUT_INVALID",
      "Choose an existing JavaScript/TypeScript entry; test and syntax checks do not accept program arguments",
    );
  signal?.throwIfAborted();
  const runtime = await checkedRuntime();
  const id = randomUUID(),
    root = path.resolve(dataDir, "cloud-programs", id),
    work = path.join(root, "work"),
    executable = path.join(root, "runtime/node.exe");
  await mkdir(work, { recursive: true });
  await mkdir(path.dirname(executable));
  await copyFile(process.execPath, executable);
  for (let i = 0; i < sources.length; i++) {
    const file = path.join(
      work,
      validateSourcePath(sources[i].path).normalize("NFC"),
    );
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, sources[i].bytes, { flag: "wx" });
  }
  const argv = [
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    "--experimental-strip-types",
  ];
  if (a.program === "node_test")
    argv.push("--test", "--experimental-test-isolation=none");
  if (a.program === "node_check") argv.push("--check");
  argv.push(entry, ...a.args);
  const start = new Date().toISOString();
  const child = spawn(
    hostPath,
    [
      root,
      executable,
      runtime.profile.node_sha256,
      String(a.timeout_ms),
      ...argv,
    ],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], shell: false },
  );
  const chunks: Buffer[] = [],
    errors: Buffer[] = [];
  let size = 0,
    stopped: string | null = null,
    scanning = false;
  const stop = (reason: string) => {
    if (!stopped) {
      stopped = reason;
      child.stdin.end("cancel\n");
    }
  };
  const read = (into: Buffer[]) => (b: Buffer) => {
    const left = Math.max(0, 131072 - size);
    if (left) into.push(b.subarray(0, left));
    size += b.length;
    if (size > 131072) stop("output_limit");
  };
  child.stdout.on("data", read(chunks));
  child.stderr.on("data", read(errors));
  child.stdin.on("error", () => {});
  const abort = () => stop("cancelled");
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) abort();
  const scan = setInterval(() => {
    if (scanning) return;
    scanning = true;
    void collect(work, false)
      .catch(() => stop("workspace_limit"))
      .finally(() => {
        scanning = false;
      });
  }, 200);
  const deadline = setTimeout(
    () => stop("host_deadline"),
    a.timeout_ms + 15000,
  );
  const force = setTimeout(() => {
    stop("host_unresponsive");
    child.kill();
  }, a.timeout_ms + 25000);
  let exit: number | null;
  try {
    exit = await new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", resolve);
    });
  } finally {
    clearInterval(scan);
    clearTimeout(deadline);
    clearTimeout(force);
    signal?.removeEventListener("abort", abort);
    child.stdin.end();
  }
  const wire = Buffer.concat(chunks).toString("utf8"),
    header = /^CPCLOUD1 (\d+)\r?\n/.exec(wire),
    stderr = Buffer.concat(errors).toString("utf8");
  const host = JSON.parse(
    await readFile(path.join(root, "host-receipt.json"), "utf8"),
  );
  if (
    !header ||
    host.process_id !== Number(header[1]) ||
    !host.resumed ||
    host.failure ||
    host.schema !== 1 ||
    host.no_network_capabilities !== true ||
    host.child_processes_prohibited !== true ||
    !host.profile_created ||
    !host.profile_deleted ||
    Number(host.exit_code) >>> 0 !== Number(exit) >>> 0
  )
    throw new Problem(
      503,
      "CLOUD_PROGRAM_RECEIPT_INVALID",
      "Execution or native cleanup could not be verified",
    );
  let output: Awaited<ReturnType<typeof collect>> = { files: [], manifest: [] };
  try {
    output = await collect(work, true);
  } catch {
    stopped ??= "workspace_limit";
  }
  const receipt = {
    schema: 1,
    execution_id: id,
    program: a.program,
    entry,
    args: a.args,
    timeout_ms: a.timeout_ms,
    started_at: start,
    finished_at: new Date().toISOString(),
    source_manifest,
    source_digest: sourceDigest(source_manifest),
    output_manifest: output.manifest,
    exit_code: exit,
    passed: exit === 0 && !host.timed_out && !host.cancelled && !stopped,
    stop_reason: stopped ?? (host.timed_out ? "timeout" : null),
    stdout: wire.slice(header[0].length),
    stderr,
    output_truncated: size > 131072,
    runtime: {
      id: runtime.profile.id,
      node_version: process.version,
      node_sha256: runtime.profile.node_sha256,
      host_sha256: runtime.host_sha256,
      host_source_sha256: runtime.host_source_sha256,
      boundary: runtime.profile.boundary,
    },
    host,
  };
  await writeFile(
    path.join(root, "receipt.json"),
    JSON.stringify(receipt, null, 2) + "\n",
    { flag: "wx" },
  );
  return { receipt, files: output.files };
}
