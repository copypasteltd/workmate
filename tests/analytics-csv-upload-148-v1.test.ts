import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { hash } from "../src/lib.js";
import { ErasureService } from "../src/erasure.js";
import { assertReportSources } from "../src/analysis-reports.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { packWorkbook, campaignWorkbook } from "./workbook-fixtures.js";
import { XLSX_MIME } from "../src/analytics-workbook.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter } from "../src/runtime.js";
import { recoverQueuedClaims } from "../src/task-recovery.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  key = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4317",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      "idempotency-key": key,
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
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
) {
  const r = await call(c, method, url, body, tenant);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", {
      email: `imports-${randomUUID()}@example.invalid`,
    }),
    mail = JSON.parse(
      await readFile(
        `${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
        "utf8",
      ),
    );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(r.status, 200);
  return {
    id: r.data.user.id,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
    csrf: r.data.csrf_token,
  };
}
async function fixture() {
  const owner = await user(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "File import studio",
      project_name: "Campaign files",
    });
  return {
    owner,
    tenant: w.tenant.id,
    project: w.project.id,
    base: `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const options = {
  source: "google_ads",
  account_id: "A",
  currency: "HKD",
  timezone: "Asia/Hong_Kong",
  entity_level: "campaign",
  attribution_definition: "7d click",
  conversion_definition: "Purchase",
  mapping: {},
};
const csv = (cost = "100.125") =>
  Buffer.from(
    `date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency,entity_id\r\n2026-10-01,Google,Launch,1000,100,${cost},4.5,450,HKD,456`,
  );
async function asset(
  f: Fixture,
  bytes: Buffer = csv(),
  name = "launch.csv",
  versionOf?: any,
) {
  return s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name,
        mime: name.endsWith("xlsx") ? XLSX_MIME : "text/csv",
        bytes,
        ...(versionOf
          ? { asset: versionOf.id, expectedVersion: versionOf.current_version }
          : {}),
      }),
    f.tenant,
    false,
    f.owner.id,
  );
}
const body = (f: Fixture, a: any, extra: Record<string, unknown> = {}) => ({
  project_id: f.project,
  asset_version_id: a.version.id,
  ...options,
  ...extra,
});
async function imported(
  f: Fixture,
  a: any,
  extra: Record<string, unknown> = {},
) {
  const r = await call(
    f.owner,
    "POST",
    "/v1/dataset-imports",
    body(f, a, extra),
    f.tenant,
  );
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return r.data;
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

async function uploadBytes(f:Fixture, bytes:Buffer, mime="text/csv") {
 const allocated=await call(f.owner,"POST",f.base+"/uploads",{project_id:f.project,filename:"campaign.csv",content_type:mime,size_bytes:bytes.length,sha256:hash(bytes)});assert.equal(allocated.status,201,JSON.stringify(allocated.data));const created=allocated.data;
 const part=await call(f.owner,"POST",f.base+`/uploads/${created.upload_id}/parts/0`,{base64:bytes.toString("base64"),sha256:hash(bytes)});assert.ok(part.status>=200&&part.status<300,JSON.stringify(part.data));
 return call(f.owner,"POST",f.base+`/uploads/${created.upload_id}/complete`,{size_bytes:bytes.length,sha256:hash(bytes)});
}
test("actual multipart upload accepts BOM-tagged UTF16LE and BE CSV then produces exact canonical analytics", async()=>{
 const f=await fixture();
 for(const encoding of ["le","be"]){
  const content=Buffer.from("date;channel;entity_id;impressions;clicks;spend\n01/10/2026;Google;456;1.000;10;1.234,56","utf16le");if(encoding==="be")content.swap16();
  const bytes=Buffer.concat([encoding==="le"?Buffer.from([255,254]):Buffer.from([254,255]),content]);
  const completed=await uploadBytes(f,bytes);assert.equal(completed.status,200,JSON.stringify(completed.data));
  const d=await imported(f,{version:{id:completed.data.version.id}},{csv_delimiter:"semicolon",date_format:"day_first",number_format:"comma_decimal"});
  const source=await call(f.owner,"GET",f.base+`/analytics/${d.id}/source`);assert.deepEqual(source.raw.rawPayload,bytes);
  const detail=await ok(f.owner,"GET",f.base+`/analytics/${d.id}`);assert.equal(detail.summary.exact.spend,"1234.56000000");
 }
});
test("UTF16 support is limited to declared CSV text and does not admit decoded NUL content",async()=>{
 const f=await fixture(),text=Buffer.concat([Buffer.from([255,254]),Buffer.from("date,spend\n2026-10-01,1","utf16le")]);
 assert.equal((await uploadBytes(f,text,"text/plain")).status,422);
 assert.equal((await uploadBytes(f,Buffer.concat([Buffer.from([255,254]),Buffer.from("date,spend\0bad","utf16le")]))).status,422);
});

