import type { CapabilityValidation } from "./capability-model";

/** Text retries are separate budgeted validations. Retrying must never erase
 * an earlier uncertain request or release its retained accounting hold. */
export function validationBlocksRetry(value: CapabilityValidation | null | undefined, fallbackState?: string | null) {
  const state = value?.state ?? fallbackState;
  if (state === "running") return true;
  if (state !== "reconciling") return false;
  if (value?.audio_suite) return !value.audio_suite.accounting.resolved || value.audio_suite.accounting.allocation_exceeded;
  if (value?.video_suite) return !value.video_suite.usage_known;
  return false;
}

export const validationErrorMessages: Record<string, [string, string]> = {
  AI_REQUEST_BUDGET_VIOLATION: ["上游的實際用量超出預留邊界或與舊版精確計數不符。已保留實際費用及對帳記錄，請檢查預留額度與用量。", "Actual upstream usage exceeded a reserved bound or differed from legacy exact counting. Actual charges and reconciliation records are retained; check allocation and measured usage."],
  AI_REQUEST_ACTOR_CAPACITY: ["此管理員的模型請求名額已滿，可能有未完成或待對帳的舊請求。請在模型請求管理中核對名額與對帳記錄。", "This administrator's model-request capacity is full, possibly due to active or earlier uncertain requests. Check request capacity and reconciliation in provider controls."],
  AI_REQUEST_VERIFICATION_CAPACITY: ["平台驗證名額已滿。請在模型請求管理中核對執行中與待對帳的驗證。", "Platform verification capacity is full. Check active and uncertain validations in provider controls."],
  AI_TOOL_CALL_NOT_ALLOWED: ["模型回傳的工具呼叫與本次 Codex 工具協議不符。請檢查服務端工具適配後重新驗證。", "The returned tool call does not match this Codex tool contract. Check the server tool adapter, then validate again."],
  AI_TOOL_NOT_ALLOWED: ["Codex 宣告的工具與此任務註冊的工具不一致，請檢查服務端工具適配。", "Codex tool declarations do not match the task's registered tools. Check the server tool adapter."],
  AI_RESPONSE_PROTOCOL_INVALID: ["上游回應不符合 Responses 串流協議，請檢查此模型的上游相容性。", "The upstream response does not follow the Responses streaming protocol. Check this model's upstream compatibility."],
  AI_STREAM_INCOMPLETE: ["模型回應中途斷開，未取得完整回執。已送出的請求仍會保留待對帳記錄。", "The model stream ended before a complete receipt arrived. Dispatched requests retain their reconciliation records."],
  CODEX_TURN_FAILED: ["Codex 未完成本次執行，請檢查模型回應及服務端執行記錄。", "Codex did not finish this turn. Check the model response and server runtime records."],
  CAPABILITY_TOOL_RECEIPT_MISSING: ["模型未完成一次有效的工具呼叫及結果接收，因此尚未通過完整 Agent 驗證。", "The model did not complete exactly one valid tool call and result round trip, so full agent verification has not passed."],
  CAPABILITY_OUTPUT_MISSING: ["Codex 沒有返回完成的文字結果。", "Codex did not return a completed text response."],
  CAPABILITY_VERIFICATION_FAILED: ["完整 Codex 驗證未完成。舊回執未保存具體失敗原因；修復後可重新驗證，原有待對帳記錄會保留。", "Full Codex verification did not complete. This older receipt did not retain the specific cause. You can validate after repair; earlier reconciliation records are preserved."],
};
