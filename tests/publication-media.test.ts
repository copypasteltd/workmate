import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { PublicationMediaProxy } from "../src/publication-media.js";
import { rendererApiOperation } from "../src/config.js";

async function fixture() {
  const tenant = randomUUID(),
    project = randomUUID(),
    id = randomUUID();
  const path = `/v1/tenants/${tenant}/projects/${project}/publications/previews/${id}/media/0`;
  const bytes = Buffer.alloc(1024 * 1024, 85),
    sha = createHash("sha256").update(bytes).digest("hex");
  const calls: { path: string; method: string; range?: string }[] = [];
  let session = {
    access_token: "synthetic-private-native-access",
    session_epoch: randomUUID(),
  };
  let active = true,
    invalidated = 0,
    badSha = false,
    unauthorized = false,
    slow = false,
    sent = 0;
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const server = createServer((request, response) => {
    calls.push({
      path: request.url!,
      method: request.method!,
      range: request.headers.range,
    });
    if (
      request.headers.authorization !== "Bearer " + session.access_token ||
      request.headers["x-tenant-id"] !== tenant ||
      unauthorized
    ) {
      response
        .writeHead(401)
        .end("synthetic private error must not leave the proxy");
      return;
    }
    if (request.url === path + "/info") {
      response.setHeader("Content-Type", "application/json");
      response.end(
        JSON.stringify({ mime: "image/png", bytes: bytes.length, sha256: sha }),
      );
      return;
    }
    if (request.url !== path) {
      response.writeHead(404).end();
      return;
    }
    let start = 0,
      end = bytes.length - 1;
    if (request.headers.range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range)!;
      start = match[1] ? Number(match[1]) : bytes.length - Number(match[2]);
      end = match[1] && match[2] ? Math.min(Number(match[2]), end) : end;
      response.statusCode = 206;
      response.setHeader(
        "Content-Range",
        `bytes ${start}-${end}/${bytes.length}`,
      );
    }
    response.setHeader("Content-Type", "image/png");
    response.setHeader("Content-Length", end - start + 1);
    response.setHeader("X-Content-SHA256", badSha ? "f".repeat(64) : sha);
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    if (!slow) {
      response.end(bytes.subarray(start, end + 1));
      return;
    }
    let position = start;
    const write = () => {
      if (response.destroyed) return;
      const next = Math.min(position + 16384, end + 1),
        chunk = bytes.subarray(position, next);
      sent += chunk.length;
      response.write(chunk);
      position = next;
      if (position > end) {
        response.end();
        return;
      }
      const timer = setTimeout(() => {
        timers.delete(timer);
        write();
      }, 15);
      timers.add(timer);
    };
    write();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number },
    api = `http://127.0.0.1:${address.port}`;
  const proxy = new PublicationMediaProxy({
    api,
    session: async () => ({ ...session }),
    ownerActive: (owner) => active && owner === "trusted-main-frame",
    unauthorized: async () => {
      invalidated++;
    },
  });
  return {
    path,
    tenant,
    bytes,
    calls,
    proxy,
    setEpoch: () => {
      session = { ...session, session_epoch: randomUUID() };
    },
    inactive: () => {
      active = false;
    },
    badSha: () => {
      badSha = true;
    },
    unauthorized: () => {
      unauthorized = true;
    },
    slow: () => {
      slow = true;
    },
    sent: () => sent,
    invalidated: () => invalidated,
    close: async () => {
      proxy.closeAll();
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}

test("native publication media uses an opaque capability and exact authenticated HTTP ranges", async () => {
  const f = await fixture();
  try {
    const media = await f.proxy.issue(f.path, f.tenant, "trusted-main-frame");
    assert.match(media.url, /^workmate-media:\/\/publication\/[a-f0-9-]{36}$/);
    assert.ok(!media.url.includes(f.tenant) && !media.url.includes("access"));
    const response = await f.proxy.handle(
      new Request(media.url, { headers: { Range: "bytes=5-24" } }),
    );
    assert.equal(response.status, 206);
    assert.deepEqual(
      Buffer.from(await response.arrayBuffer()),
      f.bytes.subarray(5, 25),
    );
    assert.equal(
      response.headers.get("Content-Range"),
      `bytes 5-24/${f.bytes.length}`,
    );
    assert.equal(response.headers.get("Cache-Control"), "private, no-store");
    assert.equal(response.headers.get("Authorization"), null);
    const head = await f.proxy.handle(
      new Request(media.url, { method: "HEAD" }),
    );
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const suffix = await f.proxy.handle(
      new Request(media.url, { headers: { Range: "bytes=-16" } }),
    );
    assert.deepEqual(
      Buffer.from(await suffix.arrayBuffer()),
      f.bytes.subarray(-16),
    );
    assert.equal(f.calls.length, 4);
  } finally {
    await f.close();
  }
});

test("media paths, tenant identity, origin, methods and multiple ranges fail before network access", async () => {
  const f = await fixture();
  try {
    for (const path of [
      "https://foreign.invalid" + f.path,
      f.path + "?url=https://foreign.invalid",
      f.path.replace("/previews/", "/../previews/"),
      f.path.replace("/media/0", "/media/10"),
      f.path.replace("/media/", "%2fmedia/"),
    ])
      await assert.rejects(f.proxy.issue(path, f.tenant, "trusted-main-frame"));
    await assert.rejects(
      f.proxy.issue(f.path, randomUUID(), "trusted-main-frame"),
    );
    await assert.rejects(
      f.proxy.issue(f.path, f.tenant, "untrusted-child-frame"),
    );
    assert.equal(f.calls.length, 0);
    const media = await f.proxy.issue(f.path, f.tenant, "trusted-main-frame");
    assert.equal(
      (await f.proxy.handle(new Request(media.url, { method: "POST" }))).status,
      405,
    );
    for (const range of [
      "bytes=0-2,4-5",
      "bytes=-0",
      "bytes=99999999-",
      "bytes=5-2",
    ])
      assert.equal(
        (
          await f.proxy.handle(
            new Request(media.url, { headers: { Range: range } }),
          )
        ).status,
        416,
      );
    assert.equal(
      (await f.proxy.handle(new Request(media.url + "?other=1"))).status,
      404,
    );
    assert.equal(f.calls.length, 1);
  } finally {
    await f.close();
  }
});

test("account change and frame retirement revoke capabilities instead of reading with another account", async () => {
  const f = await fixture();
  try {
    const media = await f.proxy.issue(f.path, f.tenant, "trusted-main-frame");
    assert.throws(() => f.proxy.close(media.id, "untrusted-child-frame"));
    f.setEpoch();
    assert.equal((await f.proxy.handle(new Request(media.url))).status, 409);
    assert.equal(f.calls.length, 1);
    assert.equal((await f.proxy.handle(new Request(media.url))).status, 404);
    const second = await f.proxy.issue(f.path, f.tenant, "trusted-main-frame");
    f.inactive();
    assert.equal((await f.proxy.handle(new Request(second.url))).status, 404);
    assert.equal(f.calls.length, 2);
  } finally {
    await f.close();
  }
});

test("upstream authorization failures and changed digests do not expose private error bodies", async () => {
  const f = await fixture();
  try {
    const media = await f.proxy.issue(f.path, f.tenant, "trusted-main-frame");
    f.badSha();
    const wrong = await f.proxy.handle(new Request(media.url));
    assert.equal(wrong.status, 502);
    assert.equal(await wrong.text(), "");
    f.unauthorized();
    const denied = await f.proxy.handle(new Request(media.url));
    assert.equal(denied.status, 401);
    assert.equal(await denied.text(), "");
    assert.equal(f.invalidated(), 1);
    assert.equal((await f.proxy.handle(new Request(media.url))).status, 404);
  } finally {
    await f.close();
  }
});

test("large media starts streaming before completion and revocation interrupts an active stream", async () => {
  const f = await fixture();
  try {
    const media = await f.proxy.issue(f.path, f.tenant, "trusted-main-frame");
    f.slow();
    const response = await f.proxy.handle(new Request(media.url)),
      reader = response.body!.getReader();
    const first = await reader.read();
    assert.ok(!first.done && first.value.byteLength > 0);
    assert.ok(f.sent() < f.bytes.length);
    f.proxy.closeAll();
    let terminated = false;
    for (let i = 0; i < 8; i++) {
      try {
        if ((await reader.read()).done) {
          terminated = true;
          break;
        }
      } catch {
        terminated = true;
        break;
      }
    }
    assert.equal(terminated, true);
    assert.ok(f.sent() < f.bytes.length);
  } finally {
    await f.close();
  }
});

test("the renderer API exposes publishing JSON actions while OAuth and binary transfer use dedicated boundaries", () => {
  const root = `/v1/tenants/${randomUUID()}/projects/${randomUUID()}/publications`,
    id = randomUUID();
  for (const path of [
    "/settings",
    "/connections",
    "/policy?target_id=" + id,
    "/operations",
    "/operations/" + id,
    "/previews/" + id + "/media/0/info",
  ])
    assert.equal(rendererApiOperation(root + path, "GET"), true, path);
  for (const path of [
    "/previews",
    "/operations",
    "/operations/" + id + "/decision",
    "/operations/" + id + "/observe",
    "/operations/" + id + "/close-unknown",
  ])
    assert.equal(rendererApiOperation(root + path, "POST"), true, path);
  assert.equal(rendererApiOperation(root + "/policy/" + id, "PUT"), true);
  assert.equal(
    rendererApiOperation(root + "/connections/" + id + "/scope", "PUT"),
    true,
  );
  for (const path of [
    "/connections/authorize",
    "/previews/" + id + "/media/0",
    "/unknown-action",
  ])
    for (const method of ["GET", "POST", "PUT", "DELETE"])
      assert.equal(
        rendererApiOperation(root + path, method),
        false,
        method + path,
      );
});
