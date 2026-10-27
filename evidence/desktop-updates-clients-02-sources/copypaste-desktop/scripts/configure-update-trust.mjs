import { readFile, writeFile } from "node:fs/promises";
import { createPublicKey, createHash } from "node:crypto";
const source = process.env.COPYPASTE_UPDATE_TRUST_FILE;
// Do not retain a prior build's keys when a deployment forgets this explicit input.
const value = source
  ? JSON.parse(await readFile(source, "utf8"))
  : { keys: {}, minimumSequence: 0 };
if (
  !value ||
  Object.keys(value).sort().join(",") !== "keys,minimumSequence" ||
  !Number.isSafeInteger(value.minimumSequence) ||
  value.minimumSequence < 0 ||
  !value.keys ||
  typeof value.keys !== "object" ||
  Array.isArray(value.keys) ||
  Object.keys(value.keys).length > 8
)
  throw new Error("Invalid update trust configuration");
for (const [id, pem] of Object.entries(value.keys)) {
  const key = createPublicKey(pem);
  if (
    key.asymmetricKeyType !== "ed25519" ||
    createHash("sha256")
      .update(key.export({ type: "spki", format: "der" }))
      .digest("hex") !== id
  )
    throw new Error("Invalid update key fingerprint");
}
if (
  process.env.COPYPASTE_RELEASE_BUILD === "true" &&
  (!source || !Object.keys(value.keys).length || value.minimumSequence < 1)
)
  throw new Error(
    "Release builds require pinned public keys and a positive sequence floor",
  );
await writeFile(
  "src/update-trust.ts",
  "// Generated deployment public trust. Never contains a signing private key.\nexport const updateTrust: { keys: Record<string,string>; minimumSequence: number } = " +
    JSON.stringify(value) +
    ";\n",
);
