import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import { advanceSeoAudits } from "../src/seo-audits.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>,
  address: string,
  clock = Date.now();
type Client = { id: string; cookie: string; csrf: string };
type Kind = "analysis" | "seo";

before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      DEV_MAILBOX: "true",
    }),
    { worker: false },
  );
  address = await s.app.listen({ host: "127.0.0.1", port: 0 });
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

async function call(
  client: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      "idempotency-key": randomUUID(),
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return {
    status: raw.statusCode,
    data: raw.headers["content-type"]?.includes("application/json")
      ? raw.json()
      : raw.body,
    raw,
  };
}
function ok(r: Awaited<ReturnType<typeof call>>, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const challenge = ok(
    await call(undefined, "POST", "/v1/auth/challenge", {
      email: `task-source-${randomUUID()}@example.invalid`,
    }),
  );
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
      "utf8",
    ),
  );
  const response = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  const body = ok(response);
  return {
    id: body.user.id,
    cookie: response.raw.cookies[0].name + "=" + response.raw.cookies[0].value,
    csrf: body.csrf_token,
  };
}

// Emit through the same Worker callback as real Codex agentMessage deltas.
// The actual stored model narrative, rather than a hand-inserted replacement,
// must remain protected after its retained source becomes unavailable.
class NarrativeRuntime extends CodexRuntimeAdapter {
  override async start(context: RuntimeContext): Promise<RuntimeResult> {
    const tool = context.tools.find((t) =>
      ["analysis_report_facts", "seo_audit_facts"].includes(t.name),
    );
    assert.ok(tool);
    const facts = (await tool.run({}, "source-facts-" + randomUUID())) as any;
    const id = facts.coverage?.id ?? facts.evidence[0].id;
    const text = JSON.stringify({
      observations: [
        { text: `Retained evidence: {{${id}}}`, evidence_ids: [id] },
      ],
      hypotheses: [],
      next_steps: ["Review original evidence before authorizing changes."],
    });
    await context.onEvent("message.delta", { text });
    return {
      status: "completed",
      text,
      inputTokens: 100,
      outputTokens: 100,
      usageKnown: true,
      accepted: true,
      thread: "synthetic-source-thread",
      turn: "synthetic-source-turn",
    };
  }
}

