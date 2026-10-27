import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import path from "node:path";
import { LocalCodexSession, type LocalSessionBinding, type LocalCodexProfile } from "../../src/local-codex.js";

const executable = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(executable && path.isAbsolute(executable), "Use the actual pinned native Codex binary");
const pin = JSON.parse(await readFile(new URL("../../contracts/local-codex-runtime.json", import.meta.url), "utf8"));
test("actual local Codex GEO has no tools or project guidance, uses fresh threads and refuses accepted-question replay", { timeout: 180000 }, async () => {
  assert.equal(createHash("sha256").update(await readFile(executable)).digest("hex"), pin.windows_x64_sha256);
  const parent = path.resolve(".data/native-geo-tests"); await mkdir(parent, { recursive: true }); const root = await mkdtemp(path.join(parent, "owned-"));
  const requests: any[] = [], sessions: LocalCodexSession[] = [], threads: string[] = []; let error: unknown;
  const provider = createServer(async (req, res) => {
    try {
      const chunks = []; for await (const b of req) chunks.push(Buffer.from(b));
      const body = JSON.parse(Buffer.concat(chunks).toString()); requests.push(body);
      assert.equal(req.headers.authorization, "Bearer synthetic-local-geo-native"); assert.equal(req.url, "/v1/responses");
      assert.deepEqual(body.tools, [], "The actual native process must advertise no tools");
      const serialized = JSON.stringify(body.input);
      assert.ok(!serialized.includes("ANCESTOR_GEO_GUIDANCE_DECOY_110") && !serialized.includes("PROJECT_GEO_GUIDANCE_DECOY_110"));
      if (requests.length === 2) assert.ok(!serialized.includes("UNIQUE_FIRST_NATIVE_GEO_ANSWER_110"), "A later question must not contain the earlier answer");
      res.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = (type: string, value: any) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...value })}\n\n`);
      const text = requests.length === 1 ? "UNIQUE_FIRST_NATIVE_GEO_ANSWER_110" : "SECOND_INDEPENDENT_NATIVE_GEO_ANSWER_110";
      const item = { id: "msg_native_geo_" + requests.length, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text, annotations: [] }] };
      const response = { id: "resp_native_geo_" + requests.length, object: "response", status: "in_progress", output: [] };
      emit("response.created", { response }); emit("response.output_item.added", { output_index: 0, item: { ...item, status: "in_progress", content: [] } });
      emit("response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: text });
      emit("response.output_text.done", { output_index: 0, item_id: item.id, content_index: 0, text });
      emit("response.output_item.done", { output_index: 0, item });
      emit("response.completed", { response: { ...response, status: "completed", output: [item], usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 } } }); res.end();
    } catch (e) { error = e; if (!res.headersSent) res.writeHead(502); res.end(); }
  });
  try {
    await writeFile(path.join(root, "AGENTS.md"), "ANCESTOR_GEO_GUIDANCE_DECOY_110");
    await new Promise<void>(r => provider.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${(provider.address() as any).port}`;
    const profile: LocalCodexProfile = { executable, version: pin.runtime_version, executableSha256: pin.windows_x64_sha256, companyOrigin: origin, baseURL: origin + "/v1", model: "synthetic-native-geo", effort: "max" };
    for (let i = 0; i < 2; i++) {
      const workspace = path.join(root, "question-" + i); await mkdir(workspace);
      const binding: LocalSessionBinding = { sessionId: randomUUID(), actorId: randomUUID(), tenantId: randomUUID(), projectId: randomUUID(), workspace, stateRoot: path.join(root, "state"),
        grant: { id: randomUUID(), actorId: "", mode: "read-only", revision: 1, expiresAt: Date.now() + 300000 }, skills: [], observationProtocol: "codex-desktop-geo-v1" }; binding.grant.actorId = binding.actorId;
      const session = new LocalCodexSession(profile, binding, { authorize: async () => {}, event: async () => {} }); sessions.push(session);
      await session.start({ token: "synthetic-local-geo-native", expiresAt: Date.now() + 300000 });
      const result = await session.turn("Independent question " + (i + 1)); threads.push(result.threadId);
      if (error) throw error;
      assert.equal(result.status, "completed", JSON.stringify({ status: result.status, requests: requests.length, tools: requests.map(r => r.tools?.map((t: any) => t.name)) })); assert.ok(result.text.includes(i === 0 ? "UNIQUE_FIRST_NATIVE_GEO" : "SECOND_INDEPENDENT_NATIVE_GEO"));
      await assert.rejects(session.turn("Blindly repeat the accepted question"), { code: "LOCAL_OBSERVATION_REPLAY_FORBIDDEN" });
      await session.close();
      const reopened = new LocalCodexSession(profile, binding, { authorize: async () => {}, event: async () => {} }); sessions.push(reopened);
      await assert.rejects(reopened.start({ token: "synthetic-local-geo-native", expiresAt: Date.now() + 300000 }), { code: "LOCAL_OBSERVATION_REPLAY_FORBIDDEN" });
      assert.deepEqual(await readdir(workspace), [], "A tool-free observation never modifies the workspace");
    }
    assert.notEqual(threads[0], threads[1]); assert.equal(requests.length, 2); if (error) throw error;
  } finally {
    await Promise.all(sessions.map(s => s.close())); provider.closeAllConnections(); await new Promise<void>(r => provider.close(() => r()));
    assert.equal(path.dirname(root), parent); await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
