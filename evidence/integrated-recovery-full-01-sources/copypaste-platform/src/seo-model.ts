import { z } from "zod";
import { canonical, hash, Problem, uuid } from "./lib.js";

export const seoVersion = "scoped-seo/1.0.0";
export const seoUserAgent = "CopyPasteBot/1.0 (+https://copypaste.hk/)";
export const seoLimits = Object.freeze({
  startURLs: 20,
  hosts: 20,
  prefixes: 20,
  pages: 1000,
  frontier: 10000,
  redirects: 5,
  responseBytes: 2_000_000,
  robotsBytes: 1_000_000,
  runBytes: 50_000_000,
  requestMs: 20000,
  lifetimeMs: 6 * 3600000,
  attemptsPerPage: 3,
  cacheMs: 24 * 3600000,
  linksPerPage: 2000,
});

export function seoError(
  code: string,
  message = "The website request is outside the confirmed scope",
): never {
  throw new Problem(422, code, message);
}

/** A decoded path is used only for policy checks; requests retain their original encoding. */
export function seoPolicyPath(value: string): string {
  if (!value.startsWith("/")) seoError("SEO_PATH_INVALID");
  let path = value;
  for (let n = 0; n < 5; n++) {
    if (
      /[\\\u0000-\u001f\u007f]/u.test(path) ||
      /%(?:2f|5c|00|0a|0d)/i.test(path)
    )
      seoError("SEO_PATH_AMBIGUOUS");
    if (path.split("/").some((part) => part === "." || part === ".."))
      seoError("SEO_PATH_AMBIGUOUS");
    let decoded: string;
    try {
      decoded = decodeURIComponent(path);
    } catch {
      return seoError("SEO_PATH_AMBIGUOUS");
    }
    if (decoded === path) return path;
    path = decoded;
  }
  return seoError("SEO_PATH_AMBIGUOUS");
}

export function seoURL(value: string): URL {
  if (value.length > 4096 || /[\\\u0000-\u0020\u007f]/u.test(value))
    seoError("SEO_URL_INVALID");
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return seoError("SEO_URL_INVALID");
  }
  if (
    !["http:", "https:"].includes(u.protocol) ||
    u.port ||
    u.username ||
    u.password ||
    u.hostname.endsWith(".")
  )
    seoError("SEO_URL_INVALID");
  if (u.search.length > 2000 || [...u.searchParams].length > 40)
    seoError("SEO_URL_INVALID");
  seoPolicyPath(u.pathname);
  u.hash = "";
  return u;
}

export function seoHost(value: string): string {
  if (
    value.length > 253 ||
    value !== value.trim() ||
    /[\\/?#@*\s]/u.test(value)
  )
    seoError("SEO_HOST_INVALID");
  const u = seoURL("http://" + value);
  if (u.pathname !== "/" || u.search) seoError("SEO_HOST_INVALID");
  return u.hostname;
}

const host = z
  .string()
  .min(1)
  .max(253)
  .transform((s, ctx) => {
    try {
      return seoHost(s);
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Use an exact public website host without a port or wildcard",
      });
      return z.NEVER;
    }
  });
const url = z
  .string()
  .min(1)
  .max(4096)
  .transform((s, ctx) => {
    try {
      return seoURL(s).href;
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Use an unambiguous HTTP/HTTPS URL on a standard port",
      });
      return z.NEVER;
    }
  });
const prefix = z
  .string()
  .min(1)
  .max(1000)
  .transform((s, ctx) => {
    try {
      if (s.includes("?") || s.includes("#")) seoError("SEO_PATH_INVALID");
      return seoPolicyPath(s).replace(/\/+$/, "") || "/";
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Use an unambiguous absolute path prefix",
      });
      return z.NEVER;
    }
  });
export const seoInput = z
  .object({
    prompt: z.string().trim().min(1).max(30000),
    start_urls: z.array(url).min(1).max(seoLimits.startURLs),
    allowed_hosts: z.array(host).min(1).max(seoLimits.hosts),
    max_pages: z.number().int().min(1).max(seoLimits.pages),
    allowed_path_prefixes: z.array(prefix).max(seoLimits.prefixes).default([]),
    concurrency: z.number().int().min(1).max(10).default(2),
    cache_policy: z.enum(["reuse_valid", "refresh"]).default("refresh"),
    connection_id: uuid.optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    for (const key of [
      "start_urls",
      "allowed_hosts",
      "allowed_path_prefixes",
    ] as const)
      if (new Set(v[key]).size !== v[key].length)
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "Remove duplicate entries",
        });
    for (const value of v.start_urls) {
      try {
        assertSeoScope(value, v);
      } catch {
        ctx.addIssue({
          code: "custom",
          path: ["start_urls"],
          message:
            "Every starting URL must be inside the confirmed hosts and path prefixes",
        });
      }
    }
  })
  .transform((v) => ({
    ...v,
    start_urls: [...v.start_urls].sort(),
    allowed_hosts: [...v.allowed_hosts].sort(),
    allowed_path_prefixes: [...v.allowed_path_prefixes].sort(),
  }));
export type SeoInput = z.infer<typeof seoInput>;
export function assertSeoScope(
  value: string,
  spec: Pick<SeoInput, "allowed_hosts" | "allowed_path_prefixes">,
  robots = false,
): URL {
  const u = seoURL(value);
  if (!spec.allowed_hosts.includes(u.hostname)) seoError("SEO_HOST_DENIED");
  if (!robots) {
    const path = seoPolicyPath(u.pathname);
    if (
      spec.allowed_path_prefixes.length &&
      !spec.allowed_path_prefixes.some(
        (p) => p === "/" || path === p || path.startsWith(p + "/"),
      )
    )
      seoError("SEO_PATH_DENIED");
  }
  return u;
}
export const seoSpecHash = (spec: SeoInput) =>
  hash(canonical({ version: seoVersion, ...spec }));

export type SeoLocation = {
  start: number;
  end: number;
  unit: "utf16_code_units";
  quote: string;
};
export type SeoIssue = {
  code: string;
  severity: "info" | "warning" | "error";
  url: string;
  location: SeoLocation | null;
  target_url?: string;
  detail: string;
};
export type SeoPage = {
  url: string;
  title: string;
  descriptions: string[];
  headings: string[];
  canonical_urls: string[];
  robots: string[];
  json_ld: { valid: boolean; location: SeoLocation }[];
  links: { url: string; nofollow: boolean; location: SeoLocation }[];
  issues: SeoIssue[];
  login_page: boolean;
  nofollow: boolean;
  content_language: string | null;
  source_sha256: string;
  limitations: string[];
};
