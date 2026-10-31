import type { Database } from "./db.js";

// A release must intentionally advance this value with its forward migration.
// The source-history test checks the complete sequence, including missing rows.
export const requiredSchemaVersion = 140;

export async function assertCurrentSchema(db: Database) {
  const relations = (
    await db.control.query(
      "SELECT to_regclass('public.schema_migrations') AS history,to_regclass('public.recovery_environment') AS fence",
    )
  ).rows[0];
  if (!relations?.history || !relations.fence)
    throw new Error(
      "SCHEMA_UPGRADE_REQUIRED: run the owner database migrations before starting client services or workers",
    );
  const version = (
    await db.control.query(
      "SELECT count(*)::integer AS n,min(version) AS first,max(version) AS last FROM schema_migrations",
    )
  ).rows[0];
  if (version.last > requiredSchemaVersion)
    throw new Error(
      "SCHEMA_VERSION_UNSUPPORTED: install the API release matching this newer database before starting client services or workers",
    );
  if (
    version.n !== requiredSchemaVersion ||
    version.first !== 1 ||
    version.last !== requiredSchemaVersion
  )
    throw new Error(
      "SCHEMA_UPGRADE_REQUIRED: apply the complete owner migration history before starting client services or workers",
    );
}
