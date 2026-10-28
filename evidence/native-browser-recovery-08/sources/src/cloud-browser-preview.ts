import { chromium, type BrowserContext, type Page } from "playwright-core";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { checkedCloudBrowserRuntime } from "./cloud-browser-runtime.js";
import {
  sourceDigest,
  sourceManifest,
  type ProgramSource,
  type CloudCheckResult,
} from "./cloud-program-executor.js";
import { validateSourcePath } from "./code-workspace.js";
import { removeOwnedUUIDDirectory } from "./owned-directory-cleanup.js";
import { reclaimCloudBrowserProfiles } from "./cloud-browser-reclamation.js";
import { hash, Problem } from "./lib.js";

const selector = z.string().trim().min(1).max(500);
const action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("click"), selector }).strict(),
  z
    .object({
      action: z.literal("fill"),
      selector,
      value: z.string().max(4000),
    })
    .strict(),
  z
    .object({
      action: z.literal("select"),
      selector,
      value: z.string().max(500),
    })
    .strict(),
  z
    .object({ action: z.literal("check"), selector, checked: z.boolean() })
    .strict(),
  z
    .object({
      action: z.literal("press"),
      selector,
      key: z.enum([
        "Enter",
        "Tab",
        "Space",
        "Escape",
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
      ]),
    })
    .strict(),
  z
    .object({
      action: z.literal("wait_for"),
      selector,
      state: z.enum(["visible", "hidden"]),
    })
    .strict(),
]);
const assertion = z
  .object({
    name: z.string().trim().min(1).max(160),
    selector,
    expect: z.union([
      z.object({ text: z.string().max(4000) }).strict(),
      z.object({ contains_text: z.string().min(1).max(4000) }).strict(),
      z.object({ value: z.string().max(4000) }).strict(),
      z.object({ count: z.number().int().min(0).max(5000) }).strict(),
      z.object({ visible: z.boolean() }).strict(),
    ]),
  })
  .strict();
export const browserPreviewInput = z
  .object({
    entry: z.string().min(1).max(500),
    viewport: z
      .object({
        width: z.number().int().min(320).max(1600),
        height: z.number().int().min(240).max(1200),
      })
      .strict()
      .default({ width: 1280, height: 800 }),
    actions: z.array(action).max(20).default([]),
    checks: z.array(assertion).min(1).max(30),
    timeout_ms: z.number().int().min(100).max(30000).default(15000),
    fail_on_page_error: z.boolean().default(true),
  })
  .strict();
export type BrowserPreviewInput = z.input<typeof browserPreviewInput>;
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};
const csp =
  "sandbox allow-scripts allow-same-origin allow-forms; default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; media-src 'self' blob:; connect-src 'none'; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'self'";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
// Browser shutdown may flush the owned profile after execution has finished.
// Give that phase its own finite bound; it does not extend page execution and
// still requires the native guardian's independently verified empty job.
const browserCleanupMs = 6000;
async function closeBounded(context: BrowserContext) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      context.close(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("CLOSE_DEADLINE")), browserCleanupMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function cleanError(error: unknown) {
  return String(error)
    .replace(/D:\\[^\r\n]+/gi, "[owned runtime]")
    .slice(0, 1500);
}

/** Customer code executes only in Chromium's native renderer sandbox. The Node
 * controller accepts structured actions and serves exact source buffers. */
