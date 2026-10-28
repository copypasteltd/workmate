import { Database } from "../../src/db.js";
import { loadConfig } from "../../src/config.js";
import { admitProviderRequest } from "../../src/provider-request-control.js";

process.once("message", async (message: any) => {
  const db = new Database(loadConfig(message.env));
  try {
    const result = await db.tx(
      async (tx) => {
        await tx.query("SELECT set_config('app.task_id',$1,true)", [
          message.request.taskId,
        ]);
        return admitProviderRequest(tx, "task", message.request);
      },
      message.request.tenantId,
      false,
      message.request.actorId,
    );
    process.send?.({
      admitted: result.admitted,
      reason: result.reason ?? null,
    });
  } catch (error: any) {
    process.send?.({
      failed: true,
      code: error.code ?? "CHILD_ADMISSION_FAILED",
    });
  } finally {
    await db.close();
    process.disconnect?.();
  }
});
process.send?.({ ready: true });
