import { z } from "zod";
import { randomBytes } from "node:crypto";

const bool = z.enum(["true", "false"]).transform((v) => v === "true");
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  HOST: z.string().default("127.0.0.1"),
  PORT: z.coerce.number().int().default(4310),
  TRUSTED_PROXIES: z.string().default("127.0.0.1,::1"),
  DATABASE_URL: z
    .string()
    .default("postgresql://cp_app:local-only@127.0.0.1:55432/copypaste"),
  CONTROL_DATABASE_URL: z
    .string()
    .default("postgresql://cp_control:local-only@127.0.0.1:55432/copypaste"),
  QUEUE_DATABASE_URL: z
    .string()
    .default("postgresql://cp_queue:local-only@127.0.0.1:55432/copypaste"),
  WEB_ORIGIN: z.string().url().default("http://localhost:4317"),
  ADMIN_ORIGIN: z.string().url().default("http://localhost:4318"),
  API_ORIGIN: z.string().url().default("http://localhost:4310"),
  MASTER_KEY: z
    .string()
    .regex(/^[a-f\d]{64}$/i)
    .optional(),
  DATA_DIR: z.string().default(".data"),
  DEV_MAILBOX: bool.default(true),
  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default("CopyPaste <hello@copypaste.hk>"),
  SSO_ALLOWED_ORIGINS: z.string().default(""),
  SSO_ALLOW_LOCALHOST: bool.default(false),
  SSO_CALLBACK_ORIGIN: z.string().url().optional(),
  CODEX_BIN: z.string().default("codex"),
  CODEX_VERSION: z.string().default("0.163.0-alpha.10.2"),
  AI_BASE_URL: z.string().url().optional(),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_REASONING_EFFORT: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .default("max"),
  AI_IMAGE_MODEL: z.string().optional(),
  AI_VIDEO_MODEL: z.string().optional(),
  AI_ALLOWED_HOSTS: z.string().default(""),
  AI_VERIFIED: bool.default(false),
  AI_IMAGE_VERIFIED: bool.default(false),
  AI_IMAGE_HKD_MICROS_PER_IMAGE: z.coerce.number().int().positive().optional(),
  AI_INPUT_HKD_MICROS_PER_MILLION: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional(),
  AI_OUTPUT_HKD_MICROS_PER_MILLION: z.coerce
    .number()
    .int()
    .nonnegative()
    .optional(),
  AI_MAX_REQUEST_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(40_000_000)
    .default(16_000_000),
  AI_MAX_RESPONSE_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100_000_000)
    .default(70_000_000),
  AI_MAX_OUTPUT_TOKENS: z.coerce
    .number()
    .int()
    .min(16)
    .max(131072)
    .default(16384),
  AI_MAX_REQUESTS_PER_TURN: z.coerce.number().int().min(1).max(512).default(64),
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10)
    .max(900000)
    .default(180000),
  AI_STREAM_IDLE_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(10)
    .max(300000)
    .default(60000),
  AI_SCOPE_TTL_MS: z.coerce.number().int().min(10).max(900000).default(900000),
  WORKER_ENABLED: bool.default(true),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(10),
  DEMO_MODE: bool.default(false),
  EXTENSION_ID: z.string().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().default("auto"),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY: z.string().optional(),
  S3_SECRET_KEY: z.string().optional(),
});
export type Config = z.infer<typeof schema>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const c = schema.parse(env);
  if (
    c.DEMO_MODE &&
    (c.NODE_ENV === "production" ||
      !["127.0.0.1", "localhost", "::1"].includes(c.HOST))
  )
    throw new Error(
      "DEMO_MODE requires a loopback development/test server; it is forbidden in production",
    );
  for (const key of [
    "WEB_ORIGIN",
    "ADMIN_ORIGIN",
    "API_ORIGIN",
    "SSO_CALLBACK_ORIGIN",
  ] as const) {
    if (!c[key]) continue;
    const u = new URL(c[key]);
    if (u.origin !== c[key] || !["http:", "https:"].includes(u.protocol))
      throw new Error(
        `${key} must be an exact HTTP(S) origin without a path or credentials`,
      );
  }
  for (const value of c.SSO_ALLOWED_ORIGINS.split(",")
    .map((v) => v.trim())
    .filter(Boolean)) {
    const u = new URL(value);
    if (u.protocol !== "https:" || u.origin !== value)
      throw new Error(
        "SSO_ALLOWED_ORIGINS must contain exact HTTPS origins without paths or credentials",
      );
  }
  if (
    c.SSO_CALLBACK_ORIGIN &&
    ![c.WEB_ORIGIN, c.API_ORIGIN].includes(c.SSO_CALLBACK_ORIGIN)
  )
    throw new Error(
      "SSO callback origin must match the public Web or API origin",
    );
  if (c.NODE_ENV === "production" && c.SSO_ALLOW_LOCALHOST)
    throw new Error("Local SSO fixtures are forbidden in production");
  if (c.NODE_ENV === "production") {
    if (!c.MASTER_KEY || c.DEV_MAILBOX || !c.SMTP_URL)
      throw new Error(
        "Production requires MASTER_KEY, SMTP_URL and DEV_MAILBOX=false",
      );
    for (const name of ["WEB_ORIGIN", "ADMIN_ORIGIN", "API_ORIGIN"] as const)
      if (!c[name].startsWith("https://"))
        throw new Error(`${name} must use HTTPS`);
    if (
      c.DATABASE_URL.includes("local-only") ||
      c.CONTROL_DATABASE_URL === c.DATABASE_URL
    )
      throw new Error(
        "Production requires separate restricted database identities",
      );
  }
  if (c.AI_BASE_URL) {
    const u = new URL(c.AI_BASE_URL);
    if (!["http:", "https:"].includes(u.protocol))
      throw new Error("AI gateway requires HTTP(S)");
    if (u.username || u.password || u.search || u.hash)
      throw new Error("AI gateway URL cannot contain credentials or query");
    if (
      !c.AI_ALLOWED_HOSTS.split(",")
        .map((s) => s.trim())
        .includes(u.hostname)
    )
      throw new Error("AI gateway must be explicitly allowlisted");
    if (c.NODE_ENV === "production" && u.protocol !== "https:")
      throw new Error("AI gateway requires HTTPS");
  }
  if (!c.MASTER_KEY) {
    // Only test callers may use an ephemeral key; dev start loads a durable key from .env.
    if (c.NODE_ENV !== "test")
      throw new Error(
        "Run npm run setup:local to create a durable local MASTER_KEY",
      );
    c.MASTER_KEY = randomBytes(32).toString("hex");
  }
  return c;
}
