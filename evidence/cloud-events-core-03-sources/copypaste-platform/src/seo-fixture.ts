import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { randomUUID } from "node:crypto";
import type { Config } from "./config.js";
import { hash } from "./lib.js";
import { seoLimits } from "./seo-model.js";

export type SeoFixtureFault =
  | "rate_limit"
  | "unavailable"
  | "slow"
  | "robots_unavailable"
  | "truncated";
/** Synthetic website over actual loopback HTTP; never starts in production. */
export async function startSeoFixture(
  config: Pick<Config, "DEMO_MODE" | "NODE_ENV" | "HOST">,
) {
  if (
    !config.DEMO_MODE ||
    config.NODE_ENV === "production" ||
    !["localhost", "127.0.0.1", "::1"].includes(config.HOST)
  )
    throw new Error("SEO fixtures require loopback non-production DEMO_MODE");
  const key = randomUUID() + randomUUID(),
    sockets = new Set<Socket>();
  const calls: Array<{ host: string; path: string; conditional: boolean }> = [],
    faults: SeoFixtureFault[] = [];
  let revision = 1,
    origin = "";
  const send = (
    res: ServerResponse,
    status: number,
    body: string | Buffer,
    headers: Record<string, string> = {},
  ) => {
    res.writeHead(status, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "max-age=3600",
      ...headers,
    });
    res.end(body);
  };
  const html = (title: string, content: string) =>
    `<!doctype html><html lang="zh-HK"><head><meta charset="utf-8"><title>${title}</title><meta name="description" content="Synthetic Hong Kong campaign website for bounded SEO tests"><link rel="canonical" href="/"></head><body><h1>${title}</h1>${content}</body></html>`;
  const server = createServer((req, res) => {
    if (req.headers["x-copypaste-seo-fixture-key"] !== key)
      return send(res, 403, "Fixture authentication required");
    const url = new URL(req.url ?? "/", origin),
      parts = /^\/site\/([^/]+)(\/.*)$/.exec(url.pathname);
    if (!parts) return send(res, 404, "Unknown fixture resource");
    const host = parts[1],
      path = parts[2] + url.search;
    calls.push({
      host,
      path,
      conditional: !!(
        req.headers["if-none-match"] || req.headers["if-modified-since"]
      ),
    });
    if (calls.length > 10000) calls.shift();
    const isRobots = parts[2] === "/robots.txt";
    const applicable = faults.findIndex((f) =>
      isRobots ? f === "robots_unavailable" : f !== "robots_unavailable",
    );
    const fault = applicable >= 0 ? faults.splice(applicable, 1)[0] : undefined;
    if (fault === "rate_limit")
      return send(res, 429, "Slow down", { "retry-after": "1" });
    if (fault === "unavailable" || fault === "robots_unavailable")
      return send(res, 503, "Unavailable");
    if (fault === "slow") {
      const timer = setTimeout(
        () => send(res, 200, html("Slow synthetic page", "Done")),
        seoLimits.requestMs + 1000,
      );
      res.once("close", () => clearTimeout(timer));
      return;
    }
    if (fault === "truncated") {
      res.writeHead(200, {
        "content-type": "text/html",
        "content-length": "200",
      });
      res.write("incomplete");
      res.destroy();
      return;
    }
    if (isRobots)
      return send(
        res,
        200,
        "User-agent: *\nDisallow: /blocked\nAllow: /blocked/public\n",
        { "content-type": "text/plain; charset=utf-8" },
      );
    if (parts[2] === "/robots-missing") return send(res, 404, "No robots");
    if (parts[2] === "/redirect")
      return send(res, 302, "", { location: "/offer" });
    if (parts[2] === "/redirect-cross-host")
      return send(res, 302, "", {
        location: "https://outside.example.invalid/",
      });
    if (parts[2] === "/redirect-private")
      return send(res, 302, "", { location: "http://127.0.0.1/" });
    if (parts[2] === "/redirect-loop")
      return send(res, 302, "", { location: "/redirect-loop" });
    if (parts[2] === "/too-large")
      return send(res, 200, Buffer.alloc(seoLimits.responseBytes + 1, "a"));
    if (parts[2] === "/encoded")
      return send(res, 200, "not a gzip stream", {
        "content-encoding": "gzip",
      });
    if (parts[2] === "/private") return send(res, 403, "Restricted");
    if (parts[2] === "/login")
      return send(
        res,
        200,
        html(
          "Synthetic member login",
          '<form><input type="password" name="password"></form>',
        ),
      );
    let body: string;
    if (parts[2] === "/")
      body = html(
        "Hong Kong marketing campaign",
        `<a href="/offer">Offer</a><a href="/about">About</a><a href="/missing">Old link</a><a href="/blocked">Blocked</a><a href="/redirect">Redirect</a><a href="/login">Members</a><a href="https://outside.example.invalid/">External</a><a href="/offer#details">Duplicate</a><a href="/nofollow" rel="nofollow">Do not follow</a>`,
      );
    else if (parts[2] === "/offer")
      body = html(
        revision === 1
          ? "Duplicate synthetic campaign title"
          : "Campaign offer updated for autumn",
        "<p>Campaign offer</p>",
      );
    else if (parts[2] === "/about")
      body = html("Duplicate synthetic campaign title", "<p>Campaign team</p>");
    else if (parts[2] === "/missing" && revision >= 2)
      body = html(
        "Restored synthetic campaign page",
        "<p>The link target now exists.</p>",
      );
    else if (parts[2] === "/blocked/public")
      body = html(
        "Public page under blocked prefix",
        "<p>Explicitly allowed by robots</p>",
      );
    else return send(res, 404, html("Page not found", "<p>Missing</p>"));
    const etag = '"' + hash(body) + '"';
    if (req.headers["if-none-match"] === etag)
      return send(res, 304, "", { etag });
    return send(res, 200, body, {
      etag,
      "last-modified": "Wed, 21 Oct 2026 00:00:00 GMT",
    });
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    origin,
    key,
    calls,
    setRevision(value: 1 | 2) {
      revision = value;
    },
    setFaults(values: SeoFixtureFault[]) {
      faults.splice(0, faults.length, ...values);
    },
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        for (const socket of sockets) socket.destroy();
      });
    },
  };
}
