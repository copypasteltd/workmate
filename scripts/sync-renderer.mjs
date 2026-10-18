import { cp, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
const source = process.argv[2];
if (!source)
  throw new Error(
    "Pass the explicit copypaste-web source directory. Existing snapshots build independently.",
  );
const from = path.resolve(source);
const p = JSON.parse(await readFile(path.join(from, "package.json"), "utf8"));
if (p.name !== "@copypaste/web")
  throw new Error("Expected CopyPaste Web source");
await mkdir("renderer", { recursive: true });
for (const f of ["src", "public"])
  await cp(path.join(from, f), "renderer/" + f, { recursive: true });
for (const f of ["index.html", "tsconfig.json"])
  await cp(path.join(from, f), "renderer/" + f);
const hashes = {};
async function walk(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(f);
    else {
      let bytes = await readFile(f);
      if (/\.(tsx|html)$/.test(f)) {
        bytes = Buffer.from(
          bytes.toString("utf8").replaceAll('src="/', 'src="./'),
        );
        await writeFile(f, bytes);
      }
      hashes[path.relative("renderer", f).replaceAll("\\", "/")] = createHash(
        "sha256",
      )
        .update(bytes)
        .digest("hex");
    }
  }
}
await walk("renderer");
await writeFile(
  "renderer-source.json",
  JSON.stringify(
    { source: "copypaste-web", version: p.version, files: hashes },
    null,
    2,
  ),
);
console.log(
  "Renderer snapshot copied. No sibling repository is needed to build.",
);

let html = await readFile("renderer/index.html", "utf8");
html = html.replace(
  "<head>",
  '<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src &apos;self&apos;; script-src &apos;self&apos;; style-src &apos;self&apos; &apos;unsafe-inline&apos;; img-src &apos;self&apos; data: blob:; font-src &apos;self&apos;; connect-src &apos;none&apos;; frame-src &apos;none&apos;; object-src &apos;none&apos;; base-uri &apos;self&apos;\">',
);
await writeFile("renderer/index.html", html);

hashes["index.html"] = createHash("sha256").update(html).digest("hex");
await writeFile(
  "renderer-source.json",
  JSON.stringify(
    { source: "copypaste-web", version: p.version, files: hashes },
    null,
    2,
  ) + "\n",
);
