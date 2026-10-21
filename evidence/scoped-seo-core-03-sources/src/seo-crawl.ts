import { randomUUID } from "node:crypto";
import { canonical, hash, Problem } from "./lib.js";
import {
  assertSeoScope,
  seoInput,
  seoLimits,
  seoSpecHash,
  seoVersion,
  type SeoInput,
  type SeoIssue,
  type SeoPage,
} from "./seo-model.js";
import {
  type SeoResponse,
  type SeoTransport,
  SeoFetchFailure,
} from "./seo-http.js";
import { decodeSeoHTML, parseSeoPage } from "./seo-page.js";
import { parseSeoRobots } from "./seo-robots.js";

export type SeoVisit = {
  state:
    | "queued"
    | "success"
    | "redirect"
    | "http_error"
    | "blocked"
    | "failed"
    | "unvisited";
  attempts: number;
  redirects: number;
  chain: string[];
  source_id?: string;
  status?: number;
  target?: string;
  reason?: string;
  robots_source_id?: string;
  robots_line?: number | null;
};
type SeoPolicy = {
  state: "queued" | "allowed" | "rules" | "blocked";
  url: string;
  attempts: number;
  redirects: number;
  chain: string[];
  source_id?: string;
  reason?: string;
  crawl_delay_ms?: number | null;
};
export type SeoCheckpoint = {
  version: typeof seoVersion;
  spec_hash: string;
  spec: SeoInput;
  state: "queued" | "running" | "complete" | "partial" | "cancelled";
  created_at: string;
  expires_at: string;
  updated_at: string;
  next_at: string;
  page_requests: number;
  robots_requests: number;
  byte_budget_used: number;
  active: null | {
    kind: "page" | "robots";
    key: string;
    reserved_bytes: number;
  };
  visits: Record<string, SeoVisit>;
  policies: Record<string, SeoPolicy>;
  frontier: string[];
  limitations: string[];
};
export type SeoDocument = {
  id: string;
  kind: "page" | "robots";
  policy_origin?: string;
  url: string;
  status: number;
  effective_status: number;
  headers: Record<string, string>;
  response_sha256: string;
  raw_sha256: string;
  source_sha256: string | null;
  captured_at: string;
  content_captured_at: string;
  source_mode: SeoResponse["source_mode"];
  raw: Buffer;
  text: string | null;
  charset: string | null;
  page: SeoPage | null;
  cache_source_id: string | null;
  error_code: string | null;
};
export interface SeoCrawlStore {
  /** The application must recheck current task, project, actor and retained source access. */
  authorize(): Promise<void>;
  /** Persist the state and optional immutable document in one fenced commit. */
  commit(state: SeoCheckpoint, document?: SeoDocument): Promise<void>;
  /** Never return body bytes from a quarantined, expired or erased source. */
  read(id: string): Promise<SeoDocument>;
  cached?(url: string): Promise<SeoDocument | null>;
  /** Acquire a shared per-origin rate slot; return the next permitted time if busy. */
  acquireOrigin?(origin: string, delayMs: number, now: number): Promise<number>;
}
const terminal = (state: SeoCheckpoint) =>
  ["complete", "partial", "cancelled"].includes(state.state);
const stamp = (time: number) => new Date(time).toISOString();
const addLimit = (state: SeoCheckpoint, reason: string) => {
  if (!state.limitations.includes(reason)) state.limitations.push(reason);
};
const emptyVisit = (chain: string[] = []): SeoVisit => ({
  state: "queued",
  attempts: 0,
  redirects: chain.length,
  chain,
});

export function createSeoCheckpoint(
  input: SeoInput,
  now = Date.now(),
): SeoCheckpoint {
  const spec = seoInput.parse(input),
    visits = Object.fromEntries(
      spec.start_urls.map((url) => [url, emptyVisit()]),
    );
  return {
    version: seoVersion,
    spec_hash: seoSpecHash(spec),
    spec,
    state: "queued",
    created_at: stamp(now),
    expires_at: stamp(now + seoLimits.lifetimeMs),
    updated_at: stamp(now),
    next_at: stamp(now),
    page_requests: 0,
    robots_requests: 0,
    byte_budget_used: 0,
    active: null,
    visits,
    policies: {},
    frontier: [...spec.start_urls],
    limitations: [
      "The confirmed page budget counts every page request, redirect hop and retry. Robots requests have a separate bound.",
      "Only discovered, allowed server HTML is inspected. This is not a full-site or search-ranking guarantee.",
      "The crawler currently uses one request at a time; requested concurrency is an upper limit.",
    ],
  };
}

