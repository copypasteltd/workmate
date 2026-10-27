import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";
import type { Page } from "playwright";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";
import { assertDesktopLayout } from "./qa-desktop-layout.js";

export async function projectUIRequest(page: Page, method: string, url: string, body?: unknown) {
  return page.evaluate(async ({ method, url, body }) => {
    const bridge = (window as any).copyPasteBridge;
    if (bridge) return bridge.request(url, { method, ...(body === undefined ? {} : { body }), idempotencyKey: crypto.randomUUID(), tenantId: localStorage.getItem("cp_tenant") ?? undefined });
    const session = await (await fetch("/v1/session/context")).json();
    const response = await fetch(url, { method, headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrf_token, "Idempotency-Key": crypto.randomUUID() }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, body: await response.json() };
  }, { method, url, body });
}

/** Files and account metadata are explicit owned fixtures. Publication, search,
 * selection, version-copy, layout and source-unavailability use the real UI/API.
 * Web tasks are accepted with the worker disabled, not claimed as model runs.
 * Desktop keeps actual earlier native tasks; this helper creates no cloud task. */
export async function exerciseProjectConfiguration({ page, repo, delivery, attempt, system, pass, screenshots, resize, captureSurface, nativeTaskId }: {
  page: Page; repo: "web" | "desktop"; delivery: string; attempt: string; system: any;
  pass: (s: string) => void; screenshots: any[]; resize: (w: number, h: number, label: string) => Promise<any>;
  captureSurface?: () => Promise<Buffer>; nativeTaskId?: string;
}) {
  const previous = await page.evaluate(() => ({ url: location.href, tenant: localStorage.getItem("cp_tenant"), project: localStorage.getItem("cp_project") }));
  assert.ok(previous.tenant && previous.project);
  const base = `/v1/tenants/${previous.tenant}/projects/${previous.project}`, endpoint = base + "/project-configuration";
  const request = async (method: string, url: string, body?: unknown) => {
    const response = await projectUIRequest(page, method, url, body);
    assert.ok(response.status >= 200 && response.status < 300, `${method} ${url}: ${response.status} ${JSON.stringify(response.body)}`);
    return response.body;
  };
  const me = await request("GET", "/v1/session/context");
  const { saveAsset } = await import(pathToFileURL(path.resolve(delivery, "../copypaste-platform/src/storage.ts")).href);
  const references: any[] = [];
  await system.db.tx(async (tx: any) => {
    for (let i = 0; i < (repo === "web" ? 51 : 3); i++) references.push(await saveAsset(tx, system.storage, {
      tenant: previous.tenant, project: previous.project, user: me.user.id,
      name: `Campaign source ${String(i).padStart(2, "0")}.txt`, mime: "text/plain", bytes: Buffer.from(`Approved fixture evidence ${i}: HK$120. This is synthetic campaign data.`),
    }));
    await saveAsset(tx, system.storage, { tenant: previous.tenant, project: previous.project, user: me.user.id,
      name: "PRIVATE campaign strategy.txt", mime: "text/plain", bytes: Buffer.from("This private source must never appear in project choices."), privateOwner: me.user.id });
  }, previous.tenant, true);
  const agent = await request("POST", base + "/agents", { name: "Harbour campaign specialist", role_key: "marketing-analyst", instructions: "Cite approved evidence. Preserve unknown metrics and currencies." });
  const brand = await request("POST", base + "/brand/definitions", {
    schema_version: 2, name: "Harbour · 香港品牌", colors: ["#1F5EFF", "#F6F6F4"], tone: "Clear, confident and local.", approved_copy: "An approved campaign.", fonts: [], logos: [],
    font_bindings: [{ key: "headline", label: "Noto Sans TC", source: { builtin: "noto-sans-tc" }, rights: { source: "Repository bundled test font", license: "SIL Open Font License 1.1", channels: ["social", "print"], valid_until: null } }],
    facts: [{ key: "offer", sku: "SKU-01", kind: "promotion", text: "春日優惠", amount_minor: 12000, currency: "HKD", valid_from: "2020-01-01T00:00:00Z", valid_until: "2099-01-01T00:00:00Z" }],
    locales: ["zh-Hant-HK", "en-HK"], channels: ["social", "print"], restrictions: "Never invent a price.",
  });
  const connection = (await system.db.control.query("INSERT INTO connections(tenant_id,project_id,provider,name,state,created_by,encrypted_secret) VALUES($1,$2,'google_ads','Harbour advertising account','connected',$3,'owned-synthetic-fixture') RETURNING id", [previous.tenant, previous.project, me.user.id])).rows[0];
  await system.db.control.query(`INSERT INTO connector_profiles(connection_id,tenant_id,project_id,auth_version,account_ids,project_ids,data_mode,api_version,configuration_hash,catalog_state)
    VALUES($1,$2,$3,1,ARRAY['harbour-approved-account'],ARRAY[$3::uuid],'simulated','synthetic-fixture',$4,'complete')`, [connection.id, previous.tenant, previous.project, "b".repeat(64)]);
  const go = async (route = "/app/projects") => {
    if (repo === "desktop") await page.evaluate(route => { location.hash = route; }, route);
    else if (route === "/app/projects" && new URL(page.url()).pathname.startsWith("/app")) await page.getByRole("link", { name: "Projects", exact: true }).click();
    else await page.goto("http://localhost:4317" + route);
  };
  const surface = captureSurface ?? (() => page.screenshot());
  const capture = async (name: string) => {
    await page.evaluate(async () => { await Promise.all(document.getAnimations().filter(a => a instanceof CSSTransition).map(a => a.finished.catch(() => {}))); });
    if (repo === "desktop") await assertDesktopLayout(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    screenshots.push(await saveWorkmateScreenshot(repo, "guidance-" + attempt, name, await surface(),
      "Actual shared guidance UI, exact versions, authorized file selection and source gates. Campaign/account facts are explicit fixtures. Web tasks are accepted metadata with no worker/model run; Desktop is the real packaged native client.", delivery));
  };
  const recording = new WorkmateRecording(repo, "project-guidance", "guidance-" + attempt, surface,
    "Actual draft, exact-dependency preview/publication, version comparison/copy and source governance. Synthetic campaign data; no AI request is initiated by publication.", delivery);
  let media: any, firstTask: any, secondTask: any, conversation: any;
  const taskCount = async () => Number((await system.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [previous.project])).rows[0].n);
  const beforeTasks = await taskCount();
  try {
    await go();
    const panel = page.locator(".project-brief-panel"); await panel.getByRole("heading", { name: "Shared project guidance", exact: true }).waitFor();
    await recording.start();
    await panel.getByRole("button", { name: "Edit shared guidance", exact: true }).click();
    let modal = page.getByRole("dialog");
    await modal.getByLabel("Guidance name", { exact: true }).fill("Harbour · shared campaign direction");
    await modal.getByLabel("Shared instructions", { exact: true }).fill("Use approved Hong Kong prices. Write in Traditional Chinese and English. Version one.");
    await modal.getByLabel("Delivery requirements", { exact: true }).fill("Deliver editable sources and a concise evidence table.");
    await modal.getByLabel("Recommended specialist and method version", { exact: true }).selectOption(agent.id + ":1");
    await modal.getByLabel("Brand version", { exact: true }).selectOption(brand.id + ":1");
    await modal.getByLabel("Harbour advertising account", { exact: true }).check();
    await modal.getByLabel("Campaign source 00.txt · v1", { exact: true }).check();
    assert.equal(await modal.getByText("PRIVATE campaign strategy.txt", { exact: false }).count(), 0);
    if (repo === "web") {
      await Promise.all([page.waitForResponse(r => r.request().method() === "GET" && r.url().includes("resource_query=Campaign%20source")), modal.getByLabel("Search shared files", { exact: true }).fill("Campaign source")]);
      await modal.getByRole("button", { name: "More shared files", exact: true }).click();
      await modal.getByLabel("Campaign source 50.txt · v1", { exact: true }).check();
      await modal.getByLabel("Search shared files", { exact: true }).fill("source 00");
      await modal.getByLabel("Campaign source 00.txt · v1", { exact: true }).waitFor();
      assert.ok((await modal.locator(".project-brief-selected").innerText()).includes("Campaign source 50.txt"));
    } else await modal.getByLabel("Campaign source 02.txt · v1", { exact: true }).check();
    await modal.getByLabel("Maximum task budget (HKD, optional)", { exact: true }).fill("2");
    await modal.getByRole("button", { name: "Save draft", exact: true }).click();
    await modal.getByText("Draft saved. It has not been published.", { exact: true }).waitFor();
    assert.equal((await request("GET", endpoint)).published, null); assert.equal(await taskCount(), beforeTasks);
    await modal.getByRole("button", { name: "Preview publication", exact: true }).click();
    await modal.getByRole("heading", { name: "First publication · v1", exact: true }).waitFor();
    await capture("publication-preview-en");
    await modal.getByRole("button", { name: "Back to editing", exact: true }).click();
    assert.equal(await modal.getByLabel("Guidance name", { exact: true }).inputValue(), "Harbour · shared campaign direction");
    assert.equal(await modal.getByLabel("Campaign source 00.txt · v1", { exact: true }).isChecked(), true);
    assert.ok((await modal.locator(".project-brief-selected").innerText()).includes(repo === "web" ? "Campaign source 50.txt" : "Campaign source 02.txt"));
    await modal.getByRole("button", { name: "Preview publication", exact: true }).click();
    await modal.getByRole("heading", { name: "First publication · v1", exact: true }).waitFor();
    await modal.getByRole("button", { name: "Confirm publication · v1", exact: true }).click(); await modal.waitFor({ state: "detached" });
    await panel.locator(".project-brief-publication").getByText("v1", { exact: true }).waitFor();
    assert.equal(await taskCount(), beforeTasks);
    const v1 = (await request("GET", endpoint)).published;
    assert.equal(v1.body.resolved.default_agent.version, 1); assert.equal(v1.body.resolved.resources.length, 2); assert.equal(v1.body.resolved.brand.version, 1);
    assert.ok(!JSON.stringify(v1).includes("owned-synthetic-fixture"));
    pass(repo + " saves a draft and previews/publishes exact specialist, brand, selected file and account versions without starting AI or exposing private files/credentials; file selections survive search and pagination");

    if (repo === "web") {
      await go("/app/conversations"); await page.getByRole("button", { name: "Start conversation", exact: true }).first().click();
      modal = page.getByRole("dialog"); await modal.locator('[data-project-brief-version="1"]').waitFor();
      await modal.getByLabel("Conversation name", { exact: true }).fill("Harbour · accepted version one");
      const accepted = page.waitForResponse(r => r.request().method() === "POST" && new URL(r.url()).pathname.endsWith("/conversations"));
      await modal.getByRole("button", { name: "Create conversation", exact: true }).click(); conversation = await (await accepted).json();
      assert.equal(conversation.agent_id, agent.id); assert.equal(conversation.agent_version, 1);
      const message = await request("POST", base + `/conversations/${conversation.id}/messages`, { expected_version: conversation.version, client_message_id: crypto.randomUUID(), body: "Prepare the approved fixture brief; this acceptance check runs no model.", intent: "delegate", budget_micros: 1000000 });
      firstTask = message.task;
      await request("POST", base + `/tasks/${firstTask.id}/cancel`, {});
      await go("/app/tasks/" + firstTask.id); await page.locator('[data-project-brief-version="1"]').waitFor();
      await page.locator('[data-project-brief-version="1"] > summary').click(); await capture("accepted-task-v1-en");
    } else {
      assert.ok(nativeTaskId); assert.deepEqual(await request("GET", base + `/tasks/${nativeTaskId}/project-configuration`), { published: null });
    }
    await request("PATCH", base + "/agents/" + agent.id, { expected_version: 1, name: "Harbour campaign specialist", role_key: "marketing-analyst", instructions: "A later specialist method, not implicitly adopted." });
    await go(); await panel.getByRole("button", { name: "Edit shared guidance", exact: true }).click(); modal = page.getByRole("dialog");
    await modal.getByLabel("Shared instructions", { exact: true }).fill("Use approved Hong Kong prices. Version two adds a separate review stage.");
    await modal.getByRole("button", { name: "Preview publication", exact: true }).click(); await modal.getByRole("heading", { name: "v1 → v2", exact: true }).waitFor();
    await modal.getByText("Currently published guidance · v1", { exact: true }).click(); await capture("compare-v1-v2-en");
    await modal.getByRole("button", { name: "Confirm publication · v2", exact: true }).click(); await modal.waitFor({ state: "detached" });
    if (firstTask) {
      const next = await request("POST", base + "/conversations", { name: "Harbour · accepted version two" });
      assert.equal(next.agent_version, 1, "The project pins method one even after the Agent itself reaches version two");
      secondTask = (await request("POST", base + `/conversations/${next.id}/messages`, { expected_version: next.version, client_message_id: crypto.randomUUID(), body: "Accept the updated project brief without running a model.", intent: "delegate", budget_micros: 1000000 })).task;
      await request("POST", base + `/tasks/${secondTask.id}/cancel`, {});
      assert.equal((await request("GET", base + `/tasks/${firstTask.id}/project-configuration`)).published.version, 1);
      assert.equal((await request("GET", base + `/tasks/${secondTask.id}/project-configuration`)).published.version, 2);
      await go("/app/tasks/" + firstTask.id); await page.locator('[data-project-brief-version="1"]').waitFor();
      await page.locator('[data-project-brief-version="1"] > summary').click();
      await page.getByText("The project has a newer publication; this task keeps its original version.", { exact: true }).waitFor(); await capture("old-task-after-v2-en");
    }
    pass(repo + (firstTask ? " distinguishes the accepted task's v1 from project v2; a new accepted task uses v2 while the exact specialist method remains v1" : " preserves the actual earlier native task's absence of shared guidance; publication never retrofits an existing local task or creates a cloud replacement"));

    await go(); await panel.getByRole("button", { name: "Version history", exact: true }).click();
    const old = panel.locator(".project-brief-history > details").last(); await old.locator(":scope > summary").click();
    await old.getByRole("button", { name: "Use this version as a draft", exact: true }).click(); modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "Preview publication", exact: true }).click(); await modal.getByRole("heading", { name: "v2 → v3", exact: true }).waitFor();
    await modal.getByRole("button", { name: "Confirm publication · v3", exact: true }).click(); await modal.waitFor({ state: "detached" });
    assert.equal(await panel.locator(".project-brief-history").count(), 1, "Copying a version must not orphan a second history when its editor closes");
    const versions = await request("GET", endpoint + "/versions"); assert.deepEqual(versions.items.map((v: any) => v.version), [3, 2, 1]);
    assert.equal(versions.items[2].sha256, v1.sha256); assert.equal(versions.items[0].body.instructions, v1.body.instructions);
    await capture("version-history-en");
    pass(repo + " copies a retained version into a new draft and publishes v3; v1/v2 remain immutable with their original SHA-256 and method bindings");

    await system.db.control.query("UPDATE assets SET state='quarantined' WHERE id=$1", [references[0].id]);
    try {
      const unavailable = (await request("GET", endpoint)).published; assert.equal(unavailable.available, false); assert.equal(unavailable.body, null);
      const unavailableVersions = await request("GET", endpoint + "/versions");
      assert.deepEqual(unavailableVersions.items.map((v: any) => [v.version, v.available, v.body]), [[3, false, null], [2, false, null], [1, false, null]]);
      await go(); await panel.getByRole("button", { name: "Refresh guidance", exact: true }).click();
      await panel.getByText("Some references or methods are unavailable. Update the selections and preview the publication again.", { exact: true }).waitFor();
      try { await panel.getByText(v1.body.instructions, { exact: true }).waitFor({ state: "hidden" }); }
      catch (error) {
        // Only the owned synthetic project's guidance is recorded. Preserve the
        // failed render before the finally block restores its source/route.
        const diagnostic = {
          status: "failed", scope: "owned synthetic shared-guidance fixture; no credentials",
          rendered: await panel.evaluate(el => ({ text: (el as HTMLElement).innerText, html: el.innerHTML })),
          versions: await request("GET", endpoint + "/versions?limit=10"),
        };
        await writeFile(path.join(delivery, `evidence/project-guidance-${repo}-${attempt}-failure.json`), JSON.stringify(diagnostic, null, 2) + "\n", { flag: "wx" });
        throw error;
      }
      assert.equal(await panel.getByText(v1.body.instructions, { exact: true }).count(), 0, "Revoked bodies must leave the DOM, including open history");
      assert.equal(await panel.locator(".project-brief-history").count(), 1);
      await capture("unavailable-reference-en");
    } finally { await system.db.control.query("UPDATE assets SET state='active' WHERE id=$1", [references[0].id]); }
    await panel.getByRole("button", { name: "Refresh guidance", exact: true }).click();
    await panel.locator(":scope > .project-brief-details").getByText(v1.body.instructions, { exact: true }).waitFor();
    const restored = (await request("GET", endpoint)).published; assert.equal(restored.version, 3); assert.equal(restored.sha256, versions.items[0].sha256);
    pass(repo + " hides the published body after real source quarantine and shows an actionable review state; restoring the source restores its unchanged publication");

    await go(); await resize(repo === "desktop" ? 800 : 390, repo === "desktop" ? 600 : 844, "compact shared guidance with actual version history");
    await page.getByTitle("切換至繁體中文", { exact: true }).click();
    for (let i = 0; i < 4 && await page.evaluate(() => document.documentElement.dataset.theme) !== "dark"; i++) await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
    await panel.getByRole("button", { name: "編輯共享設定", exact: true }).click(); modal = page.getByRole("dialog");
    await modal.getByRole("button", { name: "預覽發布", exact: true }).focus();
    assert.equal(await modal.getByRole("button", { name: "預覽發布", exact: true }).evaluate(el => el === document.activeElement), true);
    await capture("editor-zh-dark-compact");
    await modal.getByRole("button", { name: "Close", exact: true }).click();
    await page.getByTitle("Switch to English", { exact: true }).click();
    for (let i = 0; i < 4 && await page.evaluate(() => document.documentElement.dataset.theme) !== "light"; i++) await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
    await resize(1440, 980, "restore actual client after shared guidance");
    pass(repo + " keeps English/Traditional Chinese and dark-theme shared guidance usable at a compact width with the last editor action reachable and no horizontal overflow" + (repo === "desktop" ? " or visible scrollbar rails" : ""));
    media = await recording.stop();
    return { media, configuration_id: v1.id, published_versions: [1, 2, 3], agent_id: agent.id, pinned_method_version: 1,
      old_task_id: firstTask?.id ?? nativeTaskId, new_task_id: secondTask?.id ?? null, conversation_id: conversation?.id ?? null,
      task_evidence_scope: firstTask ? "real HTTP acceptance and pinned metadata; worker disabled, no model run" : "actual earlier native task is not retroactively bound; no new cloud task created" };
  } finally {
    if (!media) media = await recording.stop();
    if (repo === "desktop") await page.evaluate(url => { location.hash = new URL(url).hash; }, previous.url);
  }
}
