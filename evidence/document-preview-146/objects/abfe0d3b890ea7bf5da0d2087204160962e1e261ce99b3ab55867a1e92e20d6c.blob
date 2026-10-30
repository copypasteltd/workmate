import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unzipSync } from "fflate";
import { hash } from "../src/lib.js";
import { projectAccess } from "../src/access.js";
import {
  readCloudSource,
  writeCloudSource,
  bundleCloudSources,
} from "../src/cloud-source.js";
import {
  listCloudReferences,
  readCloudReference,
} from "../src/cloud-references.js";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { ErasureService } from "../src/erasure.js";
export let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
export async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  k: string = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4317",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      "idempotency-key": k,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    payload: body ? JSON.stringify(body) : undefined,
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
export async function ok(
  c: Client,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  status = 200,
  k?: string,
) {
  const r = await call(c, method, url, body, tenant, k);
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
export async function user(): Promise<Client> {
  const challenge = await call(undefined, "POST", "/v1/auth/challenge", {
    email: `cloud-${randomUUID()}@example.invalid`,
  });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(r.status, 200);
  return {
    id: r.data.user.id,
    csrf: r.data.csrf_token,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
  };
}
export async function fixture() {
  const owner = await user(),
    member = await user();
  const w = await ok(owner, "POST", "/v1/tenants", {
    name: "Cloud studio",
    project_name: "Shared campaign",
  });
  const tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, member.id],
  );
  const agent = await ok(owner, "POST", base + "/agents", {
    name: "Cloud specialist",
    role_key: "fullstack",
    instructions: "Keep exact versions.",
  });
  const conv = await ok(owner, "POST", base + "/conversations", {
    name: "Private documents",
    agent_id: agent.id,
  });
  const workspaces = await ok(
      owner,
      "GET",
      "/v1/workspaces?project_id=" + project,
      undefined,
      tenant,
    ),
    shared = workspaces.items.find((x: any) => x.kind === "project"),
    privateWs = workspaces.items.find(
      (x: any) => x.conversation_id === conv.id,
    );
  const roots = (
    await ok(
      owner,
      "GET",
      `/v1/workspaces/${shared.id}/nodes`,
      undefined,
      tenant,
    )
  ).items;
  return {
    owner,
    member,
    tenant,
    project,
    base,
    conv,
    shared,
    privateWs,
    roots,
  };
}
export async function file(
  f: any,
  name: string,
  content: string,
  asset?: any,
  task?: string,
) {
  return s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name,
        mime: "text/plain",
        bytes: Buffer.from(content),
        ...(asset
          ? { asset: asset.id, expectedVersion: asset.current_version }
          : {}),
        ...(task ? { metadata: { task_id: task } } : {}),
      }),
    undefined,
    true,
  );
}

export async function start(){
  isolated=await isolatedTestEnvironment();
  s=await buildApp(loadConfig({...isolated.env,NODE_ENV:"test",WORKER_ENABLED:"false"}),{worker:false});
}
export async function stop(){try{await s?.app.close();}finally{await isolated?.cleanup();}}
