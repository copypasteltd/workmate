import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import path from "node:path";

interface RuntimeContext {
  thread?: string;
  prompt: string;
  onEvent: (kind: string, body: unknown) => Promise<void>;
  tools: {
    name: string;
    run: (args: unknown, callId: string) => Promise<unknown>;
  }[];
}

// UI-only synthetic turn fixture. The separate Platform integration test runs
// actual Codex children against a controlled Responses API for paid resumption.
export async function createPaidInputUiFixture(
  system: any,
  call: any,
  tenant: string,
  project: string,
  base: string,
  user: string,
  title: string,
) {
  const platform = path.resolve(
    import.meta.dirname,
    "../../copypaste-platform",
  );
  const [{ Worker }, { CodexRuntimeAdapter }, { saveAsset }] =
    await Promise.all([
      import(pathToFileURL(path.join(platform, "src/worker.ts")).href),
      import(pathToFileURL(path.join(platform, "src/runtime.ts")).href),
      import(pathToFileURL(path.join(platform, "src/storage.ts")).href),
    ]);
  const inputName = "paid-approved-" + randomUUID() + ".txt";
  const file = await system.db.tx(
    (tx: any) =>
      saveAsset(tx, system.storage, {
        tenant,
        project,
        user,
        name: inputName,
        mime: "text/plain",
        bytes: Buffer.from("Approved native UI continuation input"),
        kind: "file",
      }),
    tenant,
    false,
    user,
  );
  const version = (
    await system.db.control.query(
      "SELECT id FROM asset_versions WHERE asset_id=$1",
      [file.id],
    )
  ).rows[0].id;
  const delegated = await call("POST", base + "/delegations", {
    title,
    prompt:
      "Use the approved input to complete the original paid UI fixture task.",
    mode: "execute",
    budget_micros: 1000000,
    client_message_id: randomUUID(),
  });
  class UiRuntime extends CodexRuntimeAdapter {
    constructor(config: any) {
      super(config);
    }
    calls = 0;
    thread = "controlled-ui-paid-" + randomUUID();
    async start(ctx: RuntimeContext) {
      const n = ++this.calls,
        turn = "controlled-ui-turn-" + n;
      if (n > 1) assert.equal(ctx.thread, this.thread);
      await ctx.onEvent("runtime.thread", { thread_id: this.thread });
      await ctx.onEvent("runtime.turn", { turn_id: turn });
      if (n === 1)
        await ctx.tools
          .find((t) => t.name === "request_input")!
          .run(
            {
              requests: [
                {
                  kind: "file",
                  description:
                    "Select the approved native UI continuation input",
                },
              ],
            },
            "ui-input",
          );
      else {
        assert.ok(ctx.prompt.includes(inputName));
        await ctx.tools
          .find((t) => t.name === "deliver_text")!
          .run(
            {
              filename: "paid-ui-complete.txt",
              mime_type: "text/plain",
              content: "Same-task native UI continuation fixture completed.",
            },
            "ui-complete",
          );
      }
      return {
        status: "completed",
        text:
          n === 1
            ? "Select the approved input to continue."
            : "Same-task UI fixture completed.",
        thread: this.thread,
        turn,
        inputTokens: 100,
        outputTokens: 50,
        usageKnown: true,
        accepted: true,
      };
    }
  }
  const runtime = new UiRuntime(system.db.config),
    load = async () =>
      (
        await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [
          delegated.task.id,
        ])
      ).rows[0];
  const run = () =>
    new Worker(system.db, system.catalog, system.storage, runtime).run(
      tenant,
      delegated.task.id,
    );
  await run();
  const waiting = await load();
  assert.equal(waiting.status, "needs_input");
  assert.equal(waiting.attempt, 1);
  assert.ok(Number(waiting.accrued_micros) > 0);
  assert.equal(Number(waiting.charged_micros), 0);
  return {
    task: waiting,
    file,
    version,
    runtime,
    load,
    run,
    async complete() {
      await run();
      const done = await load();
      assert.equal(done.status, "succeeded");
      assert.equal(done.id, waiting.id);
      assert.equal(done.runtime_thread, waiting.runtime_thread);
      assert.equal(done.attempt, 2);
      assert.equal(runtime.calls, 2);
      assert.equal(
        (
          await system.db.control.query(
            "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
            [done.id],
          )
        ).rows[0].n,
        1,
      );
      assert.equal(
        (
          await system.db.control.query(
            "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
            [done.id],
          )
        ).rows[0].n,
        1,
      );
      return done;
    },
  };
}