export async function runCloudBrowserPreview(
  dataDir: string,
  input: BrowserPreviewInput,
  sources: ProgramSource[],
  signal?: AbortSignal,
) {
  const a = browserPreviewInput.parse(input),
    manifest = sourceManifest(sources),
    entry = validateSourcePath(a.entry).normalize("NFC");
  if (!/\.html?$/i.test(entry) || !manifest.some((f) => f.path === entry))
    throw new Problem(
      400,
      "BROWSER_ENTRY_INVALID",
      "Choose an existing task HTML entry. Build framework bundles before previewing them.",
    );
  signal?.throwIfAborted();
  await reclaimCloudBrowserProfiles(dataDir);
  const runtime = await checkedCloudBrowserRuntime(),
    id = randomUUID(),
    parent = path.resolve(dataDir, "cloud-browsers"),
    root = path.join(parent, id);
  await mkdir(path.join(root, "tmp"), { recursive: true });
  await writeFile(
    path.join(root, "owner.json"),
    JSON.stringify({
      schema: 1,
      boundary: runtime.profile.boundary,
      execution_id: id,
      controller_pid: process.pid,
    }),
    { flag: "wx" },
  );
  const started = new Date().toISOString(),
    controller = new AbortController(),
    bounded = signal
      ? AbortSignal.any([signal, controller.signal])
      : controller.signal;
  let stop: string | null = null,
    context: BrowserContext | undefined,
    page: Page | undefined,
    host: any,
    attestation: any,
    afterAttestation: any,
    error: string | undefined,
    actionCount = 0,
    requests = 0,
    consoleBytes = 0;
  const checks: CloudCheckResult["checks"] = [],
    consoleLog: { type: string; text: string }[] = [],
    pageErrors: string[] = [],
    blocked: { kind: string; url: string }[] = [],
    files: ProgramSource[] = [];
  const stopNow = (reason: string) => {
    if (!stop) stop = reason;
    void writeFile(path.join(root, "cancel"), reason).catch(() => {});
  };
  const abort = () => stopNow(signal?.aborted ? "cancelled" : "timeout");
  bounded.addEventListener("abort", abort, { once: true });
  const executionStarted = performance.now();
  const timer = setTimeout(() => controller.abort(), a.timeout_ms);
  const contents = new Map(sources.map((f) => [f.path.toLowerCase(), f.bytes]));
  const taskURL =
    "http://preview.invalid/" +
    entry.split("/").map(encodeURIComponent).join("/");
  const framePolicy = "allow-scripts allow-same-origin allow-forms";
  const controllerHTML = `<!doctype html><meta charset="utf-8"><title>Task preview</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style><iframe id="task-preview" sandbox="${framePolicy}" src="${taskURL}"></iframe>`;
  const denied = (kind: string, url: string) => {
    if (blocked.length < 80) blocked.push({ kind, url: url.slice(0, 512) });
  };
  async function nativeReceipt() {
    try {
      return JSON.parse(
        await readFile(path.join(root, "host-receipt.json"), "utf8"),
      );
    } catch {
      return null;
    }
  }
  async function attest() {
    const browser = context!.browser();
    if (!browser) throw new Error("BROWSER_DISCONNECTED");
    while (performance.now() - executionStarted < a.timeout_ms) {
      if (bounded.aborted) throw new Error("PREVIEW_STOPPED");
      const session = await browser.newBrowserCDPSession();
      let processInfo: any;
      try {
        processInfo = await session.send("SystemInfo.getProcessInfo");
      } finally {
        await session.detach();
      }
      const renderers = processInfo.processInfo.filter(
        (p: any) => p.type === "renderer",
      );
      const current = await nativeReceipt();
      if (
        renderers.length &&
        current?.running &&
        processInfo.processInfo.every((p: any) =>
          current.processes.some((v: any) => v.pid === p.id),
        ) &&
        renderers.every((p: any) =>
          current.processes.some(
            (v: any) =>
              v.pid === p.id && v.integrity_rid === 0 && v.restricted === true,
          ),
        )
      )
        return {
          native: current,
          chromium_processes: processInfo.processInfo.map((p: any) => ({
            type: p.type,
            pid: p.id,
          })),
          renderers_untrusted_and_restricted: true,
        };
      if (bounded.aborted) throw new Error("PREVIEW_STOPPED");
      await delay(40);
    }
    controller.abort();
    throw new Error("NATIVE_RENDERER_SANDBOX_ATTESTATION_FAILED");
  }
  if (bounded.aborted) abort();
  try {
    context = await chromium.launchPersistentContext(
      path.join(root, "profile"),
      {
        executablePath: runtime.host,
        chromiumSandbox: true,
        headless: true,
        timeout: Math.min(a.timeout_ms + 2000, 32000),
        viewport: a.viewport,
        deviceScaleFactor: 1,
        serviceWorkers: "block",
        acceptDownloads: false,
        offline: true,
        ignoreDefaultArgs: [
          "--disable-ipc-flooding-protection",
          "--disable-popup-blocking",
          "--enable-unsafe-swiftshader",
          "--unsafely-disable-devtools-self-xss-warnings",
        ],
        proxy: { server: "http://no-egress.invalid:9", bypass: "<-loopback>" },
        args: [
          "--disable-quic",
          "--disable-sync",
          "--disable-extensions",
          "--no-first-run",
          "--disk-cache-size=1048576",
          "--media-cache-size=1048576",
          "--disable-gpu-shader-disk-cache",
          "--host-resolver-rules=MAP * ~NOTFOUND",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--webrtc-ip-handling-policy=disable_non_proxied_udp",
        ],
        env: {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          TEMP: path.join(root, "tmp"),
          TMP: path.join(root, "tmp"),
          USERPROFILE: root,
          LOCALAPPDATA: path.join(root, "tmp"),
          APPDATA: path.join(root, "tmp"),
          COPYPASTE_CHROMIUM_BINARY: runtime.binary,
          COPYPASTE_BROWSER_SHA256: runtime.binary_sha256,
          COPYPASTE_BROWSER_ROOT: root,
          COPYPASTE_BROWSER_PARENT_PID: String(process.pid),
          COPYPASTE_BROWSER_DEADLINE_MS: String(
            a.timeout_ms + browserCleanupMs,
          ),
        },
      },
    );
    context.setDefaultTimeout(Math.min(2500, a.timeout_ms));
    context.setDefaultNavigationTimeout(a.timeout_ms);
    await context.routeWebSocket("**/*", (socket) => {
      denied("websocket", socket.url());
      socket.close();
    });
    await context.addInitScript(() => {
      for (const name of [
        "RTCPeerConnection",
        "webkitRTCPeerConnection",
        "WebTransport",
      ])
        Object.defineProperty(globalThis, name, {
          value: undefined,
          writable: false,
          configurable: false,
        });
    });
    await context.route("**/*", async (route) => {
      if (++requests > 200) {
        stopNow("resource_limit");
        await route.abort("blockedbyclient");
        return;
      }
      const req = route.request();
      let relative: string | undefined;
      if (
        req.url() === "http://preview-controller.invalid/" &&
        req.isNavigationRequest() &&
        !req.frame().parentFrame()
      ) {
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy":
              "default-src 'none'; style-src 'unsafe-inline'; frame-src http://preview.invalid; object-src 'none'; base-uri 'none'; form-action 'none'",
            "Cache-Control": "no-store",
            "X-DNS-Prefetch-Control": "off",
          },
          body: controllerHTML,
        });
        return;
      }
      try {
        const url = new URL(req.url());
        if (
          url.protocol === "http:" &&
          url.hostname === "preview.invalid" &&
          !url.port &&
          !url.username &&
          !url.password &&
          !/%2f|%5c/i.test(url.pathname) &&
          ["GET", "HEAD"].includes(req.method())
        )
          relative = validateSourcePath(
            decodeURIComponent(url.pathname.slice(1)),
          ).normalize("NFC");
      } catch {}
      const content = relative
          ? contents.get(relative.toLowerCase())
          : undefined,
        type = relative
          ? mime[path.extname(relative).toLowerCase()]
          : undefined;
      if (!relative || !content || !type) {
        denied("resource", req.url());
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({
        status: 200,
        headers: {
          "Content-Type": type,
          "Content-Security-Policy": csp,
          "X-Content-Type-Options": "nosniff",
          "X-DNS-Prefetch-Control": "off",
          "Cache-Control": "no-store",
          "Permissions-Policy":
            "camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), payment=()",
        },
        body: req.method() === "HEAD" ? Buffer.alloc(0) : content,
      });
    });
    page = context.pages()[0] ?? (await context.newPage());
    const storageSession = await context.newCDPSession(page);
    try {
      await storageSession.send("Storage.overrideQuotaForOrigin", {
        origin: "http://preview.invalid",
        quotaSize: 8 * 1024 * 1024,
      });
    } finally {
      await storageSession.detach();
    }
    context.on("page", (p) => {
      if (p !== page) {
        denied("popup", p.url());
        void p.close().catch(() => {});
      }
    });
    page.on("dialog", (d) => void d.dismiss().catch(() => {}));
    page.on("download", (d) => {
      denied("download", d.url());
      void d.cancel().catch(() => {});
    });
    page.on("pageerror", (e) => {
      if (pageErrors.length < 20) pageErrors.push(e.message.slice(0, 1500));
    });
    page.on("console", (m) => {
      if (consoleLog.length < 64 && consoleBytes < 32768) {
        const text = m.text().slice(0, 2000);
        consoleBytes += Buffer.byteLength(text);
        consoleLog.push({ type: m.type(), text });
      }
    });
    attestation = await attest();
    if (bounded.aborted) throw new Error("PREVIEW_STOPPED");
    const remaining = Math.floor(a.timeout_ms - (performance.now() - executionStarted));
    if (remaining <= 0) {
      controller.abort();
      throw new Error("PREVIEW_STOPPED");
    }
    await page.goto("http://preview-controller.invalid/", {
      waitUntil: "load",
      // Startup and attestation have already consumed part of the one caller
      // budget. A separate five-second cap rejected otherwise valid local
      // pages; zero would instead disable Playwright's timeout entirely.
      timeout: remaining,
    });
    const taskFrame = page.frameLocator("#task-preview");
    for (const step of a.actions) {
      if (bounded.aborted) throw new Error("PREVIEW_STOPPED");
      const target = taskFrame.locator(step.selector);
      switch (step.action) {
        case "click":
          await target.click();
          break;
        case "fill":
          await target.fill(step.value);
          break;
        case "select":
          await target.selectOption(step.value);
          break;
        case "check":
          await target.setChecked(step.checked);
          break;
        case "press":
          await target.press(step.key);
          break;
        case "wait_for":
          await target.waitFor({ state: step.state });
          break;
      }
      actionCount++;
    }
    const element = await page.locator("#task-preview").elementHandle(),
      activeFrame = await element?.contentFrame();
    if (
      page.url() !== "http://preview-controller.invalid/" ||
      !activeFrame ||
      new URL(activeFrame.url()).origin !== "http://preview.invalid"
    )
      throw new Error("PREVIEW_NAVIGATION_DENIED");
    for (const check of a.checks) {
      if (bounded.aborted) throw new Error("PREVIEW_STOPPED");
      let actual: unknown,
        passed = false,
        checkError: string | undefined;
      try {
        const target = taskFrame.locator(check.selector),
          want = check.expect,
          end = Date.now() + Math.min(2500, a.timeout_ms);
        do {
          if ("count" in want) {
            actual = await target.count();
            passed = actual === want.count;
          } else if ("visible" in want) {
            actual = await target.isVisible();
            passed = actual === want.visible;
          } else if ("value" in want) {
            actual = await target.inputValue();
            passed = actual === want.value;
          } else {
            actual = (await target.innerText()).slice(0, 8000);
            passed =
              "text" in want
                ? actual === want.text
                : (actual as string).includes(want.contains_text);
          }
          if (passed || Date.now() >= end || bounded.aborted) break;
          await delay(40);
        } while (true);
      } catch (e) {
        checkError = cleanError(e);
      }
      checks.push({
        name: check.name,
        expected: check.expect,
        actual,
        passed,
        ...(checkError ? { error: checkError } : {}),
      });
    }
    afterAttestation = await attest();
    // The screenshot and DOM come from the same actual browser after actions.
    const png = await page.screenshot({
      type: "png",
      timeout: Math.min(3000, a.timeout_ms),
      animations: "disabled",
    });
    if (png.length > 4_000_000) throw new Error("SCREENSHOT_LIMIT");
    files.push({ path: "browser-preview.png", bytes: png });
    const text = await taskFrame.locator("body").innerText({ timeout: 1000 });
    files.push({
      path: "page-text.txt",
      bytes: Buffer.from(text.slice(0, 100000)),
    });
    const dom = await taskFrame
      .locator("html")
      .evaluate((element) => element.outerHTML.slice(0, 200000));
    files.push({ path: "page-dom.html", bytes: Buffer.from(dom) });
    if (a.fail_on_page_error && pageErrors.length)
      error = "PAGE_SCRIPT_ERROR: " + pageErrors.join("; ").slice(0, 1500);
  } catch (e) {
    error = cleanError(e);
  } finally {
    clearTimeout(timer);
    bounded.removeEventListener("abort", abort);
    if (context) {
      try {
        await closeBounded(context);
      } catch {
        stopNow(stop ?? "browser_close");
      }
    }
    // The native guardian owns all nested jobs and writes only after verifying
    // they are empty. Wait for that receipt before removing the owned profile.
    for (let attempt = 0; attempt < 120; attempt++) {
      host = await nativeReceipt();
      if (host?.running === false) break;
      await delay(50);
    }
  }
  try {
    if (
      !host ||
      host.running !== false ||
      host.schema !== 1 ||
      host.boundary !== runtime.profile.boundary ||
      !host.resumed ||
      !host.job_empty ||
      !host.kill_on_close ||
      host.failure
    )
      throw new Problem(
        503,
        "CLOUD_BROWSER_RECEIPT_INVALID",
        "Native browser execution or process cleanup could not be verified",
      );
    if (host.timed_out) stop ??= "timeout";
    if (host.cancelled) stop ??= "cancelled";
    if (host.parent_gone) stop ??= "controller_stopped";
    const check_result: CloudCheckResult = {
      kind: "browser",
      passed:
        !error &&
        !stop &&
        host.exit_code === 0 &&
        checks.length === a.checks.length &&
        checks.every((c) => c.passed),
      checks,
      ...(error ? { error } : {}),
    };
    const details = {
      check_result,
      actions_completed: actionCount,
      requested_actions: a.actions.length,
      page_errors: pageErrors,
      console: consoleLog,
      blocked_requests: blocked,
      resource_requests: requests,
      viewport: a.viewport,
    };
    files.push({
      path: "browser-checks.json",
      bytes: Buffer.from(JSON.stringify(details, null, 2) + "\n"),
    });
    for (const source of sources)
      files.push({ path: "sources/" + source.path, bytes: source.bytes });
    const output_manifest = files
      .map((f) => ({
        path: f.path,
        bytes: f.bytes.length,
        sha256: hash(f.bytes),
      }))
      .sort((x, y) => x.path.localeCompare(y.path, "en"));
    const receipt = {
      schema: 1,
      execution_id: id,
      program: "browser_preview",
      entry,
      args: [],
      timeout_ms: a.timeout_ms,
      cleanup_timeout_ms: browserCleanupMs,
      started_at: started,
      finished_at: new Date().toISOString(),
      source_manifest: manifest,
      source_digest: sourceDigest(manifest),
      output_manifest,
      exit_code: host.exit_code,
      passed: check_result.passed,
      stop_reason: stop,
      stdout: "",
      stderr: "",
      output_truncated: false,
      check_result,
      check_input: a,
      harness_sha256: hash(Buffer.from(controllerHTML)),
      browser: {
        version: runtime.profile.browser_version,
        viewport: a.viewport,
        actions_completed: actionCount,
        page_errors: pageErrors,
        blocked_requests: blocked,
        frame_isolation: {
          controller_origin: "http://preview-controller.invalid",
          task_origin: "http://preview.invalid",
          sandbox: framePolicy,
        },
        sandbox_before: attestation,
        sandbox_after: afterAttestation,
      },
      runtime: {
        id: runtime.profile.id,
        browser_version: runtime.profile.browser_version,
        browser_sha256: runtime.binary_sha256,
        profile_sha256: runtime.manifest.profile_sha256,
        host_sha256: runtime.manifest.host_sha256,
        host_source_sha256: runtime.manifest.host_source_sha256,
        boundary: runtime.profile.boundary,
      },
      host,
    };
    return { receipt: { ...receipt, workspace_deleted: true }, files };
  } finally {
    await removeOwnedUUIDDirectory(parent, id);
  }
}
