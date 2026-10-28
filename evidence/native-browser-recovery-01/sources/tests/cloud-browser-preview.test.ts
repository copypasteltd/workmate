import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createSocket } from "node:dgram";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { PNG } from "pngjs";
import {
  browserPreviewInput,
  runCloudBrowserPreview,
} from "../src/cloud-browser-preview.js";
import { sourceDigest, sourceManifest } from "../src/cloud-program-executor.js";
import {
  cloudBrowserAvailable,
  inspectCloudBrowserJob,
} from "../src/cloud-browser-runtime.js";
import { reclaimCloudBrowserProfiles } from "../src/cloud-browser-reclamation.js";
const root = path.resolve(".data/cloud-browser-tests", randomUUID()),
  native = process.platform === "win32";
const source = (html: string) => [
  { path: "index.html", bytes: Buffer.from(html) },
];
const check = (
  selector: string,
  expect: any,
  name = "Actual DOM assertion",
) => ({ name, selector, expect });

test("preview inputs cannot substitute outside URLs, program execution, file upload or unobservable assertions", async () => {
  const input = {
    entry: "index.html",
    checks: [check("h1", { text: "Actual" })],
  };
  for (const extra of [
    { url: "http://127.0.0.1" },
    { evaluate: "process.exit(0)" },
    { actions: [{ action: "evaluate", script: "alert(1)" }] },
    { actions: [{ action: "upload", selector: "input", path: "C:\\secret" }] },
    { checks: [check("h1", {})] },
    { checks: [check("h1", { text: "x", count: 1 })] },
    { viewport: { width: 99999, height: 800 } },
  ])
    assert.equal(
      browserPreviewInput.safeParse({ ...input, ...extra }).success,
      false,
    );
  for (const entry of [
    "https://outside.invalid/",
    "../outside.html",
    "code.cjs",
    "missing.html",
  ])
    await assert.rejects(
      runCloudBrowserPreview(
        root,
        { ...input, entry },
        source("<h1>Actual</h1>"),
      ),
    );
});

test(
  "real native Chromium executes form actions, local assets, navigation and viewport capture with restricted untrusted renderer tokens",
  { skip: !native },
  async () => {
    assert.equal(
      await cloudBrowserAvailable(),
      true,
      "Install the exact approved browser before native acceptance",
    );
    const files = [
      ...source(
        `<!doctype html><html><head><link rel=stylesheet href=styles.css></head><body><h1>CopyPaste preview</h1><input id=name><select id=tier><option value=standard>Standard</option><option value=vip>VIP</option></select><input id=approved type=checkbox><button id=run>Apply</button><p id=result>Pending</p><script src=app.js></script></body></html>`,
      ),
      {
        path: "styles.css",
        bytes: Buffer.from(
          "body{background:#faf8f4;font-family:Arial}h1{color:#db5524}",
        ),
      },
      {
        path: "app.js",
        bytes: Buffer.from(
          "document.querySelector('#run').onclick=()=>{document.querySelector('#result').textContent=document.querySelector('#name').value+' / '+document.querySelector('#tier').value+' / '+document.querySelector('#approved').checked;};",
        ),
      },
    ];
    const r = await runCloudBrowserPreview(
      root,
      {
        entry: "index.html",
        viewport: { width: 390, height: 700 },
        actions: [
          { action: "fill", selector: "#name", value: "香港團隊" },
          { action: "select", selector: "#tier", value: "vip" },
          { action: "check", selector: "#approved", checked: true },
          { action: "click", selector: "#run" },
        ],
        checks: [
          check("#result", { text: "香港團隊 / vip / true" }),
          check("#name", { value: "香港團隊" }),
          check("button", { count: 1 }),
          check("h1", { visible: true }),
        ],
      },
      files,
    );
    assert.equal(
      r.receipt.passed,
      true,
      JSON.stringify(r.receipt.check_result),
    );
    assert.equal(r.receipt.source_digest, sourceDigest(sourceManifest(files)));
    assert.equal(r.receipt.browser.actions_completed, 4);
    assert.equal(
      r.receipt.browser.sandbox_before.renderers_untrusted_and_restricted,
      true,
    );
    assert.equal(
      r.receipt.browser.sandbox_after.renderers_untrusted_and_restricted,
      true,
    );
    assert.equal(r.receipt.host.job_empty, true);
    assert.equal(r.receipt.host.kill_on_close, true);
    assert.equal(r.receipt.host.process_limit, 20);
    assert.equal(r.receipt.workspace_deleted, true);
    const png = PNG.sync.read(
      r.files.find((f) => f.path === "browser-preview.png")!.bytes,
    );
    assert.equal(png.width, 390);
    assert.equal(png.height, 700);
    assert.ok(
      r.files
        .find((f) => f.path === "page-text.txt")!
        .bytes.toString()
        .includes("香港團隊 / vip / true"),
    );
    assert.ok(
      r.files
        .find((f) => f.path === "page-dom.html")!
        .bytes.toString()
        .includes('id="result"'),
    );
    assert.deepEqual(await readdir(path.join(root, "cloud-browsers")), []);
  },
);