async function fixture(kind: Kind, realCodex = false) {
  const owner = await user(),
    workspace = ok(
      await call(owner, "POST", "/v1/tenants", {
        name: "Source visibility studio",
        project_name: "Private source reports",
      }),
    );
  const tenant = workspace.tenant.id as string,
    project = workspace.project.id as string,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  ok(await call(owner, "POST", `/v1/tenants/${tenant}/demo-credit`, {}));
  const agent = ok(await call(owner, "POST", base + "/analysis/assistant", {}));
  let dataset: string | undefined, result: any;
  if (kind === "analysis") {
    dataset = ok(
      await call(owner, "POST", base + "/analytics/import", {
        name: "Private launch evidence",
        csv: "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Launch,1000,100,100,4,400,HKD",
        currency: "HKD",
        account_id: "private-account",
        attribution_definition: "7d click",
        conversion_definition: "Purchase",
      }),
    ).id;
    result = ok(
      await call(
        owner,
        "POST",
        "/v1/reports",
        {
          project_id: project,
          agent_id: agent.id,
          analysis: {
            prompt: "Review the private campaign evidence",
            snapshot_ids: [dataset],
            date_from: "2026-10-01",
            date_to: "2026-10-02",
            timezone: "Asia/Hong_Kong",
            currency_policy: "group_by_currency",
            metrics: ["spend", "ctr", "roas"],
            dimensions: [],
          },
          budget: { currency: "HKD", amount_micros: "1000000" },
        },
        tenant,
      ),
      202,
    );
  } else {
    s.seoFixture!.setRevision(1);
    s.seoFixture!.setFaults([]);
    result = ok(
      await call(
        owner,
        "POST",
        "/v1/seo/audits",
        {
          project_id: project,
          agent_id: agent.id,
          input: {
            prompt: "Diagnose the private website and retain original evidence",
            start_urls: ["https://marketing.example.invalid/"],
            allowed_hosts: ["marketing.example.invalid"],
            max_pages: 10,
          },
          budget: { currency: "HKD", amount_micros: "1000000" },
        },
        tenant,
      ),
      202,
    );
    let finished = false;
    for (let n = 0; n < 180; n++) {
      const state = ok(
        await call(
          owner,
          "GET",
          "/v1/seo/audits/" + result.id,
          undefined,
          tenant,
        ),
      );
      if (!["queued", "running"].includes(state.state)) {
        finished = true;
        break;
      }
      clock = Math.max(
        clock + 1100,
        Date.parse(state.progress.next_attempt_at),
      );
      await advanceSeoAudits(s.db, s.catalog, s.storage, { now: () => clock });
    }
    assert.ok(finished, "The bounded native HTTP crawl must complete");
  }
  const runtime = realCodex ? undefined : new NarrativeRuntime(s.db.config);
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    tenant,
    result.task_id,
  );
  const task = (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [
      result.task_id,
    ])
  ).rows[0];
  assert.equal(task.status, "succeeded", JSON.stringify(task.output));
  const messages = (
    await s.db.control.query(
      "SELECT seq,body->>'text' AS text FROM task_events WHERE task_id=$1 AND kind='message.delta' ORDER BY seq",
      [task.id],
    )
  ).rows;
  assert.ok(messages.length > 0, "The real Worker must persist model deltas");
  const source =
    dataset ??
    (
      await s.db.control.query(
        "SELECT asset_id FROM seo_documents WHERE run_id=$1 AND asset_id IS NOT NULL ORDER BY id LIMIT 1",
        [result.id],
      )
    ).rows[0].asset_id;
  return {
    kind,
    owner,
    tenant,
    project,
    base,
    result,
    task,
    messages,
    source,
    route:
      kind === "analysis"
        ? "/v1/reports/" + result.id
        : "/v1/seo/audits/" + result.id,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function sourceState(
  f: Fixture,
  state: "active" | "quarantined" | "expired",
) {
  const table = f.kind === "analysis" ? "analytics_datasets" : "assets",
    column = f.kind === "analysis" ? "content_state" : "state";
  await s.db.control.query(
    `UPDATE ${table} SET ${column}=$2,moderation_version=moderation_version+1,
     retention_expires_at=clock_timestamp()+CASE WHEN $3 THEN interval '-1 second' ELSE interval '90 days' END WHERE id=$1`,
    [f.source, state === "quarantined" ? state : "active", state === "expired"],
  );
}
async function eventRequest(f: Fixture, path: string, after = 0) {
  const cancel = new AbortController();
  const response = await fetch(address + path, {
    headers: {
      cookie: f.owner.cookie,
      "X-Tenant-ID": f.tenant,
      "Last-Event-ID": String(after),
    },
    signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(8000)]),
  });
  return { response, cancel };
}
async function assertHidden(f: Fixture) {
  const routes = [
    f.route,
    f.base + "/tasks/" + f.task.id,
    f.base + "/tasks/" + f.task.id + "/events",
  ];
  const observations: {
    route: string;
    status: number;
    leaked_model_text: boolean;
  }[] = [];
  for (const route of routes) {
    const r = await call(f.owner, "GET", route, undefined, f.tenant);
    observations.push({
      route,
      status: r.status,
      leaked_model_text: JSON.stringify(r.data).includes(
        JSON.stringify(f.messages[0].text),
      ),
    });
  }
  for (const route of [
    `/v1/tasks/${f.task.id}/events`,
    f.base + `/tasks/${f.task.id}/events/stream`,
  ]) {
    const { response, cancel } = await eventRequest(f, route);
    try {
      observations.push({
        route,
        status: response.status,
        leaked_model_text: false,
      });
    } finally {
      cancel.abort();
      await response.body?.cancel().catch(() => {});
    }
  }
  const listed = ok(await call(f.owner, "GET", f.base + "/tasks")).items.some(
    (t: any) => t.id === f.task.id,
  );
  assert.ok(
    observations.every((r) => [403, 404].includes(r.status)) && !listed,
    JSON.stringify({ observations, listed }),
  );
}
async function assertReadable(f: Fixture) {
  ok(await call(f.owner, "GET", f.route, undefined, f.tenant));
  const task = ok(await call(f.owner, "GET", f.base + "/tasks/" + f.task.id));
  assert.equal(task.id, f.task.id);
  const history = ok(
    await call(f.owner, "GET", f.base + "/tasks/" + f.task.id + "/events"),
  );
  assert.deepEqual(
    history.items
      .filter((e: any) => e.kind === "message.delta")
      .map((e: any) => e.body.text),
    f.messages.map((e: any) => e.text),
  );
  assert.ok(
    ok(await call(f.owner, "GET", f.base + "/tasks")).items.some(
      (t: any) => t.id === f.task.id,
    ),
  );
}

