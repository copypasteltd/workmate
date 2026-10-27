// Copy an explicitly supplied, exact approved native browser; never install a VM.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
const root = path.resolve(import.meta.dirname, "..");
const profile = JSON.parse(
  await readFile(
    path.join(root, "contracts/cloud-browser-runtime.json"),
    "utf8",
  ),
);
assert.equal(process.platform, profile.platform);
assert.equal(process.arch, profile.architecture);
const folder = path.join(root, ".data/cloud-browser-host");
const browser = path.join(folder, "chromium");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function verify(directory) {
  const actual = [];
  async function walk(current) {
    assert.equal((await lstat(current)).isSymbolicLink(), false);
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name),
        info = await lstat(full);
      assert.equal(info.isSymbolicLink(), false);
      if (info.isDirectory()) await walk(full);
      else {
        assert.ok(info.isFile() && info.nlink === 1);
        actual.push({
          path: path.relative(directory, full).replaceAll("\\", "/"),
          bytes: info.size,
          sha256: hash(await readFile(full)),
        });
      }
    }
  }
  await walk(directory);
  actual.sort((a, b) => a.path.localeCompare(b.path, "en"));
  assert.deepEqual(
    actual,
    profile.files,
    "Browser bytes must match the reviewed runtime contract",
  );
}
assert.ok(
  process.argv.length === 2 ||
    (process.argv.length === 4 && process.argv[2] === "--source") ||
    (process.argv.length === 3 && process.argv[2] === "--download"),
);
let supplied = process.argv[3] ? path.resolve(process.argv[3]) : undefined;
if (process.argv[2] === "--download") {
  const downloads = path.join(root, ".data/cloud-browser-downloads"),
    temp = path.join(root, ".data/cloud-browser-download-temp");
  await mkdir(temp, { recursive: true });
  await promisify(execFile)(
    process.execPath,
    [
      path.join(root, "node_modules/playwright-core/cli.js"),
      "install",
      "chromium",
      "--no-shell",
    ],
    {
      cwd: root,
      windowsHide: true,
      timeout: 1200000,
      maxBuffer: 4 * 1024 * 1024,
      env: {
        ...process.env,
        PLAYWRIGHT_BROWSERS_PATH: downloads,
        TEMP: temp,
        TMP: temp,
      },
    },
  );
  supplied = path.join(
    downloads,
    "chromium-" + profile.revision,
    "chrome-win64",
  );
}
if (supplied) {
  assert.notEqual(supplied.toLowerCase(), browser.toLowerCase());
  await verify(supplied);
  await mkdir(folder, { recursive: true });
  // Refuse overwriting an existing runtime. An explicit removal/review is needed
  // for a runtime update, rather than silently trusting new browser bytes.
  await assert.rejects(lstat(browser), (e) => e.code === "ENOENT");
  await cp(supplied, browser, {
    recursive: true,
    errorOnExist: true,
    force: false,
  });
}
await verify(browser);
await mkdir(folder, { recursive: true });
const source = path.join(root, "src/cloud-browser-host.cs");
const exe = path.join(folder, "cloud-browser-host.exe");
let rebuild = true;
try {
  const old = JSON.parse(
    await readFile(path.join(folder, "manifest.json"), "utf8"),
  );
  rebuild =
    old.host_source_sha256 !== hash(await readFile(source)) ||
    old.host_sha256 !== hash(await readFile(exe)) ||
    old.profile_sha256 !==
      hash(
        await readFile(path.join(root, "contracts/cloud-browser-runtime.json")),
      );
} catch {}
if (rebuild)
  await promisify(execFile)(
    path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "Microsoft.NET/Framework64/v4.0.30319/csc.exe",
    ),
    [
      "/nologo",
      "/target:exe",
      "/platform:x64",
      "/optimize+",
      "/reference:System.Web.Extensions.dll",
      "/out:" + exe,
      source,
    ],
    { windowsHide: true, timeout: 30000 },
  );
await writeFile(
  path.join(folder, "manifest.json"),
  JSON.stringify(
    {
      schema: 1,
      boundary: profile.boundary,
      profile_sha256: hash(
        await readFile(path.join(root, "contracts/cloud-browser-runtime.json")),
      ),
      host_source_sha256: hash(await readFile(source)),
      host_sha256: hash(await readFile(exe)),
      browser_version: profile.browser_version,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    status: "verified",
    profile: profile.id,
    files: profile.files.length,
    host: exe,
  }),
);