test(
  "native preview preserves actual failed assertions and script exceptions even when the browser exits zero",
  { skip: !native },
  async () => {
    for (const html of [
      "<h1>Different actual result</h1>",
      "<h1>Expected</h1><script>throw new Error('actual script failure')</script>",
    ]) {
      const r = await runCloudBrowserPreview(
        root,
        { entry: "index.html", checks: [check("h1", { text: "Expected" })] },
        source(html),
      );
      assert.equal(r.receipt.passed, false);
      assert.equal(r.receipt.exit_code, 0);
      assert.ok(r.files.some((f) => f.path === "browser-preview.png"));
      if (html.includes("throw")) {
        assert.match(r.receipt.check_result.error!, /actual script failure/);
        assert.equal(r.receipt.check_result.checks[0].passed, true);
      } else {
        assert.equal(
          r.receipt.check_result.checks[0].actual,
          "Different actual result",
        );
        assert.equal(r.receipt.check_result.checks[0].passed, false);
      }
    }
  },
);

test(
  "external HTTP, WebSocket, RTC, filesystem and browser features cannot reach owned canaries or read controller secrets",
  { skip: !native },
  async () => {
    let httpCalls = 0,
      udpCalls = 0;
    const http = createServer((_, res) => {
        httpCalls++;
        res.end("outside");
      }),
      udp = createSocket("udp4");
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    await new Promise<void>((resolve) => udp.bind(0, "127.0.0.1", resolve));
    udp.on("message", () => udpCalls++);
    const httpPort = (http.address() as any).port,
      udpPort = udp.address().port,
      secret = "controller-only-" + randomUUID();
    process.env.COPYPASTE_BROWSER_CANARY = secret;
    await mkdir(root, { recursive: true });
    const canary = path.join(root, "outside-secret.txt");
    await writeFile(canary, secret);
    try {
      const html = `<!doctype html><h1>Bounded page</h1><p id=network>Pending</p><p id=runtime></p><button id=attempt>Attempt outside actions</button><script>document.querySelector('#runtime').textContent=typeof process+'/'+typeof require+'/'+typeof RTCPeerConnection+'/'+typeof WebTransport;document.querySelector('#attempt').onclick=async()=>{let denied=0;for(const u of ['http://127.0.0.1:${httpPort}/outside','file:///${canary.replaceAll("\\", "/")}','http://169.254.169.254/latest/meta-data/']){try{await fetch(u)}catch{denied++}}try{new WebSocket('ws://127.0.0.1:${httpPort}/socket')}catch{}try{new RTCPeerConnection({iceServers:[{urls:'stun:127.0.0.1:${udpPort}'}]})}catch{}try{new Worker('worker.js')}catch{}window.open('http://127.0.0.1:${httpPort}/popup');document.querySelector('#network').textContent='Denied '+denied;};</script>`;
      const r = await runCloudBrowserPreview(
        root,
        {
          entry: "index.html",
          actions: [
            { action: "click", selector: "#attempt" },
            {
              action: "wait_for",
              selector: "#network:text('Denied 3')",
              state: "visible",
            },
          ],
          checks: [
            check("#network", { text: "Denied 3" }),
            check("#runtime", {
              text: "undefined/undefined/undefined/undefined",
            }),
          ],
        },
        source(html),
      );
      assert.equal(
        r.receipt.passed,
        true,
        JSON.stringify(r.receipt.check_result),
      );
      assert.equal(httpCalls, 0);
      assert.equal(udpCalls, 0);
      assert.equal(await readFile(canary, "utf8"), secret);
      assert.ok(!JSON.stringify(r).includes(secret));
      assert.equal(r.receipt.host.job_empty, true);
    } finally {
      delete process.env.COPYPASTE_BROWSER_CANARY;
      await new Promise<void>((resolve) => http.close(() => resolve()));
      udp.close();
    }
  },
);

