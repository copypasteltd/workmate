import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { hash, Problem } from "./lib.js";
import {
  assertSeoScope,
  seoLimits,
  seoUserAgent,
  type SeoInput,
} from "./seo-model.js";

export class SeoFetchFailure extends Problem {
  constructor(
    code: string,
    public retryable = false,
    public retryAfterMs = 0,
  ) {
    super(
      502,
      code,
      "The website response could not be collected within the confirmed limits",
    );
  }
}
export type SeoResponse = {
  url: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  sha256: string;
  captured_at: string;
  peer: string | null;
  source_mode: "simulated" | "configured_services";
};
export type SeoTransportOptions = {
  simulated: boolean;
  production: boolean;
  fixtureOrigin?: string;
  fixtureKey?: string;
};
export type SeoResolver = (
  host: string,
) => Promise<{ address: string; family: number }[]>;

export function publicSeoAddress(value: string): boolean {
  try {
    const address = ipaddr.process(value);
    return (
      address.range() === "unicast" &&
      (address.kind() === "ipv4" || address.match(ipaddr.parseCIDR("2000::/3")))
    );
  } catch {
    return false;
  }
}
function normalizedAddress(value: string): string {
  return ipaddr.process(value).toNormalizedString();
}
function throwAborted(signal: AbortSignal, external?: AbortSignal): never {
  throw new SeoFetchFailure(
    external?.aborted
      ? "SEO_CANCELLED"
      : signal.aborted
        ? "SEO_REQUEST_TIMEOUT"
        : "SEO_TRANSPORT",
    !external?.aborted,
  );
}
async function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  signal.throwIfAborted();
  let stop: () => void = () => {};
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        stop = () => reject(signal.reason);
        signal.addEventListener("abort", stop, { once: true });
        if (signal.aborted) stop();
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", stop);
  }
}

/** Validate every DNS answer and pin the subsequent socket lookup to one checked address. */
export async function resolveSeoAddress(
  host: string,
  resolve: SeoResolver = (name) =>
    dnsLookup(name, { all: true, verbatim: true }),
) {
  const name = host.replace(/^\[|\]$/g, "");
  const literal = isIP(name);
  const answers = literal
    ? [{ address: name, family: literal }]
    : await resolve(name);
  if (
    !answers.length ||
    answers.length > 64 ||
    answers.some(
      (r) =>
        ![4, 6].includes(r.family) ||
        isIP(r.address) !== r.family ||
        !publicSeoAddress(r.address),
    )
  )
    throw new SeoFetchFailure("SEO_IP_DENIED");
  return answers.find((r) => r.family === 4) ?? answers[0];
}

const responseHeaders = new Set([
  "content-type",
  "content-length",
  "content-encoding",
  "location",
  "etag",
  "last-modified",
  "cache-control",
  "vary",
  "x-robots-tag",
  "retry-after",
  "content-language",
]);

