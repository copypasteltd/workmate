import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  root = path.resolve("../.."),
  requirePlatform = createRequire(path.join(platform, "package.json")),
  { z } = requirePlatform("zod");
const model = await import(
    pathToFileURL(path.join(platform, "src/video-project-model.ts")).href
  ),
  sha = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
  original = await readFile(path.join(root, "docs/contracts/openapi.json"));
assert.equal(
  sha(original),
  "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4",
);
const entries = {
  VideoDefinition: "videoDefinition", VideoProfile: "videoProfile", VideoCreate: "videoCreate", VideoEdit: "videoEdit",
  VideoRenderRequest: "videoRenderRequest", VideoCancelRequest: "videoCancelRequest", VideoCreated: "videoCreated",
  VideoQueued: "videoQueued", VideoCancelled: "videoCancelled", VideoList: "videoList", VideoDetail: "videoDetail", VideoPreview: "videoPreview",
};
const schemas = Object.fromEntries(
  Object.entries(entries).map(([name, key]) => [
    name,
    z.toJSONSchema(model[key], { target: "draft-2020-12" }),
  ]),
);
schemas.VideoDefinition.description = "Runtime additionally requires a supported rational frame rate, 3–60 seconds, even dimensions, <=2.1 billion pixel-frames, ordered contiguous scenes covering every frame, ordered non-overlapping captions, distinct keys and currently authorized fixed project source versions. Provided narration text is not synthesized speech.";
const content = (name: string) => ({
  "application/json": { schema: { $ref: "#/components/schemas/" + name } },
});
function op(
  id: string,
  params: string[],
  input: string | null,
  output: string,
) {
  return {
    operationId: id,
    security: [{ customerSession: [] }],
    parameters: [
      ...params.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      })),
      ...(input
        ? [
            {
              name: "Idempotency-Key",
              in: "header",
              required: true,
              schema: {
                type: "string",
                minLength: 16,
                maxLength: 128,
                pattern: "^[\\w:-]+$",
              },
            },
            {
              name: "X-CSRF-Token",
              in: "header",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
          ]
        : []),
    ],
    ...(input
      ? { requestBody: { required: true, content: content(input) } }
      : {}),
    responses: {
      "200": {
        description: "Current project-authorized result",
        content: content(output),
      },
    },
  };
}
const base = "/v1/tenants/{tenant}/projects/{project}/video-projects", parents = ["tenant", "project"], video = [...parents, "video"], render = [...video, "render"];
const listing = op("listVideoProjects", parents, null, "VideoList");
listing.parameters.push({ name: "before", in: "query", required: false, schema: { type: "string", format: "uuid" } });
const document = {
  openapi: "3.1.0",
  info: {
    title: "CopyPaste template video projects",
    version: "0.5.0",
    description:
      "Additive versioned video project contract. Native composition, frozen sources, integer frame timeline, durable render queue, cancellation, scoped actual MP4/source/script/storyboard/VTT/probe delivery and bounded inline preview. No AI generation or whole-product qualification. Original OpenAPI remains unchanged.",
  },
  "x-normative-source-sha256": sha(original),
  "x-model-source-sha256": sha(
    await readFile(path.join(platform, "src/video-project-model.ts")),
  ),
  "x-route-source-sha256": sha(
    await readFile(path.join(platform, "src/video-projects.ts")),
  ),
  paths: {
    [base]: { get: listing, post: op("createVideoProject", parents, "VideoCreate", "VideoCreated") },
    [base + "/{video}"]: { get: op("readVideoProject", video, null, "VideoDetail") },
    [base + "/{video}/edit"]: { post: op("editVideoProject", video, "VideoEdit", "VideoCreated") },
    [base + "/{video}/renders"]: { post: op("queueVideoRender", video, "VideoRenderRequest", "VideoQueued") },
    [base + "/{video}/renders/{render}/cancel"]: { post: op("cancelVideoRender", render, "VideoCancelRequest", "VideoCancelled") },
    [base + "/{video}/renders/{render}/preview"]: { get: op("previewVideoRender", render, null, "VideoPreview") },
  },
  components: {
    securitySchemes: {
      customerSession: { type: "apiKey", in: "cookie", name: "cp_session" },
    },
    schemas,
  },
};
const bytes = JSON.stringify(document, null, 2) + "\n";
await writeFile(
  path.join(root, "docs/contracts/template-video-openapi.json"),
  bytes,
);
await writeFile(
  path.join(platform, "contracts/template-video-openapi.json"),
  bytes,
);
console.log(
  JSON.stringify({
    operations: 7,
    schemas: Object.keys(schemas).length,
    sha256: sha(Buffer.from(bytes)),
    original_unchanged: true,
  }),
);
