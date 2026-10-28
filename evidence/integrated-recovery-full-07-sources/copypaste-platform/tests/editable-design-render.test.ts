import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unzipSync, zipSync } from "fflate";
import { PNG } from "pngjs";
import { PDFDocument } from "pdf-lib";
import {
  vectorInput,
  slidesInput,
  designScene,
} from "../src/editable-design-model.js";
import {
  demoVectorInput,
  demoSlidesInput,
} from "../src/editable-design-demo.js";
import {
  renderEditableDesign,
  packageEditableDesign,
  validateEditablePPTX,
  designChartKey,
  type DesignResources,
} from "../src/editable-design-render.js";
import { hash } from "../src/lib.js";
const empty = (): DesignResources => ({ images: new Map(), charts: new Map() });

test("vector delivery has genuine editable text, outline-only appearance, matching PNG/PDF and a complete licensed-font ZIP", async () => {
  const result = await renderEditableDesign(
    "vector",
    demoVectorInput(),
    empty(),
    "simulated",
  );
  const files = new Map(result.files.map((f) => [f.name, f.bytes]));
  const svg = files.get("brand-vector.svg")!.toString(),
    outlined = files.get("brand-vector.outlined.svg")!.toString();
  assert.match(svg, /<text/);
  assert.match(svg, /workmate/);
  assert.match(svg, /<path/);
  assert.doesNotMatch(outlined, /<text\b/);
  assert.match(outlined, /<path/);
  const png = PNG.sync.read(files.get("brand-vector.png")!);
  assert.equal(png.width, 1200);
  assert.equal(png.height, 800);
  assert.equal(
    (await PDFDocument.load(files.get("review.pdf")!)).getPageCount(),
    1,
  );
  assert.match(files.get("review.html")!.toString(), /Content-Security-Policy/);
  const all = packageEditableDesign(
    result.files,
    result.fontBytes,
    result.fontLicense,
    {
      schema: "test",
      files: result.files.map((f) => ({ name: f.name, sha256: hash(f.bytes) })),
    },
    result.staticFontFiles,
  );
  const zip = unzipSync(all.at(-1)!.bytes);
  for (const file of result.files)
    assert.deepEqual(Buffer.from(zip[file.name]), file.bytes);
  assert.equal(
    hash(Buffer.from(zip["fonts/NotoSansTC-VF.ttf"])),
    result.font.sha256,
  );
  assert.match(
    Buffer.from(zip["fonts/OFL.txt"]).toString(),
    /SIL OPEN FONT LICENSE/i,
  );
  assert.equal(result.font.family, "CopyPaste Sans TC");
  for (const face of result.font.static_faces)
    assert.equal(hash(Buffer.from(zip["fonts/" + face.file])), face.sha256);
  const ink: number[] = [];
  for (const weight of [400, 700] as const) {
    const input = demoVectorInput();
    input.scene = {
      width: 600,
      height: 256,
      background: "#FFFFFF",
      layers: [
        {
          kind: "text",
          id: "weight",
          x: 20,
          y: 20,
          w: 560,
          h: 180,
          text: "品牌設計",
          font_size: 100,
          weight,
          color: "#000000",
          align: "left",
          line_height: 1.4,
        },
      ],
    };
    const rendered = await renderEditableDesign(
      "vector",
      input,
      empty(),
      "simulated",
    );
    const image = PNG.sync.read(
      rendered.files.find((f) => f.name === "brand-vector.png")!.bytes,
    );
    let darkness = 0;
    for (let p = 0; p < image.data.length; p += 4)
      darkness += 255 - image.data[p];
    ink.push(darkness);
  }
  assert.ok(
    ink[1] > ink[0] * 1.25,
    "Actual 700-weight outlines must have more ink than the same 400-weight glyphs; variable-font default outlines are not acceptable",
  );
});
test("multi-page PPTX retains native text, shapes, custom paths and speaker notes rather than a slide-sized bitmap", async () => {
  const input = demoSlidesInput(),
    result = await renderEditableDesign(
      "presentation",
      input,
      empty(),
      "simulated",
    );
  const files = new Map(result.files.map((f) => [f.name, f.bytes])),
    parts = unzipSync(files.get("presentation.pptx")!);
  assert.equal(
    (await PDFDocument.load(files.get("review.pdf")!)).getPageCount(),
    3,
  );
  for (let i = 1; i <= 3; i++) {
    const xml = Buffer.from(parts[`ppt/slides/slide${i}.xml`]).toString();
    assert.match(xml, /<a:t>/);
    assert.match(xml, /<p:sp>/);
    assert.doesNotMatch(xml, /<p:pic>/);
    assert.match(
      Buffer.from(parts[`ppt/notesSlides/notesSlide${i}.xml`]).toString(),
      new RegExp(
        input.slides[i - 1].notes
          .slice(0, 16)
          .replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      ),
    );
    assert.equal(PNG.sync.read(files.get(`slide-0${i}.png`)!).width, 1200);
  }
  assert.match(
    Buffer.from(parts["ppt/slides/slide1.xml"]).toString(),
    /<a:custGeom>/,
  );
  assert.ok(!Object.keys(parts).some((n) => /^ppt\/media\/.+/.test(n)));
});
test("overflow, off-page strokes, injected arbitrary markup and malformed Unicode fail explicitly", async () => {
  const input = demoVectorInput();
  input.scene.layers = [
    {
      kind: "text",
      id: "overflow",
      x: 0,
      y: 0,
      w: 80,
      h: 18,
      text: "Too much text for this tiny area",
      font_size: 24,
      weight: 400,
      color: "#171B22",
      align: "left",
      line_height: 1.4,
    },
  ];
  await assert.rejects(
    renderEditableDesign("vector", input, empty(), "simulated"),
    (e: any) => e.code === "DESIGN_TEXT_OVERFLOW",
  );
  assert.throws(() =>
    vectorInput.parse({
      ...demoVectorInput(),
      svg: "<script>alert(1)</script>",
    }),
  );
  assert.throws(() =>
    designScene.parse({
      width: 256,
      height: 256,
      background: "#FFFFFF",
      layers: [
        {
          kind: "rect",
          id: "stroke",
          x: 0,
          y: 0,
          w: 256,
          h: 256,
          fill: "#FFFFFF",
          stroke: "#000000",
          stroke_width: 4,
        },
      ],
    }),
  );
  assert.throws(() =>
    vectorInput.parse({ ...demoVectorInput(), title: "bad\ud800" }),
  );
  assert.throws(() => slidesInput.parse({ ...demoSlidesInput(), slides: [] }));
});
test("XML-looking text stays literal; actual cubic and quadratic geometry survive in editable PPTX", async () => {
  const input = demoSlidesInput();
  input.slides[0].scene.layers = [
    {
      kind: "text",
      id: "literal",
      x: 20,
      y: 20,
      w: 1000,
      h: 100,
      text: '<script> & "hello"',
      font_size: 26,
      weight: 400,
      color: "#171B22",
      align: "left",
      line_height: 1.4,
    },
    {
      kind: "path",
      id: "curves",
      x: 120,
      y: 180,
      w: 400,
      h: 350,
      fill: "#1F5EFF",
      stroke: null,
      stroke_width: 0,
      commands: [
        { op: "M", x: 0, y: 0 },
        { op: "Q", x1: 500, y1: 0, x: 1000, y: 500 },
        { op: "C", x1: 1000, y1: 750, x2: 400, y2: 1000, x: 0, y: 1000 },
        { op: "Z" },
      ],
    },
  ];
  const result = await renderEditableDesign(
      "presentation",
      input,
      empty(),
      "simulated",
    ),
    files = new Map(result.files.map((f) => [f.name, f.bytes]));
  assert.match(files.get("slide-01.svg")!.toString(), /&lt;script&gt; &amp;/);
  assert.doesNotMatch(files.get("review.html")!.toString(), /<script> &/);
  const parts = unzipSync(files.get("presentation.pptx")!),
    xml = Buffer.from(parts["ppt/slides/slide1.xml"]).toString();
  assert.match(xml, /<a:quadBezTo>/);
  assert.match(xml, /<a:cubicBezTo>/);
  assert.match(xml, /&lt;script&gt;/);
});
test("charts with repeated page-local IDs preserve distinct exact evidence, unknown values and editable native bars", async () => {
  const input = demoSlidesInput();
  input.slides = input.slides.slice(0, 2);
  const resources = empty();
  for (const [index, slide] of input.slides.entries()) {
    const known = randomUUID(),
      unknown = randomUUID();
    const layer = {
      kind: "chart" as const,
      id: "same_chart_id",
      x: 64,
      y: 160,
      w: 1000,
      h: 360,
      source_version_id: randomUUID(),
      sha256: "a".repeat(64),
      title: index ? "Second exact evidence" : "First exact evidence",
      evidence_ids: [known, unknown],
      color: "#1F5EFF",
    };
    slide.scene.layers = [layer];
    resources.charts.set(designChartKey(layer), [
      {
        id: known,
        label: "Launch",
        value: index ? "987.65000000" : "123.45000000",
        unit: "currency",
        null_reason: null,
        scope: "{}",
      },
      {
        id: unknown,
        label: "Missing",
        value: null,
        unit: "currency",
        null_reason: "not_provided",
        scope: "{}",
      },
    ]);
  }
  const result = await renderEditableDesign(
      "presentation",
      input,
      resources,
      "simulated",
    ),
    files = new Map(result.files.map((f) => [f.name, f.bytes]));
  assert.match(files.get("slide-01.svg")!.toString(), /123\.45000000/);
  assert.doesNotMatch(files.get("slide-01.svg")!.toString(), /987\.65000000/);
  assert.match(files.get("slide-02.svg")!.toString(), /987\.65000000/);
  assert.match(files.get("slide-02.svg")!.toString(), />N\/A</);
  assert.equal(
    (
      files
        .get("slide-01.svg")!
        .toString()
        .match(/data-layer-id="same_chart_id_bar/g) ?? []
    ).length,
    1,
  );
  assert.match(files.get("evidence.csv")!.toString(), /not_provided/);
});
test("fixed PNG images are embedded as bytes and remain distinct from editable native layers", async () => {
  const input = demoSlidesInput();
  input.slides = input.slides.slice(0, 1);
  const resources = empty(),
    id = randomUUID(),
    png = new PNG({ width: 32, height: 16 });
  png.data.fill(255);
  const bytes = PNG.sync.write(png);
  resources.images.set(id, bytes);
  input.slides[0].scene.layers.push({
    kind: "image",
    id: "image",
    x: 800,
    y: 350,
    w: 320,
    h: 160,
    asset_version_id: id,
    sha256: hash(bytes),
    alt: "Actual PNG",
    fit: "contain",
  });
  const result = await renderEditableDesign(
      "presentation",
      input,
      resources,
      "simulated",
    ),
    parts = unzipSync(
      result.files.find((f) => f.name === "presentation.pptx")!.bytes,
    );
  const media = Object.keys(parts).filter((n) =>
    /^ppt\/media\/.+\.png$/.test(n),
  );
  assert.equal(media.length, 1);
  assert.deepEqual(Buffer.from(parts[media[0]]), bytes);
  assert.match(
    Buffer.from(parts["ppt/slides/slide1.xml"]).toString(),
    /<p:pic>/,
  );
  assert.ok(
    !Object.values(parts).some((b) =>
      Buffer.from(b).toString().includes('TargetMode="External"'),
    ),
  );
});
test("PPTX validator rejects broken packages and external relationships", () => {
  assert.throws(
    () =>
      validateEditablePPTX(
        Buffer.from(
          zipSync({
            "[Content_Types].xml": Buffer.from("<Types/>"),
            "ppt/presentation.xml": Buffer.from("<p/>"),
            "ppt/slides/slide1.xml": Buffer.from(
              '<s><r TargetMode="External"/></s>',
            ),
          }),
        ),
        1,
      ),
    /PPTX_XML_INVALID/,
  );
  assert.throws(
    () => validateEditablePPTX(Buffer.from(zipSync({})), 1),
    /PPTX_PARTS_INVALID/,
  );
});