for (const kind of ["analysis", "seo"] as const) {
  test(`${kind} source quarantine fences generic task detail, JSON history, both SSE routes and list; restore retains original events`, async () => {
    const f = await fixture(kind);
    await assertReadable(f);
    await sourceState(f, "quarantined");
    try {
      await assertHidden(f);
    } finally {
      await sourceState(f, "active");
    }
    await assertReadable(f);
    const task = (
      await s.db.control.query(
        "SELECT status,charged_micros FROM tasks WHERE id=$1",
        [f.task.id],
      )
    ).rows[0];
    assert.equal(task.status, "succeeded");
    assert.equal(task.charged_micros, f.task.charged_micros);
  });
  test(`${kind} expired retained source fences historical task reads immediately without a cleanup worker`, async () => {
    const f = await fixture(kind);
    await sourceState(f, "expired");
    await assertHidden(f);
    const source = (
      await s.db.control.query(
        `SELECT ${kind === "analysis" ? "content_state" : "state"} AS state FROM ${kind === "analysis" ? "analytics_datasets" : "assets"} WHERE id=$1`,
        [f.source],
      )
    ).rows[0];
    assert.equal(
      source.state,
      "active",
      "Expiry must be enforced before logical cleanup",
    );
  });
  test(`${kind} already-open event stream closes after source quarantine and never emits a later model delta`, async () => {
    const f = await fixture(kind),
      route =
        kind === "analysis"
          ? `/v1/tasks/${f.task.id}/events`
          : f.base + `/tasks/${f.task.id}/events/stream`,
      { response, cancel } = await eventRequest(
        f,
        route,
        Number(f.task.last_event_seq),
      );
    assert.equal(response.status, 200);
    const reader = response.body!.getReader(),
      decoder = new TextDecoder();
    const first = await reader.read();
    assert.match(decoder.decode(first.value), /connected/);
    const canary = "AFTER-SOURCE-QUARANTINE-" + randomUUID();
    try {
      await sourceState(f, "quarantined");
      await s.db.control.query(
        "INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'message.delta',$3)",
        [f.tenant, f.task.id, { text: canary }],
      );
      let text = "";
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
        assert.ok(
          !text.includes(canary),
          "A live stream exposed model text after source quarantine",
        );
      }
      assert.match(text, /event: stream.reset/);
      assert.match(text, /(?:ANALYSIS|SEO)_SOURCE_(?:REVOKED|CHANGING)/);
    } finally {
      cancel.abort();
      await reader.cancel().catch(() => {});
    }
  });
}

test("real locked Codex model deltas retain the same source fence as the immutable website report", async () => {
  const f = await fixture("seo", true);
  await assertReadable(f);
  await sourceState(f, "quarantined");
  await assertHidden(f);
});

