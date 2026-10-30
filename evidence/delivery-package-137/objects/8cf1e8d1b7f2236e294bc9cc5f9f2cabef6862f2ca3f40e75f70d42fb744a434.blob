import { randomUUID } from "node:crypto";

/** Synthetic company receipts only; native/API qualification uses real SQL. */
export function startupFixture(task: any) {
  task.startup ??= {
    protocol: "desktop-startup-recovery-v1", attempt: 1, max_attempts: 2,
    state: "preparing", fencing_token: randomUUID(), contract_sha256: "a".repeat(64),
    deadline_at: new Date(Date.now() + 300000).toISOString(),
  };
  return { ...task, credential: { token: "ONLY_THE_TRUSTED_NATIVE_RUNTIME_CAN_RECEIVE_THIS_TOKEN", expires_at: task.startup.deadline_at } };
}
export function startupTurnFixture(task: any, body: any) {
  if (body.startup_fencing_token !== task.startup.fencing_token || body.contract_sha256 !== task.startup.contract_sha256)
    throw new Error("Wrong synthetic startup binding");
  task.startup.state = "turn_admitted";
  return { status: 200, body: { admitted: true, task_id: task.task_id, startup_fencing_token: task.startup.fencing_token } };
}