/** Check internal persisted invariants before resuming, rather than trusting an editable checkpoint. */
export function validateSeoCheckpoint(state: SeoCheckpoint) {
  const spec = seoInput.parse(state.spec);
  if (
    state.version !== seoVersion ||
    state.spec_hash !== seoSpecHash(spec) ||
    !["queued", "running", "complete", "partial", "cancelled"].includes(
      state.state,
    ) ||
    !Number.isSafeInteger(state.page_requests) ||
    state.page_requests < 0 ||
    state.page_requests > spec.max_pages ||
    !Number.isSafeInteger(state.robots_requests) ||
    state.robots_requests < 0 ||
    state.robots_requests >
      seoLimits.hosts *
        2 *
        (seoLimits.redirects + seoLimits.attemptsPerPage + 1) ||
    !Number.isSafeInteger(state.byte_budget_used) ||
    state.byte_budget_used < 0 ||
    state.byte_budget_used > seoLimits.runBytes ||
    state.frontier.length > seoLimits.frontier ||
    new Set(state.frontier).size !== state.frontier.length ||
    Object.keys(state.visits).length > seoLimits.frontier ||
    Object.keys(state.policies).length > spec.allowed_hosts.length * 2 ||
    Buffer.byteLength(canonical(state)) > 4_000_000 ||
    ![
      state.created_at,
      state.expires_at,
      state.updated_at,
      state.next_at,
    ].every((s) => Number.isFinite(Date.parse(s))) ||
    Date.parse(state.expires_at) !==
      Date.parse(state.created_at) + seoLimits.lifetimeMs
  )
    throw new Problem(
      409,
      "SEO_CHECKPOINT_INVALID",
      "The stored crawl checkpoint is invalid",
    );
  for (const [url, visit] of Object.entries(state.visits)) {
    assertSeoScope(url, spec);
    if (
      ![
        "queued",
        "success",
        "redirect",
        "http_error",
        "blocked",
        "failed",
        "unvisited",
      ].includes(visit.state) ||
      !Number.isSafeInteger(visit.attempts) ||
      visit.attempts < 0 ||
      visit.attempts > seoLimits.attemptsPerPage ||
      visit.redirects !== visit.chain.length ||
      visit.redirects > seoLimits.redirects ||
      visit.chain.some((u) => {
        assertSeoScope(u, spec);
        return false;
      })
    )
      throw new Problem(
        409,
        "SEO_CHECKPOINT_INVALID",
        "The stored crawl checkpoint is invalid",
      );
  }
  for (const url of state.frontier)
    if (state.visits[url]?.state !== "queued")
      throw new Problem(
        409,
        "SEO_CHECKPOINT_INVALID",
        "The stored crawl frontier is invalid",
      );
  for (const [origin, policy] of Object.entries(state.policies)) {
    if (
      new URL(assertSeoScope(origin, spec, true)).origin !== origin ||
      !["queued", "allowed", "rules", "blocked"].includes(policy.state) ||
      !Number.isSafeInteger(policy.attempts) ||
      policy.attempts < 0 ||
      policy.attempts > seoLimits.attemptsPerPage ||
      policy.redirects !== policy.chain.length ||
      policy.redirects > seoLimits.redirects ||
      policy.chain.some((url) => {
        assertSeoScope(url, spec, true);
        return false;
      })
    )
      throw new Problem(
        409,
        "SEO_CHECKPOINT_INVALID",
        "The stored robots checkpoint is invalid",
      );
    assertSeoScope(policy.url, spec, true);
  }
  if (
    state.active &&
    (!["page", "robots"].includes(state.active.kind) ||
      !Number.isSafeInteger(state.active.reserved_bytes) ||
      state.active.reserved_bytes < 1 ||
      state.active.reserved_bytes > seoLimits.responseBytes ||
      !(state.active.kind === "page"
        ? state.visits[state.active.key]?.state === "queued"
        : state.policies[state.active.key]?.state === "queued"))
  )
    throw new Problem(
      409,
      "SEO_CHECKPOINT_INVALID",
      "The stored request intent is invalid",
    );
  return state;
}

