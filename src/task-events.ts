import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ServerResponse } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import type { Database } from "./db.js";
import { requireUser, principal } from "./auth.js";
import { projectAccess } from "./access.js";
import { Problem, uuid } from "./lib.js";

const cursor = z.coerce
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const states = new Set([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled",
  "waiting_approval",
  "needs_input",
  "waiting_device",
  "partially_succeeded",
]);
export function canonicalEvent(e: any) {
  let type = "task.progress",
    payload: Record<string, unknown> = { step_key: e.kind, completed: 1 };
  const b = e.body ?? {};
  if (
    e.kind === "task.queued" ||
    e.kind === "task.started" ||
    (e.kind === "task.finished" && states.has(b.status))
  ) {
    type = "task.state_changed";
    payload = {
      previous:
        e.kind === "task.queued"
          ? null
          : e.kind === "task.started"
            ? "queued"
            : "running",
      status:
        e.kind === "task.queued"
          ? "queued"
          : e.kind === "task.started"
            ? "running"
            : b.status,
    };
  } else if (e.kind === "task.cancelled") {
    type = "task.state_changed";
    payload = {
      previous: null,
      status: "cancelled",
      reason: "AUTHORIZATION_CHANGED",
    };
  } else if (e.kind === "task.paused" || e.kind === "task.resumed") {
    type = "task.state_changed";
    payload = { previous: b.previous, status: b.status };
  } else if (
    e.kind === "message.delta" &&
    typeof b.text === "string" &&
    b.text
  ) {
    type = "message.appended";
    payload = { message_id: e.event_id, text: b.text };
  } else if (e.kind === "artifact.ready") {
    type = e.kind;
    payload = {
      artifact_id: uuid.parse(b.artifact_id),
      asset_version_id: uuid.parse(b.asset_version_id),
    };
  } else if (e.kind === "usage.updated") {
    type = e.kind;
    payload = {
      currency: "HKD",
      amount_micros: String(b.amount_micros),
      cost_state: b.cost_state,
    };
  } else if (e.kind === "task.finished") {
    type = "task.warning";
    payload = {
      code: "RESULT_UNKNOWN",
      message:
        "Execution requires reconciliation; no uncertain operation will be replayed automatically.",
    };
  } else if (e.kind === "task.cancel_requested") {
    type = "task.warning";
    payload = {
      code: "CANCELLATION_REQUESTED",
      message:
        "Cancellation was requested. The final state and actual cost will follow.",
    };
  } else if (e.kind === "runtime.phase")
    payload = {
      step_key: "runtime." + String(b.phase),
      completed: ["finished", "closed"].includes(b.phase) ? 1 : 0,
    };
  const seq = cursor.parse(e.seq);
  if (!seq) throw new Error("EVENT_SEQUENCE_INVALID");
  return {
    event_id: e.event_id,
    tenant_id: e.tenant_id,
    task_id: e.task_id,
    attempt_id: e.attempt_id,
    seq,
    type,
    occurred_at: new Date(e.created_at).toISOString(),
    payload,
  };
}
export function registerTaskEvents(app: FastifyInstance, db: Database) {
  const streams = new Map<
    ServerResponse,
    { actor: string; cancel: AbortController }
  >();
  let closing = false;
  app.addHook("preClose", async () => {
    closing = true;
    for (const [res, s] of streams) {
      s.cancel.abort();
      res.end();
    }
  });
  const handler = async (req: FastifyRequest, reply: any) => {
    const p = req.params as any,
      tenant = uuid.parse(p.tenant ?? req.headers["x-tenant-id"]),
      task = uuid.parse(p.task ?? p.task_id);
    const supplied =
      req.headers["last-event-id"] ?? (req.query as any)?.after ?? 0;
    if (typeof supplied === "string" && !/^\d+$/.test(supplied))
      throw new Problem(
        400,
        "EVENT_CURSOR_INVALID",
        "Event cursor must be a nonnegative integer",
      );
    let after = cursor.parse(supplied);
    const load = async () => {
      const actor = await principal(db, req);
      return db.tx(
        async (tx) => {
          // Locate project through the restricted task policy, then recheck
          // membership and private ownership for every emitted batch.
          await tx.query("SELECT set_config('app.actor_id',$1,true)", [
            actor.id,
          ]);
          const t = (
            await tx.query(
              "SELECT project_id,last_event_seq FROM tasks WHERE id=$1",
              [task],
            )
          ).rows[0];
          if (!t || (p.project && p.project !== t.project_id))
            throw new Problem(404, "NOT_FOUND", "Task not found");
          await projectAccess(tx, actor, tenant, t.project_id);
          // Control query only returns the watermark for an already-authorized task.
          const watermark = (
            await db.control.query(
              "SELECT pruned_through FROM task_event_retention WHERE task_id=$1",
              [task],
            )
          ).rows[0]?.pruned_through;
          if (watermark && after < Number(watermark))
            throw new Problem(
              410,
              "EVENT_CURSOR_EXPIRED",
              "Refresh the task snapshot and reconnect using last_event_seq",
            );
          if (after > Number(t.last_event_seq))
            throw new Problem(
              409,
              "EVENT_CURSOR_AHEAD",
              "Event cursor is ahead of this task",
            );
          return (
            await tx.query(
              "SELECT * FROM task_events WHERE task_id=$1 AND seq>$2 ORDER BY seq LIMIT 100",
              [task, after],
            )
          ).rows.map(canonicalEvent);
        },
        tenant,
        false,
        actor.id,
      );
    };
    let batch = await load();
    if (closing)
      throw new Problem(503, "SERVICE_STOPPING", "Server is restarting");
    if (
      streams.size >= 128 ||
      [...streams.values()].filter((s) => s.actor === req.principal.id)
        .length >= 6
    )
      throw new Problem(
        429,
        "EVENT_STREAM_LIMIT",
        "Close unused task streams before opening more",
      );
    const cancel = new AbortController(),
      res = reply.raw as ServerResponse;
    streams.set(res, { actor: req.principal.id, cancel });
    const close = () => cancel.abort();
    res.once("close", close);
    res.once("error", close);
    const deadline = setTimeout(close, 30_000);
    const send = async (text: string) => {
      if (cancel.signal.aborted) return;
      if (!res.write(text))
        await new Promise<void>((resolve) => {
          const done = () => {
            res.off("drain", done);
            cancel.signal.removeEventListener("abort", done);
            resolve();
          };
          res.once("drain", done);
          cancel.signal.addEventListener("abort", done, { once: true });
          if (cancel.signal.aborted) done();
        });
    };
    reply.hijack();
    res.writeHead(200, {
      ...reply.getHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    });
    try {
      await send(": connected\nretry: 1500\n\n");
      let heartbeat = Date.now();
      while (!cancel.signal.aborted) {
        for (const e of batch) {
          if (cancel.signal.aborted) break;
          await send(
            `id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`,
          );
          after = e.seq;
        }
        if (Date.now() - heartbeat >= 10_000) {
          await send(": heartbeat\n\n");
          heartbeat = Date.now();
        }
        await delay(batch.length === 100 ? 0 : 750, undefined, {
          signal: cancel.signal,
        });
        batch = await load();
      }
    } catch (e) {
      if (!cancel.signal.aborted)
        await send(
          `event: stream.reset\ndata: ${JSON.stringify({ code: e instanceof Problem ? e.code : "STREAM_UNAVAILABLE" })}\n\n`,
        );
    } finally {
      clearTimeout(deadline);
      cancel.abort();
      res.off("close", close);
      res.off("error", close);
      res.end();
      streams.delete(res);
    }
  };
  app.get(
    "/v1/tasks/:task_id/events",
    { preHandler: requireUser(db) },
    handler,
  );
  app.get(
    "/v1/tenants/:tenant/projects/:project/tasks/:task/events/stream",
    { preHandler: requireUser(db) },
    handler,
  );
}
