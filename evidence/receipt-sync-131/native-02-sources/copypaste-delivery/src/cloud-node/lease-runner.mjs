import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

// Runs as systemd DynamicUser inside the dedicated lease's native namespaces.
// No company credential, API URL or AI key is passed into this process.
if (process.platform !== "linux" || process.getuid?.() === 0) throw new Error("UNPRIVILEGED_NATIVE_LEASE_REQUIRED");
const environment = { PATH: "/usr/bin:/bin", LANG: "C.UTF-8", HOME: "/workspace", DISPLAY: ":77" };
const children = new Set(); let stopping = false;
function run(binary, args, timeout = 8000, limit = 16_384) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { cwd: "/workspace", shell: false, env: environment, stdio: ["ignore", "pipe", "pipe"] }); children.add(child);
    const chunks = []; let size = 0, killed = false;
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, timeout);
    child.stdout.on("data", bytes => { size += bytes.length; if (size > limit) { killed = true; child.kill("SIGKILL"); } else chunks.push(bytes); }); child.stderr.resume();
    child.once("error", error => { clearTimeout(timer); children.delete(child); reject(error); });
    child.once("close", code => { clearTimeout(timer); children.delete(child); code === 0 && !killed ? resolve(Buffer.concat(chunks)) : reject(new Error("LEASE_COMMAND_FAILED")); });
  });
}
const display = spawn("/usr/bin/Xvfb", [":77", "-screen", "0", "1280x720x24", "-nolisten", "tcp", "-noreset"], { env: environment, stdio: "ignore" }); children.add(display);
let ready = false;
for (let attempt = 0; attempt < 50; attempt++) {
  try { await run("/usr/bin/xdotool", ["getdisplaygeometry"], 500); ready = true; break; } catch { await new Promise(r => setTimeout(r, 50)); }
}
if (!ready) throw new Error("DISPLAY_NOT_READY");
for (const [binary, args] of [["/usr/bin/openbox", []], ["/usr/bin/xterm", ["-geometry", "110x32+24+24", "-title", "Workmate cloud workspace"]]]) {
  const child = spawn(binary, args, { env: environment, cwd: "/workspace", stdio: "ignore" }); children.add(child); child.on("error", () => {});
}
async function handle(message) {
  if (!Number.isSafeInteger(message.id) || message.id <= 0) throw new Error("INVALID_REQUEST");
  if (message.kind === "ready") return {};
  if (message.kind === "frame") return { base64: (await run("/usr/bin/import", ["-window", "root", "-depth", "8", "-define", "png:color-type=2", "PNG:-"], 3000, 524_288)).toString("base64") };
  if (message.kind === "terminal" && typeof message.command === "string" && message.command.length <= 4096)
    return { result: (await run("/usr/bin/timeout", ["--signal=KILL", "8s", "/bin/sh", "-lc", message.command], 10_000)).toString("utf8").slice(0, 16_384) };
  if (message.kind === "pointer" && Number.isInteger(message.x) && message.x >= 0 && message.x < 1280 && Number.isInteger(message.y) && message.y >= 0 && message.y < 720 && ["none", "left", "right"].includes(message.button)) {
    await run("/usr/bin/xdotool", ["mousemove", "--sync", String(message.x), String(message.y), ...(message.button === "none" ? [] : ["click", message.button === "left" ? "1" : "3"])]); return {};
  }
  if (message.kind === "key" && ["Enter", "Escape", "Tab", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(message.key)) {
    if (message.text !== undefined) { if (typeof message.text !== "string" || message.text.length > 1000) throw new Error("INVALID_TEXT"); await run("/usr/bin/xdotool", ["type", "--clearmodifiers", "--", message.text]); }
    else await run("/usr/bin/xdotool", ["key", "--clearmodifiers", ({ Enter: "Return", ArrowUp: "Up", ArrowDown: "Down", ArrowLeft: "Left", ArrowRight: "Right" })[message.key] ?? message.key]);
    return {};
  }
  throw new Error("CONTROL_INVALID");
}
let chain = Promise.resolve();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on("line", line => {
  if (Buffer.byteLength(line) > 16_000) { process.exitCode = 1; input.close(); return; }
  chain = chain.then(async () => { if (stopping) return; let message; try { message = JSON.parse(line); const result = await handle(message); process.stdout.write(JSON.stringify({ id: message.id, ok: true, ...result }) + "\n"); } catch { process.stdout.write(JSON.stringify({ id: message?.id, ok: false }) + "\n"); } });
});
function close() { stopping = true; for (const child of children) child.kill("SIGKILL"); process.exit(0); }
input.on("close", close); process.on("SIGTERM", close); process.on("SIGINT", close);