function finish(state: SeoCheckpoint, reason?: string) {
  if (reason) addLimit(state, reason);
  for (const url of state.frontier)
    Object.assign(state.visits[url], {
      state: "unvisited",
      reason: reason || "SEO_NOT_REACHED",
    });
  state.frontier = [];
  state.active = null;
  const incomplete =
    Object.values(state.visits).some(
      (v) =>
        ["unvisited", "failed", "blocked"].includes(v.state) ||
        (v.state === "http_error" && ![404, 410].includes(v.status ?? 0)),
    ) || state.limitations.some((v) => v.startsWith("SEO_"));
  state.state = reason || incomplete ? "partial" : "complete";
}
const retryDelay = (
  headers: Record<string, string>,
  now: number,
  attempts: number,
) => {
  const value = headers["retry-after"];
  const requested =
    value && /^\d+$/.test(value)
      ? now + Math.min(Number(value) * 1000, 365 * 86400000)
      : value
        ? Date.parse(value)
        : NaN;
  return Math.max(
    now + 1000 * 2 ** (attempts - 1),
    Number.isFinite(requested) ? requested : now,
  );
};
function enqueue(state: SeoCheckpoint, url: string, chain: string[] = []) {
  if (state.visits[url]) return;
  // Account for the worst-case key/metadata size before extending the persisted frontier.
  if (
    Object.keys(state.visits).length >= seoLimits.frontier ||
    Buffer.byteLength(canonical(state)) + Buffer.byteLength(url) * 2 + 4000 >
      3_500_000
  ) {
    addLimit(state, "SEO_FRONTIER_LIMIT");
    return;
  }
  state.visits[url] = emptyVisit(chain);
  state.frontier.push(url);
}
function removeFrontier(state: SeoCheckpoint, url: string) {
  state.frontier = state.frontier.filter((v) => v !== url);
}

