import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import {
  mkdir,
  readFile,
  writeFile,
  lstat,
  symlink,
  rm,
  readdir,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { LocalVault } from "../src/vault.js";
import { newGrant } from "../src/files.js";
import { exclusive } from "../src/lock.js";
import {
  markRemoved,
  removalMarked,
  clearRemovalMarker,
  removeOwnedUpdateCache,
} from "../src/removal-fence.js";
import {
  registerNativeHostLease,
  waitNativeHosts,
  pauseNativeHosts,
  resumeNativeHosts,
  assertNativeHostEnabled,
} from "../src/native-host-lifecycle.js";
import { chromeRegistration } from "../src/chrome-registration.js";
const base = path.resolve(".data/removal-native-tests");
async function fixture() {
  const root = path.join(base, randomUUID());
  assert.equal(path.dirname(root), base);
  await mkdir(root, { recursive: true });
  return {
    root,
    async close() {
      assert.equal(path.dirname(root), base);
      await rm(root, { recursive: true, force: true });
    },
  };
}

test("real HKCU removal uses exact manifest ownership and retains another installation's registration under a shared mutex", async () => {
  const f = await fixture(),
    key = "Software\\CopyPaste\\Tests\\" + randomUUID(),
    a = path.join(f.root, "a.json"),
    b = path.join(f.root, "b.json");
  try {
    assert.equal(await chromeRegistration("register", a, key), "registered");
    assert.equal(await chromeRegistration("remove", b, key), "foreign");
    assert.equal(await chromeRegistration("inspect", a, key), "registered");
    const launcher = path.join(f.root, "resources/native-host.cmd");
    await writeFile(
      a,
      JSON.stringify({
        name: "hk.copypaste.agent",
        type: "stdio",
        path: launcher,
      }),
    );
    assert.equal(
      await chromeRegistration(
        "remove",
        a,
        key,
        path.join(f.root, "other-install/native-host.cmd"),
      ),
      "foreign",
    );
    assert.equal(await chromeRegistration("inspect", a, key), "registered");
    assert.equal(
      await chromeRegistration("remove", a.toUpperCase(), key, launcher),
      "removed",
    );
    assert.equal(await chromeRegistration("remove", a, key), "absent");
  } finally {
    assert.match(key, /^Software\\CopyPaste\\Tests\\[a-f0-9-]{36}$/);
    try {
      execFileSync("reg.exe", ["DELETE", "HKCU\\" + key, "/f"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {}
    await f.close();
  }
});
test("cache cleanup refuses root and cache junctions, keeps originals and receipts, and never follows a descendant junction", async () => {
  const f = await fixture(),
    outside = await fixture();
  try {
    await writeFile(
      path.join(outside.root, "customer.txt"),
      "customer original",
    );
    await writeFile(
      path.join(f.root, "local-agent.enc"),
      "retained unsettled receipt",
    );
    await symlink(outside.root, path.join(f.root, "update-cache"), "junction");
    await assert.rejects(removeOwnedUpdateCache(f.root), /CACHE_ROOT_INVALID/);
    assert.equal(
      await readFile(path.join(outside.root, "customer.txt"), "utf8"),
      "customer original",
    );
    await rm(path.join(f.root, "update-cache"));
    await mkdir(path.join(f.root, "update-cache"));
    await writeFile(
      path.join(f.root, "update-cache", "installer.exe"),
      "inert cache bytes",
    );
    await symlink(
      outside.root,
      path.join(f.root, "update-cache", "nested"),
      "junction",
    );
    await removeOwnedUpdateCache(f.root);
    assert.equal(
      await readFile(path.join(outside.root, "customer.txt"), "utf8"),
      "customer original",
    );
    assert.equal(
      await readFile(path.join(f.root, "local-agent.enc"), "utf8"),
      "retained unsettled receipt",
    );
    await assert.rejects(lstat(path.join(f.root, "update-cache")), {
      code: "ENOENT",
    });
    await symlink(outside.root, path.join(f.root, "linked-root"), "junction");
    await assert.rejects(
      removeOwnedUpdateCache(path.join(f.root, "linked-root")),
      /CACHE_ROOT_INVALID/,
    );
  } finally {
    await f.close();
    await outside.close();
  }
});
test("removal markers fail closed, owned Host leases are awaited without killing processes, and pause preserves permission journals", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "folders.enc"), "preserved journal");
    const release = await registerNativeHostLease(f.root);
    await assert.rejects(
      waitNativeHosts(f.root, 50),
      /NATIVE_HOST_STILL_RUNNING/,
    );
    process.kill(process.pid, 0);
    await release();
    await waitNativeHosts(f.root);
    await pauseNativeHosts(f.root);
    await assert.rejects(
      assertNativeHostEnabled(f.root),
      /DESKTOP_DISCONNECTED/,
    );
    await resumeNativeHosts(f.root);
    await assertNativeHostEnabled(f.root);
    assert.equal(
      await readFile(path.join(f.root, "folders.enc"), "utf8"),
      "preserved journal",
    );
    await markRemoved(f.root);
    assert.equal(await removalMarked(f.root), true);
    await assert.rejects(
      registerNativeHostLease(f.root),
      /DESKTOP_DISCONNECTED/,
    );
    await clearRemovalMarker(f.root);
    await assertNativeHostEnabled(f.root);
  } finally {
    await f.close();
  }
});
test("the actual bundled Native Host reads an explicit folder then exits on removal, closes its lease and refuses re-entry", async () => {
  const f = await fixture(),
    workspace = await fixture(),
    origin = "chrome-extension://" + "a".repeat(32) + "/",
    vault = new LocalVault(f.root),
    grant = newGrant(workspace.root);
  let child: ReturnType<typeof spawn> | undefined;
  try {
    await writeFile(
      path.join(workspace.root, "brief.txt"),
      "synthetic customer original",
    );
    for (const [name, value] of [
      ["extensions", [origin]],
      ["folders", { grants: [grant], completed: {} }],
    ])
      await writeFile(
        path.join(f.root, name + ".enc"),
        await vault.encrypt(JSON.stringify(value)),
      );
    const wire = Buffer.from(
        JSON.stringify({
          operation: "file.read",
          grant_id: grant.id,
          path: "brief.txt",
          request_id: randomUUID(),
        }),
      ),
      header = Buffer.alloc(4);
    header.writeUInt32LE(wire.length);
    child = spawn(process.execPath, ["dist/native-host.cjs", origin], {
      env: { ...process.env, COPYPASTE_USER_DATA: f.root },
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = Buffer.alloc(0),
      stderr = "";
    child.stderr!.on("data", (b) => (stderr += b.toString()));
    const closed = new Promise<number | null>((resolve) =>
      child!.once("close", resolve),
    );
    const received = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Host response timeout " + stderr)),
        45000,
      );
      child!.stdout!.on("data", (b) => {
        output = Buffer.concat([output, b]);
        if (output.length >= 4 && output.length >= 4 + output.readUInt32LE(0)) {
          clearTimeout(timer);
          resolve(
            JSON.parse(
              output.subarray(4, 4 + output.readUInt32LE(0)).toString(),
            ),
          );
        }
      });
    });
    child.stdin!.write(Buffer.concat([header, wire]));
    const result = await received;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(
      Buffer.from(result.data.base64, "base64").toString(),
      "synthetic customer original",
    );
    await exclusive(f.root, () => markRemoved(f.root));
    await waitNativeHosts(f.root);
    assert.equal(await closed, 0, stderr);
    assert.deepEqual(await readdir(path.join(f.root, "native-hosts")), []);
    const restarted = spawn(
      process.execPath,
      ["dist/native-host.cjs", origin],
      {
        env: { ...process.env, COPYPASTE_USER_DATA: f.root },
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    let error = "";
    restarted.stderr!.on("data", (b) => (error += b.toString()));
    assert.equal(
      await new Promise((resolve) => restarted.once("close", resolve)),
      1,
    );
    assert.match(error, /DESKTOP_DISCONNECTED/);
    assert.equal(
      await readFile(path.join(workspace.root, "brief.txt"), "utf8"),
      "synthetic customer original",
    );
    // Pending credentials use actual DPAPI-wrapped encryption, never plaintext.
    const encrypted = await vault.encrypt(
      JSON.stringify({ refresh_token: "synthetic-withdrawal-credential" }),
    );
    assert.ok(
      !encrypted.includes(Buffer.from("synthetic-withdrawal-credential")),
    );
    assert.equal(
      JSON.parse(await vault.decrypt(encrypted)).refresh_token,
      "synthetic-withdrawal-credential",
    );
  } finally {
    if (child && child.exitCode === null) {
      child.kill();
      await new Promise((resolve) => child!.once("close", resolve));
    }
    await f.close();
    await workspace.close();
  }
});
