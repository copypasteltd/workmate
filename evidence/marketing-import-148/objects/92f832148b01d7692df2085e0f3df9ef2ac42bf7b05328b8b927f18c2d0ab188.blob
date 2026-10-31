import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database } from "./db.js";
import type { Storage } from "./storage.js";
import { audit, requireUser } from "./auth.js";
import { projectAccess, key, replay } from "./access.js";
import { Problem, uuid, name } from "./lib.js";
import { importOptions } from "./analytics-import.js";
import { campaignFile, normalizeCampaignFile } from "./analytics-file.js";
import { campaignSource } from "./analytics-sources.js";
import { persistCampaignSnapshot } from "./analytics.js";
export const campaignSelectionFields = {
  sheet_name: z.string().min(1).max(100).optional(),
  header_row: z.number().int().min(1).max(100).default(1),
  csv_delimiter: z.enum(["comma", "semicolon", "tab"]).optional(),
  csv_encoding: z.enum(["utf8", "utf16le", "utf16be"]).optional(),
};
const selection = z
  .object({
    asset_version_id: uuid,
    ...campaignSelectionFields,
  })
  .strict();
const fields = {
  name: name.optional(),
  entity_level: z
    .enum(["dataset", "campaign", "adset", "ad"])
    .default("campaign"),
  conversion_definition: z.string().trim().min(1).max(1000).optional(),
  ...campaignSelectionFields,
  number_format: importOptions.shape.number_format,
  date_format: importOptions.shape.date_format,
  supersedes_id: uuid.optional(),
};
const canonicalInput = z
  .object({
    project_id: uuid,
    asset_version_id: uuid,
    source: z.enum(["google_ads", "meta_ads"]),
    account_id: z.string().trim().min(1).max(200),
    timezone: z.string().min(1).max(100),
    currency: z.string().regex(/^[A-Z]{3}$/),
    mapping: importOptions.shape.mapping,
    attribution_definition: z.string().trim().min(1).max(1000),
    ...fields,
  })
  .strict();
const nestedInput = importOptions
  .omit({ source_filename: true })
  .extend({ ...fields, name, asset_version_id: uuid })
  .strict();
const snapshot = (d: any) => ({
  id: d.id,
  project_id: d.project_id,
  source: d.source,
  state: "complete",
  row_count: d.row_count,
  data_as_of: null,
  spec_hash: d.spec_hash,
});
export function registerFileImports(
  app: FastifyInstance,
  db: Database,
  storage: Storage,
) {
  const base = "/v1/tenants/:tenant/projects/:project/analytics",
    params = z.object({ tenant: uuid, project: uuid });
  app.post(
    base + "/file-inspect",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params),
        b = selection.parse(req.body);
      return db.tx(
        async (tx) => {
          await projectAccess(tx, req.principal, tenant, project, "write");
          const source = await campaignSource(
              tx,
              storage,
              project,
              b.asset_version_id,
            ),
            {
              csv: _csv,
              locations: _locations,
              canonical_cells: _canonicalCells,
              ...info
            } = campaignFile(source.bytes, source.name, b);
          return {
            ...info,
            asset_version_id: source.id,
            filename: source.name,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  app.post(
    base + "/file-preview",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params),
        b = nestedInput.parse(req.body);
      return db.tx(
        async (tx) => {
          await projectAccess(tx, req.principal, tenant, project, "write");
          const source = await campaignSource(
            tx,
            storage,
            project,
            b.asset_version_id,
          );
          const {
            name: _name,
            asset_version_id: _id,
            sheet_name,
            header_row,
            csv_delimiter,
            csv_encoding,
            supersedes_id,
            ...options
          } = b;
          const {
            rows,
            raw_csv: _raw,
            ...data
          } = normalizeCampaignFile(
            source.bytes,
            source.name,
            {
              ...options,
              conversion_definition:
                options.conversion_definition ?? "not_provided",
            },
            {
              sheet_name,
              header_row,
              csv_delimiter,
              csv_encoding,
            },
          );
          if (
            !options.conversion_definition &&
            !data.warning_codes.includes("missing_definitions")
          ) {
            data.warnings.push(
              "Conversion definition is unspecified; keep platform conversion results separate.",
            );
            data.warning_codes.push("missing_definitions");
          }
          const existing = (
            await tx.query(
              "SELECT id FROM analytics_datasets WHERE project_id=$1 AND import_key=$2",
              [project, data.import_key],
            )
          ).rows[0];
          return {
            ...data,
            sample: rows.slice(0, 5),
            asset_version_id: source.id,
            supersedes_id: supersedes_id ?? null,
            existing_dataset_id: existing?.id ?? null,
          };
        },
        tenant,
        false,
        req.principal.id,
      );
    },
  );
  const create = async (req: any, canonical: boolean) => {
    const parsed = canonical
      ? canonicalInput.parse(req.body)
      : {
          ...nestedInput.parse(req.body),
          project_id: uuid.parse(req.params.project),
        };
    const tenant = uuid.parse(
        canonical ? req.headers["x-tenant-id"] : req.params.tenant,
      ),
      project = parsed.project_id;
    return db.tx(
      async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        // Reauthorize original source even on idempotent replay, never return a
        // stale saved response after source quarantine or project revocation.
        const source = await campaignSource(
          tx,
          storage,
          project,
          parsed.asset_version_id,
        );
        const saved = await replay(
          tx,
          req.principal.id,
          "analytics.file.import",
          key(req),
          { tenant, ...parsed },
          async () => {
            const {
              project_id: _p,
              name: label,
              asset_version_id: _id,
              sheet_name,
              header_row,
              csv_delimiter,
              csv_encoding,
              supersedes_id,
              ...options
            } = parsed;
            const data = normalizeCampaignFile(
              source.bytes,
              source.name,
              {
                ...options,
                conversion_definition:
                  options.conversion_definition ?? "not_provided",
              },
              { sheet_name, header_row, csv_delimiter, csv_encoding },
            );
            if (
              !options.conversion_definition &&
              !data.warning_codes.includes("missing_definitions")
            ) {
              data.warnings.push(
                "Conversion definition is unspecified; keep platform conversion results separate.",
              );
              data.warning_codes.push("missing_definitions");
            }
            const d = await persistCampaignSnapshot(tx, {
              tenant,
              project,
              user: req.principal.id,
              name: label ?? source.name,
              data,
              rawCsv: data.raw_csv,
              sourceVersion: source.id,
              supersedes: supersedes_id,
            });
            await audit(
              tx,
              req.principal,
              "analytics.file.import",
              d.id,
              "succeeded",
              {
                source_asset_version_id: source.id,
                supersedes_id: supersedes_id ?? null,
                source_sha256: data.source_sha256,
                spec_hash: data.spec_hash,
              },
              tenant,
            );
            return { id: d.id };
          },
        );
        const d = (
          await tx.query(
            "SELECT *,jsonb_array_length(rows) AS row_count FROM analytics_datasets WHERE id=$1 AND project_id=$2",
            [saved.id, project],
          )
        ).rows[0];
        if (!d)
          throw new Problem(
            404,
            "NOT_FOUND",
            "The imported snapshot is unavailable",
          );
        return snapshot(d);
      },
      tenant,
      false,
      req.principal.id,
    );
  };
  app.post(
    "/v1/dataset-imports",
    { preHandler: requireUser(db) },
    async (req, reply) => reply.code(202).send(await create(req, true)),
  );
  app.post(
    base + "/file-import",
    { preHandler: requireUser(db) },
    async (req, reply) => reply.code(202).send(await create(req, false)),
  );
}
