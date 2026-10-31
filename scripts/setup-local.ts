import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
const envPath = path.resolve(".env");
try {
  await readFile(envPath);
  console.log("Existing .env preserved.");
} catch {
  const selectedPort = process.env.COPYPASTE_SOURCE_DATABASE_PORT ?? "55432";
  const localDatabasePort = Number(selectedPort);
  if (!/^\d+$/.test(selectedPort) || localDatabasePort < 1024 || localDatabasePort > 65535 || [4310,4317,4318,4319].includes(localDatabasePort))
    throw new Error("Select an explicit unprivileged local database port");
  const appPass = randomBytes(24).toString("hex"),
    controlPass = randomBytes(24).toString("hex");
  const queuePass = randomBytes(24).toString("hex"),
    ownerPass = randomBytes(24).toString("hex");
  await writeFile(
    envPath,
    [
      "NODE_ENV=development",
      "PORT=4310",
      "HOST=127.0.0.1",
      "WEB_ORIGIN=http://localhost:4317",
      "ADMIN_ORIGIN=http://localhost:4318",
      "API_ORIGIN=http://localhost:4310",
      `MASTER_KEY=${randomBytes(32).toString("hex")}`,
      "DEV_MAILBOX=true",
      `DATABASE_URL=postgresql://cp_app:${appPass}@127.0.0.1:${localDatabasePort}/copypaste`,
      `CONTROL_DATABASE_URL=postgresql://cp_control:${controlPass}@127.0.0.1:${localDatabasePort}/copypaste`,
      `QUEUE_DATABASE_URL=postgresql://cp_queue:${queuePass}@127.0.0.1:${localDatabasePort}/copypaste`,
      `OWNER_DATABASE_URL=postgresql://cp_owner:${ownerPass}@127.0.0.1:${localDatabasePort}/copypaste`,
      "CODEX_VERSION=0.163.0-alpha.10.2",
      "EXTENSION_ID=fffkcnmfdhahlnifgdilabheppkgnlok",
      "AI_VERIFIED=false",
      "AI_IMAGE_VERIFIED=false",
      "WORKER_ENABLED=true",
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    "Created .env with unique local database identities and encryption key. No credentials printed.",
  );
}
await mkdir(".data/mailbox", { recursive: true });
