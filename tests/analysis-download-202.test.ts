import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { analysisDownloadBody } from "../src/analysis-download.js";
import { saveDownload } from "../src/download.js";
test("native POST downloads allow only the exact project review operation and a bounded body", () => {
  const route = `/v1/tenants/${randomUUID()}/projects/${randomUUID()}/analysis/preview/export`, options = { body: { specification: { prompt: "A reviewed question" }, calculation_sha256: "a".repeat(64), format: "html", locale: "en-HK" } };
  assert.equal(analysisDownloadBody(route, options), JSON.stringify(options.body)); assert.equal(analysisDownloadBody(route, undefined), undefined);
  for (const p of ["https://example.invalid" + route, route + "?admin=true", route.replace("preview/export", "assistant"), route + "/../tasks"]) assert.throws(() => analysisDownloadBody(p, options));
  assert.throws(() => analysisDownloadBody(route, { ...options, destination: "C:/unauthorized" }));
  assert.throws(() => analysisDownloadBody(route, { body: { ...options.body, format: "exe" } }));
  assert.throws(() => analysisDownloadBody(route, { body: { ...options.body, specification: { prompt: "x".repeat(100001) } } }));
});
test("native download session changes leave neither destination nor temporary file", async () => {
  const folder = await mkdtemp(path.resolve(".data/review-download-202-"));
  try {
    let n = 0;
    await assert.rejects(saveDownload(new Response("private review"), path.join(folder, "private.html"), 1024, () => { if (++n >= 2) throw Error("Session changed"); }), /Session changed/);
    assert.deepEqual(await readdir(folder), []);
    await saveDownload(new Response("intact review"), path.join(folder, "intact.html"), 1024, () => {});
    assert.equal(await readFile(path.join(folder, "intact.html"), "utf8"), "intact review");
  } finally { await rm(folder, { recursive: true }); }
});
