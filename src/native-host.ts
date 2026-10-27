import { spawn, type ChildProcess } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LocalFiles, atomicFile, type Journal } from "./files.js";
import { LocalVault } from "./vault.js";
import { exclusive } from "./lock.js";
import { assertNativeHostEnabled, nativeHostDisabled, registerNativeHostLease } from "./native-host-lifecycle.js";

const root = path.resolve(
  process.env.COPYPASTE_USER_DATA ??
    path.join(process.env.APPDATA ?? "", "CopyPaste"),
);
const origin = process.argv.find((a) =>
  /^chrome-extension:\/\/[a-p]{32}\/$/.test(a),
);
const vault = new LocalVault(root);
const dialogs = new Set<ChildProcess>();
let stopping = false;
async function load<T>(key: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(
      await vault.decrypt(await readFile(path.join(root, key + ".enc"))),
    );
  } catch (e: any) {
    if (e.code === "ENOENT") return fallback;
    throw new Error("Local authorization could not be decrypted");
  }
}
const save = async (key: string, value: unknown) =>
  atomicFile(
    path.join(root, key + ".enc"),
    await vault.encrypt(JSON.stringify(value)),
  );
const files = new LocalFiles(
  () => load<Journal>("folders", { grants: [], completed: {} }),
  (j) => save("folders", j),
  (fn) => exclusive(root, async () => { await assertNativeHostEnabled(root); return fn(); }),
);
async function choose() {
  const script =
    "$ErrorActionPreference='Stop';[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false);Add-Type -AssemblyName System.Windows.Forms;$d=New-Object Windows.Forms.FolderBrowserDialog;$d.Description='CopyPaste: choose a folder for one hour';if($d.ShowDialog() -ne [Windows.Forms.DialogResult]::OK){[Console]::Out.Write('null');exit};$a=[Windows.Forms.MessageBox]::Show('Allow this folder for one hour? YES: read and create NEW files. NO: read only. Existing files cannot be overwritten. CANCEL: deny.','CopyPaste folder permission',[Windows.Forms.MessageBoxButtons]::YesNoCancel,[Windows.Forms.MessageBoxIcon]::Question,[Windows.Forms.MessageBoxDefaultButton]::Button2);if($a -eq [Windows.Forms.DialogResult]::Cancel){[Console]::Out.Write('null');exit};[Console]::Out.Write((@{root=$d.SelectedPath;write=($a -eq [Windows.Forms.DialogResult]::Yes)}|ConvertTo-Json -Compress));";
  const selected = await new Promise<any>((resolve, reject) => {
    const child = spawn(
      path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    dialogs.add(child);
    let output = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Folder selection timed out"));
    }, 120000);
    child.stdout.on("data", (b) => {
      output += b;
      if (output.length > 32768) {
        child.kill();
        reject(new Error("Invalid folder selection"));
      }
    });
    child.stderr.on("data", () => {});
    child.once("error", reject);
    child.once("close", (code) => {
      dialogs.delete(child);
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error("Native folder dialog unavailable");
        resolve(JSON.parse(output));
      } catch (e) {
        reject(e);
      }
    });
  });
  return selected ? files.grant(selected.root, selected.write === true) : null;
}
async function message(body: Buffer) {
  let response: unknown;
  try {
    if (stopping) throw new Error("DESKTOP_DISCONNECTED");
    await assertNativeHostEnabled(root);
    if (!origin || !(await load<string[]>("extensions", [])).includes(origin))
      throw new Error("Unregistered extension origin");
    const m = JSON.parse(body.toString("utf8"));
    let data: unknown;
    if (m.operation === "grant.choose") data = await choose();
    else if (m.operation === "grant.list") data = await files.grants();
    else if (m.operation === "grant.revoke") {
      await files.revoke(m.grant_id);
      data = { revoked: true };
    } else data = await files.execute(m);
    response = { ok: true, data };
    if (Buffer.byteLength(JSON.stringify(response)) > 900000)
      throw new Error(
        "Native result exceeds 900 KB. Use the file picker for larger files.",
      );
  } catch (e: any) {
    response = { ok: false, error: e.message };
  }
  const bytes = Buffer.from(JSON.stringify(response)),
    header = Buffer.alloc(4);
  header.writeUInt32LE(bytes.length);
  await new Promise<void>((resolve, reject) =>
    process.stdout.write(Buffer.concat([header, bytes]), (e) =>
      e ? reject(e) : resolve(),
    ),
  );
}
async function main() {
  if (!origin) throw new Error("Chrome extension origin is required");
  const release = await registerNativeHostLease(root);
  let checking = false;
  const stop = () => { stopping = true; for (const child of dialogs) child.kill(); process.stdin.destroy(); };
  const timer = setInterval(() => {
    if(checking)return; checking=true;
    void nativeHostDisabled(root).then(disabled => { if(disabled)stop(); },stop).finally(() => { checking=false; });
  },250);
  timer.unref();
  try {
  let pending = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    pending = Buffer.concat([pending, chunk]);
    if (pending.length > 8_000_004) throw new Error("Native message too large");
    while (pending.length >= 4) {
      const length = pending.readUInt32LE(0);
      if (length > 8_000_000) throw new Error("Native message too large");
      if (pending.length < length + 4) break;
      const body = pending.subarray(4, 4 + length);
      pending = pending.subarray(4 + length);
      if(stopping)break;
      await message(body);
    }
  }
  if (pending.length && !stopping) throw new Error("Incomplete native message");
  } catch(error) { if(!stopping)throw error; }
  finally { clearInterval(timer); for(const child of dialogs)child.kill(); await release(); }
}
void main().catch((e) => {
  process.stderr.write("CopyPaste native host: " + e.message + "\n");
  process.exitCode = 1;
});