/** Advance at most one HTTP request. The request intent is committed before any network I/O. */
export async function advanceSeoCrawl(
  previous: SeoCheckpoint,
  transport: SeoTransport,
  store: SeoCrawlStore,
  options: { now?: () => number; signal?: AbortSignal } = {},
): Promise<SeoCheckpoint> {
  const state = structuredClone(validateSeoCheckpoint(previous)),
    now = options.now ?? Date.now;
  if (terminal(state)) return state;
  await store.authorize();
  const commit = async (document?: SeoDocument) => {
    state.updated_at = stamp(now());
    validateSeoCheckpoint(state);
    await store.authorize();
    await store.commit(state, document);
    return state;
  };
  if (options.signal?.aborted) {
    state.state = "cancelled";
    state.active = null;
    addLimit(state, "SEO_CANCELLED");
    return commit();
  }
  if (Date.parse(state.expires_at) <= now()) {
    finish(state, "SEO_LIFETIME_LIMIT");
    return commit();
  }
  if (state.active) {
    // A committed intent without a committed result is unknown, not a free retry.
    const { kind, key } = state.active,
      item = kind === "page" ? state.visits[key] : state.policies[key];
    item.reason = "SEO_REQUEST_OUTCOME_UNKNOWN";
    state.active = null;
    addLimit(state, "SEO_REQUEST_OUTCOME_UNKNOWN");
    if (item.attempts >= seoLimits.attemptsPerPage) {
      item.state = kind === "page" ? "failed" : "blocked";
      if (kind === "page") removeFrontier(state, key);
    }
    state.next_at = stamp(now() + 1000);
    return commit();
  }
  if (Date.parse(state.next_at) > now()) return state;
  if (!state.frontier.length) {
    finish(state);
    return commit();
  }
  if (state.page_requests >= state.spec.max_pages) {
    finish(state, "SEO_PAGE_BUDGET_LIMIT");
    return commit();
  }
  if (state.byte_budget_used >= seoLimits.runBytes) {
    finish(state, "SEO_BYTE_BUDGET_LIMIT");
    return commit();
  }
  state.state = "running";
  const pageURL = state.frontier[0],
    visit = state.visits[pageURL],
    origin = new URL(pageURL).origin;
  const policy = (state.policies[origin] ??= {
    state: "queued",
    url: origin + "/robots.txt",
    attempts: 0,
    redirects: 0,
    chain: [],
  });
  let kind: "page" | "robots" = policy.state === "queued" ? "robots" : "page";
  if (kind === "page" && policy.state === "blocked") {
    Object.assign(visit, {
      state: "blocked",
      reason: policy.reason || "SEO_ROBOTS_UNAVAILABLE",
      ...(policy.source_id ? { robots_source_id: policy.source_id } : {}),
    });
    removeFrontier(state, pageURL);
    return commit();
  }
  let delay = Math.max(1000, policy.crawl_delay_ms ?? 0);
  if (kind === "page" && policy.state === "rules") {
    const source = await store.read(policy.source_id!);
    if (
      source.kind !== "robots" ||
      source.text === null ||
      source.policy_origin !== origin
    )
      throw new Problem(
        409,
        "SEO_SOURCE_INVALID",
        "The retained robots source does not match this origin",
      );
    const decision = parseSeoRobots(origin, source.text).decide(pageURL);
    visit.robots_source_id = source.id;
    visit.robots_line = decision.line;
    if (!decision.allowed) {
      Object.assign(visit, {
        state: "blocked",
        reason: "SEO_ROBOTS_DISALLOWED",
      });
      removeFrontier(state, pageURL);
      return commit();
    }
    delay = Math.max(1000, decision.crawl_delay_ms ?? 0);
  }
  const url = kind === "robots" ? policy.url : pageURL,
    item = kind === "robots" ? policy : visit;
  const resourceOrigin = new URL(url).origin;
  if (store.acquireOrigin) {
    const permitted = await store.acquireOrigin(resourceOrigin, delay, now());
    if (permitted > now()) {
      state.next_at = stamp(Math.min(permitted, Date.parse(state.expires_at)));
      return commit();
    }
  }
  const reserved = Math.min(
    kind === "robots" ? seoLimits.robotsBytes : seoLimits.responseBytes,
    seoLimits.runBytes - state.byte_budget_used,
  );
  if (kind === "robots" && reserved < 500 * 1024) {
    finish(state, "SEO_BYTE_BUDGET_LIMIT");
    return commit();
  }
  item.attempts++;
  if (kind === "robots") state.robots_requests++;
  else state.page_requests++;
  if (
    state.robots_requests >
    seoLimits.hosts * 2 * (seoLimits.redirects + seoLimits.attemptsPerPage + 1)
  ) {
    state.robots_requests--;
    item.attempts--;
    finish(state, "SEO_ROBOTS_REQUEST_LIMIT");
    return commit();
  }
  state.byte_budget_used += reserved;
  state.active = {
    kind,
    key: kind === "robots" ? origin : pageURL,
    reserved_bytes: reserved,
  };
  await commit(); // Durable reservation precedes DNS/socket creation and every retry.
  let response: SeoResponse;
  let cached: SeoDocument | null = null;
  try {
    if (
      kind === "page" &&
      state.spec.cache_policy === "reuse_valid" &&
      store.cached
    ) {
      const candidate = await store.cached(url);
      if (
        candidate &&
        candidate.kind === "page" &&
        candidate.url === url &&
        candidate.effective_status === 200 &&
        now() - Date.parse(candidate.captured_at) <= seoLimits.cacheMs &&
        now() >= Date.parse(candidate.captured_at) &&
        !/\bno-store\b/i.test(candidate.headers["cache-control"] ?? "") &&
        !(candidate.headers.vary ?? "").split(",").some((v) => v.trim() === "*")
      )
        cached = candidate;
    }
    await store.authorize();
    response = await transport(url, state.spec, {
      robots: kind === "robots",
      signal: options.signal,
      maxBytes: reserved,
      ...(cached
        ? {
            etag: cached.headers.etag,
            modifiedSince: cached.headers["last-modified"],
          }
        : {}),
    });
    await store.authorize();
  } catch (error) {
    // Authority failures are handled by the task service, preserving the reserved unknown intent.
    if (!(error instanceof SeoFetchFailure) && error instanceof Problem)
      throw error;
    const failure =
      error instanceof SeoFetchFailure
        ? error
        : new SeoFetchFailure("SEO_TRANSPORT", true);
    state.active = null;
    item.reason = failure.code;
    if (options.signal?.aborted || failure.code === "SEO_CANCELLED") {
      state.state = "cancelled";
      addLimit(state, "SEO_CANCELLED");
      return commit();
    }
    if (!failure.retryable || item.attempts >= seoLimits.attemptsPerPage) {
      item.state = kind === "robots" ? "blocked" : "failed";
      if (kind === "page") removeFrontier(state, pageURL);
      addLimit(state, failure.code);
    }
    state.next_at = stamp(
      now() +
        Math.max(delay, 1000 * 2 ** (item.attempts - 1), failure.retryAfterMs),
    );
    return commit();
  }
  state.active = null;
  state.byte_budget_used -= reserved - response.body.length;
  state.next_at = stamp(now() + delay);
  const document: SeoDocument = {
    id: randomUUID(),
    kind,
    ...(kind === "robots" ? { policy_origin: origin } : {}),
    url,
    status: response.status,
    effective_status: response.status,
    headers: response.headers,
    response_sha256: response.sha256,
    raw_sha256: response.sha256,
    source_sha256: null,
    captured_at: response.captured_at,
    content_captured_at: response.captured_at,
    source_mode: response.source_mode,
    raw: response.body,
    text: null,
    charset: null,
    page: null,
    cache_source_id: null,
    error_code: null,
  };
  item.source_id = document.id;
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    try {
      if (!response.headers.location)
        throw new SeoFetchFailure("SEO_REDIRECT_INVALID");
      const target = assertSeoScope(
        new URL(response.headers.location, url).href,
        state.spec,
        kind === "robots",
      ).href;
      if (item.redirects >= seoLimits.redirects)
        throw new SeoFetchFailure("SEO_REDIRECT_LIMIT");
      if (target === url || item.chain.includes(target))
        throw new SeoFetchFailure("SEO_REDIRECT_LOOP");
      if (kind === "robots") {
        policy.chain.push(url);
        policy.redirects++;
        policy.url = target;
        policy.attempts = 0;
      } else {
        Object.assign(visit, { state: "redirect", target });
        removeFrontier(state, pageURL);
        enqueue(state, target, [...visit.chain, url]);
      }
    } catch (error) {
      const reason =
        error instanceof Problem ? error.code : "SEO_REDIRECT_INVALID";
      item.state = kind === "robots" ? "blocked" : "failed";
      item.reason = reason;
      document.error_code = reason;
      if (kind === "page") removeFrontier(state, pageURL);
      addLimit(state, reason);
    }
    return commit(document);
  }
  if (response.status === 429 || response.status >= 500) {
    item.reason =
      response.status === 429 ? "SEO_RATE_LIMITED" : "SEO_SERVER_UNAVAILABLE";
    if (item.attempts >= seoLimits.attemptsPerPage) {
      item.state = kind === "robots" ? "blocked" : "failed";
      if (kind === "page") removeFrontier(state, pageURL);
      addLimit(state, item.reason);
    }
    state.next_at = stamp(
      Math.max(
        now() + delay,
        retryDelay(response.headers, now(), item.attempts),
      ),
    );
    return commit(document);
  }
  if (kind === "robots") {
    if (
      response.status >= 400 &&
      response.status < 500 &&
      ![401, 403].includes(response.status)
    )
      policy.state = "allowed";
    else if (response.status === 200) {
      try {
        document.text = new TextDecoder("utf-8", { fatal: true }).decode(
          response.body,
        );
        document.charset = "utf-8";
        document.source_sha256 = hash(document.text);
        const parsed = parseSeoRobots(origin, document.text);
        policy.state = "rules";
        policy.crawl_delay_ms = parsed.crawl_delay_ms;
        state.next_at = stamp(
          Math.min(
            Date.parse(state.expires_at),
            Math.max(
              Date.parse(state.next_at),
              now() + Math.max(1000, parsed.crawl_delay_ms ?? 0),
            ),
          ),
        );
      } catch (error) {
        policy.state = "blocked";
        policy.reason =
          error instanceof Problem ? error.code : "SEO_ROBOTS_INVALID";
        document.error_code = policy.reason;
        addLimit(state, policy.reason);
      }
    } else {
      policy.state = "blocked";
      policy.reason = "SEO_ROBOTS_ACCESS_UNAVAILABLE";
      document.error_code = policy.reason;
      addLimit(state, policy.reason);
    }
    return commit(document);
  }
  visit.status = response.status;
  if (response.status === 304) {
    if (!cached) {
      visit.state = "failed";
      visit.reason = "SEO_CACHE_SOURCE_MISSING";
      document.error_code = visit.reason;
      removeFrontier(state, pageURL);
      addLimit(state, visit.reason);
      return commit(document);
    }
    // Preserve the actual empty 304 response hash and the separately retained content source.
    if (cached.raw.length > reserved) {
      visit.state = "failed";
      visit.reason = "SEO_BYTE_BUDGET_LIMIT";
      document.error_code = visit.reason;
      removeFrontier(state, pageURL);
      addLimit(state, visit.reason);
      return commit(document);
    }
    state.byte_budget_used += cached.raw.length;
    Object.assign(document, {
      effective_status: cached.effective_status,
      headers: { ...cached.headers, ...response.headers },
      raw: cached.raw,
      raw_sha256: cached.raw_sha256,
      cache_source_id: cached.id,
      content_captured_at: cached.content_captured_at,
    });
  }
  if (document.effective_status !== 200) {
    visit.state = "http_error";
    removeFrontier(state, pageURL);
    return commit(document);
  }
  try {
    const decoded = decodeSeoHTML({
      headers: document.headers,
      body: document.raw,
    });
    Object.assign(document, {
      text: decoded.text,
      charset: decoded.charset,
      source_sha256: decoded.source_sha256,
      page: parseSeoPage(url, decoded.text, document.headers),
    });
    visit.state = "success";
    if (document.page!.login_page)
      addLimit(state, "SEO_LOGIN_CONTENT_UNAVAILABLE");
    if (!document.page!.nofollow && !document.page!.login_page) {
      for (const link of document.page!.links) {
        if (link.nofollow) continue;
        try {
          enqueue(state, assertSeoScope(link.url, state.spec).href);
        } catch {
          /* Out-of-scope URLs are evidence only. */
        }
      }
    }
    for (const limitation of document.page!.limitations)
      addLimit(state, limitation);
  } catch (error) {
    visit.state = "failed";
    visit.reason = error instanceof Problem ? error.code : "SEO_HTML_INVALID";
    document.error_code = visit.reason;
    addLimit(state, visit.reason);
  }
  removeFrontier(state, pageURL);
  return commit(document);
}

