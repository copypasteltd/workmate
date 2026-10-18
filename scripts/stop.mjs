import { readFile } from "node:fs/promises";
import path from "node:path";
const s = JSON.parse(
  await readFile(
    path.resolve(import.meta.dirname, "../.data/controller.json"),
    "utf8",
  ),
);
if (s.port !== 4319 || !/^([a-f0-9]{64})$/.test(s.token))
  throw new Error("Invalid controller state");
const r = await fetch("http://127.0.0.1:4319/shutdown", {
  method: "POST",
  headers: { Authorization: "Bearer " + s.token },
  signal: AbortSignal.timeout(5000),
});
if (!r.ok) throw new Error("Controller did not accept shutdown");
console.log(await r.text());
