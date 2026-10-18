import pg from "pg";
import type { Config } from "./config.js";
export type Tx = pg.PoolClient;
export class Database {
  readonly app: pg.Pool;
  readonly control: pg.Pool;
  readonly queue: pg.Pool;
  constructor(public config: Config) {
    this.app = new pg.Pool({ connectionString: config.DATABASE_URL, max: 12 });
    this.control = new pg.Pool({
      connectionString: config.CONTROL_DATABASE_URL,
      max: 6,
    });
    this.queue = new pg.Pool({
      connectionString: config.QUEUE_DATABASE_URL,
      max: 4,
    });
    for (const p of [this.app, this.control, this.queue])
      p.on("error", () => {
        /* Health endpoint reports DB readiness without leaking DSNs. */
      });
  }
  async tx<T>(
    f: (tx: Tx) => Promise<T>,
    tenant?: string,
    control = false,
    actor?: string,
  ): Promise<T> {
    const c = await (control ? this.control : this.app).connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.tenant_id',$1,true)", [
        tenant ?? "",
      ]);
      await c.query("SELECT set_config('app.actor_id',$1,true)", [actor ?? ""]);
      await c.query("SELECT set_config('app.task_id','',true)");
      await c.query("SELECT set_config('app.erasing_content','false',true)");
      const result = await f(c);
      await c.query("COMMIT");
      return result;
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async close() {
    await Promise.all([this.app.end(), this.control.end(), this.queue.end()]);
  }
}