export function createSeoTransport(
  options: SeoTransportOptions,
  resolver?: SeoResolver,
) {
  let fixture: URL | undefined;
  if (options.fixtureOrigin) {
    fixture = new URL(options.fixtureOrigin);
    if (
      options.production ||
      !options.simulated ||
      fixture.protocol !== "http:" ||
      !["localhost", "127.0.0.1", "[::1]"].includes(fixture.hostname) ||
      fixture.origin !== options.fixtureOrigin ||
      !options.fixtureKey
    )
      throw new SeoFetchFailure("SEO_FIXTURE_DENIED");
  } else if (options.simulated) {
    // Simulated workspaces never fetch an arbitrary real customer website.
    throw new SeoFetchFailure("SEO_FIXTURE_REQUIRED");
  }
  return async function request(
    value: string,
    spec: Pick<SeoInput, "allowed_hosts" | "allowed_path_prefixes">,
    parameters: {
      signal?: AbortSignal;
      robots?: boolean;
      etag?: string;
      modifiedSince?: string;
    } = {},
  ): Promise<SeoResponse> {
    const original = assertSeoScope(value, spec, parameters.robots),
      timeout = AbortSignal.timeout(seoLimits.requestMs),
      signal = parameters.signal
        ? AbortSignal.any([parameters.signal, timeout])
        : timeout;
    const literal = original.hostname.replace(/^\[|\]$/g, "");
    if (isIP(literal) && !publicSeoAddress(literal))
      throw new SeoFetchFailure("SEO_IP_DENIED");
    if (signal.aborted) throwAborted(signal, parameters.signal);
    let endpoint = original;
    let peer: { address: string; family: number } | null = null;
    if (fixture) {
      endpoint = new URL(fixture);
      endpoint.pathname = "/site/" + original.hostname + original.pathname;
      endpoint.search = original.search;
    } else {
      try {
        peer = await abortable(
          resolveSeoAddress(original.hostname, resolver),
          signal,
        );
      } catch (error) {
        if (error instanceof Problem) throw error;
        if (signal.aborted) throwAborted(signal, parameters.signal);
        throw new SeoFetchFailure("SEO_DNS_UNAVAILABLE", true);
      }
    }
    const headers: Record<string, string> = {
      "user-agent": seoUserAgent,
      accept: parameters.robots
        ? "text/plain,*/*;q=0.1"
        : "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
      "accept-encoding": "identity",
    };
    if (fixture) headers["x-copypaste-seo-fixture-key"] = options.fixtureKey!;
    for (const [key, value] of [
      ["if-none-match", parameters.etag],
      ["if-modified-since", parameters.modifiedSince],
    ])
      if (value && value.length <= 1000 && !/[\r\n\u0000]/u.test(value))
        headers[key!] = value;
    const selected = peer;
    const pinnedLookup: LookupFunction | undefined = selected
      ? (_host, opts, callback) => {
          if (opts.all) callback(null, [selected]);
          else callback(null, selected.address, selected.family);
        }
      : undefined;
    const socketOptions = { autoSelectFamily: false };
    return new Promise<SeoResponse>((resolve, reject) => {
      const transport = endpoint.protocol === "https:" ? https : http;
      let complete = false;
      const fail = (error: unknown) => {
        if (complete) return;
        complete = true;
        reject(
          error instanceof Problem
            ? error
            : new SeoFetchFailure(
                parameters.signal?.aborted
                  ? "SEO_CANCELLED"
                  : timeout.aborted
                    ? "SEO_REQUEST_TIMEOUT"
                    : "SEO_TRANSPORT",
                !parameters.signal?.aborted,
              ),
        );
      };
      const req = transport.request(
        endpoint,
        {
          method: "GET",
          headers,
          agent: false,
          signal,
          ...socketOptions,
          ...(selected
            ? { family: selected.family, lookup: pinnedLookup }
            : {}),
        },
        (response) => {
          if (
            selected &&
            (!response.socket.remoteAddress ||
              normalizedAddress(response.socket.remoteAddress) !==
                normalizedAddress(selected.address))
          ) {
            response.destroy();
            fail(new SeoFetchFailure("SEO_PEER_DENIED"));
            return;
          }
          const received: Record<string, string> = {};
          for (const [key, value] of Object.entries(response.headers)) {
            if (!responseHeaders.has(key) || value === undefined) continue;
            const text = Array.isArray(value) ? value.join(", ") : value;
            if (text.length > 8192) {
              response.destroy();
              fail(new SeoFetchFailure("SEO_HEADER_LIMIT"));
              return;
            }
            received[key] = text;
          }
          const status = response.statusCode ?? 0;
          const finish = (body: Buffer) => {
            if (complete) return;
            complete = true;
            resolve({
              url: original.href,
              status,
              headers: received,
              body,
              sha256: hash(body),
              captured_at: new Date().toISOString(),
              peer: selected?.address ?? null,
              source_mode: fixture ? "simulated" : "configured_services",
            });
          };
          // A redirect is a separate durable, budgeted request; never follow here.
          if ((status >= 300 && status < 400) || status === 204) {
            finish(Buffer.alloc(0));
            response.destroy();
            return;
          }
          if (
            received["content-encoding"] &&
            received["content-encoding"].toLowerCase() !== "identity"
          ) {
            response.destroy();
            fail(new SeoFetchFailure("SEO_ENCODING_UNSUPPORTED"));
            return;
          }
          const bound = parameters.robots
            ? seoLimits.robotsBytes
            : seoLimits.responseBytes;
          const declared = received["content-length"];
          if (
            declared &&
            (!/^\d+$/.test(declared) || Number(declared) > bound)
          ) {
            response.destroy();
            fail(new SeoFetchFailure("SEO_RESPONSE_LIMIT"));
            return;
          }
          const chunks: Buffer[] = [];
          let size = 0;
          response.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > bound) {
              response.destroy();
              fail(new SeoFetchFailure("SEO_RESPONSE_LIMIT"));
            } else chunks.push(chunk);
          });
          response.on("end", () => finish(Buffer.concat(chunks)));
          response.on("aborted", () =>
            fail(new SeoFetchFailure("SEO_RESPONSE_TRUNCATED", true)),
          );
          response.on("error", fail);
        },
      );
      req.on("error", fail);
      req.end();
    });
  };
}
export type SeoTransport = ReturnType<typeof createSeoTransport>;
