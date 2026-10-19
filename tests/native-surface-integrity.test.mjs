import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import {
  captureNativeSurfaces,
  assertTestedSurfaces,
} from "../scripts/native-surface-integrity.mjs";

test("native preview admission binds a green report to the actual runtime, installers and extension bytes", async (t) => {
  await mkdir(".data", { recursive: true });
  const fixture = await mkdtemp(path.resolve(".data/native-integrity-"));
  assert.equal(path.dirname(fixture), path.resolve(".data"));
  try {
    const desktop = path.join(fixture, "desktop"),
      extension = path.join(fixture, "extension");
    async function put(root, file, bytes) {
      const target = path.join(root, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    for (const repo of [desktop, extension]) {
      await mkdir(repo);
      execFileSync("git", ["init", "--quiet"], {
        cwd: repo,
        windowsHide: true,
      });
      await put(repo, "src/main.ts", "original source");
      await put(repo, "README.md", "documentation");
      execFileSync("git", ["add", "src/main.ts", "README.md"], {
        cwd: repo,
        windowsHide: true,
      });
    }
    const runtime = "release/frameless/win-unpacked/";
    await put(desktop, runtime + "CopyPaste.exe", "fixture executable");
    await put(desktop, runtime + "resources/app.asar", "fixture application");
    await put(
      desktop,
      runtime + "resources/native-host.cjs",
      "fixture native host",
    );
    for (const kind of ["Setup", "Portable"])
      await put(
        desktop,
        `release/frameless/CopyPaste-0.5.0-x64-${kind}.exe`,
        kind,
      );
    await put(extension, "dist/manifest.json", "fixture manifest");
    await put(extension, "dist/background.js", "fixture worker");
    const options = {
      desktop,
      extension,
      executable: path.join(desktop, runtime + "CopyPaste.exe"),
      packaged: true,
    };
    const snapshot = await captureNativeSurfaces(options);
    const report = {
      inspection: { desktop: { executable_kind: "packaged" } },
      checks: Array.from({ length: 10 }, () => ({ status: "passed" })),
      errors: [],
      desktop_closed: true,
      browser_closed: true,
      extension_closed: true,
      artifacts_unchanged_after_run: true,
      tested_artifacts: snapshot,
    };
    assertTestedSurfaces(report, await captureNativeSurfaces(options));
    await t.test("reject a legacy green report without a byte binding", () => {
      const { tested_artifacts, ...legacy } = report;
      assert.throws(() => assertTestedSurfaces(legacy, snapshot));
    });
    for (const [root, file, original] of [
      [desktop, runtime + "resources/app.asar", "fixture application"],
      [desktop, runtime + "resources/native-host.cjs", "fixture native host"],
      [desktop, runtime + "CopyPaste.exe", "fixture executable"],
      [desktop, "release/frameless/CopyPaste-0.5.0-x64-Setup.exe", "Setup"],
      [extension, "dist/background.js", "fixture worker"],
      [desktop, "src/main.ts", "original source"],
    ]) {
      await t.test("reject changed bytes: " + file, async () => {
        await put(root, file, "changed after QA");
        const changed = await captureNativeSurfaces(options);
        assert.throws(
          () => assertTestedSurfaces(report, changed),
          /bytes differ/,
        );
        await put(root, file, original);
      });
    }
    await t.test("reject added or missing extension files", async () => {
      await put(extension, "dist/extra.js", "unexpected runtime");
      const added = await captureNativeSurfaces(options);
      assert.throws(() => assertTestedSurfaces(report, added), /bytes differ/);
      await rm(path.join(extension, "dist/extra.js"));
      await rm(path.join(extension, "dist/background.js"));
      const removed = await captureNativeSurfaces(options);
      assert.throws(
        () => assertTestedSurfaces(report, removed),
        /bytes differ/,
      );
      await put(extension, "dist/background.js", "fixture worker");
    });
    await t.test("reject incomplete cleanup and failures", () => {
      assert.throws(() =>
        assertTestedSurfaces({ ...report, extension_closed: false }, snapshot),
      );
      assert.throws(() =>
        assertTestedSurfaces(
          { ...report, errors: ["owned process not closed"] },
          snapshot,
        ),
      );
      assert.throws(() =>
        assertTestedSurfaces(
          { ...report, artifacts_unchanged_after_run: false },
          snapshot,
        ),
      );
    });
    await t.test(
      "allow documentation changes when all runtime bytes remain identical",
      async () => {
        await put(desktop, "README.md", "updated verified instructions");
        assertTestedSurfaces(report, await captureNativeSurfaces(options));
      },
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
