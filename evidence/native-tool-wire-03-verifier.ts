import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Diagnose actual native schema serialization without recording model inputs,
// inference credentials or making any paid/external model request.
const P = path.resolve("../copypaste-platform"),
  D = path.resolve("../copypaste-desktop");
const delivery = process.cwd();
const moduleAt = (root: string, file: string) =>
  import(
    new URL("file:///" + path.join(root, file).replaceAll("\\", "/")).href
  );
const { Catalog } = await moduleAt(P, "src/catalog.ts");
const { TaskBusinessTools } = await moduleAt(P, "src/task-business-tools.ts");
const { loadConfig } = await moduleAt(P, "src/config.ts");
const { desktopCompanyToolSchema, desktopToolDeclarations } = await moduleAt(
  P,
  "src/desktop-tool-policy.ts",
);
const { desktopRuntime } = await moduleAt(P, "src/desktop-runtime.ts");
const { LocalCodexSession } = await moduleAt(D, "src/local-codex.ts");
const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(path.basename(process.cwd()), "copypaste-delivery");
const prefix = path.resolve("evidence/native-tool-wire-" + attempt);
for (const suffix of [".json", "-verifier.ts"])
  await assert.rejects(
    readFile(prefix + suffix),
    (e: any) => e.code === "ENOENT",
  );
await writeFile(prefix + "-verifier.ts", await readFile(import.meta.filename), {
  flag: "wx",
});
const catalog = new Catalog();
process.chdir(P);
await catalog.load();
const role = catalog.role("video-motion");
const id = randomUUID(),
  directory = path.join(delivery, ".data/native-tool-wire", id),
  actor = randomUUID();
const workspace = path.join(directory, "workspace"),
  stateRoot = path.join(directory, "state");
await mkdir(workspace, { recursive: true });
await mkdir(stateRoot);
const business = new TaskBusinessTools(
  { config: loadConfig(process.env) },
  catalog,
  {},
  { authorize: async () => {}, inference: async () => {}, videoReady: true },
);
const definitions = business.build(
  {
    id,
    tenant_id: randomUUID(),
    project_id: randomUUID(),
    execution_location: "desktop",
    input_context: {},
    mode: "execute",
  },
  {},
  "",
  role,
);
const company = definitions.map(({ name, inputSchema }: any) => ({
  name,
  inputSchema: desktopCompanyToolSchema(inputSchema),
}));
const token = randomBytes(32).toString("hex");
let wire: any[] = [],
  requestError: string | null = null;
const server = createServer(async (req, res) => {
  try {
    assert.equal(req.headers.authorization, "Bearer " + token);
    const chunks = [];
    for await (const part of req) chunks.push(Buffer.from(part));
    const body = JSON.parse(Buffer.concat(chunks).toString());
    wire = body.tools;
    const item = {
      id: "msg_wire",
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: "Explicit synthetic wire inspection completed.",
          annotations: [],
        },
      ],
    };
    const response = {
      id: "resp_wire",
      object: "response",
      model: "synthetic-wire",
      created_at: 1,
      status: "in_progress",
      output: [],
    };
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    const emit = (type: string, fields: any) =>
      res.write(
        `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`,
      );
    emit("response.created", { response });
    emit("response.output_item.added", { output_index: 0, item });
    emit("response.output_text.delta", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      delta: item.content[0].text,
    });
    emit("response.output_text.done", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      text: item.content[0].text,
    });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", {
      response: {
        ...response,
        status: "completed",
        output: [item],
        usage: { input_tokens: 17, output_tokens: 5, total_tokens: 22 },
      },
    });
    res.end();
  } catch (e) {
    requestError = String(e);
    res.writeHead(500);
    res.end();
  }
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const origin = "http://127.0.0.1:" + (server.address() as any).port;
const native = new LocalCodexSession(
  {
    executable: path.join(D, ".data/runtime/windows-x64/codex.exe"),
    version: desktopRuntime.pinned_version,
    executableSha256: desktopRuntime.windows_x64_sha256,
    companyOrigin: origin,
    baseURL: origin + "/v1",
    model: "synthetic-wire",
    effort: "medium",
  },
  {
    sessionId: id,
    actorId: actor,
    tenantId: randomUUID(),
    projectId: randomUUID(),
    workspace,
    stateRoot,
    grant: {
      id: randomUUID(),
      actorId: actor,
      mode: "full-access",
      revision: 1,
      expiresAt: Date.now() + 120000,
    },
    skills: [],
    companyTools: definitions.map(
      ({ name, description, inputSchema }: any) => ({
        name,
        description,
        inputSchema,
      }),
    ),
    browserToolsVersion: 1,
    programToolsVersion: 1,
  },
  {
    authorize: async () => {},
    event: async () => {},
    companyTool: async () => {
      throw new Error("This diagnostic must not execute a business tool");
    },
    browserTool: async () => { throw new Error("This diagnostic must not control a browser"); },
    programTool: async () => { throw new Error("This diagnostic must not control a program"); },
  },
);
let result: any,
  error: string | null = null;
try {
  await native.start({ token, expiresAt: Date.now() + 120000 });
  result = await native.turn(
    "Return an explicitly synthetic diagnostic result without executing any tool.",
    AbortSignal.timeout(45000),
  );
} catch (e) {
  error = String(e);
} finally {
  await native.close();
  server.closeAllConnections();
  await new Promise<void>((r, reject) =>
    server.close((e) => (e ? reject(e) : r())),
  );
}
const failures = wire.flatMap((namespace: any) =>
  namespace.type === "namespace"
    ? namespace.tools
        .filter(
          (child: any) =>
            !desktopToolDeclarations(
              [{ ...namespace, tools: [child] }],
              company,
            ),
        )
        .map((child: any) => ({
          namespace: namespace.name,
          name: child.name,
          declaration: child,
          expected: company.find((t: any) => t.name === child.name)
            ?.inputSchema,
        }))
    : !desktopToolDeclarations([namespace], company)
      ? [{ name: namespace.name, type: namespace.type }]
      : [],
);
const accepted = wire.length > 0 && desktopToolDeclarations(wire, company);
await writeFile(
  prefix + ".json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      native_codex: true,
      synthetic_model: true,
      paid_provider_calls: 0,
      role: role.role_key,
      version: role.version,
      company_tools: company.length,
      runtime_version: desktopRuntime.pinned_version,
      runtime_sha256: desktopRuntime.windows_x64_sha256,
      namespaces: wire.map((t: any) => ({
        name: t.name,
        type: t.type,
        tools: t.tools?.length,
      })),
      accepted,
      failures,
      turn_status: result?.status,
      error,
      request_error: requestError,
      native_closed: true,
      server_closed: true,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    accepted,
    company_tools: company.length,
    failures: failures.map((f: any) => ({
      name: f.name,
      namespace: f.namespace,
    })),
    native_closed: true,
    server_closed: true,
  }),
);
assert.equal(error, null);
assert.equal(requestError, null);
assert.equal(result?.status, "completed");
assert.equal(accepted, true);
