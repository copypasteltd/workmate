import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireUser, audit } from "./auth.js";
import { key, replay } from "./access.js";
import { canonical, hash, Problem, seal, token, uuid } from "./lib.js";
import { event } from "./tasks.js";
import { desktopRuntime } from "./desktop-runtime.js";

export const desktopStartupProtocol = "desktop-startup-recovery-v1" as const;
export const desktopSessionBinding = z.object({
  device_id: uuid,
  local_session_id: uuid,
  workspace_hash: z.string().regex(/^[a-f0-9]{64}$/),
  runtime_version: z.literal(desktopRuntime.pinned_version),
  runtime_sha256: z.literal(desktopRuntime.windows_x64_sha256),
});
export const desktopStartBody = desktopSessionBinding.extend({
  startup_protocol: z.literal(desktopStartupProtocol).optional(),
}).strict();
const epoch = {
  startup_fencing_token: uuid,
  contract_sha256: z.string().regex(/^[a-f0-9]{64}$/),
};
const recoveryBody = desktopSessionBinding.extend({
  ...epoch,
  expected_attempt: z.literal(1),
  stage: z.enum(["initialize", "thread/start", "thread/resume"]),
}).strict();
const turnBody = desktopSessionBinding.extend(epoch).strict();
const executionParams = z.object({ tenant: uuid, project: uuid, execution: uuid });
const unavailable = (code = "DESKTOP_STARTUP_RECOVERY_UNAVAILABLE") =>
  new Problem(409, code, "This local startup cannot be replayed. Check its original task and permission.");

export function desktopStartupState(d: any, t: any) {
  if (!d.startup_protocol) return undefined;
  return {
    protocol: d.startup_protocol,
    attempt: d.startup_attempt,
    max_attempts: 2,
    state: d.startup_state,
    fencing_token: t.fencing_token,
    contract_sha256: d.startup_contract_sha256,
    deadline_at: d.startup_deadline_at,
  };
}

/** The HTTP credential lookup alone cannot fence an already queued request. */
export function assertDesktopStartupAuthority(d: any, t: any, fencing?: string) {
  if (fencing !== undefined && fencing !== t.fencing_token)
    throw unavailable("DESKTOP_STARTUP_EPOCH_CHANGED");
  if (d.startup_protocol && (fencing !== t.fencing_token || d.startup_state !== "turn_admitted"))
    throw unavailable("DESKTOP_TURN_NOT_ADMITTED");
}

interface RecoveryHooks {
  base: string;
  own(tx: Tx, request: FastifyRequest, write?: boolean, lock?: boolean): Promise<{ d: any; t: any }>;
  authorize(tx: Tx, d: any, t: any, active?: boolean): Promise<unknown>;
  receipt(tx: Tx, actor: Principal, d: any, t: any): Promise<any>;
  close(taskId: string): Promise<void>;
}

