import { commandPublicKey } from "./device-signing.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { pathToFileURL } from "node:url";
import { loadConfig, type Config } from "./config.js";
import { Database } from "./db.js";
import { Catalog } from "./catalog.js";
import { Problem } from "./lib.js";
import { registerAuth } from "./auth.js";
import { registerWorkspaces } from "./workspaces.js";
import { registerAssets } from "./assets.js";
import { Storage } from "./storage.js";
import { registerAnalytics } from "./analytics.js";
import { registerTasks } from "./tasks.js";
import { registerAdmin } from "./admin.js";
import { registerAdminOperations } from "./admin-operations.js";
import { seedRoles, auditDenied } from "./admin-access.js";
import { Worker } from "./worker.js";
import { registerBusiness } from "./business.js";
import { registerPersistentWork } from "./persistent-work.js";

export async function buildApp(c: Config, options: { worker?: boolean } = {}) {
  const db = new Database(c);
  const catalog = new Catalog();
  await catalog.load();
  const identity = (
    await db.app.query(
      "SELECT r.rolsuper,r.rolbypassrls,current_user FROM pg_roles r WHERE r.rolname=current_user",
    )
  ).rows[0];
  if (
    identity.rolsuper ||
    identity.rolbypassrls ||
    identity.current_user !== "cp_app"
  )
    throw new Error("Application database identity must be restricted cp_app");
  await seedRoles(db, catalog);
  const storage = new Storage(c);
  const worker = new Worker(db, catalog, storage);
  const app = Fastify({
    bodyLimit: 8 * 1024 * 1024,
    logger: false,
    requestTimeout: 200000,
    trustProxy: c.TRUSTED_PROXIES.split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    genReqId: () => crypto.randomUUID(),
  });
  const origins = [
    c.WEB_ORIGIN,
    c.ADMIN_ORIGIN,
    ...(c.EXTENSION_ID ? [`chrome-extension://${c.EXTENSION_ID}`] : []),
  ];
  const routes: { method: string; path: string }[] = [];
  app.addHook("onRoute", (route) => {
    for (const method of Array.isArray(route.method)
      ? route.method
      : [route.method])
      if (method !== "HEAD" && method !== "OPTIONS")
        routes.push({ method, path: route.url });
  });
  await app.register(cookie);
  await app.register(cors, {
    origin: (origin, done) => done(null, !origin || origins.includes(origin)),
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "X-CSRF-Token",
      "Idempotency-Key",
      "Authorization",
    ],
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
  await app.register(rateLimit, {
    max:
      c.NODE_ENV === "test" ? 10000 : c.NODE_ENV === "development" ? 1000 : 600,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
  });
  await app.register(multipart, {
    limits: { fileSize: 25 * 1024 * 1024, files: 1, fields: 10 },
  });
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin))
      throw new Problem(
        403,
        "ORIGIN_DENIED",
        "Unregistered application origin",
      );
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store")
      .header("X-Request-Id", req.id)
      .header(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
    if (c.NODE_ENV === "production")
      reply.header(
        "Strict-Transport-Security",
        "max-age=31536000; includeSubDomains",
      );
  });
  app.setErrorHandler(async (error, req, reply) => {
    let status = 500,
      code = "INTERNAL_ERROR",
      message = "暫時無法完成，請稍後重試 / Unable to complete this request",
      details: unknown;
    if (error instanceof ZodError) {
      status = 400;
      code = "VALIDATION_ERROR";
      message = "請檢查輸入內容 / Please check your input";
      details = error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
    } else if (error instanceof Problem) {
      status = error.status;
      code = error.code;
      message = error.message;
      details = error.details;
    } else if ((error as any).code === "23505") {
      status = 409;
      code = "ALREADY_EXISTS";
      message = "A matching record or payment reference already exists";
    } else if ((error as any).code === "23503") {
      status = 409;
      code = "RELATED_RECORD_REQUIRED";
      message =
        "A referenced record does not exist or belongs to another workspace";
    } else if ((error as any).statusCode === 429) {
      status = 429;
      code = "RATE_LIMITED";
      message = "Please wait before trying again";
    } else if ((error as any).code === "FST_REQ_FILE_TOO_LARGE") {
      status = 413;
      code = "FILE_TOO_LARGE";
      message = "File exceeds 25 MB";
    } else if (
      typeof (error as any).statusCode === "number" &&
      (error as any).statusCode < 500
    ) {
      status = (error as any).statusCode;
      code = "REQUEST_INVALID";
      message = "Request could not be processed";
    }
    if (req.principal?.audience === "admin")
      await auditDenied(
        db,
        req.principal,
        req.routeOptions.url ?? req.method,
        undefined,
        code,
      ).catch(() => {});
    if (status >= 500)
      console.error(
        JSON.stringify({
          request_id: req.id,
          code,
          error_type:
            error instanceof Error ? error.constructor.name : "Unknown",
          db_code: /^\d{5}$/.test((error as any).code ?? "")
            ? (error as any).code
            : undefined,
        }),
      );
    return reply
      .status(status)
      .send({ error: { code, message, details, request_id: req.id } });
  });
  app.get("/health/live", async () => ({
    ok: true,
    service: "copypaste-platform",
    version: "0.2.0",
  }));
  app.get("/health/ready", async () => {
    await db.app.query("SELECT 1");
    return {
      ok: true,
      kernel: "codex",
      ai_ready: !!(c.AI_VERIFIED && c.AI_BASE_URL && c.AI_MODEL),
      email_delivery: c.DEV_MAILBOX ? "local_development" : "smtp",
      storage: c.S3_BUCKET ? "s3" : "native_filesystem",
    };
  });
  app.get("/v1/public/config", async () => ({
    brand: "CopyPaste",
    locales: ["zh-HK", "en"],
    auth: { email_code: true, enterprise_sso: false },
    services: {
      text: !!(c.AI_VERIFIED && c.AI_BASE_URL && c.AI_MODEL),
      image: !!(c.AI_IMAGE_VERIFIED && c.AI_IMAGE_MODEL),
      video: false,
    },
    device_command_public_key: commandPublicKey(c.MASTER_KEY!),
    mail_mode:
      c.NODE_ENV === "production"
        ? "email"
        : c.DEV_MAILBOX
          ? "local_mailbox"
          : "email",
  }));
  app.get("/v1/public/content", async () =>
    db.tx(
      async (tx) => ({
        items: (
          await tx.query(
            "SELECT id,kind,key,version,body FROM catalog_entries WHERE state='published' AND kind IN ('help','announcement','navigation') AND (kind='navigation' OR coalesce((body->>'enabled')::boolean,true)) ORDER BY created_at DESC",
          )
        ).rows,
      }),
      undefined,
      true,
    ),
  );
  registerAuth(app, db);
  registerWorkspaces(app, db);
  registerAssets(app, db, storage);
  registerAnalytics(app, db);
  registerTasks(app, db, catalog);
  registerPersistentWork(app, db, catalog);
  registerBusiness(app, db, storage, catalog);
  registerAdmin(app, db, catalog, storage);
  registerAdminOperations(app, db);
  let started = false;
  if (options.worker !== false && c.WORKER_ENABLED) {
    await worker.start();
    started = true;
  }
  app.addHook("onClose", async () => {
    if (started) await worker.stop();
    await db.close();
  });
  return { app, db, catalog, worker, storage, routes };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const c = loadConfig();
  const { app } = await buildApp(c);
  await app.listen({ host: c.HOST, port: c.PORT });
  console.log(`CopyPaste API ready at ${c.API_ORIGIN}`);
  let stopping = false;
  async function stop() {
    if (stopping) return;
    stopping = true;
    await app.close();
    process.exit(0);
  }
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("message", (message) => {
    if ((message as any)?.action === "shutdown") void stop();
  });
}
