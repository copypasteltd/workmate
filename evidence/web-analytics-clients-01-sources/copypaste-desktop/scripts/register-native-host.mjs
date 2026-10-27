import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { app } from "electron";
import { LocalVault } from "../dist/vault.js";
// Run with Electron, because the origin allowlist is DPAPI-encrypted just like grants.
const extension = process.argv.find((a) => /^[a-p]{32}$/.test(a));
const executable = process.argv.find((a) => /CopyPaste\.exe$/i.test(a));
if (!extension || !executable)
  throw new Error(
    "Usage: electron scripts/register-native-host.mjs <extension-id> <absolute CopyPaste.exe>",
  );
if (!path.isAbsolute(executable))
  throw new Error("Use an absolute packaged executable path");
await readFile(executable);
void app
  .whenReady()
  .then(async () => {
    const root = path.join(app.getPath("appData"), "CopyPaste");
    await mkdir(root, { recursive: true });
    const origins = [`chrome-extension://${extension}/`];
    await writeFile(
      path.join(root, "extensions.enc"),
      await new LocalVault(root).encrypt(JSON.stringify(origins)),
    );
    const manifest = path.join(root, "hk.copypaste.agent.json");
    await writeFile(
      manifest,
      JSON.stringify(
        {
          name: "hk.copypaste.agent",
          description: "CopyPaste explicitly authorized local files",
          path: path.join(
            path.dirname(executable),
            "resources",
            "native-host.cmd",
          ),
          type: "stdio",
          allowed_origins: origins,
        },
        null,
        2,
      ),
    );
    const result = spawnSync(
      "reg.exe",
      [
        "ADD",
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\hk.copypaste.agent",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        manifest,
        "/f",
      ],
      { windowsHide: true, stdio: "inherit" },
    );
    app.exit(result.status ?? 1);
  })
  .catch(() => app.exit(1));
