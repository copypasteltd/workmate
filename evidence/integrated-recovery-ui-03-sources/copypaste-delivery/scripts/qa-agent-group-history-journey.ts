import assert from "node:assert/strict";
import type { Page } from "playwright";
import { WorkmateRecording } from "./record-workmate-media.js";

export async function qualifyTeamHistory({
  page,
  system,
  group,
  agents,
  tenant,
  project,
  base,
  url,
  attempt,
  call,
  go,
  shot,
  pass,
  frame,
  media,
  delivery,
}: {
  page: Page;
  system: any;
  group: any;
  agents: any[];
  tenant: string;
  project: string;
  base: string;
  url: string;
  attempt: string;
  call: (...args: any[]) => Promise<any>;
  go: (page: Page, url: string) => Promise<any>;
  shot: (page: Page, name: string) => Promise<void>;
  pass: (name: string) => void;
  frame: () => Promise<Buffer>;
  media: any[];
  delivery: string;
}) {
  const result: any = {
    history_runs: [],
    created_teams: [],
    draft_preserved: false,
    cursor_withdrawal_fenced: false,
    project_switch_fenced: false,
  };
  const secondProject = await call(
    page,
    "POST",
    `/v1/tenants/${tenant}/projects`,
    {
      name: "Independent history project",
      description: "Synthetic scope isolation fixture",
    },
    tenant,
  );
  let current = group;
  for (let i = 0; i < 22; i++)
    current = await call(
      page,
      "PATCH",
      url,
      {
        expected_version: current.version,
        name: "Harbour launch team · revision " + (i + 2),
      },
      tenant,
    );
  for (let i = 0; i < 102; i++)
    result.created_teams.push(
      (
        await call(
          page,
          "POST",
          "/v1/agent-groups",
          {
            project_id: project,
            name: "Studio team " + String(i + 1).padStart(3, "0"),
            coordinator_agent_id: agents[0].id,
            members: [
              {
                agent_id: agents[1].id,
                role_description: "Prepare a clearly simulated brief",
              },
            ],
          },
          tenant,
        )
      ).id,
    );
  const input = (brief: string) => ({
    expected_version: current.version,
    brief,
    nodes: [
      {
        key: "copy",
        agent_id: agents[1].id,
        title: "History fixture copy",
        prompt:
          "Clearly simulated history fixture; execute only after explicit customer approval.",
        depends_on: [],
        budget_micros: 100000,
      },
    ],
    coordinator_budget_micros: 100000,
    max_parallelism: 1,
  });
  for (let i = 0; i < 10; i++) {
    const review = await call(
      page,
      "POST",
      url + "/preflight",
      input("Synthetic history " + (i + 1)),
      tenant,
    );
    const run = await call(
      page,
      "POST",
      url + "/runs",
      {
        preflight_id: review.id,
        expected_version: review.version,
        definition_hash: review.definition_hash,
        approved_budget_micros: review.approved_budget_micros,
        confirm: true,
      },
      tenant,
    );
    const stopped = await call(
      page,
      "POST",
      url + `/runs/${run.id}/cancel`,
      { expected_revision: run.revision },
      tenant,
    );
    assert.equal(stopped.state, "cancelled");
    assert.equal(stopped.reserved_micros, 0);
    assert.equal(stopped.charged_micros, 0);
    result.history_runs.push({
      id: run.id,
      created_at: run.created_at,
      state: stopped.state,
      charged_micros: stopped.charged_micros,
      reserved_micros: stopped.reserved_micros,
    });
  }
  await page.setViewportSize({ width: 1440, height: 980 });
  await page.evaluate(() => localStorage.setItem("cp_locale", "en"));
  await go(page, "http://localhost:4317/app/teams");
  const target = async () => {
    await page.locator('.team-directory[aria-busy="false"]').waitFor();
    const previous = page
      .locator(".team-directory .team-pagination button")
      .nth(0);
    if (await previous.isEnabled()) await previous.click();
    await page.locator('.team-directory[aria-busy="false"]').waitFor();
    if (
      !(await page
        .locator(`.team-directory option[value="${group.id}"]`)
        .count())
    ) {
      await page
        .locator(".team-directory .team-pagination button")
        .nth(1)
        .click();
      await page
        .locator(`.team-directory option[value="${group.id}"]`)
        .waitFor({ state: "attached" });
    }
    await page.locator(".team-directory select").selectOption(group.id);
    await page
      .getByRole("heading", { name: current.name, exact: true })
      .waitFor();
  };
  await target();
  const runIds = () =>
    page
      .locator(".team-run")
      .evaluateAll((rows) =>
        rows.map((row) => row.getAttribute("data-run-id")),
      );
  const newest = result.history_runs
    .slice(-8)
    .reverse()
    .map((r: any) => r.id);
  await page.waitForFunction(
    (ids) =>
      JSON.stringify(
        Array.from(document.querySelectorAll(".team-run")).map((e) =>
          e.getAttribute("data-run-id"),
        ),
      ) === JSON.stringify(ids),
    newest,
  );
  await page
    .getByRole("textbox", { name: "Overall brief", exact: true })
    .fill("Keep this customer draft while browsing team history.");
  await page.getByRole("button", { name: "Add step", exact: true }).click();
  await page
    .getByLabel("Step title", { exact: true })
    .fill("Draft that survives history pages");
  await page
    .getByLabel("Instructions", { exact: true })
    .fill(
      "This is a synthetic test. Preserve the customer's draft and require exact approval.",
    );
  const record = new WorkmateRecording(
    "web",
    "team-history",
    "agent-group-history-" + attempt,
    frame,
    "Actual chronological run history, independent version pages, retained draft and explicit approval",
    delivery,
  );
  await record.start();
  try {
    await page.getByRole("button", { name: "Older runs", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Run history pages" })
      .getByRole("status")
      .filter({ hasText: "Page 2" })
      .waitFor();
    await page.waitForFunction(
      () => document.querySelectorAll(".team-run").length === 3,
    );
    assert.deepEqual(
      (await runIds()).slice(0, 2),
      result.history_runs
        .slice(0, 2)
        .reverse()
        .map((r: any) => r.id),
    );
    const pageTwo = await runIds();
    await page.locator(".team-overview summary").click();
    await page
      .getByRole("button", { name: "Older versions", exact: true })
      .click();
    await page.waitForFunction(() =>
      document
        .querySelector(".team-version strong")
        ?.textContent?.startsWith("v3 ·"),
    );
    assert.equal(await page.locator(".team-version").count(), 3);
    assert.equal(
      await page
        .getByRole("textbox", { name: "Overall brief", exact: true })
        .inputValue(),
      "Keep this customer draft while browsing team history.",
    );
    assert.equal(
      await page.getByLabel("Step title", { exact: true }).inputValue(),
      "Draft that survives history pages",
    );
    const poll = await page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname === url + "/runs" &&
        new URL(r.url()).searchParams.has("before"),
    );
    assert.equal(poll.status(), 200);
    assert.deepEqual(await runIds(), pageTwo);
    await shot(page, "history-pages");
    const anchor = result.history_runs[2].id;
    await system.db.control.query(
      "UPDATE agent_group_runs SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
      [anchor],
    );
    await page.waitForFunction(
      () => document.querySelectorAll(".team-run").length === 0,
    );
    result.cursor_withdrawal_fenced = true;
    await page.getByRole("button", { name: "Newer runs", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".team-run").length === 8,
    );
    assert.ok(!(await runIds()).includes(anchor));
    assert.equal(
      await page
        .getByRole("textbox", { name: "Overall brief", exact: true })
        .inputValue(),
      "Keep this customer draft while browsing team history.",
    );
    result.draft_preserved = true;
    result.current_version = current.version;
    pass(
      "HISTORY-01 actual private run pages are chronological and revalidated; old version pages and polling preserve the draft, while a withdrawn cursor clears cached run bodies",
    );

    await page.getByRole("button", { name: "Older runs", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Run history pages" })
      .getByRole("status")
      .filter({ hasText: "Page 2" })
      .waitFor();
    await page
      .getByRole("button", { name: "Review team & budget", exact: true })
      .click();
    const approval = page.getByRole("dialog", {
      name: "Approve this team plan",
      exact: true,
    });
    await approval.waitFor();
    const [approved] = await Promise.all([
      page.waitForResponse(
        (r) =>
          new URL(r.url()).pathname === url + "/runs" &&
          r.request().method() === "POST",
      ),
      approval
        .getByRole("button", { name: "Approve & start", exact: true })
        .click(),
    ]);
    assert.equal(approved.status(), 201);
    const started = await approved.json();
    await page.waitForFunction(
      (id) =>
        document.querySelector(".team-run")?.getAttribute("data-run-id") === id,
      started.id,
    );
    assert.match(
      await page
        .getByRole("navigation", { name: "Run history pages" })
        .getByRole("status")
        .innerText(),
      /Page 1/,
    );
    assert.equal(
      await page
        .getByRole("textbox", { name: "Overall brief", exact: true })
        .inputValue(),
      "Keep this customer draft while browsing team history.",
    );
    await page
      .locator(`.team-run[data-run-id="${started.id}"]`)
      .getByRole("button", { name: "Stop run", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Stop this team run", exact: true })
      .getByRole("button", { name: "Confirm stop", exact: true })
      .click();
    await page.waitForFunction(
      (id) =>
        document
          .querySelector(`.team-run[data-run-id="${id}"] > header .badge`)
          ?.textContent?.includes("Cancelled"),
      started.id,
    );
    const stopped = await call(
      page,
      "GET",
      url + "/runs/" + started.id,
      undefined,
      tenant,
    );
    assert.equal(stopped.reserved_micros, 0);
    assert.equal(stopped.charged_micros, 0);
    result.newest_approved_run = {
      id: started.id,
      reserved_after_stop: stopped.reserved_micros,
      charged_micros: stopped.charged_micros,
    };
    await page.locator(".team-runs").scrollIntoViewIfNeeded();
    await shot(page, "history-newest");
    pass(
      "HISTORY-02 approving from an older history page returns to the actual newest run; explicit customer cancellation releases its original hold with no model charge",
    );

    const previous = page.getByRole("button", {
      name: "Previous teams",
      exact: true,
    });
    if (await previous.isEnabled()) await previous.click();
    await page.getByRole("button", { name: "Next teams", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Team pages" })
      .getByRole("status")
      .filter({ hasText: "Page 2" })
      .waitFor();
    await page
      .getByRole("button", { name: "Create team", exact: true })
      .waitFor({ state: "visible" });
    for (let attemptIndex = 0; attemptIndex < 5; attemptIndex++) {
      await page
        .getByRole("button", { name: "Create team", exact: true })
        .click();
      const editor = page.getByRole("dialog", {
        name: "Create team",
        exact: true,
      });
      await editor
        .getByLabel("Team name", { exact: true })
        .fill("Saved outside the directory page " + (attemptIndex + 1));
      await editor
        .getByRole("combobox", { name: "Coordinator", exact: true })
        .selectOption(agents[0].id);
      await editor
        .getByRole("button", { name: "Add member", exact: true })
        .click();
      await editor
        .getByRole("combobox", { name: "Specialist", exact: true })
        .selectOption(agents[1].id);
      await editor
        .getByLabel("Responsibility", { exact: true })
        .fill("Prepare a clearly simulated delivery");
      const [response, directoryResponse] = await Promise.all([
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/v1/agent-groups" &&
            r.request().method() === "POST",
        ),
        page.waitForResponse(
          (r) =>
            new URL(r.url()).pathname === "/v1/agent-groups" &&
            r.request().method() === "GET" &&
            new URL(r.url()).searchParams.has("cursor"),
        ),
        editor.getByRole("button", { name: "Save team", exact: true }).click(),
      ]);
      const saved = await response.json();
      assert.equal(response.status(), 201);
      await page
        .getByRole("heading", { name: saved.name, exact: true })
        .waitFor();
      const boundary = new URL(directoryResponse.url()).searchParams.get(
        "cursor",
      );
      const actualPage = await call(
        page,
        "GET",
        `/v1/agent-groups?project_id=${project}&limit=100&cursor=${boundary}`,
        undefined,
        tenant,
      );
      result.created_teams.push(saved.id);
      if (actualPage.items.some((g: any) => g.id === saved.id)) continue;
      assert.equal(
        await page
          .getByRole("combobox", { name: "Project team", exact: true })
          .inputValue(),
        saved.id,
      );
      await page
        .getByRole("button", { name: "Refresh teams", exact: true })
        .click();
      await page
        .getByRole("heading", { name: saved.name, exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("combobox", { name: "Project team", exact: true })
          .inputValue(),
        saved.id,
      );
      result.saved_outside_page = {
        id: saved.id,
        directory_cursor: boundary,
        selected_after_refresh: true,
      };
      break;
    }
    assert.ok(
      result.saved_outside_page,
      "Exercise an actually saved team outside the current UUID directory page",
    );
    await page.locator(".team-directory").scrollIntoViewIfNeeded();
    await shot(page, "history-directory");
    pass(
      "HISTORY-03 actual directory pages traverse more than one hundred teams; saving outside the current page preserves a fresh selectable team through refresh",
    );
  } finally {
    media.push(await record.stop());
  }
  await target();
  let release!: () => void, hold!: () => void;
  const held = new Promise<void>((resolve) => {
      hold = resolve;
    }),
    released = new Promise<void>((resolve) => {
      release = resolve;
    });
  let used = false;
  const pattern = `**${url}/runs?*`;
  await page.route(pattern, async (route) => {
    if (used) return route.continue();
    used = true;
    const response = await route.fetch();
    hold();
    await released;
    await route.fulfill({ response });
  });
  try {
    await held;
    await page
      .getByRole("combobox", { name: "Current project", exact: true })
      .selectOption(secondProject.id);
    await page
      .getByRole("heading", {
        name: "Build a team for your next brief",
        exact: true,
      })
      .waitFor();
    release();
    await page.waitForResponse(
      (r) => new URL(r.url()).pathname === url + "/runs",
    );
    assert.equal(await page.locator(".team-run,.team-overview").count(), 0);
    assert.equal(
      await page
        .getByRole("combobox", { name: "Current project", exact: true })
        .inputValue(),
      secondProject.id,
    );
    result.project_switch_fenced = true;
    await shot(page, "history-project-scope");
  } finally {
    release();
    await page.unroute(pattern);
  }
  await page
    .getByRole("combobox", { name: "Current project", exact: true })
    .selectOption(project);
  await target();
  for (const width of [375, 800]) {
    await page.setViewportSize({ width, height: 980 });
    await page.locator(".team-directory").scrollIntoViewIfNeeded();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    );
    const button = page.getByRole("button", {
      name: "Create team",
      exact: true,
    });
    await button.focus();
    assert.ok(await button.evaluate((e) => e === document.activeElement));
    await shot(page, "history-responsive-" + width);
  }
  pass(
    "HISTORY-04 a held real history response cannot repopulate another project after a switch; paged controls remain keyboard accessible without horizontal overflow at 375px and 800px",
  );
  await page.setViewportSize({ width: 1440, height: 980 });
  // Preserve the original source-withdrawal/sign-out journey's Chinese context.
  await page.evaluate(() => localStorage.setItem("cp_locale", "zh"));
  await go(page, "http://localhost:4317/app/teams");
  await target();
  return result;
}
