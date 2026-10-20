import { registerAdminApprovals } from "./admin-approvals.js";
import { seedCommercialPlans } from "./commercial-plans.js";
import { registerAdminPlans } from "./admin-plans.js";
import { registerCapabilityReleases } from "./capability-releases.js";
import { registerAdminVip } from "./admin-vip.js";
import { registerAdminVipCredit } from "./admin-vip-credit.js";
import { registerUserEntitlements } from "./user-entitlements.js";
import { registerFinancialNotifications } from "./financial-notifications.js";
import { registerSupport, assertSupportContext } from "./admin-support.js";
import { commandPublicKey } from "./device-signing.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import multipart from "@fastify/multipart";
import { ZodError } from "zod";
import { pathToFileURL } from "node:url";
import { loadConfig, type Config } from "./config.js";
import { retentionPolicy } from "./retention.js";
import { Database } from "./db.js";
import { Catalog } from "./catalog.js";
import { Problem } from "./lib.js";
import { registerAuth, principal as sessionPrincipal } from "./auth.js";
import { registerWorkspaces } from "./workspaces.js";
import { registerAssets } from "./assets.js";
import { Storage } from "./storage.js";
import { registerAnalytics } from "./analytics.js";
import { registerFileImports } from "./analytics-file-routes.js";
import { registerAnalysisReports } from "./analysis-reports.js";
import { registerTasks } from "./tasks.js";
import { registerAdmin } from "./admin.js";
import { registerAdminOperations } from "./admin-operations.js";
import { registerAdminMemberships } from "./admin-memberships.js";
import { registerAdminAccounts } from "./admin-accounts.js";
import { registerAdminBilling } from "./admin-billing.js";
import { registerAdminPayments } from "./admin-payments.js";
import { registerAdminRefunds } from "./admin-refunds.js";
import { registerAdminFees } from "./admin-fees.js";
import { seedRoles, auditDenied } from "./admin-access.js";
import { Worker } from "./worker.js";
import { registerBusiness } from "./business.js";
import { registerPersistentWork } from "./persistent-work.js";
import { registerAdminIdentities } from "./admin-identities.js";
import { registerSchedules } from "./schedules.js";
import { registerFederation } from "./federation.js";
import { registerDeletions } from "./deletions.js";
import { startDemoGateway } from "./demo-gateway.js";
import { registerDemo } from "./demo.js";
import { registerUploads } from "./uploads.js";
import { registerTaskEvents } from "./task-events.js";
import { registerCloudFiles } from "./cloud-files.js";
import { registerNotifications } from "./notifications.js";
import { registerTaskDependencies } from "./task-dependencies.js";
import { seedRuntimeProfile } from "./runtime-profiles.js";
import {
  seedAgentTemplates,
  registerAgentTemplates,
} from "./agent-templates.js";
import {
  seedSkillVersions,
  registerSkillLifecycle,
} from "./skill-lifecycle.js";

