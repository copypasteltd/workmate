import { writeFile, mkdir } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
const s = await buildApp(loadConfig(), { worker: false });
try {
  await s.app.ready();
  await mkdir("contracts", { recursive: true });
  const routes = [...s.routes].sort(
    (a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method),
  );
  await writeFile(
    "contracts/implemented-routes.json",
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        contract: "actual_fastify_route_inventory",
        not_full_design_openapi: true,
        routes,
      },
      null,
      2,
    ),
  );
  console.log(routes.length + " implemented method/path pairs exported.");
} finally {
  await s.app.close();
}
