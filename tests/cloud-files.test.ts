import { before, after, test } from "node:test";
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
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
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
async function ok(
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
async function user(): Promise<Client> {
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
async function fixture() {
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
async function file(
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
before(async () => {
  const env = { ...process.env };
  for (const k of [
    "DATABASE_URL",
    "CONTROL_DATABASE_URL",
    "QUEUE_DATABASE_URL",
  ]) {
    const u = new URL(env[k]!);
    u.pathname = "/copypaste_test";
    env[k] = u.href;
  }
  s = await buildApp(
    loadConfig({
      ...env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DATA_DIR: ".data/test",
    }),
    { worker: false },
  );
});
after(async () => {
  await s?.app.close();
});

test("cloud tree survives app restart, pins versions, serializes moves and rejects foreign/private references", async () => {
  const f = await fixture(),
    t = f.tenant,
    root = f.roots.find((x: any) => x.root_kind === "project_materials"),
    shared = `/v1/workspaces/${f.shared.id}/nodes`,
    entry = (id: string) => `/v1/workspace-nodes/${id}`;
  assert.deepEqual(f.roots.map((x: any) => x.root_kind).sort(), [
    "deliverables",
    "project_materials",
  ]);
  const privateRoots = (
    await ok(
      f.owner,
      "GET",
      `/v1/workspaces/${f.privateWs.id}/nodes`,
      undefined,
      t,
    )
  ).items;
  assert.deepEqual(privateRoots.map((x: any) => x.root_kind).sort(), [
    "attachments",
    "deliverables",
    "working_files",
  ]);
  assert.equal(
    (
      await call(
        f.member,
        "GET",
        `/v1/workspaces/${f.privateWs.id}/nodes`,
        undefined,
        t,
      )
    ).status,
    404,
  );
  const a = await file(f, "brief.txt", "version one"),
    b = await file(f, "brief.txt", "version two", a);
  const indexed = (await ok(f.owner, "GET", shared + "?q=brief", undefined, t))
    .items;
  assert.equal(indexed.length, 1);
  assert.equal(indexed[0].asset_version_id, a.version.id);
  const k = randomUUID(),
    folder = await ok(
      f.owner,
      "POST",
      shared,
      { name: "Campaign", kind: "directory", parent_id: root.id },
      t,
      201,
      k,
    );
  assert.equal(
    (
      await ok(
        f.owner,
        "POST",
        shared,
        { name: "Campaign", kind: "directory", parent_id: root.id },
        t,
        201,
        k,
      )
    ).id,
    folder.id,
  );
  const bound = await ok(
    f.owner,
    "POST",
    shared,
    {
      name: "Pinned brief",
      kind: "file",
      parent_id: folder.id,
      asset_version_id: a.version.id,
    },
    t,
    201,
  );
  await ok(
    f.owner,
    "PATCH",
    entry(bound.id),
    { expected_version: 1, parent_id: root.id, name: "Moved brief" },
    t,
  );
  assert.equal(
    (await ok(f.owner, "GET", entry(bound.id) + "/reference", undefined, t))
      .text,
    "version one",
  );
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        entry(bound.id),
        { expected_version: 1, name: "Stale overwrite" },
        t,
      )
    ).status,
    409,
  );
  const changes = await Promise.all(
    ["Renamed A", "Renamed B"].map((name) =>
      call(f.owner, "PATCH", entry(bound.id), { expected_version: 2, name }, t),
    ),
  );
  assert.deepEqual(changes.map((r) => r.status).sort(), [200, 409]);
  const dirs = await Promise.all(
    ["Dir A", "Dir B"].map((name) =>
      ok(
        f.owner,
        "POST",
        shared,
        { name, kind: "directory", parent_id: root.id },
        t,
        201,
      ),
    ),
  );
  const cycle = await Promise.all([
    call(
      f.owner,
      "PATCH",
      entry(dirs[0].id),
      { expected_version: 1, parent_id: dirs[1].id },
      t,
    ),
    call(
      f.owner,
      "PATCH",
      entry(dirs[1].id),
      { expected_version: 1, parent_id: dirs[0].id },
      t,
    ),
  ]);
  assert.deepEqual(cycle.map((r) => r.status).sort(), [200, 409]);
  const foreign = await fixture(),
    foreignFile = await file(foreign, "brief.txt", "foreign secret");
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/workspaces/${foreign.shared.id}/nodes`,
        undefined,
        t,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        shared,
        {
          name: "Forbidden",
          kind: "file",
          asset_version_id: foreignFile.version.id,
        },
        t,
      )
    ).status,
    404,
  );
  const secret = (
    await s.db.control.query(
      "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,status,budget_micros,idempotency_key,private_owner,conversation_id) VALUES($1,$2,$3,'Fixture','Fixture','fullstack','fixture','succeeded',1,$4,$3,$5) RETURNING id",
      [t, f.project, f.owner.id, randomUUID(), f.conv.id],
    )
  ).rows[0];
  const privateFile = await file(
    f,
    "private.txt",
    "private source",
    undefined,
    secret.id,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        shared,
        {
          name: "Implicit share",
          kind: "file",
          asset_version_id: privateFile.version.id,
        },
        t,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await ok(
        f.member,
        "GET",
        "/v1/workspaces?project_id=" + f.project,
        undefined,
        t,
      )
    ).items.length,
    1,
  );
  await s.app.close();
  s = await buildApp(s.db.config, { worker: false });
  const persisted = await ok(
    f.owner,
    "GET",
    entry(bound.id) + "/reference",
    undefined,
    t,
  );
  assert.equal(persisted.asset_version_id, a.version.id);
  assert.equal(persisted.text, "version one");
  assert.equal(b.version.version, 2);
});

test("explicit promotion owns an independent object; deleting source invalidates references and clears directory metadata", async () => {
  const f = await fixture(),
    t = f.tenant,
    privateNodes = `/v1/workspaces/${f.privateWs.id}/nodes`,
    sharedNodes = `/v1/workspaces/${f.shared.id}/nodes`,
    entry = (id: string) => `/v1/workspace-nodes/${id}`;
  const task = (
    await s.db.control.query(
      "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,status,budget_micros,idempotency_key,private_owner,conversation_id) VALUES($1,$2,$3,'Fixture','Fixture','fullstack','fixture','succeeded',1,$4,$3,$5) RETURNING id",
      [t, f.project, f.owner.id, randomUUID(), f.conv.id],
    )
  ).rows[0];
  const source = await file(
      f,
      "private-deliverable.txt",
      "approved private content",
      undefined,
      task.id,
    ),
    pinned = (
      await ok(
        f.owner,
        "GET",
        privateNodes + "?q=private-deliverable",
        undefined,
        t,
      )
    ).items[0];
  const promotion = await ok(
    f.owner,
    "POST",
    `/v1/artifacts/${source.id}/promotions`,
    {
      workspace_id: f.shared.id,
      base_asset_version_id: source.version.id,
      sharing_scope: "project",
    },
    t,
    201,
  );
  const ref = await ok(
    f.member,
    "GET",
    entry(promotion.id) + "/reference",
    undefined,
    t,
  );
  assert.equal(ref.text, "approved private content");
  const keys = (
    await s.db.control.query(
      "SELECT storage_key FROM asset_versions WHERE id=ANY($1::uuid[])",
      [[source.version.id, ref.asset_version_id]],
    )
  ).rows;
  assert.equal(new Set(keys.map((x) => x.storage_key)).size, 2);
  const removed = await ok(
    f.owner,
    "POST",
    "/v1/deletions",
    {
      target_type: "asset",
      target_id: source.id,
      reason: "Erase private source",
    },
    t,
    202,
  );
  assert.equal(
    (
      await ok(
        f.owner,
        "GET",
        privateNodes + "?q=private-deliverable",
        undefined,
        t,
      )
    ).items[0].reference_state,
    "deleted",
  );
  assert.equal(
    (await call(f.owner, "GET", entry(pinned.id) + "/reference", undefined, t))
      .status,
    410,
  );
  assert.equal(
    (
      await ok(
        f.member,
        "GET",
        entry(promotion.id) + "/reference",
        undefined,
        t,
      )
    ).text,
    "approved private content",
  );
  const folder = await ok(
    f.owner,
    "POST",
    sharedNodes,
    { name: "Remove tree", kind: "directory" },
    t,
    201,
  );
  const child = await ok(
    f.owner,
    "POST",
    sharedNodes,
    {
      name: "Reference only",
      kind: "file",
      parent_id: folder.id,
      asset_version_id: ref.asset_version_id,
    },
    t,
    201,
  );
  const deletion = await ok(
    f.owner,
    "DELETE",
    entry(folder.id),
    undefined,
    t,
    202,
  );
  const eraser = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE id=$1 OR id IN (SELECT child_job_id FROM deletion_dependencies WHERE job_id=$1)",
      [deletion.id],
    );
    await eraser.advance(40);
  }
  assert.equal(
    (await ok(f.owner, "GET", `/v1/deletions/${deletion.id}`, undefined, t))
      .state,
    "completed",
  );
  const cleared = (
    await s.db.control.query(
      "SELECT name,asset_version_id,content_state FROM workspace_nodes WHERE id=ANY($1::uuid[])",
      [[folder.id, child.id]],
    )
  ).rows;
  assert.ok(
    cleared.every(
      (x) =>
        x.name === "[deleted]" &&
        !x.asset_version_id &&
        x.content_state === "deleted",
    ),
  );
  assert.equal(
    (
      await ok(
        f.member,
        "GET",
        entry(promotion.id) + "/reference",
        undefined,
        t,
      )
    ).text,
    "approved private content",
  );
  assert.equal(
    (await call(f.owner, "GET", entry(child.id) + "/reference", undefined, t))
      .status,
    404,
  );
  assert.equal(
    (await ok(f.owner, "GET", `/v1/deletions/${removed.id}`, undefined, t))
      .state,
    "completed",
  );
});

test("folder quarantine hides descendants; conversation removal cleans its private tree; membership removal revokes every lookup", async () => {
  const f = await fixture(),
    t = f.tenant,
    nodes = `/v1/workspaces/${f.shared.id}/nodes`;
  const folder = await ok(
      f.owner,
      "POST",
      nodes,
      { name: "Moderated folder", kind: "directory" },
      t,
      201,
    ),
    child = await ok(
      f.owner,
      "POST",
      nodes,
      { name: "Hidden child", kind: "directory", parent_id: folder.id },
      t,
      201,
    );
  await s.db.control.query(
    "UPDATE workspace_nodes SET content_state='quarantined' WHERE id=$1",
    [folder.id],
  );
  assert.equal(
    (await ok(f.member, "GET", nodes + "?q=Hidden", undefined, t)).items.length,
    0,
  );
  assert.equal(
    (
      await call(
        f.member,
        "PATCH",
        `/v1/workspace-nodes/${child.id}`,
        { expected_version: 1, name: "Bypass" },
        t,
      )
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE workspace_nodes SET content_state='active' WHERE id=$1",
    [folder.id],
  );
  assert.equal(
    (await ok(f.member, "GET", nodes + "?q=Hidden", undefined, t)).items.length,
    1,
  );
  const gone = await ok(
    f.owner,
    "POST",
    "/v1/deletions",
    {
      target_type: "conversation",
      target_id: f.conv.id,
      reason: "Remove conversation tree",
    },
    t,
    202,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/workspaces/${f.privateWs.id}/nodes`,
        undefined,
        t,
      )
    ).status,
    404,
  );
  const eraser = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 5; i++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE id=$1 OR id IN(SELECT child_job_id FROM deletion_dependencies WHERE job_id=$1)",
      [gone.id],
    );
    await eraser.advance(40);
  }
  assert.equal(
    (await ok(f.owner, "GET", `/v1/deletions/${gone.id}`, undefined, t)).state,
    "completed",
  );
  await s.db.control.query(
    "UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",
    [t, f.member.id],
  );
  assert.equal((await call(f.member, "GET", nodes, undefined, t)).status, 404);
});

