import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { generatedVideoProvider } from "./generated-video-fixture.js";
import { hash } from "../src/lib.js";
import { videoOK, type VideoClient, type VideoSystem } from "./desktop-video-fixture.js";
import { setTimeout as delay } from "node:timers/promises";

/** Test-only customer. It uses the public authenticated, CSRF/PKCE-protected
 * HTTP action; no product auto-confirm option or privileged consent insert. */
export async function withAudioCustomerConfirmation<T>(s: VideoSystem, client: VideoClient, base: string,
  taskId: string | undefined, operation: () => Promise<T>, specificationHash?: string) {
  let settled: { value: T } | { error: unknown } | undefined;
  const running = operation().then(value => { settled = { value }; }, error => { settled = { error }; });
  const deadline = Date.now() + 90000;
  for (;;) {
    if (settled) { if ("error" in settled) throw settled.error; return settled.value; }
    assert.ok(Date.now() < deadline, "Explicit test customer confirmation deadline");
    const result = await videoOK(s, client, "GET", base + "/audio-authorizations?" +
      new URLSearchParams({ limit: "100", ...(taskId ? { task_id: taskId } : {}) }));
    for (const row of result.items) if (row.state === "pending" && (!specificationHash || row.specification_hash === specificationHash))
      await videoOK(s, client, "POST", base + "/audio-authorizations/" + row.id + "/confirm", {
        expected_revision: row.revision, specification_hash: row.specification_hash, quoted_micros: row.quoted_micros,
        confirm_authorized_use: true, rights_reference: "Owned explicit synthetic test fixture",
        purpose: "A separate logged-in test customer explicitly approves this exact operation",
      }, "explicit-test-customer-" + row.id);
    await Promise.race([running, delay(30)]);
  }
}

export async function audioProviderFixture(directory: string) {
  const text = await generatedVideoProvider(directory);
  const file = path.join(directory, "explicit-synthetic-tone.wav");
  await promisify(execFile)(process.env.FFMPEG_BIN ?? "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=24000", "-t", "2", "-ac", "1", "-c:a", "pcm_s16le", file], { windowsHide: true, timeout: 60000 });
  const bytes = await readFile(file);
  const calls: { path: string; operation: string; fields: any; source_sha256?: string }[] = [];
  const errors: string[] = [];
  const state = { drop: false, corrupt: false, status: 200, timestamps: true,
    beforeReply: undefined as undefined | (() => Promise<void>),
    transcript: { text: "你好，香港。\nHello Hong Kong.", segments: [{ start: 0, end: 0.9, text: "你好，香港。" }, { start: 1, end: 2, text: "Hello Hong Kong." }] } };
  const server = createServer(async (req, res) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const raw = Buffer.concat(chunks);
      if (!req.url?.startsWith("/v1/audio/")) {
        const headers = { ...req.headers }; delete headers.host; delete headers.connection; delete headers["content-length"];
        const response = await fetch(text.origin.replace(/\/v1$/, "") + req.url, { method: req.method, headers: headers as Record<string, string>, body: new Uint8Array(raw), redirect: "error" });
        res.writeHead(response.status, Object.fromEntries([...response.headers].filter(([key]) => !["connection", "transfer-encoding", "content-length", "content-encoding"].includes(key))));
        res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      assert.equal(req.method, "POST"); assert.equal(req.headers.authorization, "Bearer synthetic-video-provider-fixture");
      const operation = String(req.headers["x-copypaste-operation-id"]);
      assert.match(operation, /^[a-f0-9-]{36}$/); assert.equal(req.headers["idempotency-key"], operation);
      for (const name of ["task", "tenant", "project", "actor", "capability-version"]) assert.match(String(req.headers["x-copypaste-" + name + "-id"]), /^[a-f0-9-]{36}$/);
      const call: typeof calls[number] = { path: req.url, operation, fields: {} };
      if (req.url === "/v1/audio/speech") call.fields = JSON.parse(raw.toString());
      else {
        assert.equal(req.url, "/v1/audio/transcriptions");
        const form = await new Request("http://fixture.invalid", { method: "POST", headers: { "Content-Type": String(req.headers["content-type"]) }, body: new Uint8Array(raw) }).formData();
        call.fields = Object.fromEntries([...form].filter(([key]) => key !== "file"));
        const file = form.get("file"); assert.ok(file instanceof File); call.source_sha256 = hash(Buffer.from(await file.arrayBuffer()));
      }
      calls.push(call); await state.beforeReply?.();
      if (state.drop) { req.socket.destroy(); return; }
      if (state.status !== 200) { res.writeHead(state.status, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "explicit synthetic failure" })); return; }
      if (req.url === "/v1/audio/speech") res.writeHead(200, { "Content-Type": "audio/wav" }).end(state.corrupt ? Buffer.from("corrupt fixture") : bytes);
      else res.writeHead(200, { "Content-Type": "application/json" }).end(state.corrupt ? "{incomplete" : JSON.stringify(state.timestamps ? state.transcript : { text: state.transcript.text }));
    } catch (error) { errors.push(String(error)); if (!res.writableEnded) res.writeHead(500).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: "http://127.0.0.1:" + (server.address() as any).port + "/v1", bytes, calls, state, errors, text,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); await text.close(); } };
}
