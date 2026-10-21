import type { Database, Tx } from "./db.js";
import { tokenCharge } from "./billing.js";
import {
  AIRequestFailure,
  type AIRequestInfo,
  type AIRequestOutcome,
  type AIRequestPermit,
} from "./internal-ai-gateway.js";

export interface ProviderAdmission {
  admitted: boolean;
  id?: string;
  execution_nonce?: string;
  reason?: string;
  retry_after_seconds?: number;
}

/** Called inside the actual original-actor authorization transaction. */
export async function admitProviderRequest(
  tx: Tx,
  kind: "task" | "validation",
  request: AIRequestInfo,
): Promise<ProviderAdmission> {
  return (
    await tx.query(
      "SELECT admit_ai_gateway_request($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result",
      [
        request.requestId,
        kind,
        request.taskId,
        request.capabilityVersionId ?? null,
        request.fencingToken ?? null,
        request.operation,
        request.model,
        request.requestHash,
        request.requestBytes,
      ],
    )
  ).rows[0].result;
}

function admissionFailure(reason?: string, retry?: number) {
  const duplicate = reason === "OPERATION_ALREADY_USED";
  const failure = new AIRequestFailure(
    duplicate
      ? "AI_REQUEST_OPERATION_ALREADY_USED"
      : "AI_REQUEST_" + (reason ?? "ADMISSION_DENIED"),
    duplicate ? 409 : 429,
    false,
  );
  if (retry && Number.isInteger(retry) && retry <= 60)
    failure.retryAfterSeconds = retry;
  return failure;
}

/** The closure retains the permit nonce; no client obtains a completion API. */
export function providerRequestPermit(
  db: Database,
  admitted: ProviderAdmission,
  scope: { tenantId?: string; actorId: string; control: boolean },
  authorize: (tx: Tx) => Promise<void>,
): AIRequestPermit {
  if (!admitted.admitted || !admitted.id || !admitted.execution_nonce)
    throw admissionFailure(admitted.reason, admitted.retry_after_seconds);
  const id = admitted.id,
    nonce = admitted.execution_nonce;

  const finish = async (outcome: AIRequestOutcome) => {
    await db.tx(
      async (tx) => {
        const row = (
          await tx.query(
            "SELECT * FROM ai_gateway_requests WHERE id=$1 AND execution_nonce=$2 FOR UPDATE",
            [id, nonce],
          )
        ).rows[0];
        if (!row)
          throw new AIRequestFailure("AI_REQUEST_PERMIT_LOST", 502, true);
        if (
          row.state === "completed" &&
          outcome.state === "completed" &&
          (Number(row.input_tokens) !== (outcome.inputTokens ?? 0) ||
            Number(row.output_tokens) !== (outcome.outputTokens ?? 0) ||
            Number(row.image_units) !== (outcome.imageUnits ?? 0))
        )
          throw new AIRequestFailure("AI_REQUEST_USAGE_CONFLICT", 502, true);
        if (["completed", "cancelled", "denied"].includes(row.state)) return;
        const beforeDispatch = row.state === "prepared";
        if (beforeDispatch && outcome.state === "completed")
          throw new AIRequestFailure("AI_REQUEST_USAGE_INVALID", 502, false);
        if (row.state === "unknown" && outcome.state === "unknown") return;
        const known = !beforeDispatch && outcome.state === "completed";
        const cancelled = beforeDispatch || outcome.state === "cancelled";
        const state = cancelled ? "cancelled" : known ? "completed" : "unknown";
        let input: number | null = cancelled ? 0 : null,
          output: number | null = cancelled ? 0 : null,
          images: number | null = cancelled ? 0 : null,
          charge: number | null = cancelled ? 0 : null;
        let numerator: string | null = cancelled ? "0" : null;
        if (known) {
          const rates: number[] = row.rate_snapshot;
          if (row.request_class === "text") {
            input =
              outcome.state === "completed"
                ? (outcome.inputTokens ?? null)
                : null;
            output =
              outcome.state === "completed"
                ? (outcome.outputTokens ?? null)
                : null;
            images = 0;
            if (
              !Number.isSafeInteger(input) ||
              !Number.isSafeInteger(output) ||
              input! < 0 ||
              output! < 0 ||
              rates.length !== 2 ||
              rates.some((n) => !Number.isSafeInteger(n) || n < 0)
            )
              throw new AIRequestFailure("AI_REQUEST_USAGE_INVALID", 502, true);
            charge = tokenCharge(input!, output!, rates[0], rates[1]);
            numerator = (
              BigInt(input!) * BigInt(rates[0]) +
              BigInt(output!) * BigInt(rates[1])
            ).toString();
          } else {
            if (
              outcome.imageUnits !== 1 ||
              rates.length !== 1 ||
              !Number.isSafeInteger(rates[0]) ||
              rates[0] < 0
            )
              throw new AIRequestFailure("AI_REQUEST_USAGE_INVALID", 502, true);
            input = output = 0;
            images = 1;
            charge = rates[0];
            numerator = (BigInt(rates[0]) * 1_000_000n).toString();
          }
        }
        const code = cancelled
          ? "CANCELLED_BEFORE_DISPATCH"
          : outcome.state === "unknown"
            ? outcome.code
            : null;
        if (code && !/^[A-Z0-9_]{1,100}$/.test(code))
          throw new AIRequestFailure("AI_REQUEST_OUTCOME_INVALID", 502, true);
        await tx.query(
          `UPDATE ai_gateway_requests SET state=$3,finished_at=clock_timestamp(),
          released_at=CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,usage_known=$4,
          input_tokens=$5,output_tokens=$6,image_units=$7,known_charge_micros=$8,
          http_status=$9,outcome_code=$10,charge_numerator=$11 WHERE id=$1 AND execution_nonce=$2`,
          [
            id,
            nonce,
            state,
            cancelled || known,
            input,
            output,
            images,
            charge,
            outcome.httpStatus ?? null,
            code,
            numerator,
          ],
        );
        await tx.query(
          "INSERT INTO ai_gateway_request_events(request_id,state,body) VALUES($1,$2,$3)",
          [
            id,
            state,
            {
              code,
              usage_known: cancelled || known,
              input_tokens: input,
              output_tokens: output,
              image_units: images,
              known_charge_micros: charge === null ? null : String(charge),
              charge_numerator: numerator,
              http_status: outcome.httpStatus ?? null,
            },
          ],
        );
      },
      undefined,
      true,
    );
  };
  return {
    async dispatch() {
      const result = await db.tx(
        async (tx) => {
          await authorize(tx);
          return (
            await tx.query(
              "SELECT dispatch_ai_gateway_request($1,$2) AS result",
              [id, nonce],
            )
          ).rows[0].result;
        },
        scope.tenantId,
        scope.control,
        scope.actorId,
      );
      if (!result.dispatched)
        throw admissionFailure(result.reason, result.retry_after_seconds);
    },
    finish,
  };
}
