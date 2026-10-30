import test from "node:test";
import assert from "node:assert/strict";
import { startCreativePackageDownload } from "../src/creative-package-download.js";
const selection = { tenant: "11111111-1111-4111-8111-111111111111", project: "22222222-2222-4222-8222-222222222222", id: "33333333-3333-4333-8333-333333333333", version: 2 };
function fixture() { const calls: any[] = []; let epoch = "current", row: any = { id: selection.id, version: 2 };
  return { calls, change: () => { epoch = "changed"; }, stale: () => { row.version = 3; }, io: {
    apiOrigin: "https://company.example.invalid", tokens: async () => ({ access_token: "fixture", session_epoch: epoch }),
    check: async (path: string, tenant: string) => { calls.push({ path, tenant }); return { items: [row] }; },
    download: async (options: any) => { calls.push(options); return 8; },
  } }; }
test("exact project ZIP uses company origin, scoped credentials and browser download manager", async () => {
  const f = fixture(); assert.deepEqual(await startCreativePackageDownload(selection, f.io), { download_id: 8 });
  assert.equal(f.calls[1].url, `https://company.example.invalid/v1/tenants/${selection.tenant}/projects/${selection.project}/creative-project-packages/${selection.id}?expected_version=2`);
  assert.equal(f.calls[1].headers[1].value, selection.tenant); assert.equal(f.calls[1].conflictAction, "uniquify");
});
test("invalid IDs, paths and stale versions never reach the download manager", async () => {
  for (const input of [{ ...selection, id: "../admin" }, { ...selection, version: 0 }, { ...selection, project: "https://external.invalid" }]) {
    const f = fixture(); await assert.rejects(startCreativePackageDownload(input, f.io)); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.stale(); await assert.rejects(startCreativePackageDownload(selection, f.io)); assert.equal(f.calls.length, 1);
});
test("sign-out or account replacement during permission lookup prevents export", async () => {
  const f = fixture(), check = f.io.check; f.io.check = async (...args) => { const result = await check(...args); f.change(); return result; };
  await assert.rejects(startCreativePackageDownload(selection, f.io)); assert.equal(f.calls.length, 1);
});
