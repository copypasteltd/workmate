import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
assert.deepEqual(process.argv.slice(2), ["--compiled"]);
const { runCloudBrowserPreview } = await import(
  "../dist/src/cloud-browser-preview.js"
);
const root = path.resolve(".data/compiled-browser-probe", randomUUID());
await mkdir(root, { recursive: true });
const result = await runCloudBrowserPreview(
  root,
  {
    entry: "index.html",
    actions: [{ action: "click", selector: "button" }],
    checks: [
      {
        name: "Compiled entry performs a real DOM update",
        selector: "#state",
        expect: { text: "Actual compiled browser check" },
      },
    ],
  },
  [
    {
      path: "index.html",
      bytes: Buffer.from(
        "<!doctype html><h1>CopyPaste</h1><button onclick=\"document.querySelector('#state').textContent='Actual compiled browser check'\">Check</button><p id=state>Pending</p>",
      ),
    },
  ],
);
await writeFile(
  path.join(root, "receipt.json"),
  JSON.stringify(result.receipt, null, 2) + "\n",
  { flag: "wx" },
);
for (const file of result.files) {
  const output = path.join(root, file.path);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, file.bytes, { flag: "wx" });
}
assert.equal(
  result.receipt.passed,
  true,
  JSON.stringify(result.receipt.check_result),
);
assert.equal(result.receipt.host.job_empty, true);
assert.equal(result.receipt.workspace_deleted, true);
console.log(
  JSON.stringify({
    status: "passed",
    scope: "compiled-native-browser-probe",
    receipt: path.join(root, "receipt.json"),
    native_browser_closed: true,
    owned_profile_removed: true,
  }),
);
