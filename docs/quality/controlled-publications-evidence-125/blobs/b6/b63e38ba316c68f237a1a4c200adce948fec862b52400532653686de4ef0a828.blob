import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, canonical, hash } from "../src/lib.js";
import {
  clientAudienceMatches,
  clientContentDocument,
  projectClientContent,
  legacyClientContent,
} from "../src/client-content-model.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = {
  id: string;
  email: string;
  cookie: string;
  csrf: string;
  admin?: boolean;
};
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  options: { key?: string | null; headers?: Record<string, string> } = {},
) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(options.key === null
        ? {}
        : { "idempotency-key": options.key ?? randomUUID() }),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...options.headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function signIn(
  address: string,
  secret?: OTPAuth.Secret,
): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  await s.db.control.query(
    "UPDATE auth_challenges SET created_at=now()-interval '2 minutes' WHERE email=$1",
    [address],
  );
  const ch = await call(undefined, "POST", prefix + "/challenge", {
    email: address,
  });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: ch.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret
      ? {
          totp: new OTPAuth.TOTP({
            secret,
            digits: 6,
            period: 30,
            algorithm: "SHA1",
          }).generate(),
        }
      : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie =
    r.raw.cookies.find(
      (c) => c.name === (secret ? "cp_admin_session" : "cp_session"),
    ) ?? r.raw.cookies[0];
  return {
    id: r.data.user?.id ?? r.data.admin?.id,
    email: address,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}