export async function buildApp(c: Config, options: { worker?: boolean } = {}) {
  const demo = c.DEMO_MODE ? await startDemoGateway(c) : undefined;
  if (demo) c = demo.config;
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
  await seedCommercialPlans(db, catalog);
  await seedSkillVersions(db, catalog);
  await seedRuntimeProfile(db, catalog);
  await seedAgentTemplates(db, catalog);
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
      "X-Tenant-ID",
      "X-Billing-Account-ID",
      "X-Admin-Preview-ID",
      "X-CopyPaste-Support-Session",
      "Last-Event-ID",
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
    if (req.headers["x-copypaste-support-session"] !== undefined) {
      try {
        req.principal = await sessionPrincipal(db, req, "admin");
      } catch {
        /* A rejected context never authenticates the customer. */
      }
    }
    assertSupportContext(req);
    const origin = req.headers.origin;
    if (origin && !origins.includes(origin))
      throw new Problem(
        403,
        "ORIGIN_DENIED",
        "Unregistered application origin",
      );
    if (
      req.headers["x-billing-account-id"] !== undefined &&
      (req.method !== "POST" ||
        req.routeOptions.url !== "/v1/tenants/:tenant/projects/:project/tasks")
    )
      throw new Problem(
        400,
        "BILLING_SELECTION_UNSUPPORTED",
        "This operation does not support an explicit billing account",
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
    } else if (
      (error as any).code === "23514" &&
      [
        "PLAN_SEAT_LIMIT",
        "PLAN_STORAGE_LIMIT",
        "PLAN_RECONCILIATION_REQUIRED",
        "UPLOAD_RESERVATION_INVALID",
        "RESOURCE_SCOPE_INVALID",
        "RESOURCE_IDENTITY_IMMUTABLE",
      ].includes((error as any).message)
    ) {
      status = 409;
      code = (error as any).message;
      message = (
        {
          PLAN_SEAT_LIMIT:
            "Workspace seat limit reached; remove a membership or change the workspace plan",
          PLAN_STORAGE_LIMIT:
            "Workspace storage limit reached; finish content cleanup, cancel pending uploads or change the workspace plan",
          PLAN_RECONCILIATION_REQUIRED:
            "A valid fixed plan definition is required before adding resources",
          UPLOAD_RESERVATION_INVALID:
            "The upload reservation is unavailable or does not match this content",
          RESOURCE_SCOPE_INVALID: "The resource scope or size is invalid",
          RESOURCE_IDENTITY_IMMUTABLE:
            "A resource identity or completed upload cannot be changed",
        } as Record<string, string>
      )[code];
    } else if (
      (error as any).code === "23514" &&
      (error as any).message === "UPLOAD_QUOTA"
    ) {
      status = 429;
      code = "UPLOAD_QUOTA";
      message = "Complete or cancel pending uploads before starting more";
    } else if (
      (error as any).code === "23514" &&
      /^WORKSPACE_/.test((error as any).message ?? "")
    ) {
      status = 409;
      code = (error as any).message;
      message =
        "The file name, folder, reference or workspace scope is invalid";
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
    version: "0.5.0",
  }));
  app.get("/health/ready", async () => {
    await db.app.query("SELECT 1");
    return {
      ok: true,
      kernel: "codex",
      ai_ready: !!(c.AI_VERIFIED && c.AI_BASE_URL && c.AI_MODEL),
      email_delivery: c.DEV_MAILBOX ? "local_development" : "smtp",
      storage: c.S3_BUCKET ? "s3" : "native_filesystem",
      data_mode: c.DEMO_MODE ? "simulated" : "configured_services",
    };
  });
  app.get("/v1/public/config", async () => ({
    brand: "CopyPaste",
    data_mode: c.DEMO_MODE ? "simulated" : "configured_services",
    locales: ["zh-HK", "en"],
    retention: retentionPolicy,
    auth: { email_code: true, enterprise_sso: true },
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
  registerFederation(app, db);
  registerWorkspaces(app, db);
  registerDemo(app, db);
  registerAssets(app, db, storage);
  registerUploads(app, db, storage);
  registerCloudFiles(app, db, storage);
  registerDeletions(app, db);
  registerAnalytics(app, db, storage);
  registerFileImports(app, db, storage);
  registerAnalysisReports(app, db, catalog, storage);
  registerTasks(app, db, catalog);
  registerTaskEvents(app, db);
  registerPersistentWork(app, db, catalog);
  registerAgentTemplates(app, db, catalog);
  registerSkillLifecycle(app, db, catalog);
  registerNotifications(app, db);
  registerUserEntitlements(app, db);
  registerFinancialNotifications(app, db);
  registerSupport(app, db);
  registerTaskDependencies(app, db);
  registerBusiness(app, db, storage, catalog);
  registerSchedules(app, db, catalog);
  registerAdmin(app, db, catalog, storage);
  registerAdminPlans(app, db, catalog);
  registerCapabilityReleases(app, db, catalog);
  registerAdminVip(app, db);
  registerAdminVipCredit(app, db);
  registerAdminOperations(app, db);
  registerAdminMemberships(app, db);
  registerAdminAccounts(app, db);
  registerAdminBilling(app, db);
  registerAdminFees(app, db);
  registerAdminPayments(app, db);
  registerAdminRefunds(app, db);
  registerAdminApprovals(app, db, catalog);
  registerAdminIdentities(app, db);
  let started = false;
  if (options.worker !== false && c.WORKER_ENABLED) {
    await worker.start();
    started = true;
  }
  app.addHook("onClose", async () => {
    if (started) await worker.stop();
    await db.close();
    await demo?.close();
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
