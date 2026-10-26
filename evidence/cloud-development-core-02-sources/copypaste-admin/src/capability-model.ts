import { parseHKD } from "./financial-money";

export type CapabilityDocument = {
  kernel: "codex";
  gateway_policy: "company_internal_only";
  model_alias: string;
} & (
  | {
      profile_key: "internal-text-v1";
      reasoning_effort: "low" | "medium" | "high" | "xhigh" | "max";
      rates: [number, number];
    }
  | {
      profile_key: "internal-image2-v1" | "internal-video-v1";
      reasoning_effort: null;
      rates: [number];
    }
);
export type CapabilityRelease = {
  id: string;
  profile_key: CapabilityDocument["profile_key"];
  data_mode: "simulated" | "configured_services";
  version: number;
  document: CapabilityDocument;
  definition_hash: string;
  runtime_profile_id: string;
  created_at: string;
  state: "published" | "superseded" | "validated" | "rejected" | "draft";
  validation_id: string | null;
  validation_state: string | null;
  validation_expires_at: string | null;
  validation_error_codes: string[];
  head_revision: number;
  current_publication_id: string | null;
};
export type WorkspacePurge = {
  validation_id: string;
  state: "queued" | "completed" | "failed";
  version: number;
  attempts: number;
  next_attempt_at: string;
  completed_at: string | null;
  error_code: string | null;
};
export type CapabilityValidation = {
  id: string;
  release_id: string;
  state: "running" | "passed" | "failed" | "reconciling" | "cancelled";
  capability_version_id: string | null;
  created_at: string;
  finished_at: string | null;
  expires_at: string | null;
  result: {
    usage_known?: boolean;
    accepted?: boolean;
    input_tokens?: number;
    output_tokens?: number;
    known_cost_micros?: string;
    error_code?: string;
    checks?: string[];
    codex_version?: string;
    codex_binary_sha256?: string;
    workspace_cleanup_completed?: boolean;
    workspace_cleanup_error_code?: string;
  };
  workspace_cleanup: WorkspacePurge | null;
  video_suite?: {
    plan_hash: string; total_cases: number; verified_cases: number; quoted_micros: string;
    known_cost_micros: string; usage_known: boolean; cancel_requested: boolean; deadline_at: string; error_code: string | null;
    cases: { id: string; ordinal: number; operation_id: string; state: string; size: string; seconds: number;
      progress: number | null; usage_known: boolean; actual_micros: string | null; verified: boolean; error_code: string | null;
      operations: string[]; media: { fully_decoded: boolean; sha256: string; bytes: number; width: number; height: number; duration_seconds: number } | null }[];
  } | null;
};
type ComparedRelease = Pick<CapabilityRelease, "version" | "document"> & {
  release_id: string;
};
export type CapabilityComparison = {
  profile_key: CapabilityDocument["profile_key"];
  data_mode: CapabilityRelease["data_mode"];
  head_revision: number;
  publication_id: string | null;
  current: ComparedRelease | null;
  proposed: ComparedRelease & {
    validation_id: string;
    capability_version_id: string;
  };
};
export type CapabilityPreview = {
  preview_id: string;
  payload_hash: string;
  before: CapabilityComparison;
  expires_at: string;
  decision: "independent_approval";
  creates_business_effect: false;
};
export type CapabilityAccess = {
  me: { user: { id: string } };
  has: (permission: string) => boolean;
};
export const capabilityRoot = "/v1/admin/capability-releases";

export function rateInput(micros: number) {
  const amount = BigInt(micros);
  return `${amount / 1000000n}.${(amount % 1000000n).toString().padStart(6, "0")}`;
}
function rate(value: FormDataEntryValue | null, allowZero: boolean) {
  const micros = BigInt(parseHKD(String(value ?? ""), allowZero));
  if (micros > 1000000000000n)
    throw new Error(
      "每單位費率最高為 HK$1,000,000 / Maximum rate is HK$1,000,000 per unit",
    );
  // The API's bounded integer is exact in JavaScript; billing itself uses bigint.
  return Number(micros);
}
export function capabilityDraft(form: FormData) {
  const profile = form.get("profile"),
    model = String(form.get("model") ?? "").trim(),
    reason = String(form.get("reason") ?? "").trim();
  if (!model || model.length > 200 || reason.length < 3 || reason.length > 1000)
    throw new Error(
      "請填寫模型別名及操作原因 / Enter a model alias and an operation reason",
    );
  const common = {
    kernel: "codex" as const,
    gateway_policy: "company_internal_only" as const,
    model_alias: model,
  };
  let document: CapabilityDocument;
  if (profile === "internal-text-v1") {
    const effort = form.get("effort");
    if (!["low", "medium", "high", "xhigh", "max"].includes(String(effort)))
      throw new Error("請選擇推理強度 / Choose a reasoning effort");
    document = {
      ...common,
      profile_key: profile,
      reasoning_effort: effort as "low" | "medium" | "high" | "xhigh" | "max",
      rates: [
        rate(form.get("input_rate"), true),
        rate(form.get("output_rate"), true),
      ],
    };
  } else if (profile === "internal-image2-v1" || profile === "internal-video-v1") {
    document = {
      ...common,
      profile_key: profile,
      reasoning_effort: null,
      rates: [rate(form.get(profile === "internal-video-v1" ? "video_rate" : "image_rate"), false)],
    };
  } else throw new Error("請選擇支援的能力 / Choose a supported capability");
  return { document, reason };
}
