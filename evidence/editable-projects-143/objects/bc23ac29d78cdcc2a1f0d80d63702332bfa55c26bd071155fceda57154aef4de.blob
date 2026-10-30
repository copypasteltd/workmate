/** Only exact task delivery exports may enter the browser's download manager. */
const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export type DeliveryDownload = { tenant: string; project: string; task: string; version: number; deliveryHash: string };
export async function startDeliveryDownload(value: DeliveryDownload, io: {
  apiOrigin: string;
  tokens(): Promise<{ access_token: string; session_epoch?: string }>;
  check(path: string, tenant: string): Promise<any>;
  download(options: { url: string; filename: string; saveAs: boolean; conflictAction: "uniquify"; headers: { name: string; value: string }[] }): Promise<number>;
}) {
  if (!value || ![value.tenant, value.project, value.task].every(v => typeof v === "string" && uuid.test(v))
      || !Number.isSafeInteger(value.version) || value.version < 1 || !/^[a-f0-9]{64}$/.test(value.deliveryHash))
    throw new Error("Invalid delivery selection");
  const path = `/v1/tenants/${value.tenant}/projects/${value.project}/tasks/${value.task}`;
  const before = await io.tokens();
  if (!before.session_epoch) throw new Error("Sign in again before downloading / 請重新登入後下載");
  const current = await io.check(path + "/quality", value.tenant);
  if (current.task_version !== value.version || current.delivery_hash !== value.deliveryHash)
    throw new Error("Delivery changed; refresh before downloading / 交付已改變，請重新載入");
  const tokens = await io.tokens();
  if (tokens.session_epoch !== before.session_epoch) throw new Error("Sign-in state changed / 登入狀態已改變");
  const query = new URLSearchParams({ expected_version: String(value.version), expected_delivery_hash: value.deliveryHash });
  const id = await io.download({ url: io.apiOrigin + path + "/delivery-package?" + query,
    filename: `workmate-${value.task}-v${value.version}.zip`, saveAs: false, conflictAction: "uniquify",
    headers: [{ name: "Authorization", value: "Bearer " + tokens.access_token }, { name: "X-Tenant-ID", value: value.tenant }] });
  return { download_id: id };
}