async function user() {
  return signIn(`client-content-${randomUUID()}@example.invalid`);
}
async function admin(tenant?: string, role = "user_operator") {
  const email = `client-content-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Membership operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, tenant ? "tenant" : "global", tenant ?? null],
  );
  return { ...(await signIn(email, secret)), id: p.id };
}
const root = "/v1/admin/client-content";
let operator: Client,
  other: Client,
  owner: Client,
  outsider: Client,
  tenant: string,
  project: string;
const copy = (title: string, overrides = {}) => ({
  key: "Launch_Copy",
  title,
  title_en: title + " English",
  text: "經核對的公告正文",
  text_en: "Reviewed announcement body",
  enabled: true,
  ...overrides,
});
const document = (title: string) => ({
  schema: 1,
  announcements: [copy(title)],
  help: [{ ...copy(title + " help"), key: "help" }],
  navigation: [
    {
      client: "web",
      path: "analytics",
      label: "行銷成效",
      label_en: "Campaign results",
      enabled: false,
      order: 12,
    },
  ],
});
const audience = (overrides = {}) => ({
  clients: ["web", "desktop", "extension"],
  tenant_ids: [],
  user_ids: [],
  percentage: 100,
  cohort_key: "launch-test",
  ...overrides,
});
async function ok(
  c: Client | undefined,
  method: string,
  path: string,
  body?: unknown,
  options?: any,
) {
  const r = await call(c, method, path, body, options);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${method} ${path}: ${r.status} ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
const create = (
  title: string,
  target = audience(),
  c = operator,
  options?: any,
) =>
  ok(
    c,
    "POST",
    root,
    {
      document: document(title),
      audience: target,
      reason: "Review client copy " + title,
    },
    options,
  );
const preview = (
  release: any,
  action = "publish",
  c = operator,
  sample: any = { client: "web" },
) =>
  ok(c, "POST", `${root}/${release.id}/previews`, {
    action,
    reason: "Reviewed client audience and exact copy",
    sample,
  });
const publish = (p: any, c = operator) =>
  ok(c, "POST", root + "/" + p.action, { preview_id: p.id });
const current = (
  c = owner,
  client = "web",
  workspace: string | null = tenant,
) =>
  call(c, "GET", "/v1/client-content?client=" + client, undefined, {
    headers: workspace ? { "x-tenant-id": workspace } : {},
  });
const title = (r: any) =>
  r.data.items.find((v: any) => v.kind === "announcement")?.body.title;
async function full(name: string) {
  const r = await create(name);
  await publish(await preview(r));
  return r;
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
    }),
    { worker: false },
  );
  operator = await admin(undefined, "super_admin");
  other = await admin(undefined, "super_admin");
  owner = await user();
  outsider = await user();
  const w = await ok(owner, "POST", "/v1/tenants", {
    name: "Content review studio",
    project_name: "Launch",
  });
  tenant = w.tenant.id;
  project = w.project.id;
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("legacy public content stays compatible; first preview rejects a changed legacy baseline", async () => {
  const legacy = await ok(operator, "POST", "/v1/admin/catalog", {
    kind: "announcement",
    key: "Legacy_Key",
    body: {
      title: "Before releases",
      text: "Original public copy",
      enabled: true,
    },
  });
  await ok(operator, "POST", `/v1/admin/catalog/${legacy.id}/publish`);
  const response = await current();
  assert.equal(response.status, 200);
  assert.equal(title(response), "Before releases");
  assert.equal(response.raw.headers["cache-control"], "private, no-store");
  assert.equal(
    (await call(undefined, "GET", "/v1/public/content")).data.items[0].id,
    legacy.id,
  );
  const draft = await create("First managed content"),
    p = await preview(draft);
  const updated = await ok(operator, "POST", "/v1/admin/catalog", {
    kind: "announcement",
    key: "Legacy_Key",
    body: { title: "Changed legacy", text: "New public copy", enabled: true },
  });
  await ok(operator, "POST", `/v1/admin/catalog/${updated.id}/publish`);
  const stale = await call(operator, "POST", root + "/publish", {
    preview_id: p.id,
  });
  assert.equal(stale.data.error.code, "CONTENT_PREVIEW_STALE");
  await publish(await preview(draft));
  assert.equal(title(await current()), "First managed content");
});
test("strict documents reject duplicate keys, invalid schedules, non-menu paths and hidden account controls", async () => {
  const invalid = [
    { ...document("x"), announcements: [copy("x"), copy("y")] },
    {
      ...document("x"),
      announcements: [
        copy("x", {
          starts_at: "2026-11-01T00:00:00Z",
          ends_at: "2026-10-01T00:00:00Z",
        }),
      ],
    },
    { ...document("x"), permission: "full" },
    {
      ...document("x"),
      navigation: [
        {
          client: "extension",
          path: "entitlements",
          label: "Hide",
          label_en: "Hide",
          enabled: false,
          order: 1,
        },
      ],
    },
    {
      ...document("x"),
      navigation: [
        {
          client: "web",
          path: "settings",
          label: "Hide",
          label_en: "Hide",
          enabled: false,
          order: 1,
        },
      ],
    },
  ];
  for (const value of invalid) {
    const r = await call(operator, "POST", root, {
      document: value,
      audience: audience(),
      reason: "Invalid fixture",
    });
    assert.equal(r.status, 400, JSON.stringify(r.data));
  }
  assert.equal(
    (
      await call(operator, "POST", root, {
        document: document("x"),
        audience: audience({ clients: ["web", "web"] }),
        reason: "Duplicate clients",
      })
    ).status,
    400,
  );
});
test("draft requests are idempotent and content versions are digest-checked, append-only and control-only", async () => {
  const key = randomUUID(),
    r = await create("Digest", audience(), operator, { key });
  assert.equal(
    (await create("Digest", audience(), operator, { key })).id,
    r.id,
  );
  assert.equal(
    (
      await call(
        operator,
        "POST",
        root,
        {
          document: document("Changed"),
          audience: audience(),
          reason: "Review client copy Digest",
        },
        { key },
      )
    ).data.error.code,
    "IDEMPOTENCY_CONFLICT",
  );
  assert.equal(
    r.definition_hash,
    hash(canonical({ document: r.document, audience: r.audience })),
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE client_content_releases SET reason='changed' WHERE id=$1",
      [r.id],
    ),
    /immutable/,
  );
  await assert.rejects(
    s.db.control.query("DELETE FROM client_content_releases WHERE id=$1", [
      r.id,
    ]),
    /immutable/,
  );
  await assert.rejects(
    s.db.app.query("SELECT * FROM client_content_releases"),
    /permission denied/,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE client_content_head SET revision=revision+1 WHERE singleton",
    ),
    /reviewed publication/,
  );
  const saved = (
    await s.db.control.query(
      "SELECT * FROM client_content_releases WHERE id=$1",
      [r.id],
    )
  ).rows[0];
  await assert.rejects(
    s.db.control.query(
      "INSERT INTO client_content_releases(version,document,audience,canonical_definition,definition_hash,reason,created_by,idempotency_key,request_hash) VALUES(100000,$1,$2,$3,$4,'tampered definition',$5,$6,$4)",
      [
        saved.document,
        saved.audience,
        saved.canonical_definition + " ",
        saved.definition_hash,
        operator.id,
        randomUUID(),
      ],
    ),
    /check constraint/,
  );
});
test("global content control cannot bypass a scoped allow or explicit scoped deny", async () => {
  const limited = await admin(tenant, "super_admin");
  assert.equal(
    (
      await call(limited, "POST", root, {
        document: document("Denied"),
        audience: audience(),
        reason: "Scoped control",
      })
    ).status,
    403,
  );
  const role = "content_deny_" + randomUUID();
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Deny client draft',$2)",
    [role, JSON.stringify(["admin.catalog.draft"])],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'tenant',$3,'deny')",
    [limited.id, role, tenant],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
    [limited.id],
  );
  const result = await call(limited, "POST", root, {
    document: document("Denied"),
    audience: audience(),
    reason: "Explicit deny",
  });
  assert.equal(result.data.error.code, "ADMIN_FORBIDDEN");
});
test("full publication reaches all three clients with private metadata and optional-menu appearance only", async () => {
  const r = await full("Everyone");
  for (const client of ["web", "desktop", "extension"]) {
    const result = await current(owner, client);
    assert.equal(title(result), "Everyone");
    assert.equal(result.data.release_id, r.id);
    assert.equal(JSON.stringify(result.data).includes("cohort_key"), false);
    assert.equal(JSON.stringify(result.data).includes("user_ids"), false);
  }
  const web = await current();
  assert.equal(
    web.data.items.find((v: any) => v.kind === "navigation").body.enabled,
    false,
  );
  assert.equal(
    (await call(undefined, "GET", "/v1/client-content?client=web")).status,
    401,
  );
  assert.equal((await current(outsider)).status, 404);
  assert.equal(
    (
      await call(
        owner,
        "GET",
        `/v1/client-content?client=web&project_id=${project}`,
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        owner,
        "GET",
        `/v1/client-content?client=web&project_id=${randomUUID()}`,
        undefined,
        { headers: { "x-tenant-id": tenant } },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        owner,
        "GET",
        `/v1/client-content?client=web&project_id=${project}`,
        undefined,
        { headers: { "x-tenant-id": tenant } },
      )
    ).status,
    200,
  );
});
test("targeted publication preserves the exact baseline for other users, workspaces and clients", async () => {
  await full("Stable baseline");
  const r = await create(
    "Selected launch",
    audience({ clients: ["web"], tenant_ids: [tenant], user_ids: [owner.id] }),
  );
  const p = await preview(r, "publish", operator, {
    client: "web",
    user_id: owner.id,
    tenant_id: tenant,
  });
  assert.equal(p.before.items[0].body.title, "Stable baseline");
  assert.equal(p.after.items[0].body.title, "Selected launch");
  assert.equal(p.sample_selected, true);
  await publish(p);
  assert.equal(title(await current()), "Selected launch");
  assert.equal(title(await current(owner, "desktop")), "Stable baseline");
  assert.equal(title(await current(owner, "extension")), "Stable baseline");
  assert.equal(title(await current(owner, "web", null)), "Stable baseline");
  assert.equal(title(await current(outsider, "web", null)), "Stable baseline");
  assert.equal(
    (await call(undefined, "GET", "/v1/public/content")).data.items[0].body
      .title,
    "Stable baseline",
  );
  const unselected = await preview(r, "rollback", operator, {
    client: "extension",
  });
  assert.equal(unselected.sample_selected, false);
  assert.equal(unselected.after.items[0].body.title, "Stable baseline");
});
test("overlapping targeted rollouts are rejected; promotion to everyone is explicit", async () => {
  const r = await create("Another target", audience({ percentage: 10 }));
  const result = await call(operator, "POST", `${root}/${r.id}/previews`, {
    action: "publish",
    reason: "Second targeted release",
    sample: { client: "web" },
  });
  assert.equal(result.data.error.code, "CONTENT_ROLLOUT_ACTIVE");
  await full("Promoted release");
  assert.equal(title(await current(outsider, "web", null)), "Promoted release");
});
test("rollback creates a new publication and restores a historical rollout's original baseline", async () => {
  const history = await ok(operator, "GET", root),
    target = history.items.find(
      (r: any) => r.document.announcements[0]?.title === "Selected launch",
    );
  await publish(await preview(target, "rollback"));
  assert.equal(title(await current()), "Selected launch");
  assert.equal(title(await current(owner, "desktop")), "Stable baseline");
  const stable = history.items.find(
    (r: any) => r.document.announcements[0]?.title === "Stable baseline",
  );
  await publish(await preview(stable, "rollback"));
  assert.equal(title(await current()), "Stable baseline");
  const draft = await create("Never published");
  const denied = await call(operator, "POST", `${root}/${draft.id}/previews`, {
    action: "rollback",
    reason: "Cannot rollback a draft",
    sample: { client: "web" },
  });
  assert.equal(denied.data.error.code, "CONTENT_ROLLBACK_UNAVAILABLE");
  const log = await ok(operator, "GET", root + "/publications?limit=2");
  assert.equal(log.items[0].action, "rollback");
  assert.ok(log.next_before_revision);
  assert.equal(
    (
      await ok(
        operator,
        "GET",
        root + "/publications?before_revision=" + log.next_before_revision,
      )
    ).items.some((r: any) => r.id === log.items[0].id),
    false,
  );
  await assert.rejects(
    s.db.control.query("DELETE FROM client_content_publications WHERE id=$1", [
      log.items[0].id,
    ]),
    /immutable/,
  );
});
test("stale concurrent previews cannot overwrite a newer administrator publication", async () => {
  const first = await create("First review"),
    second = await create("Second review"),
    a = await preview(first),
    b = await preview(second, "publish", other);
  await publish(a);
  const stale = await call(other, "POST", root + "/publish", {
    preview_id: b.id,
  });
  assert.equal(stale.data.error.code, "CONTENT_PREVIEW_STALE");
  assert.equal(title(await current()), "First review");
});
test("preview binds actor, action, session and deadline; expired MFA blocks publication", async () => {
  const r = await create("Bound preview"),
    p = await preview(r);
  assert.equal(
    (await call(other, "POST", root + "/publish", { preview_id: p.id })).data
      .error.code,
    "CONTENT_PREVIEW_REQUIRED",
  );
  assert.equal(
    (await call(operator, "POST", root + "/rollback", { preview_id: p.id }))
      .data.error.code,
    "CONTENT_PREVIEW_REQUIRED",
  );
  const bound = (
    await s.db.control.query(
      "SELECT * FROM client_content_previews WHERE id=$1",
      [p.id],
    )
  ).rows[0];
  const fields =
    "release_id,action,expected_revision,previous_publication_id,baseline_document,baseline_release_id,created_by,auth_version,session_id,reason,sample,comparison".split(
      ",",
    );
  const inserted = await s.db.control.query(
    `INSERT INTO client_content_previews(${fields.join(",")},expires_at) VALUES(${fields.map((_, i) => "$" + (i + 1)).join(",")},now()-interval '1 second') RETURNING id`,
    fields.map((k) => bound[k]),
  );
  assert.equal(
    (
      await call(operator, "POST", root + "/publish", {
        preview_id: inserted.rows[0].id,
      })
    ).data.error.code,
    "CONTENT_PREVIEW_EXPIRED",
  );
  for (const field of ["session_id", "auth_version"] as const) {
    const invalid = {
      ...bound,
      [field]: field === "session_id" ? randomUUID() : bound.auth_version + 1,
    };
    const clone = await s.db.control.query(
      `INSERT INTO client_content_previews(${fields.join(",")}) VALUES(${fields.map((_, i) => "$" + (i + 1)).join(",")}) RETURNING id`,
      fields.map((k) => invalid[k]),
    );
    assert.equal(
      (
        await call(operator, "POST", root + "/publish", {
          preview_id: clone.rows[0].id,
        })
      ).data.error.code,
      "CONTENT_PREVIEW_REQUIRED",
    );
  }
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [operator.id],
  );
  assert.equal(
    (await call(operator, "POST", root + "/publish", { preview_id: p.id })).data
      .error.code,
    "MFA_REQUIRED",
  );
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now() WHERE admin_id=$1",
    [operator.id],
  );
  await publish(p);
  await assert.rejects(
    s.db.control.query(
      "UPDATE client_content_previews SET reason='changed' WHERE id=$1",
      [p.id],
    ),
    /immutable/,
  );
});
test("duplicate concurrent confirmation publishes once and replay still rechecks live authority", async () => {
  const r = await create("Exactly once"),
    p = await preview(r),
    [a, b] = await Promise.all([publish(p), publish(p)]);
  assert.equal(a.id, b.id);
  assert.notEqual(a.replay, b.replay);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM client_content_publications WHERE preview_id=$1",
        [p.id],
      )
    ).rows[0].n,
    1,
  );
  const revoke = await admin(undefined, "super_admin"),
    q = await preview(await create("Revoke replay"), "publish", revoke);
  await publish(q, revoke);
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    revoke.id,
  ]);
  assert.equal(
    (await call(revoke, "POST", root + "/publish", { preview_id: q.id }))
      .status,
    403,
  );
});
test("zero percent and stable cohort hashing preserve identity; schedule boundaries and literal text are exact", async () => {
  await full("Zero baseline");
  const r = await create("No rollout", audience({ percentage: 0 }));
  await publish(await preview(r));
  assert.equal(title(await current()), "Zero baseline");
  const target: any = audience({ percentage: 35 }),
    ids = Array.from({ length: 300 }, () => randomUUID()),
    selected = ids.filter((id) =>
      clientAudienceMatches(target, { client: "web", user_id: id }),
    );
  assert.ok(selected.length > 65 && selected.length < 145);
  for (const id of ids)
    assert.equal(
      clientAudienceMatches(target, { client: "web", user_id: id }),
      clientAudienceMatches(target, { client: "desktop", user_id: id }),
    );
  assert.equal(clientAudienceMatches(target, { client: "web" }), false);
  const begin = "2026-10-26T09:00:00Z",
    end = "2026-10-26T10:00:00Z",
    d = clientContentDocument.parse({
      ...document("Schedule"),
      announcements: [
        copy("<script>literal</script>", { starts_at: begin, ends_at: end }),
      ],
      help: [],
      navigation: [],
    });
  assert.equal(
    projectClientContent(d, { client: "web" }, r.id, Date.parse(begin) - 1)
      .length,
    0,
  );
  assert.equal(
    projectClientContent(d, { client: "web" }, r.id, Date.parse(begin))[0].body
      .title,
    "<script>literal</script>",
  );
  assert.equal(
    projectClientContent(d, { client: "web" }, r.id, Date.parse(end)).length,
    0,
  );
});
test("audience and preview subjects require directory authority and active membership", async () => {
  const noDirectory = await admin(undefined, "super_admin"),
    role = "content_only_" + randomUUID();
  await s.db.control.query("DELETE FROM admin_bindings WHERE principal_id=$1", [
    noDirectory.id,
  ]);
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Content only',$2)",
    [
      role,
      JSON.stringify([
        "admin.catalog.read",
        "admin.catalog.draft",
        "admin.catalog.publish",
      ]),
    ],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')",
    [noDirectory.id, role],
  );
  assert.equal(
    (
      await call(noDirectory, "POST", root, {
        document: document("Private target"),
        audience: audience({ user_ids: [owner.id] }),
        reason: "Directory missing",
      })
    ).status,
    403,
  );
  const r = await create("Review subjects");
  assert.equal(
    (
      await call(operator, "POST", `${root}/${r.id}/previews`, {
        action: "publish",
        reason: "Not a member",
        sample: { client: "web", user_id: outsider.id, tenant_id: tenant },
      })
    ).data.error.code,
    "CONTENT_SAMPLE_UNAVAILABLE",
  );
  assert.equal(
    (
      await call(operator, "POST", root, {
        document: document("Unknown target"),
        audience: audience({ user_ids: [randomUUID()] }),
        reason: "Missing subject",
      })
    ).data.error.code,
    "CONTENT_AUDIENCE_UNAVAILABLE",
  );
});
test("managed content blocks legacy backdoors while old public byte-compatible menu precedence is preserved", async () => {
  const old = (
    await s.db.control.query(
      "SELECT id FROM catalog_entries WHERE kind='announcement' AND state='retired' LIMIT 1",
    )
  ).rows[0];
  assert.equal(
    (await call(operator, "POST", `/v1/admin/catalog/${old.id}/publish`)).data
      .error.code,
    "VERSIONED_CONTENT_REQUIRED",
  );
  assert.equal(
    (await call(operator, "POST", `/v1/admin/catalog/${old.id}/rollback`)).data
      .error.code,
    "VERSIONED_CONTENT_REQUIRED",
  );
  assert.equal(
    (
      await call(operator, "POST", "/v1/admin/catalog", {
        kind: "announcement",
        key: "Bypass",
        body: { title: "Bypass", text: "Bypass" },
      })
    ).data.error.code,
    "VERSIONED_CONTENT_REQUIRED",
  );
  const rows = [
    {
      kind: "navigation",
      key: "new",
      body: { path: "analytics", label: "Latest", enabled: false, order: 1 },
    },
    {
      kind: "navigation",
      key: "old",
      body: { path: "analytics", label: "Older", enabled: true, order: 9 },
    },
  ];
  const frozen = legacyClientContent(rows);
  assert.equal(frozen.navigation.length, 2);
  assert.ok(frozen.navigation.every((v) => v.label === "Latest"));
  assert.throws(
    () =>
      legacyClientContent([
        { kind: "help", key: "bad", body: { text: "No title" } },
      ]),
    /Correct the published/,
  );
  assert.ok((await ok(operator, "GET", root + "?limit=2")).next_before_version);
});
test("audience subjects are revalidated after preview and cannot become invalid before publication", async () => {
  await full("Audience authority baseline");
  const r = await create(
      "Active user rollout",
      audience({ user_ids: [outsider.id] }),
    ),
    p = await preview(r);
  await s.db.control.query("UPDATE users SET status='suspended' WHERE id=$1", [
    outsider.id,
  ]);
  try {
    const result = await call(operator, "POST", root + "/publish", {
      preview_id: p.id,
    });
    assert.equal(result.data.error.code, "CONTENT_AUDIENCE_UNAVAILABLE");
    assert.equal(title(await current()), "Audience authority baseline");
  } finally {
    await s.db.control.query("UPDATE users SET status='active' WHERE id=$1", [
      outsider.id,
    ]);
  }
});