export type SeoFinding = SeoIssue & {
  id: string;
  source_id: string;
  key: string;
  related_source_ids: string[];
};
export function collectSeoFindings(
  state: SeoCheckpoint,
  documents: SeoDocument[],
) {
  validateSeoCheckpoint(state);
  const sources = new Map(documents.map((d) => [d.id, d])),
    findings: SeoFinding[] = [];
  const pages = Object.entries(state.visits)
    .filter(([, v]) => v.state === "success" && v.source_id)
    .map(([url, v]) => {
      const source = sources.get(v.source_id!);
      if (
        !source?.page ||
        source.url !== url ||
        source.source_sha256 !== source.page.source_sha256
      )
        throw new Problem(
          409,
          "SEO_SOURCE_INVALID",
          "A collected page source is missing or invalid",
        );
      return source;
    });
  const add = (source: SeoDocument, issue: SeoIssue, related: string[] = []) =>
    findings.push({
      ...issue,
      id: randomUUID(),
      source_id: source.id,
      key: hash(
        canonical({
          code: issue.code,
          url: issue.url,
          target_url: issue.target_url ?? null,
        }),
      ),
      related_source_ids: [...new Set(related)],
    });
  const titles = new Map<string, SeoDocument[]>();
  for (const source of pages) {
    for (const issue of source.page!.issues) add(source, issue);
    const title = source.page!.title.normalize("NFKC").toLowerCase();
    if (title && !source.page!.login_page)
      titles.set(title, [...(titles.get(title) ?? []), source]);
    for (const link of source.page!.links) {
      let target = link.url;
      const seen = new Set<string>();
      while (state.visits[target]?.state === "redirect" && !seen.has(target)) {
        seen.add(target);
        target = state.visits[target].target!;
      }
      const visit = state.visits[target];
      if (
        visit?.state === "http_error" &&
        [404, 410].includes(visit.status ?? 0) &&
        visit.source_id
      ) {
        if (!sources.has(visit.source_id))
          throw new Problem(
            409,
            "SEO_SOURCE_INVALID",
            "A checked link target is missing",
          );
        add(
          source,
          {
            code: "broken_link",
            severity: "error",
            url: source.url,
            target_url: link.url,
            location: link.location,
            detail: `The checked target returned HTTP ${visit.status}. Update the link or restore the intended page.`,
          },
          [
            visit.source_id,
            ...[...seen]
              .map((url) => state.visits[url].source_id!)
              .filter(Boolean),
          ],
        );
      }
    }
  }
  for (const group of titles.values())
    if (group.length > 1)
      for (const source of group) {
        const other = group.find((s) => s.id !== source.id)!;
        add(
          source,
          {
            code: "duplicate_title",
            severity: "warning",
            url: source.url,
            target_url: other.url,
            location: null,
            detail:
              "Another successfully inspected page has the same normalized title. Review page-specific intent.",
          },
          [other.id],
        );
      }
  // Repeated anchors can share one issue, while retaining the first exact source location.
  return [...new Map(findings.map((f) => [f.key, f])).values()];
}

