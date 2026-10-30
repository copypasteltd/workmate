import { z } from "zod";
import type { Config } from "./config.js";
import {
  connectorJSON,
  ConnectorFailure,
  sanitizeConnectorRaw,
} from "./connector-http.js";
import {
  calendarDate,
  connectorAccount,
  connectorCredential,
  connectorLimits,
  connectorQuery,
  discoveryCursor,
  decimalValue,
  signedRevenueValue,
  fact,
  pageCursor,
  type ConnectorAccount,
  type ConnectorCredential,
  type ConnectorPage,
  type ConnectorProvider,
  type ConnectorQuery,
  type DiscoveryCursor,
  type DiscoveryPage,
  type PageCursor,
} from "./connector-model.js";
import { hash, Problem } from "./lib.js";

export const connectorProviders = {
  google_ads: {
    name: "Google Ads",
    scope: "https://www.googleapis.com/auth/adwords",
  },
  meta_ads: { name: "Meta Ads", scope: "ads_read" },
  ga4: {
    name: "Google Analytics 4",
    scope: "https://www.googleapis.com/auth/analytics.readonly",
  },
  search_console: {
    name: "Google Search Console",
    scope: "https://www.googleapis.com/auth/webmasters.readonly",
  },
} as const;
const strings = z.array(z.string().min(1).max(8192)).max(10000);
const rows = (v: unknown): any[] => {
  if (v === undefined) return [];
  if (
    !Array.isArray(v) ||
    v.length > 25000 ||
    v.some((r) => !r || typeof r !== "object" || Array.isArray(r))
  )
    invalid();
  return v as any[];
};
function invalid(): never {
  throw new ConnectorFailure("permanent", "CONNECTOR_SCHEMA_CHANGED");
}
const text = (v: unknown, max = 2000): string => {
  const r = z.string().max(max).safeParse(v);
  if (
    !r.success ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(r.data)
  )
    invalid();
  return r.data;
};
const numericID = (v: unknown) => {
  if (
    (typeof v !== "string" && typeof v !== "number") ||
    !/^\d{1,20}$/.test(String(v)) ||
    (typeof v === "number" && !Number.isSafeInteger(v))
  )
    invalid();
  return String(v);
};
function decimal(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" && typeof v !== "number") invalid();
  if (
    typeof v === "number" &&
    (!Number.isFinite(v) ||
      v < 0 ||
      (Number.isInteger(v) && !Number.isSafeInteger(v)))
  )
    invalid();
  const parsed = decimalValue.safeParse(String(v));
  if (!parsed.success) invalid();
  return parsed.data;
}
function revenueDecimal(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if ((typeof v !== "string" && typeof v !== "number") ||
    (typeof v === "number" && (!Number.isFinite(v) || (Number.isInteger(v) && !Number.isSafeInteger(v))))) invalid();
  const parsed = signedRevenueValue.safeParse(String(v));
  if (!parsed.success) invalid();
  return parsed.data;
}
function integer(v: unknown): number {
  const n = Number(v);
  if (
    (typeof v !== "string" && typeof v !== "number") ||
    !Number.isSafeInteger(n) ||
    n < 0 ||
    !/^\d+$/.test(String(v))
  )
    invalid();
  return n;
}
const asDate = (v: unknown) => {
  const r = calendarDate.safeParse(v);
  if (!r.success) invalid();
  return r.data;
};
const auth = (c: ConnectorCredential) => ({
  authorization: `Bearer ${c.access_token}`,
});
const basicAccount = {
  timezone: null,
  currency: null,
  readable: true,
  login_customer_id: null,
  reporting_identity: null,
  reporting_identity_source: "not_applicable" as const,
  permission_level: null,
};
export function connectorSettings(c: Config, p: ConnectorProvider) {
  const fixture =
    !!c.CONNECTOR_FIXTURE_ORIGIN && c.DEMO_MODE && c.NODE_ENV !== "production";
  const client = p === "meta_ads" ? c.META_APP_ID : c.GOOGLE_CLIENT_ID;
  const secret = p === "meta_ads" ? c.META_APP_SECRET : c.GOOGLE_CLIENT_SECRET;
  const version =
    p === "google_ads"
      ? c.GOOGLE_ADS_API_VERSION
      : p === "meta_ads"
        ? c.META_GRAPH_VERSION
        : "v1beta";
  const available =
    fixture ||
    !!(
      client &&
      secret &&
      version &&
      (p !== "google_ads" || c.GOOGLE_ADS_DEVELOPER_TOKEN)
    );
  return {
    available,
    client: fixture ? "copypaste-simulated-client" : client,
    secret: fixture ? "copypaste-simulated-secret" : secret,
    version: fixture
      ? p === "meta_ads"
        ? "v26.0"
        : p === "google_ads"
          ? "v26"
          : "v1beta"
      : version,
    developerToken: fixture
      ? "simulated-developer-token"
      : c.GOOGLE_ADS_DEVELOPER_TOKEN,
  };
}
export function connectorAuthorizationURL(
  c: Config,
  provider: ConnectorProvider,
  state: string,
  verifier: string,
) {
  const setup = connectorSettings(c, provider);
  if (!setup.available)
    throw new Problem(
      503,
      "CONNECTOR_SETUP_REQUIRED",
      "Company OAuth configuration is required",
    );
  const u = c.CONNECTOR_FIXTURE_ORIGIN
    ? new URL(`/consent/${provider}`, c.CONNECTOR_FIXTURE_ORIGIN)
    : new URL(
        provider === "meta_ads"
          ? `https://www.facebook.com/${setup.version}/dialog/oauth`
          : "https://accounts.google.com/o/oauth2/v2/auth",
      );
  u.search = new URLSearchParams({
    client_id: setup.client!,
    state,
    redirect_uri: `${c.API_ORIGIN}/v1/connections/callback`,
    scope: connectorProviders[provider].scope,
    response_type: "code",
  }).toString();
  if (provider !== "meta_ads") {
    u.searchParams.set("access_type", "offline");
    u.searchParams.set("prompt", "consent");
    u.searchParams.set("code_challenge_method", "S256");
    u.searchParams.set(
      "code_challenge",
      Buffer.from(hash(verifier), "hex").toString("base64url"),
    );
  }
  return u.href;
}
export function connectorConfigurationHash(
  c: Config,
  provider: ConnectorProvider,
) {
  const s = connectorSettings(c, provider);
  return hash(
    JSON.stringify({
      provider,
      client: s.client,
      secret_hash: hash(s.secret ?? ""),
      version: s.version,
      redirect: `${c.API_ORIGIN}/v1/connections/callback`,
      fixture: c.CONNECTOR_FIXTURE_ORIGIN ?? null,
      scope: connectorProviders[provider].scope,
    }),
  );
}
export async function exchangeConnectorCode(
  c: Config,
  provider: ConnectorProvider,
  code: string,
  verifier: string,
  signal?: AbortSignal,
): Promise<ConnectorCredential> {
  const s = connectorSettings(c, provider);
  if (!s.available)
    throw new Problem(
      503,
      "CONNECTOR_SETUP_REQUIRED",
      "Company OAuth configuration is required",
    );
  const form = new URLSearchParams({
    client_id: s.client!,
    client_secret: s.secret!,
    code,
    redirect_uri: `${c.API_ORIGIN}/v1/connections/callback`,
    grant_type: "authorization_code",
  });
  if (provider !== "meta_ads") form.set("code_verifier", verifier);
  const { body } = await connectorJSON(
    c,
    provider === "meta_ads"
      ? `https://graph.facebook.com/${s.version}/oauth/access_token`
      : "https://oauth2.googleapis.com/token",
    { method: "POST", body: form },
    signal,
  );
  const access = text(body.access_token, 8192);
  if (!access) invalid();
  let scopes: string[];
  if (provider === "meta_ads") {
    const permissions = await connectorJSON(
      c,
      `https://graph.facebook.com/${s.version}/me/permissions`,
      { headers: { authorization: `Bearer ${access}` } },
      signal,
    );
    scopes = rows(permissions.body.data)
      .filter((v) => v.status === "granted")
      .map((v) => text(v.permission, 300));
  } else scopes = text(body.scope, 9000).split(/\s+/).filter(Boolean);
  if (!scopes.includes(connectorProviders[provider].scope))
    throw new ConnectorFailure("reauth", "CONNECTOR_SCOPE_MISSING");
  return connectorCredential.parse({
    access_token: access,
    refresh_token: body.refresh_token ? text(body.refresh_token, 8192) : null,
    expires_at:
      body.expires_in === undefined
        ? null
        : Date.now() + integer(body.expires_in) * 1000,
    scopes,
  });
}
export async function refreshConnectorCredential(
  c: Config,
  provider: ConnectorProvider,
  credential: ConnectorCredential,
  signal?: AbortSignal,
): Promise<ConnectorCredential> {
  if (
    credential.expires_at === null ||
    credential.expires_at > Date.now() + 60000
  )
    return credential;
  if (provider === "meta_ads" || !credential.refresh_token)
    throw new ConnectorFailure("reauth", "CONNECTOR_AUTH_EXPIRED");
  const setup = connectorSettings(c, provider);
  const { body } = await connectorJSON(
    c,
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: credential.refresh_token,
        client_id: setup.client!,
        client_secret: setup.secret!,
      }),
    },
    signal,
  );
  if (
    body.scope &&
    !text(body.scope, 9000)
      .split(/\s+/)
      .includes(connectorProviders[provider].scope)
  )
    throw new ConnectorFailure("reauth", "CONNECTOR_SCOPE_MISSING");
  return connectorCredential.parse({
    ...credential,
    access_token: text(body.access_token, 8192),
    expires_at: Date.now() + integer(body.expires_in) * 1000,
  });
}
function adsHeaders(
  c: Config,
  credential: ConnectorCredential,
  login?: string | null,
) {
  return {
    ...auth(credential),
    "content-type": "application/json",
    "developer-token": connectorSettings(c, "google_ads").developerToken!,
    ...(login ? { "login-customer-id": login } : {}),
  };
}
function nextToken(v: unknown): string | null {
  if (v === undefined || v === "") return null;
  return text(v, 8192) || null;
}
function metaNext(body: any, expected: URL): string | null {
  const next = body.paging?.next;
  if (!next) return null;
  let url: URL;
  try {
    url = new URL(next);
  } catch {
    invalid();
  }
  if (
    url.origin !== expected.origin ||
    url.pathname !== expected.pathname ||
    url.username ||
    url.password ||
    url.hash
  )
    invalid();
  const cursor = text(body.paging?.cursors?.after, 8192);
  if (!cursor || url.searchParams.get("after") !== cursor) invalid();
  return cursor;
}
function adsAccount(
  raw: any,
  login: string | null,
  client = false,
): ConnectorAccount {
  const prefix = client ? raw.customerClient : raw.customer;
  if (!prefix) invalid();
  return connectorAccount.parse({
    ...basicAccount,
    account_id: numericID(prefix.id),
    name: text(prefix.descriptiveName || prefix.id),
    timezone: text(prefix.timeZone, 100),
    currency: text(prefix.currencyCode, 3),
    kind: prefix.manager ? "manager" : "advertiser",
    readable:
      prefix.manager !== true &&
      (prefix.status === undefined || prefix.status === "ENABLED"),
    login_customer_id: login,
    permission_level: "oauth_accessible",
  });
}
function dc(v: Partial<DiscoveryCursor>) {
  return discoveryCursor.parse({ stage: "start", ...v });
}
/** Each step performs one read request and checkpoints its next step durably. */
export async function discoverConnectorPage(
  c: Config,
  provider: ConnectorProvider,
  credential: ConnectorCredential,
  input: DiscoveryCursor | null,
  signal?: AbortSignal,
): Promise<DiscoveryPage> {
  const cursor = input ? discoveryCursor.parse(input) : dc({});
  const result: DiscoveryPage = { accounts: [], next: null, limitations: [] };
  const setup = connectorSettings(c, provider);
  if (!setup.available)
    throw new Problem(
      503,
      "CONNECTOR_SETUP_REQUIRED",
      "Company OAuth configuration is required",
    );
  if (provider === "google_ads") {
    if (cursor.stage === "start") {
      const { body } = await connectorJSON(
        c,
        `https://googleads.googleapis.com/${setup.version}/customers:listAccessibleCustomers`,
        { headers: adsHeaders(c, credential) },
        signal,
      );
      const roots = strings.parse(body.resourceNames ?? []).map((v) => {
        if (!/^customers\/\d{1,20}$/.test(v)) invalid();
        return v.slice(10);
      });
      if (roots.length > connectorLimits.catalogAccounts)
        throw new ConnectorFailure("permanent", "CONNECTOR_CATALOG_LIMIT");
      result.next = roots.length
        ? dc({
            stage: "ads_root",
            current: roots[0],
            remaining: roots.slice(1),
          })
        : null;
    } else {
      if (
        !cursor.current ||
        !/^\d+$/.test(cursor.current) ||
        !["ads_root", "ads_clients"].includes(cursor.stage)
      )
        invalid();
      const clients = cursor.stage === "ads_clients";
      const query = clients
        ? "SELECT customer_client.id,customer_client.descriptive_name,customer_client.currency_code,customer_client.time_zone,customer_client.manager,customer_client.status FROM customer_client ORDER BY customer_client.id"
        : "SELECT customer.id,customer.descriptive_name,customer.currency_code,customer.time_zone,customer.manager,customer.status FROM customer LIMIT 1";
      const { body } = await connectorJSON(
        c,
        `https://googleads.googleapis.com/${setup.version}/customers/${cursor.current}/googleAds:search`,
        {
          method: "POST",
          headers: adsHeaders(c, credential, cursor.current),
          body: JSON.stringify({
            query,
            ...(cursor.token ? { pageToken: cursor.token } : {}),
          }),
        },
        signal,
      );
      result.accounts = rows(body.results).map((v) =>
        adsAccount(v, clients ? cursor.current : null, clients),
      );
      const next = nextToken(body.nextPageToken);
      if (clients && next) result.next = dc({ ...cursor, token: next });
      else if (!clients && result.accounts.some((a) => a.kind === "manager"))
        result.next = dc({ ...cursor, stage: "ads_clients", token: null });
      else if (cursor.remaining.length)
        result.next = dc({
          stage: "ads_root",
          current: cursor.remaining[0],
          remaining: cursor.remaining.slice(1),
        });
    }
  } else if (provider === "meta_ads") {
    if (!["start", "meta_list"].includes(cursor.stage)) invalid();
    const url = new URL(
      `https://graph.facebook.com/${setup.version}/me/adaccounts`,
    );
    url.searchParams.set(
      "fields",
      "account_id,name,currency,timezone_name,account_status,user_tasks",
    );
    url.searchParams.set("limit", "50");
    if (cursor.token) url.searchParams.set("after", cursor.token);
    const { body } = await connectorJSON(
      c,
      url,
      { headers: auth(credential) },
      signal,
    );
    if (!Array.isArray(body.data)) invalid();
    result.accounts = rows(body.data).map((a) =>
      connectorAccount.parse({
        ...basicAccount,
        account_id: numericID(a.account_id),
        name: text(a.name),
        timezone: text(a.timezone_name, 100),
        currency: text(a.currency, 3),
        readable:
          a.account_status === 1 &&
          Array.isArray(a.user_tasks) &&
          a.user_tasks.some((v: unknown) =>
            ["ANALYZE", "MANAGE", "ADVERTISE"].includes(String(v)),
          ),
        kind: "advertiser",
        permission_level: "ads_read",
      }),
    );
    const next = metaNext(body, url);
    if (next) result.next = dc({ stage: "meta_list", token: next });
  } else if (provider === "search_console") {
    if (cursor.stage !== "start") invalid();
    const { body } = await connectorJSON(
      c,
      "https://www.googleapis.com/webmasters/v3/sites",
      { headers: auth(credential) },
      signal,
    );
    result.accounts = rows(body.siteEntry).map((a) =>
      connectorAccount.parse({
        ...basicAccount,
        account_id: text(a.siteUrl, 512),
        name: text(a.siteUrl, 512),
        timezone: "America/Los_Angeles",
        kind: "site",
        readable: ["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(
          a.permissionLevel,
        ),
        permission_level: text(a.permissionLevel, 100),
      }),
    );
  } else if (cursor.stage === "start" || cursor.stage === "ga4_list") {
    const url = new URL(
      "https://analyticsadmin.googleapis.com/v1beta/accountSummaries",
    );
    url.searchParams.set("pageSize", "50");
    if (cursor.token) url.searchParams.set("pageToken", cursor.token);
    const { body } = await connectorJSON(
      c,
      url,
      { headers: auth(credential) },
      signal,
    );
    const properties = rows(body.accountSummaries).flatMap((a) =>
      rows(a.propertySummaries).map((p) => text(p.property, 100)),
    );
    if (
      properties.length > connectorLimits.catalogAccounts ||
      properties.some((v) => !/^properties\/\d{1,20}$/.test(v))
    )
      invalid();
    const next = nextToken(body.nextPageToken);
    result.next = properties.length
      ? dc({
          stage: "ga4_property",
          current: properties[0],
          remaining: properties.slice(1),
          token: next,
        })
      : next
        ? dc({ stage: "ga4_list", token: next })
        : null;
  } else if (cursor.stage === "ga4_property") {
    if (!cursor.current || !/^properties\/\d{1,20}$/.test(cursor.current))
      invalid();
    const { body } = await connectorJSON(
      c,
      `https://analyticsadmin.googleapis.com/v1beta/${cursor.current}`,
      { headers: auth(credential) },
      signal,
    );
    if (body.name !== cursor.current || body.deleteTime) invalid();
    const account = connectorAccount.parse({
      ...basicAccount,
      account_id: cursor.current.slice(11),
      name: text(body.displayName),
      timezone: text(body.timeZone, 100),
      currency: text(body.currencyCode, 3),
      kind: "property",
      reporting_identity_source: "unavailable",
      permission_level: "analytics.readonly",
    });
    result.next = dc({ ...cursor, stage: "ga4_identity", account });
  } else if (cursor.stage === "ga4_identity") {
    if (
      !cursor.current ||
      !cursor.account ||
      !/^properties\/\d{1,20}$/.test(cursor.current)
    )
      invalid();
    const account = { ...cursor.account };
    try {
      const { body } = await connectorJSON(
        c,
        `https://analyticsadmin.googleapis.com/v1alpha/${cursor.current}/reportingIdentitySettings`,
        { headers: auth(credential) },
        signal,
      );
      if (
        !["BLENDED", "OBSERVED", "DEVICE_BASED"].includes(
          body.reportingIdentity,
        )
      )
        invalid();
      account.reporting_identity = body.reportingIdentity;
      account.reporting_identity_source = "provider";
    } catch (e) {
      if (
        !(e instanceof ConnectorFailure) ||
        e.code !== "CONNECTOR_PERMISSION_DENIED"
      )
        throw e;
      result.limitations.push("GA4_REPORTING_IDENTITY_UNAVAILABLE");
    }
    result.accounts = [account];
    result.next = cursor.remaining.length
      ? dc({
          stage: "ga4_property",
          current: cursor.remaining[0],
          remaining: cursor.remaining.slice(1),
          token: cursor.token,
        })
      : cursor.token
        ? dc({ stage: "ga4_list", token: cursor.token })
        : null;
  } else invalid();
  return result;
}
function offsetCursor(cursor: PageCursor | null): {
  offset: number;
  total: number | null;
} {
  if (!cursor) return { offset: 0, total: null };
  if (cursor.kind !== "offset") invalid();
  return cursor;
}
function tokenCursor(cursor: PageCursor | null): string | null {
  if (!cursor) return null;
  if (cursor.kind !== "token") invalid();
  return cursor.token;
}
/** Returns facts at their original grain; no cross-platform identity merge or aggregate invention. */
export async function readConnectorPage(
  c: Config,
  frozen: ConnectorQuery,
  credential: ConnectorCredential,
  input: PageCursor | null,
  signal?: AbortSignal,
): Promise<ConnectorPage> {
  const q = connectorQuery.parse(frozen),
    cursor = input ? pageCursor.parse(input) : null;
  const setup = connectorSettings(c, q.provider);
  if (!setup.available || setup.version !== q.api_version)
    throw new ConnectorFailure("permanent", "CONNECTOR_CONFIGURATION_CHANGED");
  let response: Awaited<ReturnType<typeof connectorJSON>>;
  let facts: ConnectorPage["facts"] = [],
    next: PageCursor | null = null;
  const limitations: string[] = [
    "PROVIDER_DATA_CUTOFF_UNAVAILABLE",
    "LATE_ATTRIBUTION_CAN_CHANGE_NEW_SNAPSHOTS",
  ];
  if (q.provider === "google_ads") {
    const page = tokenCursor(cursor);
    response = await connectorJSON(
      c,
      `https://googleads.googleapis.com/${q.api_version}/customers/${q.account.account_id}/googleAds:search`,
      {
        method: "POST",
        headers: adsHeaders(c, credential, q.account.login_customer_id),
        body: JSON.stringify({
          query: `SELECT segments.date,campaign.id,campaign.name,metrics.impressions,metrics.clicks,metrics.cost_micros,metrics.conversions,metrics.conversions_value,customer.id,customer.currency_code,customer.time_zone FROM campaign WHERE segments.date BETWEEN '${q.date_from}' AND '${q.date_to}' ORDER BY segments.date,campaign.id`,
          ...(page ? { pageToken: page } : {}),
        }),
      },
      signal,
    );
    if (
      response.body.results === undefined &&
      typeof response.body.fieldMask !== "string"
    )
      invalid();
    facts = rows(response.body.results).map((r) => {
      if (
        numericID(r.customer?.id) !== q.account.account_id ||
        r.customer.currencyCode !== q.account.currency ||
        r.customer.timeZone !== q.account.timezone
      )
        invalid();
      const micros = decimal(r.metrics?.costMicros);
      if (micros !== null && !/^\d+$/.test(micros)) invalid();
      const spend =
        micros === null
          ? null
          : `${BigInt(micros) / 1000000n}.${(BigInt(micros) % 1000000n).toString().padStart(6, "0")}`;
      return fact(
        q,
        asDate(r.segments?.date),
        {
          campaign_id: numericID(r.campaign?.id),
          campaign_name: text(r.campaign?.name),
        },
        {
          impressions: decimal(r.metrics?.impressions),
          clicks: decimal(r.metrics?.clicks),
          spend,
          conversions: decimal(r.metrics?.conversions),
          revenue: decimal(r.metrics?.conversionsValue),
        },
      );
    });
    const token = nextToken(response.body.nextPageToken);
    if (token) next = { kind: "token", token };
    limitations.push(
      "GOOGLE_ADS_CONFIGURED_CONVERSION_ACTIONS_AND_ATTRIBUTION",
    );
  } else if (q.provider === "meta_ads") {
    const url = new URL(
      `https://graph.facebook.com/${q.api_version}/act_${q.account.account_id}/insights`,
    );
    url.search = new URLSearchParams({
      fields:
        "account_id,account_currency,date_start,date_stop,campaign_id,campaign_name,impressions,clicks,spend,actions,action_values,attribution_setting",
      time_range: JSON.stringify({ since: q.date_from, until: q.date_to }),
      time_increment: "1",
      level: "campaign",
      limit: String(q.page_size),
      action_report_time: "conversion",
      use_account_attribution_setting: "true",
    }).toString();
    const page = tokenCursor(cursor);
    if (page) url.searchParams.set("after", page);
    response = await connectorJSON(
      c,
      url,
      { headers: auth(credential) },
      signal,
    );
    const action = (data: unknown) => {
      const matches = rows(data).filter(
        (a) => a.action_type === q.conversion_action_type,
      );
      if (matches.length > 1) invalid();
      return matches.length ? decimal(matches[0].value) : null;
    };
    if (!Array.isArray(response.body.data)) invalid();
    facts = rows(response.body.data).map((r) => {
      if (
        numericID(r.account_id) !== q.account.account_id ||
        r.account_currency !== q.account.currency ||
        r.date_start !== r.date_stop
      )
        invalid();
      return fact(
        q,
        asDate(r.date_start),
        {
          campaign_id: numericID(r.campaign_id),
          campaign_name: text(r.campaign_name),
          conversion_action_type: q.conversion_action_type,
          attribution_setting:
            typeof r.attribution_setting === "string"
              ? text(r.attribution_setting)
              : "account_setting_not_returned",
        },
        {
          impressions: decimal(r.impressions),
          clicks: decimal(r.clicks),
          spend: decimal(r.spend),
          conversions: action(r.actions),
          revenue: action(r.action_values),
        },
      );
    });
    const token = metaNext(response.body, url);
    if (token) next = { kind: "token", token };
    limitations.push(
      "META_ACTION_TYPE_EXACT_MATCH_MISSING_IS_UNKNOWN",
      "META_CONVERSION_TIME_ACCOUNT_ATTRIBUTION",
    );
  } else if (q.provider === "ga4") {
    const current = offsetCursor(cursor),
      traffic = q.profile === "ga4_traffic";
    const dims = traffic
      ? ["date", "sessionDefaultChannelGroup", "landingPagePlusQueryString"]
      : ["date", "eventName"];
    const metrics = traffic
      ? [
          "sessions",
          "totalUsers",
          "screenPageViews",
          "keyEvents",
          "totalRevenue",
        ]
      : ["eventCount", "totalUsers", "keyEvents"];
    response = await connectorJSON(
      c,
      `https://analyticsdata.googleapis.com/v1beta/properties/${q.account.account_id}:runReport`,
      {
        method: "POST",
        headers: { ...auth(credential), "content-type": "application/json" },
        body: JSON.stringify({
          dateRanges: [{ startDate: q.date_from, endDate: q.date_to }],
          dimensions: dims.map((name) => ({ name })),
          metrics: metrics.map((name) => ({ name })),
          offset: String(current.offset),
          limit: String(q.page_size),
          returnPropertyQuota: true,
          orderBys: dims.map((dimensionName) => ({
            dimension: { dimensionName },
            desc: false,
          })),
        }),
      },
      signal,
    );
    if (
      JSON.stringify(
        rows(response.body.dimensionHeaders).map((h) => h.name),
      ) !== JSON.stringify(dims) ||
      JSON.stringify(rows(response.body.metricHeaders).map((h) => h.name)) !==
        JSON.stringify(metrics)
    )
      invalid();
    const total = integer(response.body.rowCount ?? 0),
      data = rows(response.body.rows),
      metadata = response.body.metadata ?? {};
    if (current.total !== null && current.total !== total)
      throw new ConnectorFailure("permanent", "CONNECTOR_ROW_COUNT_CHANGED");
    if (
      data.length > q.page_size ||
      current.offset + data.length > total ||
      (!data.length && current.offset < total)
    )
      invalid();
    if (
      metadata.timeZone !== q.account.timezone ||
      (traffic && metadata.currencyCode !== q.account.currency)
    )
      throw new ConnectorFailure("permanent", "CONNECTOR_PROPERTY_CHANGED");
    facts = data.map((r) => {
      if (
        !Array.isArray(r.dimensionValues) ||
        r.dimensionValues.length !== dims.length ||
        !Array.isArray(r.metricValues) ||
        r.metricValues.length !== metrics.length
      )
        invalid();
      const values = r.dimensionValues.map((d: any) => text(d.value));
      if (!/^\d{8}$/.test(values[0])) invalid();
      const date = `${values[0].slice(0, 4)}-${values[0].slice(4, 6)}-${values[0].slice(6)}`;
      return fact(
        q,
        asDate(date),
        Object.fromEntries(
          dims.slice(1).map((name, i) => [name, values[i + 1]]),
        ),
        Object.fromEntries(
          metrics.map((name, i) => [name, name === "totalRevenue" ? revenueDecimal(r.metricValues[i].value) : decimal(r.metricValues[i].value)]),
        ),
      );
    });
    if (current.offset + data.length < total)
      next = { kind: "offset", offset: current.offset + data.length, total };
    limitations.push(
      "GA4_USERS_NOT_ADDITIVE_ACROSS_ROWS_OR_REPORTS",
      "GA4_DATES_WITHOUT_ROWS_ARE_NOT_ZERO",
    );
    if (metadata.subjectToThresholding) limitations.push("GA4_THRESHOLDING");
    if (metadata.dataLossFromOtherRow)
      limitations.push("GA4_OTHER_ROW_DATA_LOSS");
    if (rows(metadata.samplingMetadatas).length)
      limitations.push("GA4_SAMPLING");
    if (metadata.schemaRestrictionResponse?.activeMetricRestrictions?.length)
      limitations.push("GA4_METRIC_RESTRICTIONS");
    if (!q.account.reporting_identity)
      limitations.push("GA4_REPORTING_IDENTITY_UNAVAILABLE");
  } else {
    const current = offsetCursor(cursor);
    response = await connectorJSON(
      c,
      `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(q.account.account_id)}/searchAnalytics/query`,
      {
        method: "POST",
        headers: { ...auth(credential), "content-type": "application/json" },
        body: JSON.stringify({
          startDate: q.date_from,
          endDate: q.date_to,
          dimensions: ["date", "query", "page", "country", "device"],
          type: "web",
          dataState: "final",
          aggregationType: "byPage",
          startRow: current.offset,
          rowLimit: q.page_size,
        }),
      },
      signal,
    );
    const data = rows(response.body.rows);
    if (
      data.length > q.page_size ||
      response.body.responseAggregationType !== "byPage"
    )
      invalid();
    facts = data.map((r) => {
      const keys = strings.parse(r.keys);
      if (keys.length !== 5) invalid();
      const clicks = decimal(r.clicks),
        impressions = decimal(r.impressions),
        ctr = decimal(r.ctr),
        position = decimal(r.position);
      return fact(
        q,
        asDate(keys[0]),
        {
          query: text(keys[1]),
          page: text(keys[2]),
          country: text(keys[3]),
          device: text(keys[4]),
        },
        { clicks, impressions, ctr, position },
      );
    });
    if (data.length === q.page_size)
      next = {
        kind: "offset",
        offset: current.offset + data.length,
        total: null,
      };
    limitations.push(
      "GSC_TOP_ROWS_ONLY_NOT_FULL_COVERAGE",
      "GSC_ANONYMIZED_QUERIES_OMITTED",
      "GSC_AVERAGE_POSITION_NOT_ADDITIVE",
      "GSC_WEB_FINAL_BY_PAGE_PACIFIC_TIME",
    );
    if (response.body.metadata?.first_incomplete_date)
      limitations.push("GSC_INCOMPLETE_DATES");
  }
  return {
    facts,
    next,
    raw: sanitizeConnectorRaw(response.body),
    raw_sha256: response.sha256,
    raw_bytes: response.bytes,
    limitations: [...new Set(limitations)],
  };
}