test("analysis report artifact quarantine, artifact expiry and terminal-task expiry fence every report read without rewriting retained events", async () => {
  const f = await fixture("analysis"),
    output = (
      await s.db.control.query(
        "SELECT v.asset_id FROM analysis_reports r JOIN asset_versions v ON v.id=r.asset_version_id WHERE r.id=$1",
        [f.result.id],
      )
    ).rows[0].asset_id;
  for (const state of ["quarantined", "expired"] as const) {
    await sourceState({ ...f, kind: "seo", source: output }, state);
    try {
      await assertHidden(f);
    } finally {
      await sourceState({ ...f, kind: "seo", source: output }, "active");
    }
    await assertReadable(f);
  }
  await s.db.control.query(
    "UPDATE tasks SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [f.task.id],
  );
  await assertHidden(f);
  const row = (
    await s.db.control.query(
      "SELECT content_state,status FROM tasks WHERE id=$1",
      [f.task.id],
    )
  ).rows[0];
  assert.equal(row.content_state, "active");
  assert.equal(row.status, "succeeded");
});

test("source locks wait for ordinary task updates, then recheck a revoked actor before detail, JSON events or SSE can respond", async () => {
  const f = await fixture("seo"),
    holder = await s.db.control.connect();
  const routes = [
    f.base + "/tasks/" + f.task.id,
    f.base + "/tasks/" + f.task.id + "/events",
    `/v1/tasks/${f.task.id}/events`,
  ];
  const requests: Promise<Awaited<ReturnType<typeof eventRequest>>>[] = [];
  let results:
    | Promise<PromiseSettledResult<Awaited<ReturnType<typeof eventRequest>>>[]>
    | undefined;
  let locked = false;
  try {
    await holder.query("BEGIN");
    locked = true;
    const pid = Number(
      (await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid,
    );
    await holder.query("UPDATE tasks SET version=version+1 WHERE id=$1", [
      f.task.id,
    ]);
    requests.push(...routes.map((route) => eventRequest(f, route)));
    results = Promise.allSettled(requests);
    const deadline = Date.now() + 6000;
    while (true) {
      const waiting = Number(
        (
          await s.db.control.query(
            "SELECT count(*)::int AS n FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))",
            [pid],
          )
        ).rows[0].n,
      );
      if (waiting === routes.length) break;
      assert.ok(
        Date.now() < deadline,
        "All actual reads must wait for the held source-task update",
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await s.db.control.query(
      "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
      [f.owner.id],
    );
    await holder.query("COMMIT");
    locked = false;
    const completed = await results;
    for (const item of completed) {
      assert.equal(item.status, "fulfilled");
      if (item.status === "fulfilled")
        assert.ok([401, 404].includes(item.value.response.status));
    }
  } finally {
    if (locked) await holder.query("ROLLBACK");
    holder.release();
    for (const item of await (results ?? Promise.resolve([])))
      if (item.status === "fulfilled") {
        item.value.cancel.abort();
        await item.value.response.body?.cancel().catch(() => {});
      }
  }
});

test("unrelated normal tasks and other private reports retain their authorized visibility when one report source is quarantined", async () => {
  const f = await fixture("analysis"),
    other = await fixture("seo");
  const normal = ok(
    await call(f.owner, "POST", f.base + "/tasks", {
      title: "Unrelated source-free work",
      prompt: "Explain an unrelated software requirement",
      role_key: "fullstack",
      budget_micros: 100000,
    }),
  );
  await sourceState(f, "quarantined");
  await assertHidden(f);
  assert.equal(
    ok(await call(f.owner, "GET", f.base + "/tasks/" + normal.id)).id,
    normal.id,
  );
  assert.ok(
    ok(await call(f.owner, "GET", f.base + "/tasks")).items.some(
      (t: any) => t.id === normal.id,
    ),
  );
  await assertReadable(other);
  assert.equal(
    (await call(other.owner, "GET", f.base + "/tasks/" + f.task.id)).status,
    404,
  );
});
