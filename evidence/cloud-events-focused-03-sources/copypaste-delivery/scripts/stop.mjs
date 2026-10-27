import { readFile } from "node:fs/promises";
import path from "node:path";
const stateFile = path.resolve(import.meta.dirname, "../.data/controller.json");
const s = JSON.parse(await readFile(stateFile, "utf8"));
if (s.port !== 4319 || !/^([a-f0-9]{64})$/.test(s.token))
  throw new Error("Invalid controller state");
const r = await fetch("http://127.0.0.1:4319/shutdown", {
  method: "POST",
  headers: { Authorization: "Bearer " + s.token },
  signal: AbortSignal.timeout(5000),
});
if (!r.ok) throw new Error("Controller did not accept shutdown");
console.log(await r.text());
// The controller acknowledges immediately, then closes API and PostgreSQL.
// Its state is removed only after every owned child finishes shutting down.
const deadline = Date.now() + 330000;
let nextProgress = Date.now() + 15000;
while (true) {
  try {
    const current = JSON.parse(await readFile(stateFile, "utf8"));
    if (current.token !== s.token) break;
  } catch (e) {
    if (e.code === "ENOENT") break;
    throw e;
  }
  if (Date.now() > deadline)
    throw new Error(
      "Shutdown is still in progress. Processes were preserved; inspect .data/logs before restarting.",
    );
  if (Date.now() >= nextProgress) {
    console.log(
      "Waiting for the controller and native database to finish shutting down...",
    );
    nextProgress = Date.now() + 15000;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.log("CopyPaste shutdown complete.");