export function compareSeoFindings(
  before: { state: SeoCheckpoint; findings: SeoFinding[] },
  after: { state: SeoCheckpoint; findings: SeoFinding[] },
) {
  const method = (spec: SeoInput) => {
    const { cache_policy: _cache, prompt: _prompt, ...rest } = spec;
    return hash(canonical({ version: seoVersion, ...rest }));
  };
  if (method(before.state.spec) !== method(after.state.spec))
    throw new Problem(
      409,
      "SEO_COMPARISON_METHOD_CHANGED",
      "A comparison requires the same confirmed crawl scope and budget",
    );
  const old = new Map(before.findings.map((f) => [f.key, f])),
    current = new Map(after.findings.map((f) => [f.key, f]));
  const checked = (url: string, seen = new Set<string>()): boolean => {
    const visit = after.state.visits[url];
    if (!visit || seen.has(url)) return false;
    if (visit.state === "redirect") {
      seen.add(url);
      return checked(visit.target!, seen);
    }
    return (
      (visit.state === "success" &&
        !after.findings.some(
          (f) => f.url === url && f.code === "login_form",
        )) ||
      (visit.state === "http_error" && [404, 410].includes(visit.status ?? 0))
    );
  };
  return {
    previous_spec_hash: before.state.spec_hash,
    current_spec_hash: after.state.spec_hash,
    changes: [...old].map(([key, finding]) => ({
      key,
      previous_finding_id: finding.id,
      current_finding_id: current.get(key)?.id ?? null,
      state: current.has(key)
        ? "persistent"
        : checked(finding.url) &&
            (!finding.target_url ||
              !["broken_link", "duplicate_title"].includes(finding.code) ||
              checked(finding.target_url))
          ? "resolved"
          : "not_rechecked",
    })),
    new_finding_ids: [...current]
      .filter(([key]) => !old.has(key))
      .map(([, f]) => f.id),
  };
}
