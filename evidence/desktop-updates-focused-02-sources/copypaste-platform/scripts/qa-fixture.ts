import { loadConfig } from "../src/config.js";
import { Database } from "../src/db.js";
import { seal } from "../src/lib.js";
import * as OTPAuth from "otpauth";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
const config = loadConfig();
if (config.NODE_ENV === "production")
  throw new Error("QA fixtures are disabled in production");
const db = new Database(config);
try {
  const id = randomUUID(),
    email = `qa-admin-${id.slice(0, 8)}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  await db.control.query(
    "INSERT INTO admin_principals(id,email,name,totp_secret) VALUES($1,$2,$3,$4)",
    [id, email, "Avery · Operations", seal(config.MASTER_KEY!, secret.base32)],
  );
  await db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) VALUES($1,'super_admin','global','allow')",
    [id],
  );
  await mkdir(".data/qa", { recursive: true });
  await writeFile(
    ".data/qa/operator.json",
    JSON.stringify({ email, totp_secret: secret.base32 }),
    { mode: 0o600 },
  );
  console.log(
    "QA operator created. Private enrolment is stored in .data/qa/operator.json.",
  );
} finally {
  await db.close();
}