export function registerDesktopStartupRecovery(app: FastifyInstance, db: Database, hooks: RecoveryHooks) {
  function bindingMatches(d: any, body: z.infer<typeof desktopSessionBinding>) {
    if (d.device_id !== body.device_id || d.local_session_id !== body.local_session_id
      || d.workspace_hash !== body.workspace_hash || d.runtime_sha256 !== body.runtime_sha256)
      throw unavailable("DESKTOP_SESSION_BINDING_CHANGED");
  }
  function currentDeadline(d: any, t: any) {
    if (t.status !== "running" || t.cancel_requested || t.content_state !== "active"
      || !t.lease_until || new Date(t.lease_until).getTime() <= Date.now()
      || !d.startup_deadline_at || new Date(d.startup_deadline_at).getTime() <= Date.now())
      throw unavailable();
  }

  app.post(hooks.base + "/:execution/startup-recovery", { preHandler: requireUser(db) }, async request => {
    const p = executionParams.parse(request.params), body = recoveryBody.parse(request.body);
    const requestKey = key(request), requestHash = hash(canonical(body));
    // Commit the fence BEFORE waiting for network/process cleanup. Concurrent
    // callers serialize on the original parent/task/execution lock order.
    const prepared = await db.tx(async tx => {
      const { d, t } = await hooks.own(tx, request, true, true);
      bindingMatches(d, body);
      await hooks.authorize(tx, d, t, false);
      if (d.startup_protocol !== desktopStartupProtocol || d.startup_contract_sha256 !== body.contract_sha256)
        throw unavailable("DESKTOP_STARTUP_CONTRACT_CHANGED");
      currentDeadline(d, t);
      const prior = (await tx.query("SELECT * FROM desktop_startup_recoveries WHERE task_id=$1 FOR UPDATE", [t.id])).rows[0];
      if (prior) {
        if (prior.request_key !== requestKey || prior.request_sha256 !== requestHash
          || prior.source_fencing_token !== body.startup_fencing_token)
          throw unavailable("DESKTOP_STARTUP_RECOVERY_CONFLICT");
        if (prior.state === "denied") throw unavailable("DESKTOP_STARTUP_ADMISSION_EXISTS");
        if (prior.state === "ready") {
          if (d.state !== "running" || d.startup_attempt !== 2 || d.startup_state !== "preparing"
            || prior.target_fencing_token !== t.fencing_token)
            throw unavailable();
          return { ready: true, taskId: t.id };
        }
        if (d.state !== "recovering" || d.startup_attempt !== 1
          || prior.target_fencing_token !== t.fencing_token)
          throw unavailable();
        return { ready: false, taskId: t.id };
      }
      if (d.state !== "running" || d.startup_state !== "preparing" || d.startup_attempt !== 1
        || body.startup_fencing_token !== t.fencing_token || t.runtime_turn)
        throw unavailable();
      const nextFence = randomUUID();
      await tx.query("UPDATE tasks SET fencing_token=$2,version=version+1,updated_at=now() WHERE id=$1", [t.id, nextFence]);
      await tx.query("UPDATE desktop_executions SET state='recovering',credential_cipher=NULL,credential_hash=NULL,credential_expires_at=NULL WHERE task_id=$1", [t.id]);
      await tx.query(
        "INSERT INTO desktop_startup_recoveries(task_id,tenant_id,actor_id,request_key,request_sha256,source_fencing_token,target_fencing_token,state) VALUES($1,$2,$3,$4,$5,$6,$7,'fenced')",
        [t.id, t.tenant_id, t.created_by, requestKey, requestHash, t.fencing_token, nextFence],
      );
      await event(tx, t.tenant_id, t.id, "desktop.startup.recovery.fenced", { startup_attempt: 1, max_attempts: 2, stage: body.stage });
      return { ready: false, taskId: t.id };
    }, p.tenant);
    if (!prepared.ready) await hooks.close(prepared.taskId);

    const result = await db.tx(async tx => {
      const { d, t } = await hooks.own(tx, request, true, true);
      bindingMatches(d, body);
      await hooks.authorize(tx, d, t, false);
      currentDeadline(d, t);
      const saved = (await tx.query("SELECT * FROM desktop_startup_recoveries WHERE task_id=$1 FOR UPDATE", [t.id])).rows[0];
      if (!saved || saved.request_key !== requestKey || saved.request_sha256 !== requestHash
        || saved.target_fencing_token !== t.fencing_token)
        throw unavailable("DESKTOP_STARTUP_RECOVERY_CONFLICT");
      if (saved.state === "ready") {
        if (d.state !== "running" || d.startup_attempt !== 2 || d.startup_state !== "preparing")
          throw unavailable();
        return { receipt: await hooks.receipt(tx, request.principal, d, t) };
      }
      if (saved.state !== "fenced" || d.state !== "recovering" || d.startup_attempt !== 1)
        throw unavailable();
      const proof = (await tx.query("SELECT desktop_startup_admission_proof($1) AS proof", [t.id])).rows[0].proof;
      if (proof.safe !== true) {
        await tx.query("UPDATE desktop_executions SET state='stopping' WHERE task_id=$1", [t.id]);
        await tx.query("UPDATE desktop_startup_recoveries SET state='denied',proof=$2,finished_at=clock_timestamp() WHERE task_id=$1", [t.id, proof]);
        await event(tx, t.tenant_id, t.id, "desktop.startup.recovery.denied", { reason: "ADMISSION_EXISTS" });
        return { denied: true };
      }
      const secret = token();
      await tx.query(
        "UPDATE desktop_executions SET state='running',startup_attempt=2,credential_cipher=$2,credential_hash=$3,credential_expires_at=startup_deadline_at WHERE task_id=$1",
        [t.id, seal(db.config.MASTER_KEY!, secret), hash(secret)],
      );
      await tx.query("UPDATE tasks SET lease_until=now()+interval '45 seconds',version=version+1,updated_at=now() WHERE id=$1", [t.id]);
      await tx.query("UPDATE desktop_startup_recoveries SET state='ready',proof=$2,finished_at=clock_timestamp() WHERE task_id=$1", [t.id, proof]);
      await event(tx, t.tenant_id, t.id, "desktop.startup.recovery.ready", { startup_attempt: 2, max_attempts: 2, same_task_and_reservation: true });
      await audit(tx, request.principal, "desktop.startup.recover", t.id, "succeeded", { startup_attempt: 2, zero_admission: true }, t.tenant_id);
      const live = (await tx.query("SELECT * FROM desktop_executions WHERE task_id=$1", [t.id])).rows[0];
      const current = (await tx.query("SELECT * FROM tasks WHERE id=$1", [t.id])).rows[0];
      return { receipt: await hooks.receipt(tx, request.principal, live, current) };
    }, p.tenant);
    if ("denied" in result) throw unavailable("DESKTOP_STARTUP_ADMISSION_EXISTS");
    return result.receipt;
  });

  app.post(hooks.base + "/:execution/turn-admission", { preHandler: requireUser(db) }, async request => {
    const p = executionParams.parse(request.params), body = turnBody.parse(request.body), turnKey = key(request);
    return db.tx(async tx => {
      const { d, t } = await hooks.own(tx, request, true, true);
      bindingMatches(d, body);
      await hooks.authorize(tx, d, t);
      if (d.startup_protocol !== desktopStartupProtocol || d.startup_contract_sha256 !== body.contract_sha256
        || body.startup_fencing_token !== t.fencing_token)
        throw unavailable("DESKTOP_STARTUP_EPOCH_CHANGED");
      await replay(tx, request.principal.id, "desktop.turn:" + t.id, turnKey, body, async () => {
        if (d.startup_state !== "preparing" || !d.startup_contract_sha256)
          throw unavailable("DESKTOP_TURN_ALREADY_ADMITTED");
        await tx.query("UPDATE desktop_executions SET startup_state='turn_admitted',startup_turn_key=$2 WHERE task_id=$1", [t.id, turnKey]);
        await event(tx, t.tenant_id, t.id, "desktop.turn.admitted", { startup_attempt: d.startup_attempt });
        return { admitted: true };
      });
      if (d.startup_turn_key && d.startup_turn_key !== turnKey)
        throw unavailable("DESKTOP_TURN_ALREADY_ADMITTED");
      return { admitted: true, task_id: t.id, startup_fencing_token: t.fencing_token };
    }, p.tenant);
  });
}
