import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Config } from "./config.js";
import { hash, token } from "./lib.js";

export type ConnectorFixtureFault =
  | "rate_limit"
  | "expired"
  | "forbidden"
  | "malformed"
  | "cursor_loop"
  | "row_count_changed"
  | "slow"
  | "missing_scope"
  | "cross_account"
  | "negative_revenue";
const escape = (s: string) =>
  s
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
/** Protocol-shaped synthetic supplier, bound to loopback and never enabled in production. */
export async function startConnectorFixture(config: Config) {
  if (
    !config.DEMO_MODE ||
    config.NODE_ENV === "production" ||
    !["127.0.0.1", "localhost", "::1"].includes(config.HOST)
  )
    throw new Error("Connector fixture requires loopback DEMO_MODE");
  const secret = token(),
    codes = new Map<
      string,
      {
        provider: string;
        challenge: string | null;
        redirect: string;
        used: boolean;
      }
    >(),
    credentials = new Map<string, string>(),
    refreshes = new Map<string, string>();
  const faults = new Map<string, ConnectorFixtureFault[]>();
  const calls: Array<{ host: string; path: string; method: string }> = [];
  const scopes: Record<string, string> = {
    google_ads: "https://www.googleapis.com/auth/adwords",
    ga4: "https://www.googleapis.com/auth/analytics.readonly",
    search_console: "https://www.googleapis.com/auth/webmasters.readonly",
    meta_ads: "ads_read",
  };
  let origin = "";
  const send = (res: ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  const server = createServer(
    (req, res) =>
      void handle(req, res).catch(() => {
        if (!res.headersSent) send(res, 500, { error: { code: 500 } });
        else res.destroy();
      }),
  );
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", origin);
    if (
      url.pathname.startsWith("/consent/") ||
      url.pathname.startsWith("/approve/")
    ) {
      const provider = url.pathname.split("/")[2];
      if (
        !scopes[provider] ||
        url.searchParams.get("redirect_uri") !==
          `${config.API_ORIGIN}/v1/connections/callback` ||
        url.searchParams.get("client_id") !== "copypaste-simulated-client" ||
        url.searchParams.get("scope") !== scopes[provider] ||
        !/^[\w-]{43}$/.test(url.searchParams.get("state") ?? "")
      )
        return send(res, 400, { error: "invalid_consent" });
      if (url.pathname.startsWith("/consent/")) {
        res.writeHead(200, {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store",
          "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${config.API_ORIGIN} ${config.WEB_ORIGIN}; frame-ancestors 'none'`,
          "x-content-type-options": "nosniff",
        });
        res.end(
          `<!doctype html><html lang="zh-HK"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CopyPaste 模擬授權 / Simulated authorization</title><style>body{background:#f6f6f4;color:#15171a;font:16px system-ui;max-width:600px;margin:12vh auto;padding:32px;border:1px solid #e3e4e5;border-radius:16px}button{background:#1f5eff;color:white;border:0;border-radius:8px;padding:14px 20px;font:inherit}small{color:#646a75}</style><h1>模擬供應商授權</h1><p>Simulated provider · ${escape(provider)}</p><p>本頁只連接本機合成資料，不會取得任何真實廣告、網站或客戶帳戶。</p><p>This local fixture grants read access to synthetic marketing accounts only.</p><p><small>Scope: ${escape(scopes[provider])}</small></p><form method="get" action="/approve/${provider}">${[...url.searchParams].map(([k, v]) => `<input type="hidden" name="${escape(k)}" value="${escape(v)}">`).join("")}<button type="submit">允許模擬讀取 / Allow simulated read</button></form></html>`,
        );
        return;
      }
      const code = randomUUID(),
        redirect = url.searchParams.get("redirect_uri")!;
      codes.set(code, {
        provider,
        challenge: url.searchParams.get("code_challenge"),
        redirect,
        used: false,
      });
      const callback = new URL(redirect);
      callback.searchParams.set("state", url.searchParams.get("state")!);
      callback.searchParams.set("code", code);
      res.writeHead(302, {
        location: callback.href,
        "cache-control": "no-store",
      });
      res.end();
      return;
    }
    if (req.headers["x-copypaste-fixture-key"] !== secret)
      return send(res, 403, { error: { code: 403 } });
    const path = url.pathname.match(/^\/provider\/([^/]+)(\/.*)$/);
    if (!path) return send(res, 404, { error: { code: 404 } });
    const [, host, resource] = path;
    calls.push({ host, path: resource, method: req.method ?? "GET" });
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 100000) return send(res, 413, { error: { code: 413 } });
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString("utf8"),
      form = new URLSearchParams(raw);
    let body: any = {};
    if (req.headers["content-type"]?.includes("application/json"))
      body = JSON.parse(raw || "{}");
    if (
      resource.endsWith("/token") ||
      resource.endsWith("/oauth/access_token")
    ) {
      if (
        form.get("client_id") !== "copypaste-simulated-client" ||
        form.get("client_secret") !== "copypaste-simulated-secret"
      )
        return send(res, 400, { error: "invalid_client" });
      let provider: string | undefined;
      if (form.get("grant_type") === "refresh_token")
        provider = refreshes.get(form.get("refresh_token") ?? "");
      else {
        const code = codes.get(form.get("code") ?? "");
        if (!code || code.used || code.redirect !== form.get("redirect_uri"))
          return send(res, 400, { error: "invalid_grant" });
        code.used = true;
        if (
          code.provider !== "meta_ads" &&
          (!code.challenge ||
            code.challenge !==
              Buffer.from(
                hash(form.get("code_verifier") ?? ""),
                "hex",
              ).toString("base64url"))
        )
          return send(res, 400, { error: "invalid_grant" });
        provider = code.provider;
      }
      if (!provider) return send(res, 400, { error: "invalid_grant" });
      const access = token(),
        refresh = token();
      credentials.set(access, provider);
      refreshes.set(refresh, provider);
      const missing = faults.get(provider)?.[0] === "missing_scope";
      if (missing) faults.get(provider)!.shift();
      return send(res, 200, {
        access_token: access,
        refresh_token: refresh,
        expires_in: 3600,
        token_type: "Bearer",
        scope: missing ? "email" : scopes[provider],
      });
    }
    const bearer = req.headers.authorization?.replace(/^Bearer /, "") ?? "",
      provider = credentials.get(bearer);
    if (!provider) return send(res, 401, { error: { code: 190 } });
    const fault = faults.get(provider)?.shift();
    if (fault === "rate_limit") {
      res.setHeader("retry-after", "1");
      return send(res, 429, { error: { code: 4, is_transient: true } });
    }
    if (fault === "expired") return send(res, 401, { error: { code: 190 } });
    if (fault === "forbidden") return send(res, 403, { error: { code: 403 } });
    if (fault === "malformed")
      return send(res, 200, { rows: "unexpected-schema" });
    if (fault === "slow")
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 250);
        res.once("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    if (resource.endsWith("/me/permissions"))
      return send(res, 200, {
        data: [{ permission: "ads_read", status: "granted" }],
      });
    const account = (id: string, manager = false) => ({
      id,
      descriptiveName: manager ? "模擬集團經理" : "香港品牌 · " + id,
      currencyCode: "HKD",
      timeZone: "Asia/Hong_Kong",
      manager,
      status: "ENABLED",
    });
    if (
      host === "googleads.googleapis.com" &&
      resource.endsWith(":listAccessibleCustomers")
    )
      return send(res, 200, { resourceNames: ["customers/100"] });
    if (
      host === "googleads.googleapis.com" &&
      resource.endsWith("/googleAds:search")
    ) {
      if (req.headers["developer-token"] !== "simulated-developer-token")
        return send(res, 403, { error: { code: 403 } });
      const id = resource.match(/customers\/(\d+)/)?.[1],
        query = String(body.query ?? "");
      if (query.includes("FROM customer_client"))
        return send(res, 200, {
          results: [
            { customerClient: account("101") },
            { customerClient: account("102") },
          ],
        });
      if (query.includes("FROM customer "))
        return send(res, 200, { results: [{ customer: account(id!, true) }] });
      if (!["101", "102"].includes(id ?? ""))
        return send(res, 403, { error: { code: 403 } });
      const range = query.match(
        /BETWEEN '(\d{4}-\d{2}-\d{2})' AND '(\d{4}-\d{2}-\d{2})'/,
      );
      if (!range) return send(res, 400, { error: { code: 400 } });
      const offset = body.pageToken ? 2 : 0;
      const all = [0, 1, 2].map((i) => ({
        customer: account(fault === "cross_account" ? "999" : id!),
        segments: { date: range[1] },
        campaign: {
          id: String(700 + i),
          name: ["香港新品", "品牌搜尋", "再行銷"][i],
        },
        metrics: {
          impressions: String(1000 + i * 100),
          clicks: String(80 + i),
          costMicros: String(123456789 + i * 1000000),
          conversions: i === 2 ? undefined : String(i + 2),
          conversionsValue: i === 2 ? undefined : String(500 + i * 100),
        },
      }));
      return send(res, 200, {
        results: all.slice(offset, offset + 2),
        ...(offset === 0 || fault === "cursor_loop"
          ? { nextPageToken: "ads-next" }
          : {}),
      });
    }
    if (
      host === "analyticsadmin.googleapis.com" &&
      resource.endsWith("/accountSummaries")
    )
      return send(res, 200, {
        accountSummaries: [
          {
            account: "accounts/200",
            displayName: "模擬香港網站",
            propertySummaries: [
              { property: "properties/201", displayName: "官網" },
            ],
          },
        ],
      });
    if (
      host === "analyticsadmin.googleapis.com" &&
      resource.endsWith("/reportingIdentitySettings")
    )
      return send(res, 200, {
        name: "properties/201/reportingIdentitySettings",
        reportingIdentity: "BLENDED",
      });
    if (
      host === "analyticsadmin.googleapis.com" &&
      resource.endsWith("/properties/201")
    )
      return send(res, 200, {
        name: "properties/201",
        displayName: "香港品牌官網",
        timeZone: "Asia/Hong_Kong",
        currencyCode: "HKD",
      });
    if (
      host === "analyticsdata.googleapis.com" &&
      resource.endsWith("/properties/201:runReport")
    ) {
      const date = String(
          body.dateRanges?.[0]?.startDate ?? "2026-10-01",
        ).replaceAll("-", ""),
        offset = Number(body.offset ?? 0),
        event = body.dimensions?.[1]?.name === "eventName";
      const data = [0, 1, 2].map((i) => ({
        dimensionValues: (event
          ? [date, ["page_view", "generate_lead", "purchase"][i]]
          : [
              date,
              ["Organic Search", "Paid Search", "Direct"][i],
              ["/", "/offer", "/contact"][i],
            ]
        ).map((value) => ({ value })),
        metricValues: (event
          ? ["150", "100", "3"]
          : ["120", "100", "150", "3", fault === "negative_revenue" && i === 0 ? "-1800.50" : "800.50"]
        ).map((value) => ({ value })),
      }));
      return send(res, 200, {
        dimensionHeaders: body.dimensions,
        metricHeaders: body.metrics.map((m: any) => ({
          ...m,
          type: "TYPE_INTEGER",
        })),
        rows: data.slice(offset, offset + Number(body.limit)),
        rowCount: fault === "row_count_changed" ? 4 : 3,
        metadata: {
          timeZone: "Asia/Hong_Kong",
          currencyCode: "HKD",
          subjectToThresholding: true,
          dataLossFromOtherRow: false,
        },
        propertyQuota: { tokensPerDay: { consumed: 2, remaining: 10000 } },
      });
    }
    if (host === "www.googleapis.com" && resource.endsWith("/sites"))
      return send(res, 200, {
        siteEntry: [
          { siteUrl: "sc-domain:example.hk", permissionLevel: "siteOwner" },
          { siteUrl: "https://example.hk/", permissionLevel: "siteFullUser" },
          {
            siteUrl: "https://denied.invalid/",
            permissionLevel: "siteUnverifiedUser",
          },
        ],
      });
    if (
      host === "www.googleapis.com" &&
      resource.includes("/searchAnalytics/query")
    ) {
      if (
        !resource.includes(encodeURIComponent("sc-domain:example.hk")) &&
        !resource.includes(encodeURIComponent("https://example.hk/"))
      )
        return send(res, 403, { error: { code: 403 } });
      const all = [0, 1, 2].map((i) => ({
        keys: [
          body.startDate,
          ["香港設計", "企業代理", "品牌服務"][i],
          "https://example.hk/",
          "hkg",
          "MOBILE",
        ],
        clicks: 20 + i,
        impressions: 200 + i,
        ctr: 0.1,
        position: 4.5 + i,
      }));
      return send(res, 200, {
        rows: all.slice(
          body.startRow ?? 0,
          (body.startRow ?? 0) + body.rowLimit,
        ),
        responseAggregationType: "byPage",
      });
    }
    if (host === "graph.facebook.com" && resource.endsWith("/me/adaccounts"))
      return send(res, 200, {
        data: [
          {
            account_id: "301",
            name: "香港活動廣告",
            currency: "HKD",
            timezone_name: "Asia/Hong_Kong",
            account_status: 1,
            user_tasks: ["ANALYZE"],
          },
        ],
      });
    if (
      host === "graph.facebook.com" &&
      resource.endsWith("/act_301/insights")
    ) {
      const range = JSON.parse(url.searchParams.get("time_range") ?? "{}"),
        offset = url.searchParams.get("after") ? 2 : 0;
      const all = [0, 1, 2].map((i) => ({
        account_id: fault === "cross_account" ? "999" : "301",
        account_currency: "HKD",
        date_start: range.since,
        date_stop: range.since,
        campaign_id: String(800 + i),
        campaign_name: ["節日推廣", "產品介紹", "會員招募"][i],
        impressions: String(500 + i),
        clicks: String(50 + i),
        spend: "75.50",
        actions:
          i === 2
            ? []
            : [
                { action_type: "purchase", value: "2" },
                {
                  action_type: "offsite_conversion.fb_pixel_purchase",
                  value: "2",
                },
              ],
        action_values:
          i === 2 ? [] : [{ action_type: "purchase", value: "200" }],
        attribution_setting: "7d_click,1d_view",
      }));
      const next = new URL(`https://graph.facebook.com${resource}`);
      next.searchParams.set("after", "meta-next");
      next.searchParams.set("access_token", bearer);
      return send(res, 200, {
        data: all.slice(offset, offset + 2),
        ...(offset === 0 || fault === "cursor_loop"
          ? { paging: { cursors: { after: "meta-next" }, next: next.href } }
          : {}),
      });
    }
    return send(res, 404, { error: { code: 404 } });
  }
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    config: {
      ...config,
      CONNECTOR_FIXTURE_ORIGIN: origin,
      CONNECTOR_FIXTURE_KEY: secret,
    },
    origin,
    setFaults(provider: string, values: ConnectorFixtureFault[]) {
      faults.set(provider, [...values]);
    },
    calls,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
