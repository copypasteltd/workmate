import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { hash, Problem } from "./lib.js";

const moduleFolder = path.dirname(fileURLToPath(import.meta.url));
export const browserPackageRoot = path.resolve(
  moduleFolder,
  path.basename(path.dirname(moduleFolder)) === "dist" ? "../.." : "..",
);
const folder = path.join(browserPackageRoot, ".data/cloud-browser-host");
const contract = path.join(
  browserPackageRoot,
  "contracts/cloud-browser-runtime.json",
);
let cached: { value: any; stats: Map<string, string> } | undefined;
let checking: Promise<any> | undefined;
async function inspect() {
  const profileBytes = await readFile(contract),
    profile = JSON.parse(profileBytes.toString("utf8"));
  if (
    process.platform !== profile.platform ||
    process.arch !== profile.architecture
  )
    throw new Error("PLATFORM");
  const manifestPath = path.join(folder, "manifest.json"),
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const host = path.join(folder, "cloud-browser-host.exe"),
    source = path.join(browserPackageRoot, "src/cloud-browser-host.cs"),
    browser = path.join(folder, "chromium");
  const version = JSON.parse(
    await readFile(
      path.join(
        browserPackageRoot,
        "node_modules/playwright-core/package.json",
      ),
      "utf8",
    ),
  ).version;
  if (
    version !== profile.playwright_version ||
    manifest.boundary !== profile.boundary ||
    manifest.profile_sha256 !== hash(profileBytes) ||
    manifest.host_sha256 !== hash(await readFile(host)) ||
    manifest.host_source_sha256 !== hash(await readFile(source))
  )
    throw new Error("CONTRACT");
  if (cached?.value.manifest.profile_sha256 !== manifest.profile_sha256)
    cached = undefined;
  const stats = new Map<string, string>();
  async function safeAncestors(full: string) {
    for (let current = full; ; current = path.dirname(current)) {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("REPARSE_PATH");
      if (path.dirname(current) === current) break;
    }
  }
  await safeAncestors(folder);
  await safeAncestors(browser);
  const actual: string[] = [];
  async function walk(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name),
        st = await lstat(full);
      if (st.isSymbolicLink()) throw new Error("REPARSE_PATH");
      if (st.isDirectory()) await walk(full);
      else {
        if (!st.isFile() || st.nlink !== 1) throw new Error("BROWSER_FILE");
        const key = path.relative(browser, full).replaceAll("\\", "/"),
          expected = profile.files.find((f: any) => f.path === key);
        if (!expected || st.size !== expected.bytes)
          throw new Error("BROWSER_FILE");
        const stamp = `${st.ino}:${st.size}:${st.mtimeMs}:${st.ctimeMs}`;
        if (!cached || cached.stats.get(full) !== stamp)
          if (hash(await readFile(full)) !== expected.sha256)
            throw new Error("BROWSER_HASH");
        stats.set(full, stamp);
        actual.push(key);
      }
    }
  }
  await walk(browser);
  if (actual.length !== profile.files.length)
    throw new Error("BROWSER_FILES_MISSING");
  const value = {
    profile,
    manifest,
    host,
    binary: path.join(browser, profile.executable),
    binary_sha256: profile.files.find((f: any) => f.path === profile.executable)
      .sha256,
  };
  cached = { value, stats };
  return value;
}
export async function checkedCloudBrowserRuntime() {
  try {
    return await (checking ??= inspect().finally(() => {
      checking = undefined;
    }));
  } catch {
    cached = undefined;
    throw new Problem(
      503,
      "CLOUD_BROWSER_RUNTIME_UNAVAILABLE",
      "Install and verify the approved native browser runtime before previewing customer pages",
    );
  }
}
export async function cloudBrowserAvailable() {
  try {
    await checkedCloudBrowserRuntime();
    return true;
  } catch {
    return false;
  }
}
export async function inspectCloudBrowserJob(root: string) {
  const id = path.basename(root);
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id))
    throw new Error("BROWSER_JOB_ROOT");
  const runtime = await checkedCloudBrowserRuntime();
  const raw = await promisify(execFile)(
    runtime.host,
    ["--inspect-job", path.resolve(root)],
    {
      windowsHide: true,
      timeout: 5000,
      env: { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" },
    },
  );
  const value = JSON.parse(raw.stdout);
  if (
    value.schema !== 1 ||
    value.job_name !== "Local\\CopyPasteBrowser-" + id ||
    typeof value.job_exists !== "boolean" ||
    typeof value.job_empty !== "boolean" ||
    !Array.isArray(value.processes) ||
    value.job_empty !== (value.processes.length === 0)
  )
    throw new Error("BROWSER_JOB_INSPECTION_INVALID");
  return value as {
    schema: 1;
    job_name: string;
    job_exists: boolean;
    job_empty: boolean;
    processes: any[];
  };
}