test(
  "each preview has fresh browser storage; local navigation and cookie state exist only inside that invocation",
  { skip: !native },
  async () => {
    const files = [
      ...source(
        "<h1 id=state></h1><a href=next.html>Continue</a><script>document.querySelector('#state').textContent=localStorage.getItem('owner')||'Fresh';localStorage.setItem('owner','This invocation');</script>",
      ),
      {
        path: "next.html",
        bytes: Buffer.from(
          "<h1 id=state></h1><script>document.querySelector('#state').textContent=localStorage.getItem('owner');</script>",
        ),
      },
    ];
    const first = await runCloudBrowserPreview(
      root,
      {
        entry: "index.html",
        actions: [{ action: "click", selector: "a" }],
        checks: [check("#state", { text: "This invocation" })],
      },
      files,
    );
    assert.equal(
      first.receipt.passed,
      true,
      JSON.stringify(first.receipt.check_result),
    );
    const second = await runCloudBrowserPreview(
      root,
      { entry: "index.html", checks: [check("#state", { text: "Fresh" })] },
      files,
    );
    assert.equal(
      second.receipt.passed,
      true,
      JSON.stringify(second.receipt.check_result),
    );
    assert.notEqual(first.receipt.execution_id, second.receipt.execution_id);
  },
);

test(
  "customer frames cannot read their controller, navigate the top document or launch external application protocols",
  { skip: !native },
  async () => {
    const scheme = "wm-preview-denied-" + randomUUID();
    const html = `<h1>Customer frame remains here</h1><a id=protocol href="${scheme}:blocked">External protocol</a><p id=frame></p><button id=top>Try top navigation</button><script>try{parent.document.body;document.querySelector('#frame').textContent='Unsafe parent access'}catch{document.querySelector('#frame').textContent='Controller denied'}document.querySelector('#top').onclick=()=>{try{parent.location.href='http://outside.invalid'}catch{document.querySelector('#frame').textContent='Top navigation denied'}};</script>`;
    const r = await runCloudBrowserPreview(
      root,
      {
        entry: "index.html",
        actions: [{ action: "click", selector: "#top" }],
        checks: [
          check("h1", { text: "Customer frame remains here" }),
          check("#frame", { text: "Top navigation denied" }),
        ],
      },
      source(html),
    );
    assert.equal(
      r.receipt.passed,
      true,
      JSON.stringify(r.receipt.check_result),
    );
    assert.ok(
      r.receipt.browser.frame_isolation.sandbox.includes("allow-scripts"),
    );
    const blocked = await runCloudBrowserPreview(
      root,
      {
        entry: "index.html",
        actions: [{ action: "click", selector: "#protocol" }],
        checks: [check("h1", { text: "Customer frame remains here" })],
      },
      source(html),
    );
    const log = JSON.parse(
      blocked.files
        .find((f) => f.path === "browser-checks.json")!
        .bytes.toString(),
    );
    assert.ok(
      log.blocked_requests.some((m: any) => m.url.startsWith(scheme + ":")) ||
        log.console.some((m: any) =>
          /external protocol blocked by sandbox|Content Security Policy directive:.*frame-src/i.test(
            m.text,
          ),
        ),
      JSON.stringify(log),
    );
    assert.equal(blocked.receipt.host.job_empty, true);
  },
);

test(
  "invalid selectors and blocked infinite JavaScript cannot become passing checks and owned browser jobs are reclaimed",
  { skip: !native },
  async () => {
    const bad = await runCloudBrowserPreview(
      root,
      {
        entry: "index.html",
        actions: [{ action: "click", selector: "[not-valid" }],
        checks: [check("h1", { text: "Actual" })],
      },
      source("<h1>Actual</h1>"),
    );
    assert.equal(bad.receipt.passed, false);
    assert.ok(bad.receipt.check_result.error);
    assert.equal(bad.receipt.host.job_empty, true);
    const started = Date.now(),
      timed = await runCloudBrowserPreview(
        root,
        {
          entry: "index.html",
          timeout_ms: 5000,
          checks: [check("h1", { text: "Never returns" })],
        },
        source(
          "<h1>Blocked script</h1><script>console.log('entered blocked script');for(;;){}</script>",
        ),
      );
    assert.equal(timed.receipt.passed, false);
    assert.ok(["timeout", "cancelled"].includes(timed.receipt.stop_reason!));
    assert.ok(Date.now() - started < 18000);
    assert.equal(timed.receipt.host.job_empty, true);
    assert.deepEqual(await readdir(path.join(root, "cloud-browsers")), []);
  },
);

test(
  "caller cancellation terminates only its native browser job and removes the owned profile",
  { skip: !native },
  async () => {
    const abort = new AbortController(),
      clock = Date.now();
    const timer = setTimeout(() => abort.abort(), 2500);
    try {
      const r = await runCloudBrowserPreview(
        root,
        {
          entry: "index.html",
          timeout_ms: 20000,
          checks: [check("h1", { text: "Unreachable" })],
        },
        source("<h1>Cancel</h1><script>for(;;){}</script>"),
        abort.signal,
      );
      assert.equal(r.receipt.passed, false);
      assert.equal(r.receipt.stop_reason, "cancelled");
      assert.equal(r.receipt.host.job_empty, true);
      assert.ok(Date.now() - clock < 16000);
      assert.deepEqual(await readdir(path.join(root, "cloud-browsers")), []);
    } finally {
      clearTimeout(timer);
    }
  },
);

