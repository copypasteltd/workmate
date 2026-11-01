import { test, mock } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { Config } from "../src/config.js";
import { normalizedModelURL } from "../src/model-connections.js";
import { modelConnectionFetch } from "../src/model-connection-http.js";

const config = {
  NODE_ENV: "production",
  API_ORIGIN: "https://api.workmate.example",
  WEB_ORIGIN: "https://agent.workmate.example",
  ADMIN_ORIGIN: "https://admin.workmate.example",
} as Config;

test("production model configuration accepts public HTTP without a private-network override", () => {
  assert.equal(
    normalizedModelURL(config, "http://93.184.216.34:9841/v1/", false),
    "http://93.184.216.34:9841/v1",
  );
  assert.equal(
    normalizedModelURL(config, "https://gateway.example/v1", false),
    "https://gateway.example/v1",
  );
  assert.throws(() =>
    normalizedModelURL(config, "http://user:key@gateway.example/v1", false),
  );
  assert.throws(() =>
    normalizedModelURL(config, "ftp://gateway.example/v1", false),
  );
  assert.throws(() =>
    normalizedModelURL(config, config.API_ORIGIN + "/v1", false),
  );
});

test("production public HTTP reaches the configured model transport with authorization and the exact request body", async () => {
  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    assert.equal(req.url, "/v1/responses");
    assert.equal(req.headers.authorization, "Bearer fixture-only-180");
    assert.equal(JSON.parse(body).model, "fixture-model");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ accepted: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port,
    request = http.request;
  // Only the socket destination is replaced with this owned local fixture.
  // Production DNS/address/protocol checks execute without the test exception.
  const transport = mock.method(
    http,
    "request",
    (url: URL, options: any, callback: any) => {
      assert.equal(url.origin, "http://93.184.216.34:9841");
      options.lookup(url.hostname, {}, (error: any, address: string) => {
        assert.equal(error, null);
        assert.equal(address, "93.184.216.34");
      });
      return request(
        new URL(`http://127.0.0.1:${port}${url.pathname}`),
        { ...options, lookup: undefined },
        callback,
      );
    },
  );
  try {
    const response = await modelConnectionFetch(
      new URL("http://93.184.216.34:9841/v1/responses"),
      {
        method: "POST",
        headers: {
          Authorization: "Bearer fixture-only-180",
          "Content-Type": "application/json",
        },
        body: Buffer.from(JSON.stringify({ model: "fixture-model" })),
        signal: AbortSignal.timeout(5000),
        allowPrivate: false,
        test: false,
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
    assert.equal(transport.mock.callCount(), 1);
  } finally {
    transport.mock.restore();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("public HTTP support retains private-network and metadata restrictions", async () => {
  for (const address of ["127.0.0.1", "169.254.169.254", "10.2.3.4"]) {
    await assert.rejects(
      modelConnectionFetch(new URL(`http://${address}/v1/models`), {
        method: "GET",
        headers: {},
        signal: AbortSignal.timeout(1000),
        allowPrivate: false,
        test: false,
      }),
      (error: any) => error.code === "MODEL_CONNECTION_ADDRESS_BLOCKED",
    );
  }
});
