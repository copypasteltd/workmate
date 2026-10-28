import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadImage } from "@napi-rs/canvas";
import { hash } from "../src/lib.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import type { VideoJobObservation } from "../src/video-job-protocol.js";

/** Actual native MP4 bytes behind an explicitly synthetic internal HTTP server. */
export async function capabilityVideoProvider(directory: string) {
  const jobs = new Map<string, VideoJobObservation>(), media = new Map<string, Buffer>(), calls: { method: string; path: string; operation: string; reference?: string }[] = [];
  const state = { dropCreate: false, lookupMissing: false, corruptContent: false, cancelCompletes: false,
    queued: false, usageUnknown: false, billableExtra: 0,
    beforeCreate: undefined as undefined | ((operation: string) => Promise<void>),
    beforeContent: undefined as undefined | (() => Promise<void>) };
  const errors: string[] = [];
  async function bytes(size: string, seconds: number) {
    const key = size + "-" + seconds;
    if (!media.has(key)) {
      const file = path.join(directory, "video-verification-" + key + ".mp4");
      await promisify(execFile)(process.env.FFMPEG_BIN ?? "ffmpeg", ["-v", "error", "-f", "lavfi", "-i", `color=c=0x1F5EFF:s=${size}:r=2`,
        "-t", String(seconds), "-an", "-c:v", "libx264", "-threads", "1", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-movflags", "+faststart", file],
      { windowsHide: true, timeout: 60000 });
      media.set(key, await readFile(file));
    }
    return media.get(key)!;
  }
  async function complete(operation: string, usage?: number | null) {
    const previous = jobs.get(operation)!, content = await bytes(previous.size, previous.seconds);
    const next: VideoJobObservation = { ...previous, status: "completed", event_id: randomUUID(), sequence: previous.sequence + 1,
      progress: 100, usage: usage === null ? null : { billable_seconds: usage ?? previous.seconds }, content: { sha256: hash(content), bytes: content.length }, error: null };
    jobs.set(operation, next); return next;
  }
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, "Bearer synthetic-video-capability-fixture");
      assert.match(String(req.headers["x-copypaste-task-id"]), /^[a-f0-9-]{36}$/);
      assert.match(String(req.headers["x-copypaste-actor-id"]), /^[a-f0-9-]{36}$/);
      for (const key of ["tenant", "project", "capability-version"]) assert.equal(req.headers[`x-copypaste-${key}-id`], undefined);
      const operation = String(req.headers["x-copypaste-operation-id"]), url = req.url!;
      assert.equal(req.headers["idempotency-key"], operation);
      const call: typeof calls[number] = { method: req.method!, path: url, operation }; calls.push(call);
      const json = (body: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body));
      if (req.method === "POST" && url === "/v1/videos") {
        assert.equal(jobs.has(operation), false, "A generation operation is never posted twice");
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const form = await new Request("http://fixture.invalid", { method: "POST", headers: { "Content-Type": req.headers["content-type"]! }, body: Buffer.concat(chunks) }).formData();
        const size = String(form.get("size")), seconds = Number(form.get("seconds")), model = String(form.get("model"));
        const reference = form.get("input_reference");
        if (reference instanceof File) {
          call.reference = reference.type;
          const image = await loadImage(Buffer.from(await reference.arrayBuffer()));
          assert.equal(`${image.width}x${image.height}`, size);
        }
        const queued = state.queued || String(form.get("prompt")).includes("cancellation"), content = queued ? null : await bytes(size, seconds);
        jobs.set(operation, { protocol: "company-video-jobs-v1", object: "video", id: "verification_" + randomUUID(), operation_id: operation,
          event_id: randomUUID(), sequence: 0, model, size: size as any, seconds: seconds as any,
          status: queued ? "queued" : "completed", progress: queued ? null : 100,
          usage: queued || state.usageUnknown ? null : { billable_seconds: seconds + state.billableExtra },
          content: content ? { sha256: hash(content), bytes: content.length } : null, error: null });
        await state.beforeCreate?.(operation);
        if (state.dropCreate) { req.socket.destroy(); return; }
        json(jobs.get(operation)); return;
      }
      const lookup = /^\/v1\/videos\/operations\/([a-f0-9-]{36})$/.exec(url), resource = /^\/v1\/videos\/([a-zA-Z0-9_-]+)(\/cancel|\/content)?$/.exec(url);
      const job = lookup ? jobs.get(lookup[1]) : [...jobs.values()].find(j => j.id === resource?.[1]);
      if (!job || lookup && state.lookupMissing) { res.writeHead(404).end(); return; }
      if (resource?.[2] === "/cancel") {
        assert.equal(req.method, "POST"); assert.equal(operation, job.operation_id);
        if (state.cancelCompletes) { json(await complete(job.operation_id)); return; }
        const next: VideoJobObservation = { ...job, event_id: randomUUID(), sequence: job.sequence + 1, status: "cancelled", progress: null,
          usage: state.usageUnknown ? null : { billable_seconds: 1 }, content: null, error: null };
        jobs.set(job.operation_id, next); json(next); return;
      }
      assert.equal(req.method, "GET");
      if (resource?.[2] === "/content") {
        await state.beforeContent?.();
        const content = await bytes(job.size, job.seconds);
        res.writeHead(200, { "Content-Type": "video/mp4" }).end(state.corruptContent ? Buffer.alloc(content.length) : content); return;
      }
      json(job);
    } catch (e) { errors.push(String(e)); if (!res.writableEnded) res.writeHead(500).end(); }
  });
  const port = await listenLoopbackHTTP(server);
  return { origin: "http://127.0.0.1:" + port + "/v1", state, calls, jobs, errors, complete,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
