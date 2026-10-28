import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const prefix = `evidence/capability-release-contract-${attempt}`;
await assert.rejects(access(prefix + ".json"), (e: any) => e.code === "ENOENT");
const platform = path.resolve("../copypaste-platform"),
  admin = path.resolve("../copypaste-admin"),
  root = path.resolve("../.."),
  requirePlatform = createRequire(path.join(platform, "package.json")),
  { Ajv2020 } = requirePlatform("ajv/dist/2020.js"),
  ajv = new Ajv2020({ allErrors: true });
requirePlatform("ajv-formats")(ajv);
const hash = (bytes: Buffer) =>
    createHash("sha256").update(bytes).digest("hex"),
  files = [
    path.join(root, "docs/contracts/openapi.json"),
    path.join(root, "docs/contracts/capability-releases.openapi.json"),
    path.join(platform, "src/capability-verification.ts"),
    path.join(admin, "src/capability-model.ts"),
    path.join(admin, "src/financial-money.ts"),
    path.resolve("scripts/check-capability-release-contract.ts"),
  ],
  before = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        path.relative(root, file).replaceAll("\\", "/"),
        hash(await readFile(file)),
      ]),
    ),
  ),
  normative = JSON.parse(await readFile(files[0], "utf8")),
  contract = JSON.parse(await readFile(files[1], "utf8")),
  checks: string[] = [],
  errors: string[] = [];
await writeFile(prefix + "-verifier.ts", await readFile(import.meta.filename), {
  flag: "wx",
});
try {
  assert.equal(
    before["docs/contracts/openapi.json"],
    "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4",
  );
  for (const name of ["AdminOperation", "Capability", "CapabilityList"])
    assert.deepEqual(
      contract.components.schemas[name],
      normative.components.schemas[name],
    );
  checks.push(
    "normative API bytes and all three original strict DTO definitions remain unchanged",
  );
  const defs = JSON.parse(
      JSON.stringify(contract.components.schemas).replaceAll(
        "#/components/schemas/",
        "#/$defs/",
      ),
    ),
    validators: any = {};
  for (const name of Object.keys(defs))
    validators[name] = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
  assert.equal(Object.keys(contract.paths).length, 13);
  checks.push(
    `all ${Object.keys(defs).length} supplemental schemas compile with resolved references across 13 paths`,
  );
  const { capabilityDraft, rateInput } = await import(
      pathToFileURL(path.join(admin, "src/capability-model.ts")).href
    ),
    { capabilityDocument } = await import(
      pathToFileURL(path.join(platform, "src/capability-verification.ts")).href
    );
  function form(image = false) {
    const f = new FormData();
    for (const [k, v] of Object.entries({
      profile: image ? "internal-image2-v1" : "internal-text-v1",
      model: "internal-model-fixture",
      effort: "max",
      input_rate: "0.000001",
      output_rate: "999999.999999",
      image_rate: "0.000001",
      reason: "Synthetic cross-consumer contract verification",
    }))
      f.set(k, v);
    return f;
  }
  const text = capabilityDraft(form());
  assert.deepEqual(text.document.rates, [1, 999999999999]);
  assert.equal(rateInput(text.document.rates[0]), "0.000001");
  assert.ok(validators.CapabilityDraftCommand(text));
  assert.deepEqual(capabilityDocument.parse(text.document), text.document);
  checks.push(
    "actual Admin text serialization agrees with the server and contract for one micro, maximum decimal precision and explicit effort",
  );
  const image = capabilityDraft(form(true));
  assert.deepEqual(image.document.rates, [1]);
  assert.equal(image.document.reasoning_effort, null);
  assert.ok(validators.CapabilityDraftCommand(image));
  assert.deepEqual(capabilityDocument.parse(image.document), image.document);
  checks.push(
    "actual Admin image serialization agrees with the server and contract for a positive single-image rate and null effort",
  );
  const videoForm = form(true);
  videoForm.set("profile", "internal-video-v1"); videoForm.set("video_rate", "0.000001");
  const video = capabilityDraft(videoForm);
  assert.deepEqual(video.document.rates, [1]); assert.equal(video.document.reasoning_effort, null);
  assert.ok(validators.CapabilityDraftCommand(video));
  assert.deepEqual(capabilityDocument.parse(video.document), video.document);
  videoForm.set("video_rate", "0"); assert.throws(() => capabilityDraft(videoForm));
  checks.push("actual Admin video serialization agrees with the server and contract for a positive per-second rate and refuses zero");
  const invalid = [
    { ...text.document, kernel: "dsh" },
    { ...text.document, gateway_policy: "external" },
    { ...text.document, api_key: "synthetic-forbidden-value" },
    { ...text.document, endpoint: "https://example.invalid" },
    { ...text.document, profile_key: "internal-video-v1" },
    { ...text.document, profile_key: "internal-speech-v1" },
    { ...text.document, rates: [1.5, 2] },
    { ...text.document, rates: [1] },
    { ...image.document, reasoning_effort: "max" },
    { ...image.document, rates: [0] },
  ];
  for (const document of invalid) {
    assert.equal(validators.CapabilityDocument(document), false);
    assert.equal(capabilityDocument.safeParse(document).success, false);
  }
  checks.push(
    "server and machine contract both reject alternate kernels/routes, credentials, endpoints, unsupported media and invalid rate/effort shapes",
  );
  for (const value of ["0.0000001", "1000000.000001", "1e3", "-1"]) {
    const f = form();
    f.set("input_rate", value);
    assert.throws(() => capabilityDraft(f));
  }
  const zero = form();
  zero.set("input_rate", "0");
  assert.equal(capabilityDraft(zero).document.rates[0], 0);
  const badImage = form(true);
  badImage.set("image_rate", "0");
  assert.throws(() => capabilityDraft(badImage));
  checks.push(
    "actual UI rejects overprecise/overflowing/scientific/negative rates, permits zero text rate and refuses a zero image rate",
  );
} catch (error) {
  errors.push((error as Error).message);
}
const after = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        path.relative(root, file).replaceAll("\\", "/"),
        hash(await readFile(file)),
      ]),
    ),
  ),
  stable = JSON.stringify(before) === JSON.stringify(after),
  passed = errors.length === 0 && stable;
await writeFile(
  prefix + ".json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: passed ? "passed" : "failed",
      scope:
        "Cross-consumer serialization and schema checks; no browser, live provider or complete requirement acceptance claim",
      checks,
      errors,
      source_files: before,
      source_unchanged: stable,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: passed ? "passed" : "failed",
    checks: checks.length,
    errors,
  }),
);
process.exitCode = passed ? 0 : 1;
