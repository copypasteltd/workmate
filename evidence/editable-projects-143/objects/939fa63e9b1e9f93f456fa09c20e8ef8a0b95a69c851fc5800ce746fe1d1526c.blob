import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.js";
import { Database } from "../src/db.js";
import { uuid } from "../src/lib.js";
import { providerReason } from "../src/provider-admin-model.js";
import { enableProviderAdmin } from "../src/provider-admin-bootstrap.js";
const { values } = parseArgs({
  options: {
    principal: { type: "string" },
    reason: { type: "string" },
    apply: { type: "boolean", default: false },
    "expected-hash": { type: "string" },
  },
});
const id = uuid.parse(values.principal),
  reason = providerReason.parse(values.reason);
if (values.apply && !/^[a-f0-9]{64}$/.test(values["expected-hash"] ?? ""))
  throw new Error("--apply requires the exact preview --expected-hash");
if (!values.apply && values["expected-hash"])
  throw new Error("Use --expected-hash only with --apply");
const catalog = JSON.parse(
  await readFile("catalog/provider-admin-permissions.json", "utf8"),
);
const db = new Database(loadConfig());
try {
  const result = await db.tx(
    (tx) =>
      enableProviderAdmin(
        tx,
        id,
        reason,
        catalog.permissions.map((p: { key: string }) => p.key),
        values.apply ? values["expected-hash"] : undefined,
      ),
    undefined,
    true,
  );
  console.log(JSON.stringify(result));
} finally {
  await db.close();
}
