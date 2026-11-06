/** Display metadata never grants access. The server rechecks every selected version. */
export type WorkAttachment = { id: string; assetId: string; name: string };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
export function validWorkAttachments(value: unknown): value is WorkAttachment[] {
  return Array.isArray(value) && value.length <= 20 && value.every(item => item && typeof item === "object"
    && Object.keys(item).every(key => ["id", "assetId", "name"].includes(key))
    && typeof item.id === "string" && uuid.test(item.id) && typeof item.assetId === "string" && uuid.test(item.assetId)
    && typeof item.name === "string" && item.name.length > 0 && item.name.length <= 512)
    && new Set(value.map(item => item.id)).size === value.length;
}
export function workInputDependencies(attachments: WorkAttachment[], required: string, fileDescription: string, connectionDescription: string) {
  if (!validWorkAttachments(attachments)) throw new Error("WORK_ATTACHMENTS_INVALID");
  if (!["", "file", "google_ads", "ga4", "search_console", "meta"].includes(required)) throw new Error("WORK_INPUT_INVALID");
  const dependencies: Array<{kind: "file"; description: string; resource_ids?: string[]} | {kind:"connection";provider:string;description:string}> = [];
  if (attachments.length || required === "file") dependencies.push({kind:"file",description:fileDescription,...(attachments.length?{resource_ids:attachments.map(item=>item.id)}:{})});
  if (required && required !== "file") dependencies.push({kind:"connection",provider:required,description:connectionDescription});
  return dependencies;
}
