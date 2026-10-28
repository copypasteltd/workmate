import { readFile, writeFile } from "node:fs/promises";
import {
  createPrivateKey,
  createPublicKey,
  createHash,
  sign,
} from "node:crypto";
import {
  updateCanonical,
  verifyUpdateEnvelope,
} from "../src/desktop-update-contract.js";
const args = process.argv.slice(2);
if (
  args.length !== 6 ||
  args[0] !== "--payload" ||
  args[2] !== "--private-key" ||
  args[4] !== "--out"
)
  throw new Error(
    "Usage: npm run desktop-update:sign -- --payload payload.json --private-key offline-key.pem --out signed-release.json",
  );
const payload = JSON.parse(await readFile(args[1], "utf8")),
  privateKey = createPrivateKey(await readFile(args[3]));
if (privateKey.asymmetricKeyType !== "ed25519")
  throw new Error("Use an offline Ed25519 release signing key");
const publicKey = createPublicKey(privateKey),
  key_id = createHash("sha256")
    .update(publicKey.export({ type: "spki", format: "der" }))
    .digest("hex");
const envelope = {
  key_id,
  payload,
  signature: sign(
    null,
    Buffer.from(updateCanonical(payload)),
    privateKey,
  ).toString("base64url"),
};
verifyUpdateEnvelope(envelope, {
  [key_id]: publicKey.export({ type: "spki", format: "pem" }).toString(),
});
await writeFile(args[5], JSON.stringify(envelope, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log("Signed release created. Key fingerprint: " + key_id);
