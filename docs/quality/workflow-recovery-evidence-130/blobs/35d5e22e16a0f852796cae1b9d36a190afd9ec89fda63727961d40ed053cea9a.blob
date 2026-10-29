import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";

const originalSpawn = childProcess.spawn;
// Only transport metadata is recorded. Prompts, arguments, tool bodies,
// provider credentials and returned customer text never enter this log.
childProcess.spawn = function (file, args, options) {
  const child = originalSpawn.call(this, file, args, options);
  if (!/codex(?:\.exe)?$/i.test(path.basename(String(file))) || !args?.includes("app-server")) return child;
  const started = performance.now();
  const observe = body => process.stdout.write("# codex_rpc_diagnostic " + JSON.stringify({ elapsed_ms: Math.round(performance.now() - started), ...body }) + "\n");
  observe({ event: "spawn", pid: child.pid ?? null });
  const originalWrite = child.stdin.write.bind(child.stdin);
  child.stdin.write = function (chunk, ...rest) {
    for (const line of String(chunk).trim().split("\n")) {
      try { const message = JSON.parse(line); observe({ event: "send", id: message.id ?? null, method: message.method ?? null }); } catch { observe({ event: "send_unparsed" }); }
    }
    return originalWrite(chunk, ...rest);
  };
  let pending = "";
  child.stdout.on("data", bytes => {
    pending += bytes.toString();
    if (Buffer.byteLength(pending) > 8 * 1024 * 1024) { pending = ""; observe({ event: "oversized_transport_line" }); return; }
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      try { const message = JSON.parse(line); observe({ event: "receive", id: message.id ?? null, method: message.method ?? null, error_code: message.error?.code ?? null }); } catch { observe({ event: "receive_unparsed" }); }
    }
  });
  child.once("error", error => observe({ event: "spawn_error", code: error.code ?? null }));
  child.once("close", (code, signal) => observe({ event: "close", code, signal }));
  return child;
};
syncBuiltinESMExports();
