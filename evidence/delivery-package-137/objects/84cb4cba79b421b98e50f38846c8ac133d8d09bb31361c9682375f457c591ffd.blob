import assert from "node:assert/strict";
import path from "node:path";
import { open } from "node:fs/promises";

export async function writeFixtureOwnership(file: string, value: unknown) {
  const handle = await open(file, "wx");
  try { await handle.writeFile(JSON.stringify(value)); await handle.sync(); }
  finally { await handle.close(); }
}

export function processIsGone(pid: number, signal = process.kill): boolean {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  try { signal(pid, 0); return false; }
  catch (error: any) { if (error.code === "ESRCH") return true; throw error; }
}

export function validateFixtureOwner(item: any, manifest: any, base: string, name: string) {
  assert.match(name, /^[a-f0-9]{32}\.json$/);
  assert.equal(item.id + ".json", name);
  assert.equal(item.token, manifest.token);
  assert.match(manifest.token, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.equal(path.resolve(item.directory), path.join(path.resolve(base), item.id));
  assert.ok(Number.isSafeInteger(item.worker_pid) && item.worker_pid > 0);
  return item;
}
