import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

const exec = promisify(execFile);
export async function sha256(file) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}

export async function directoryFiles(root, relative = "") {
  const files = [];
  for (const entry of await readdir(path.join(root, relative), {
    withFileTypes: true,
  })) {
    const next = path.posix.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...(await directoryFiles(root, next)));
    else if (entry.isFile()) files.push(next);
    else throw new Error("Unexpected non-file artifact: " + next);
  }
  return files.sort();
}

async function manifest(root, files) {
  const result = [];
  for (const file of [...files].sort())
    result.push({ path: file, sha256: await sha256(path.join(root, file)) });
  return result;
}

async function runtimeSources(root) {
  const { stdout } = await exec(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    {
      cwd: root,
      windowsHide: true,
    },
  );
  // Documentation/screenshots do not affect a running client. Include all other
  // tracked and new inputs, including icons, fonts, config, locks and renderer
  // snapshots. Staging a source file must not change the captured file set.
  const files = [...new Set(stdout.split("\0"))].filter(
    (file) =>
      file &&
      !/^README(?:\.[\w-]+)?\.md$/.test(file) &&
      !file.startsWith("assets/screenshots/") &&
      !file.startsWith("docs/"),
  );
  return manifest(root, files);
}

export async function captureNativeSurfaces({
  desktop,
  extension,
  executable,
  packaged,
}) {
  const executablePath = path.resolve(executable);
  const runtimeRoot = packaged ? path.dirname(executablePath) : desktop;
  const runtimeFiles = packaged
    ? await directoryFiles(runtimeRoot)
    : [
        ...(await directoryFiles(path.join(desktop, "dist"))).map(
          (f) => "dist/" + f,
        ),
        ...(await directoryFiles(path.join(desktop, "renderer-dist"))).map(
          (f) => "renderer-dist/" + f,
        ),
      ];
  return {
    schema_version: 1,
    desktop: {
      executable_kind: packaged ? "packaged" : "source",
      executable_sha256: await sha256(executablePath),
      runtime_files: await manifest(runtimeRoot, runtimeFiles),
      source_files: await runtimeSources(desktop),
      installer_files: packaged
        ? await manifest(path.dirname(runtimeRoot), [
            "CopyPaste-0.5.0-x64-Setup.exe",
            "CopyPaste-0.5.0-x64-Portable.exe",
          ])
        : [],
    },
    extension: {
      source_files: await runtimeSources(extension),
      dist_files: await manifest(
        path.join(extension, "dist"),
        await directoryFiles(path.join(extension, "dist")),
      ),
    },
    verifier_sha256: await sha256(
      new URL("./qa-marketing-connector-native.ts", import.meta.url),
    ),
    integrity_checker_sha256: await sha256(
      new URL("./native-surface-integrity-connectors.mjs", import.meta.url),
    ),
  };
}
