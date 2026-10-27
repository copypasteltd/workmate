import { readFile } from "node:fs/promises";
import { parseUpdateKeys, UpdateError } from "./desktop-update-contract.js";
export type UpdateTrust = {
  keys: Record<string, string>;
  minimumSequence: number;
};
export async function resolveUpdateTrust(
  bundled: UpdateTrust,
  packaged: boolean,
  developmentFile?: string,
): Promise<UpdateTrust> {
  // Installed applications exclusively trust their build. An environment variable cannot replace it.
  if (packaged || !developmentFile)
    return {
      keys: parseUpdateKeys(bundled.keys),
      minimumSequence: bundled.minimumSequence,
    };
  const raw = await readFile(developmentFile);
  if (raw.length > 10000) throw new UpdateError("UPDATE_TRUST_INVALID");
  const value = JSON.parse(raw.toString("utf8"));
  if (
    !value ||
    Object.keys(value).sort().join(",") !== "keys,minimumSequence" ||
    !Number.isSafeInteger(value.minimumSequence) ||
    value.minimumSequence < 0
  )
    throw new UpdateError("UPDATE_TRUST_INVALID");
  return {
    keys: parseUpdateKeys(value.keys),
    minimumSequence: value.minimumSequence,
  };
}
