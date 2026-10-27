import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { loadConfig } from "../src/config.js";
import { Database } from "../src/db.js";
import { Catalog } from "../src/catalog.js";
import { seedRoles } from "../src/admin-access.js";
import { email, seal } from "../src/lib.js";
const address = email.parse(process.argv[2]);
const role = process.argv[3] ?? "super_admin";
const c = loadConfig();
const db = new Database(c);
const catalog = new Catalog();
await catalog.load();
if (!catalog.admin.roles.some((r: any) => r.id === role))
  throw new Error("Unknown built-in admin role");
try {
  await seedRoles(db, catalog);
  const secret = new OTPAuth.Secret({ size: 20 });
  const uri = new OTPAuth.TOTP({
    issuer: "CopyPaste Admin",
    label: address,
    secret,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  }).toString();
  const id = await db.tx(
    async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('admin-bootstrap',0))",
      );
      const p = (
        await tx.query(
          "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
          [address, address.split("@")[0], seal(c.MASTER_KEY!, secret.base32)],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",
        [p.id, role],
      );
      return p.id;
    },
    undefined,
    true,
  );
  await mkdir(".data/enrolment", { recursive: true });
  const file = `.data/enrolment/${id}.json`;
  await writeFile(
    file,
    JSON.stringify(
      {
        email: address,
        role,
        totp_uri: uri,
        secret: secret.base32,
        notice:
          "Import into an authenticator, then delete this local enrollment file. Never commit this file.",
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  );
  console.log(
    `Created admin ${address}. One-time local enrollment: ${file}. No shared default account.`,
  );
} finally {
  await db.close();
}
