import { _electron } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
const repo = path.resolve("../copypaste-desktop");
const app = await _electron.launch({
  executablePath: path.join(repo, "release/win-unpacked/CopyPaste.exe"),
  env: {
    ...process.env,
    COPYPASTE_USER_DATA: path.resolve(".data/packaged-" + randomUUID()),
  },
});
let passed = false;
let state: { packaged: boolean; name: string; version: string } | undefined;
try {
  const page = await app.firstWindow();
  await page.getByRole("button", { name: /瀏覽器|browser/i }).waitFor();
  await page.screenshot({
    path: path.join(repo, "assets/screenshots/03-packaged-windows.png"),
    fullPage: true,
  });
  state = await app.evaluate(({ app }) => ({
    packaged: app.isPackaged,
    name: app.getName(),
    version: app.getVersion(),
  }));
  if (!state.packaged) throw new Error("Expected packaged app");
  passed = true;
} finally {
  await app.close();
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/packaged-windows.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        ...state,
        code_signing: "unsigned",
        electron_closed: true,
      },
      null,
      2,
    ),
  );
  if (!passed) console.error("Packaged UI check failed");
}
