const uuid = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
export async function startCreativePackageDownload(value: { tenant: string; project: string; id: string; version: number }, io: {
  apiOrigin: string; tokens(): Promise<{ access_token: string; session_epoch?: string }>;
  check(path: string, tenant: string): Promise<any>;
  download(options: { url: string; filename: string; saveAs: boolean; conflictAction: "uniquify"; headers: { name: string; value: string }[] }): Promise<number>;
}) {
  if (!value || ![value.tenant, value.project, value.id].every(v => typeof v === "string" && uuid.test(v)) || !Number.isSafeInteger(value.version) || value.version < 1) throw new Error("Invalid creative project selection");
  const before = await io.tokens(); if (!before.session_epoch) throw new Error("Sign in again before downloading");
  const base = `/v1/tenants/${value.tenant}/projects/${value.project}/creative-project-packages`;
  const list = await io.check(base, value.tenant);
  if (!list.items.some((p: any) => p.id === value.id && p.version === value.version)) throw new Error("Creative project changed; refresh before downloading");
  const current = await io.tokens(); if (current.session_epoch !== before.session_epoch) throw new Error("Sign-in state changed");
  return { download_id: await io.download({ url: io.apiOrigin + base + "/" + value.id + "?expected_version=" + value.version,
    filename: `workmate-project-${value.id}-v${value.version}.zip`, saveAs: false, conflictAction: "uniquify",
    headers: [{ name: "Authorization", value: "Bearer " + current.access_token }, { name: "X-Tenant-ID", value: value.tenant }] }) };
}
