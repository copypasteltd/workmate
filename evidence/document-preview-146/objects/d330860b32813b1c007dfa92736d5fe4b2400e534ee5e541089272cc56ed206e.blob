/** A selected company delivery, never an OS permission grant or filesystem path. */
export interface NativeDeliveryRevision {
  source_task_id: string;
  expected_version: number;
  expected_delivery_hash: string;
  target: Record<string, unknown>;
}
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export function nativeDeliveryRevision(value: unknown): NativeDeliveryRevision {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("LOCAL_REVISION_INVALID");
  const v = value as NativeDeliveryRevision;
  if (Object.keys(v).sort().join(",") !== "expected_delivery_hash,expected_version,source_task_id,target"
    || !uuid.test(v.source_task_id) || !Number.isSafeInteger(v.expected_version) || v.expected_version < 1
    || !/^[a-f0-9]{64}$/.test(v.expected_delivery_hash) || !v.target || typeof v.target !== "object" || Array.isArray(v.target)
    || !["whole", "output", "artifact", "text", "image", "video"].includes(String(v.target.kind)) || JSON.stringify(v).length > 20000)
    throw new Error("LOCAL_REVISION_INVALID");
  // The company API validates the exact target schema, bytes and current authority.
  return structuredClone(v);
}
