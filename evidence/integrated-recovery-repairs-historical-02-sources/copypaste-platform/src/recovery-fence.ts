import type { Database } from "./db.js";

/** A restored archive is never an instruction to resume work or paid effects. */
export async function assertLiveEnvironment(db: Database) {
  const schema = await db.app.query("SELECT to_regclass('public.recovery_environment') AS fence");
  if (!schema.rows[0]?.fence)
    throw new Error("SCHEMA_UPGRADE_REQUIRED: run the owner database migrations before starting client services or workers");
  const { rows } = await db.app.query(
    `SELECT e.state,shobj_description(d.oid,'pg_database') AS marker
       FROM recovery_environment e JOIN pg_database d ON d.datname=current_database()
      WHERE e.singleton`,
  );
  if (rows.length !== 1 || rows[0].state !== "live" ||
      String(rows[0].marker ?? "").startsWith("copypaste:recovery:"))
    throw new Error("RECOVERY_QUARANTINED: restored environments cannot serve clients or execute work");
}