test(
  "asynchronous DOM state is polled and cancellation of one preview leaves a simultaneous owned preview intact",
  { skip: !native },
  async () => {
    const abort = new AbortController(),
      timer = setTimeout(() => abort.abort(), 2500);
    try {
      const [cancelled, completed] = await Promise.all([
        runCloudBrowserPreview(
          root,
          {
            entry: "index.html",
            timeout_ms: 20000,
            checks: [check("h1", { text: "Never" })],
          },
          source("<h1>Cancel only me</h1><script>for(;;){}</script>"),
          abort.signal,
        ),
        runCloudBrowserPreview(
          root,
          {
            entry: "index.html",
            checks: [check("#state", { text: "Asynchronous actual state" })],
          },
          source(
            "<h1>Independent preview</h1><p id=state>Pending</p><script>setTimeout(()=>document.querySelector('#state').textContent='Asynchronous actual state',400);</script>",
          ),
        ),
      ]);
      assert.equal(cancelled.receipt.passed, false);
      assert.equal(cancelled.receipt.stop_reason, "cancelled");
      assert.equal(
        completed.receipt.passed,
        true,
        JSON.stringify(completed.receipt.check_result),
      );
      assert.notEqual(
        cancelled.receipt.host.process_id,
        completed.receipt.host.process_id,
      );
      assert.ok(
        cancelled.receipt.host.job_empty && completed.receipt.host.job_empty,
      );
      assert.deepEqual(await readdir(path.join(root, "cloud-browsers")), []);
    } finally {
      clearTimeout(timer);
    }
  },
);

test(
  "controller death is observed natively and only a positively closed orphan profile is reclaimed",
  { skip: !native },
  async () => {
    const module = pathToFileURL(
      path.resolve("src/cloud-browser-preview.ts"),
    ).href;
    const code = `import{runCloudBrowserPreview}from${JSON.stringify(module)};await runCloudBrowserPreview(${JSON.stringify(root)},{entry:'index.html',timeout_ms:30000,checks:[{name:'Blocked controller test',selector:'h1',expect:{text:'Never'}}]},[{path:'index.html',bytes:Buffer.from('<h1>Native parent watchdog</h1><script>for(;;){}</script>')}]);`;
    const child = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", code],
        { cwd: process.cwd(), windowsHide: true, stdio: "ignore" },
      ),
      closed = new Promise((resolve) => child.once("close", resolve));
    let owned: string | undefined, finished: any;
    try {
      const deadline = Date.now() + 18000;
      while (Date.now() < deadline) {
        for (const name of await readdir(
          path.join(root, "cloud-browsers"),
        ).catch(() => [])) {
          try {
            const dir = path.join(root, "cloud-browsers", name),
              owner = JSON.parse(
                await readFile(path.join(dir, "owner.json"), "utf8"),
              ),
              host = JSON.parse(
                await readFile(path.join(dir, "host-receipt.json"), "utf8"),
              );
            if (
              owner.controller_pid === child.pid &&
              host.running &&
              host.processes.some(
                (p: any) => p.integrity_rid === 0 && p.restricted,
              )
            ) {
              owned = name;
              break;
            }
          } catch {}
        }
        if (owned) break;
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.ok(
        owned,
        "The child controller must have launched actual sandboxed renderers",
      );
      assert.deepEqual(
        await reclaimCloudBrowserProfiles(root),
        [],
        "A live controller's profile must stay intact",
      );
      child.kill();
      await closed;
      let removed: string[] = [];
      for (let attempt = 0; attempt < 120; attempt++) {
        finished = await inspectCloudBrowserJob(
          path.join(root, "cloud-browsers", owned!),
        );
        // Closing the browser job precedes the native host's final receipt and
        // process exit. Reclamation independently requires both owners gone;
        // observe that complete lifecycle rather than treating job_empty alone
        // as permission to delete a still-owned profile.
        if (finished.job_empty && !finished.job_exists) {
          removed = await reclaimCloudBrowserProfiles(root);
          if (removed.includes(owned!)) break;
        }
        await new Promise((r) => setTimeout(r, 50));
      }
      assert.equal(finished?.job_empty, true);
      assert.equal(finished?.job_exists, false);
      assert.deepEqual(removed, [owned]);
      assert.deepEqual(await readdir(path.join(root, "cloud-browsers")), []);
    } finally {
      if (child.exitCode === null) child.kill();
      await closed;
    }
  },
);