test("private resumable attachments retain their conversation scope and are erased with its staging files", async () => {
  const f = await fixture(),
    t = f.tenant,
    bytes = Buffer.from("Private attachment content"),
    manifest = {
      project_id: f.project,
      conversation_id: f.conv.id,
      filename: "private-attachment.txt",
      content_type: "text/plain",
      size_bytes: bytes.length,
      sha256: hash(bytes),
    };
  assert.equal(
    (await call(f.member, "POST", f.base + "/uploads", manifest, t)).status,
    404,
  );
  const upload = await ok(
    f.owner,
    "POST",
    f.base + "/uploads",
    manifest,
    t,
    201,
  );
  await ok(
    f.owner,
    "POST",
    `${f.base}/uploads/${upload.upload_id}/parts/0`,
    { base64: bytes.toString("base64"), sha256: hash(bytes) },
    t,
  );
  const asset = await ok(
    f.owner,
    "POST",
    `${f.base}/uploads/${upload.upload_id}/complete`,
    { size_bytes: bytes.length, sha256: hash(bytes) },
    t,
  );
  assert.equal(asset.private_owner, f.owner.id);
  const nodes = (
    await ok(
      f.owner,
      "GET",
      `/v1/workspaces/${f.privateWs.id}/nodes?q=private-attachment`,
      undefined,
      t,
    )
  ).items;
  assert.equal(nodes.length, 1);
  const roots = (
    await ok(
      f.owner,
      "GET",
      `/v1/workspaces/${f.privateWs.id}/nodes`,
      undefined,
      t,
    )
  ).items;
  assert.equal(
    nodes[0].parent_id,
    roots.find((x: any) => x.root_kind === "attachments").id,
  );
  assert.equal(
    (await ok(f.member, "GET", f.base + "/assets", undefined, t)).items.some(
      (x: any) => x.id === asset.id,
    ),
    false,
  );
  const deletion = await ok(
    f.owner,
    "POST",
    "/v1/deletions",
    {
      target_type: "conversation",
      target_id: f.conv.id,
      reason: "Remove attachment",
    },
    t,
    202,
  );
  const eraser = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE tenant_id=$1 AND state='queued'",
      [t],
    );
    await eraser.advance(40);
  }
  assert.equal(
    (await ok(f.owner, "GET", `/v1/deletions/${deletion.id}`, undefined, t))
      .state,
    "completed",
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `${f.base}/uploads/${upload.upload_id}`,
        undefined,
        t,
      )
    ).status,
    404,
  );
  const us = (
    await s.db.control.query(
      "SELECT state,filename,result FROM upload_sessions WHERE id=$1",
      [upload.upload_id],
    )
  ).rows[0];
  assert.equal(us.state, "cancelled");
  assert.equal(us.filename, "[deleted]");
  assert.equal(us.result, null);
});

