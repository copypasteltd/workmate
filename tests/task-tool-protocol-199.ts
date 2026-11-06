/** A TASK_CONTROL_CHANGING response is emitted by authorization, before tool
 * admission, when NOWAIT collides with a heartbeat/control-row update. Keep the
 * original key and retry only this explicitly unadmitted result. Unknown
 * outcomes, pause requests and provider errors must never be retried here. */
export function withUnadmittedToolRetry<T extends { run: (...args: any[]) => Promise<any> }>(tool: T): T {
  return { ...tool, run: async (...args: Parameters<T["run"]>) => {
    for (let n = 0;; n++) {
      try { return await tool.run(...args); }
      catch (e) { if (n >= 7 || (e as any)?.code !== "TASK_CONTROL_CHANGING" || (e as any)?.status !== 409) throw e;
        await new Promise(resolve => setTimeout(resolve, 25)); }
    }
  } } as T;
}
