import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { hash } from "../src/lib.js";
import type { VideoJobObservation } from "../src/video-job-protocol.js";

export async function generatedVideoProvider(directory: string) {
  const file = path.join(directory, "synthetic-video-provider.mp4");
  await promisify(execFile)(process.env.FFMPEG_BIN ?? "ffmpeg", ["-v", "error", "-f", "lavfi", "-i",
    "color=c=0x1F5EFF:s=1280x720:r=12", "-t", "4", "-an", "-c:v", "libx264", "-preset", "ultrafast",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", file], { windowsHide: true, timeout: 60000 });
  const bytes = await readFile(file), digest = hash(bytes);
  const jobs = new Map<string, VideoJobObservation>(), calls: { method: string; path: string; operation: string; fields?: Record<string, unknown>; headers: Record<string, string | undefined> }[] = [];
  const state = { initial: "completed" as VideoJobObservation["status"], initialUsage: 4 as number | null,
    dropCreate: false, corruptContent: false, lookupMissing: false, cancelCompletes: false, textCount: 10,
    beforeCreateResponse: undefined as undefined | (() => Promise<void>), beforeContent: undefined as undefined | (() => Promise<void>),
    textItem: undefined as undefined | ((body: any, serial: number) => any) };
  const errors: string[] = [];
  const update = (operation: string, patch: Partial<VideoJobObservation>) => {
    const previous = jobs.get(operation)!;
    assert.ok(previous);
    const next = { ...previous, ...patch, event_id: randomUUID(), sequence: previous.sequence + 1 };
    jobs.set(operation, next);
    return next;
  };
  const complete = (operation: string, seconds: number | null = 4) => update(operation, {
    status: "completed", progress: 100, usage: seconds === null ? null : { billable_seconds: seconds },
    content: { sha256: digest, bytes: bytes.length }, error: null });
  const server = createServer(async (req, res) => {
    try {
      assert.equal(req.headers.authorization, "Bearer synthetic-video-provider-fixture");
      const operation = String(req.headers["x-copypaste-operation-id"]), url = req.url!;
      assert.match(operation, /^[a-f0-9-]{36}$/);
      assert.equal(req.headers["idempotency-key"], operation);
      const call: typeof calls[number] = { method: req.method!, path: url, operation, headers: Object.fromEntries(
        ["task", "tenant", "project", "actor", "capability-version"].map(name => [name, req.headers["x-copypaste-" + name + "-id"] as string | undefined])) };
      assert.ok(Object.values(call.headers).every(value => /^[a-f0-9-]{36}$/.test(value ?? "")));
      calls.push(call);
      const json = (value: unknown) => res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(value));
      if (req.method === "POST" && url === "/v1/responses/input_tokens") {
        for await (const _chunk of req) { /* Consume the actual company counting request. */ }
        json({ object: "response.input_tokens", input_tokens: state.textCount }); return;
      }
      if (req.method === "POST" && url === "/v1/responses") {
        const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = JSON.parse(Buffer.concat(chunks).toString()), serial = calls.filter(call => call.path === "/v1/responses").length;
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const emit = (type: string, data: unknown) => res.write("event: " + type + "\ndata: " + JSON.stringify({ type, ...data as object }) + "\n\n");
        const item = state.textItem?.(body, serial) ?? { type: "message", id: "msg_generated_video_fixture", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: "Explicit synthetic company reasoning fixture", annotations: [] }] };
        const response = { id: "resp_generated_video_fixture_" + serial, object: "response", model: body.model, created_at: 1, status: "in_progress", output: [] };
        emit("response.created", { response });
        emit("response.output_item.added", { output_index: 0, item: item.type === "function_call" ? { ...item, arguments: "" } : item });
        if (item.type === "function_call") {
          emit("response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: item.arguments });
          emit("response.function_call_arguments.done", { output_index: 0, item_id: item.id, arguments: item.arguments });
        } else {
          emit("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text });
          emit("response.output_text.done", { output_index: 0, item_id: item.id, content_index: 0, text: item.content[0].text });
        }
        emit("response.output_item.done", { output_index: 0, item });
        emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: { input_tokens: state.textCount, output_tokens: 20, total_tokens: state.textCount + 20 } } });
        res.end(); return;
      }
      if (req.method === "POST" && url === "/v1/videos") {
        const chunks = [];
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
        const body = Buffer.concat(chunks);
        const form = await new Request("http://fixture.invalid", { method: "POST", headers: { "Content-Type": req.headers["content-type"]! }, body }).formData();
        call.fields = Object.fromEntries([...form].filter(([key]) => key !== "input_reference"));
        const reference = form.get("input_reference");
        if (reference instanceof File) call.fields.reference_sha256 = hash(Buffer.from(await reference.arrayBuffer()));
        assert.equal(form.get("model"), "synthetic-video-async-v1");
        const status = state.initial;
        if (!jobs.has(operation)) jobs.set(operation, { protocol: "company-video-jobs-v1", object: "video", id: "video_" + randomUUID(), operation_id: operation,
          event_id: randomUUID(), sequence: 0, model: String(form.get("model")), size: String(form.get("size")) as any, seconds: Number(form.get("seconds")) as any,
          status, progress: status === "completed" ? 100 : null,
          usage: ["completed", "failed", "cancelled"].includes(status) && state.initialUsage !== null ? { billable_seconds: state.initialUsage } : null,
          content: status === "completed" ? { sha256: digest, bytes: bytes.length } : null,
          error: status === "failed" ? { code: "SYNTHETIC_VIDEO_FAILURE" } : null });
        if (state.dropCreate) { req.socket.destroy(); return; }
        await state.beforeCreateResponse?.();
        json(jobs.get(operation)); return;
      }
      const lookup = /^\/v1\/videos\/operations\/([a-f0-9-]{36})$/.exec(url);
      const resource = /^\/v1\/videos\/([a-zA-Z0-9_-]+)(\/cancel|\/content)?$/.exec(url);
      const job = lookup ? jobs.get(lookup[1]) : [...jobs.values()].find(value => value.id === resource?.[1]);
      if (!job || lookup && state.lookupMissing) { res.writeHead(404).end(); return; }
      if (resource?.[2] === "/content") {
        assert.equal(req.method, "GET");
        await state.beforeContent?.();
        res.writeHead(200, { "Content-Type": "video/mp4" }).end(state.corruptContent ? Buffer.alloc(bytes.length, 0) : bytes); return;
      }
      if (resource?.[2] === "/cancel") {
        assert.equal(req.method, "POST");
        assert.equal(operation, job.operation_id, "Cancellation has the original stable operation key");
        json(state.cancelCompletes ? complete(job.operation_id, 4) : update(job.operation_id, { status: "cancelled", progress: null,
          usage: state.initialUsage === null ? null : { billable_seconds: 1 }, content: null, error: null })); return;
      }
      assert.equal(req.method, "GET"); json(job);
    } catch (error) { errors.push(String(error)); if (!res.writableEnded) res.writeHead(500).end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { origin: "http://127.0.0.1:" + (server.address() as any).port + "/v1", bytes, sha256: digest, jobs, calls, state, errors, update, complete,
    async close() { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } };
}