test("Codex working sources persist across tasks with hash checks, bounded packaging and current reference authorization", async () => {
  const f = await fixture(),
    t = f.tenant;
  const makeTask = async (conversation = f.conv.id) =>
    (
      await s.db.control.query(
        "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,status,budget_micros,idempotency_key,private_owner,conversation_id) VALUES($1,$2,$3,'Fixture','Fixture','fullstack','fixture','succeeded',1,$4,$3,$5) RETURNING *",
        [t, f.project, f.owner.id, randomUUID(), conversation],
      )
    ).rows[0];
  const task = await makeTask();
  const asTask = <T>(task: any, fn: (tx: any) => Promise<T>) =>
    s.db.tx(async (tx) => {
      await projectAccess(
        tx,
        { id: f.owner.id, authVersion: 1, audience: "user" } as any,
        t,
        f.project,
        "write",
      );
      await tx.query("SELECT set_config('app.task_id',$1,true)", [task.id]);
      return fn(tx);
    }, t);
  const first = await asTask(task, (tx) =>
    writeCloudSource(
      tx,
      s.storage,
      task,
      "src/app.ts",
      "export const value=1;",
    ),
  );
  const secondTask = await makeTask();
  assert.equal(
    (
      await asTask(secondTask, (tx) =>
        readCloudSource(tx, s.storage, secondTask, "src/app.ts"),
      )
    )?.content,
    "export const value=1;",
  );
  await assert.rejects(
    asTask(secondTask, (tx) =>
      writeCloudSource(
        tx,
        s.storage,
        secondTask,
        "src/app.ts",
        "blind overwrite",
      ),
    ),
    (e: any) => e.code === "CODE_VERSION_CONFLICT",
  );
  const concurrent = await Promise.allSettled(
    ["export const value=2;", "export const value=3;"].map((text) =>
      asTask(secondTask, (tx) =>
        writeCloudSource(
          tx,
          s.storage,
          secondTask,
          "src/app.ts",
          text,
          first.sha256,
        ),
      ),
    ),
  );
  assert.equal(concurrent.filter((x) => x.status === "fulfilled").length, 1);
  await asTask(secondTask, (tx) =>
    writeCloudSource(
      tx,
      s.storage,
      secondTask,
      "README.md",
      "# Persistent project",
    ),
  );
  const zip = await asTask(secondTask, (tx) =>
      bundleCloudSources(tx, s.storage, secondTask),
    ),
    files = unzipSync(zip.bytes);
  assert.ok(files["src/app.ts"]);
  assert.ok(files["README.md"]);
  assert.equal(
    JSON.parse(Buffer.from(files["copypaste-manifest.json"]).toString())
      .execution_validation,
    "not_executed",
  );
  for (const bad of ["../outside.txt", ".env", "C:\\secret"])
    await assert.rejects(
      asTask(task, (tx) => writeCloudSource(tx, s.storage, task, bad, "bad")),
    );
  const current = await asTask(secondTask, (tx) =>
    readCloudSource(tx, s.storage, secondTask, "src/app.ts"),
  );
  assert.ok(current);
  const readReference = await asTask(secondTask, (tx) =>
    readCloudReference(
      tx,
      s.storage,
      secondTask,
      current.node_id,
      current.asset_version_id,
    ),
  );
  assert.ok("text" in readReference);
  assert.equal(readReference.text, current.content);
  await assert.rejects(
    asTask(secondTask, (tx) =>
      readCloudReference(
        tx,
        s.storage,
        { ...secondTask, conversation_id: null, private_owner: null },
        current.node_id,
        current.asset_version_id,
      ),
    ),
    (e: any) => e.status === 404,
  );
  const refs = await asTask(secondTask, (tx) =>
    listCloudReferences(tx, secondTask, "app.ts"),
  );
  assert.equal(refs.items.length, 1);
  const workingRoots = (
    await ok(
      f.owner,
      "GET",
      `/v1/workspaces/${f.privateWs.id}/nodes`,
      undefined,
      t,
    )
  ).items;
  const shared = await file(f, "shared-source.txt", "shared original"),
    imported = await ok(
      f.owner,
      "POST",
      `/v1/workspaces/${f.privateWs.id}/nodes`,
      {
        parent_id: workingRoots.find(
          (x: any) => x.root_kind === "working_files",
        ).id,
        name: "imported.txt",
        kind: "file",
        asset_version_id: shared.version.id,
      },
      t,
      201,
    );
  await asTask(secondTask, (tx) =>
    writeCloudSource(
      tx,
      s.storage,
      secondTask,
      "imported.txt",
      "private edit",
      shared.version.sha256,
    ),
  );
  const original = (
    await ok(
      f.owner,
      "GET",
      f.base + "/assets/" + shared.id + "/versions",
      undefined,
      t,
    )
  ).items;
  assert.equal(original.length, 1);
  const changed = await ok(
    f.owner,
    "GET",
    `/v1/workspace-nodes/${imported.id}/reference`,
    undefined,
    t,
  );
  assert.equal(changed.text, "private edit");
  assert.notEqual(changed.asset_id, shared.id);
  await ok(
    f.owner,
    "DELETE",
    `/v1/workspace-nodes/${current.node_id}`,
    undefined,
    t,
    202,
  );
  await assert.rejects(
    asTask(secondTask, (tx) =>
      readCloudReference(
        tx,
        s.storage,
        secondTask,
        current.node_id,
        current.asset_version_id,
      ),
    ),
    (e: any) => e.status === 404,
  );
  assert.equal(
    await asTask(secondTask, (tx) =>
      readCloudSource(tx, s.storage, secondTask, "src/app.ts"),
    ),
    undefined,
  );
  await assert.rejects(
    asTask(secondTask, (tx) =>
      writeCloudSource(
        tx,
        s.storage,
        secondTask,
        "src/app.ts",
        "restore deleted",
        current.sha256,
      ),
    ),
    (e: any) => e.code === "CODE_VERSION_CONFLICT",
  );
});
