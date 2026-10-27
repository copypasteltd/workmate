import { z } from "zod";
import type { Config } from "./config.js";
import type { ConnectorCredential } from "./connector-model.js";
import { connectorJSON, ConnectorFailure } from "./connector-http.js";
import { connectorSettings } from "./connector-provider.js";
import { Problem } from "./lib.js";
import {
  budgetDigest,
  budgetMicros,
  budgetProtocol,
  budgetRequest,
  googleBudgetSnapshot,
  googleIdentifier,
  type GoogleBudgetSnapshot,
} from "./external-budget-model.js";

export type BudgetConnection = {
  credential: ConnectorCredential;
  account_id: string;
  login_customer_id: string | null;
};
const headers = (config: Config, connection: BudgetConnection) => ({
  authorization: `Bearer ${connection.credential.access_token}`,
  "content-type": "application/json",
  "developer-token": connectorSettings(config, "google_ads").developerToken!,
  ...(connection.login_customer_id
    ? { "login-customer-id": connection.login_customer_id }
    : {}),
});
function endpoint(
  config: Config,
  connection: BudgetConnection,
  method: string,
) {
  googleIdentifier.parse(connection.account_id);
  const setup = connectorSettings(config, "google_ads");
  if (!setup.available || !/^v[1-9][0-9]{0,3}$/.test(setup.version ?? ""))
    throw new Problem(
      503,
      "BUDGET_PROVIDER_UNAVAILABLE",
      "The Google Ads API version is not configured",
    );
  return `https://googleads.googleapis.com/${setup.version}/customers/${connection.account_id}/${method}`;
}
const nonnegativeInteger = z
  .union([z.string().regex(/^\d+$/), z.number().int().nonnegative().safe()])
  .transform((value) => String(value));
const budgetRow = z.object({
  customer: z.object({ currencyCode: z.string().regex(/^[A-Z]{3}$/) }),
  campaignBudget: z.object({
    resourceName: z.string(),
    id: nonnegativeInteger,
    name: z.string(),
    amountMicros: nonnegativeInteger,
    period: z.string(),
    explicitlyShared: z.boolean().default(false),
    referenceCount: nonnegativeInteger.default("0"),
    status: z.string(),
    type: z.string(),
  }),
});

/** One fixed-resource GAQL read. No supplied URL or free-form query is accepted. */
export async function readGoogleBudget(
  config: Config,
  connection: BudgetConnection,
  budget: string,
) {
  googleIdentifier.parse(budget);
  const query = `SELECT customer.currency_code, campaign_budget.resource_name, campaign_budget.id, campaign_budget.name, campaign_budget.amount_micros, campaign_budget.period, campaign_budget.explicitly_shared, campaign_budget.reference_count, campaign_budget.status, campaign_budget.type FROM campaign_budget WHERE campaign_budget.id = ${budget}`;
  const response = await connectorJSON(
    config,
    endpoint(config, connection, "googleAds:search"),
    {
      method: "POST",
      headers: headers(config, connection),
      body: JSON.stringify({ query }),
    },
  );
  const decoded = z.array(budgetRow).length(1).safeParse(response.body.results);
  if (!decoded.success)
    throw new Problem(
      502,
      "BUDGET_PROVIDER_SCHEMA",
      "The provider returned invalid budget data",
    );
  const results = decoded.data;
  if (response.body.nextPageToken)
    throw new Problem(
      409,
      "BUDGET_SOURCE_AMBIGUOUS",
      "The provider returned ambiguous budget data",
    );
  const row = results[0];
  const checked = googleBudgetSnapshot.safeParse({
    protocol: budgetProtocol,
    account_id: connection.account_id,
    budget_id: row.campaignBudget.id,
    resource_name: row.campaignBudget.resourceName,
    name: row.campaignBudget.name,
    currency: row.customer.currencyCode,
    amount_micros: row.campaignBudget.amountMicros,
    period: row.campaignBudget.period,
    explicitly_shared: row.campaignBudget.explicitlyShared,
    reference_count: Number(row.campaignBudget.referenceCount),
    status: row.campaignBudget.status,
    type: row.campaignBudget.type,
  });
  if (!checked.success)
    throw new Problem(
      409,
      "BUDGET_UNSUPPORTED_SOURCE",
      "Only enabled, non-shared standard average daily budgets with at most one campaign are supported",
    );
  const snapshot = checked.data;
  if (snapshot.budget_id !== budget)
    throw new Problem(
      409,
      "BUDGET_SOURCE_MISMATCH",
      "The provider returned a different budget",
    );
  return snapshot;
}

export class BudgetRejected extends Problem {}

/** Exactly one physical mutate call. Transport failures are not retried here. */
export async function writeGoogleBudget(
  config: Config,
  connection: BudgetConnection,
  before: GoogleBudgetSnapshot,
  desired: string,
) {
  const request = budgetRequest(before, desired);
  let response;
  try {
    response = await connectorJSON(
      config,
      endpoint(config, connection, "campaignBudgets:mutate"),
      {
        method: "POST",
        headers: headers(config, connection),
        body: JSON.stringify(request),
      },
    );
  } catch (error) {
    if (
      error instanceof ConnectorFailure &&
      [
        "CONNECTOR_AUTH_EXPIRED",
        "CONNECTOR_PERMISSION_DENIED",
        "CONNECTOR_PROVIDER_REJECTED",
      ].includes(error.code)
    )
      throw new BudgetRejected(
        409,
        error.code,
        "The provider rejected the atomic budget mutation",
      );
    throw error;
  }
  const result = z.object({
    resourceName: z.literal(before.resource_name),
    campaignBudget: z.object({
      resourceName: z.literal(before.resource_name),
      amountMicros: budgetMicros,
    }),
  });
  const parsed = z.array(result).length(1).safeParse(response.body.results);
  if (
    !parsed.success ||
    response.body.partialFailureError ||
    parsed.data[0].campaignBudget.amountMicros !== desired
  )
    throw new Problem(
      502,
      "BUDGET_RECEIPT_UNVERIFIED",
      "The returned mutation receipt does not confirm the exact requested budget",
    );
  return {
    protocol: budgetProtocol,
    resource_name: before.resource_name,
    amount_micros: desired,
    request_sha256: budgetDigest(request),
    response_sha256: response.sha256,
    response_bytes: response.bytes,
    result: parsed.data[0],
    attribution: "provider_mutation_receipt",
  };
}
