import { test } from "node:test";
import assert from "node:assert/strict";
import { startDeliveryDownload, type DeliveryDownload } from "../src/delivery-download.js";
const tenant = "11111111-1111-4111-8111-111111111111", project = "22222222-2222-4222-8222-222222222222", task = "33333333-3333-4333-8333-333333333333";
const selected: DeliveryDownload = { tenant, project, task, version: 7, deliveryHash: "a".repeat(64) };
function fixture() {
  const downloads: any[] = [], checked: string[] = []; let epoch = "original";
  const io = { apiOrigin: "https://company.example.invalid", tokens: async () => ({ access_token: "private-bearer-value", session_epoch: epoch }),
    check: async (path: string, tenant: string) => { checked.push(path, tenant); return { task_version: 7, delivery_hash: "a".repeat(64) }; },
    download: async (options: any) => { downloads.push(options); return 19; } };
  return { io, downloads, checked, change: () => { epoch = "new-sign-in"; } };
}
test("the native download is exact, uses company origin and sends authorization only in headers", async () => {
  const f = fixture(); assert.deepEqual(await startDeliveryDownload(selected, f.io), { download_id: 19 });
  const options = f.downloads[0], url = new URL(options.url); assert.equal(url.origin, f.io.apiOrigin);
  assert.equal(url.pathname, `/v1/tenants/${tenant}/projects/${project}/tasks/${task}/delivery-package`);
  assert.equal(url.searchParams.get("expected_version"), "7"); assert.equal(url.searchParams.get("expected_delivery_hash"), selected.deliveryHash);
  assert.ok(!options.url.includes("private-bearer-value")); assert.equal(options.saveAs, false); assert.equal(options.filename, `workmate-${task}-v7.zip`);
  assert.equal(options.headers.find((h: any) => h.name === "Authorization").value, "Bearer private-bearer-value");
});
test("invalid paths, versions, hashes and injected scope identities are rejected before any network operation", async () => {
  for (const input of [{ ...selected, task: "../../auth" }, { ...selected, project: project + "?x=1" }, { ...selected, version: 0 }, { ...selected, version: 1.5 }, { ...selected, deliveryHash: "secret\r\nvalue" }]) {
    const f = fixture(); await assert.rejects(startDeliveryDownload(input, f.io)); assert.equal(f.downloads.length, 0); assert.equal(f.checked.length, 0);
  }
});
test("a replaced delivery never starts a browser download", async () => {
  const f = fixture(); f.io.check = async () => ({ task_version: 8, delivery_hash: "b".repeat(64) });
  await assert.rejects(startDeliveryDownload(selected, f.io), /Delivery changed/); assert.equal(f.downloads.length, 0);
});
test("sign-in changes during the permission check cannot download under the new account", async () => {
  const f = fixture(); f.io.check = async () => { f.change(); return { task_version: 7, delivery_hash: selected.deliveryHash }; };
  await assert.rejects(startDeliveryDownload(selected, f.io), /Sign-in state changed/); assert.equal(f.downloads.length, 0);
});
test("permission failures and browser download failures stay failures", async () => {
  const f = fixture(); f.io.check = async () => { throw new Error("403"); }; await assert.rejects(startDeliveryDownload(selected, f.io), /403/); assert.equal(f.downloads.length, 0);
  const g = fixture(); g.io.download = async () => { throw new Error("User cancelled"); }; await assert.rejects(startDeliveryDownload(selected, g.io), /User cancelled/);
});
