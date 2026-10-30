import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";
import path from "node:path";
// Protocol-only probe: no turn is started and no AI request is made.
const home = path.resolve(".data/protocol-probe");
await mkdir(home, { recursive: true });
await writeFile(
  path.join(home, "config.toml"),
  [
    'model = "protocol-probe"',
    'model_provider = "copypaste_internal"',
    'approval_policy = "never"',
    'sandbox_mode = "read-only"',
    'web_search = "disabled"',
    "[model_providers.copypaste_internal]",
    'name = "CopyPaste Internal Gateway"',
    'base_url = "http://127.0.0.1:9/v1"',
    'env_key = "COPYPASTE_RUNTIME_KEY"',
    'wire_api = "responses"',
    "[features]",
    "shell_tool = false",
    "multi_agent = false",
    "[analytics]",
    "enabled = false",
  ].join("\n"),
);
const child = spawn(
  process.env.CODEX_BIN ?? "codex",
  ["app-server", "--stdio", "--strict-config"],
  {
    cwd: home,
    env: {
      PATH: process.env.PATH,
      Path: process.env.Path,
      SystemRoot: process.env.SystemRoot,
      TEMP: process.env.TEMP,
      TMP: process.env.TMP,
      HOME: home,
      USERPROFILE: home,
      CODEX_HOME: home,
      COPYPASTE_RUNTIME_KEY: "protocol-probe-no-live-key",
    },
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"],
  },
);
let seq = 0;
const pending = new Map<
  number,
  { resolve: (x: any) => void; reject: (e: Error) => void }
>();
const lines = createInterface({ input: child.stdout });
const timer = setTimeout(() => {
  child.kill();
  throw new Error("Protocol probe timeout");
}, 15000);
lines.on("line", (line) => {
  try {
    const m = JSON.parse(line),
      p = pending.get(m.id);
    if (p) {
      pending.delete(m.id);
      if (m.error)
        p.reject(new Error("Codex RPC rejected: " + JSON.stringify(m.error)));
      else p.resolve(m.result);
    }
  } catch {}
});
let stderr = "";
child.stderr.on("data", (b) => (stderr += b));
child.on("exit", () => {
  for (const p of pending.values())
    p.reject(new Error("Codex exited: " + stderr.slice(-2500)));
});
child.on("error", (e) => {
  for (const p of pending.values()) p.reject(e);
});
const rpc = (method: string, params: any) =>
  new Promise<any>((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
try {
  const init = await rpc("initialize", {
    clientInfo: { name: "copypaste_protocol_probe", version: "0.1.0" },
    capabilities: { experimentalApi: true },
  });
  child.stdin.write(
    JSON.stringify({ method: "initialized", params: {} }) + "\n",
  );
  const thread = await rpc("thread/start", {
    model: "protocol-probe",
    modelProvider: "copypaste_internal",
    cwd: home,
    approvalPolicy: "never",
    sandbox: "read-only",
    allowProviderModelFallback: false,
    dynamicTools: [
      {
        name: "deliver_text",
        description: "Protocol probe only",
        inputSchema: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
      },
    ],
  });
  await mkdir("evidence", { recursive: true });
  await writeFile(
    "evidence/codex-protocol.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        user_agent: init.userAgent ?? null,
        initialize: "passed",
        thread_start: "passed",
        internal_provider: thread.modelProvider ?? null,
        turn_started: false,
        live_ai_qualified: false,
      },
      null,
      2,
    ),
  );
  console.log(
    "Real Codex initialize + thread/start passed. No model turn was started.",
  );
} finally {
  clearTimeout(timer);
  lines.close();
  child.stdin.end();
  child.kill();
}
