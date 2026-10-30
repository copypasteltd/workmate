import { build } from "esbuild";
import { mkdir, cp, writeFile, readFile } from "node:fs/promises";
import { generateKeyPairSync, createHash } from "node:crypto";
const api = new URL(
    process.env.COPYPASTE_API_ORIGIN ?? "http://localhost:4310",
  ),
  web = new URL(process.env.COPYPASTE_WEB_ORIGIN ?? "http://localhost:4317");
for (const u of [api, web])
  if (
    u.username ||
    u.password ||
    u.pathname !== "/" ||
    u.search ||
    u.hash ||
    (u.protocol !== "https:" &&
      !(
        ["localhost", "127.0.0.1"].includes(u.hostname) &&
        u.protocol === "http:"
      ))
  )
    throw new Error("Use HTTPS company origins, or localhost for development");
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await build({
  entryPoints: { background: "src/background.ts", panel: "src/panel.ts" },
  outdir: "dist",
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  define: {
    __COPYPASTE_API_ORIGIN__: JSON.stringify(api.origin),
    __COPYPASTE_WEB_ORIGIN__: JSON.stringify(web.origin),
  },
});
let key;
try {
  key = (await readFile("manifest-key.txt", "utf8")).trim();
} catch {
  key = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "der" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  }).publicKey.toString("base64");
  await writeFile("manifest-key.txt", key + "\n");
}
const id = createHash("sha256")
  .update(Buffer.from(key, "base64"))
  .digest("hex")
  .slice(0, 32)
  .split("")
  .map((c) => String.fromCharCode("a".charCodeAt(0) + parseInt(c, 16)))
  .join("");
const manifest = {
  manifest_version: 3,
  name: "CopyPaste · Enterprise Workspace",
  version: JSON.parse(await readFile("package.json", "utf8")).version,
  description:
    "Bring projects, specialist work and explicitly selected local materials into CopyPaste.",
  key,
  minimum_chrome_version: "120",
  permissions: ["storage", "identity", "sidePanel", "activeTab", "scripting", "downloads"],
  optional_permissions: ["nativeMessaging"],
  host_permissions: [api.origin + "/*"],
  background: { service_worker: "background.js" },
  side_panel: { default_path: "sidepanel.html" },
  action: { default_title: "Open CopyPaste side panel · 開啟工作側欄" },
  icons: { 16: "icon-16.png", 48: "icon-48.png", 128: "icon-128.png" },
  content_security_policy: {
    extension_pages: "script-src 'self'; object-src 'none'; base-uri 'none'",
  },
};
await writeFile("dist/manifest.json", JSON.stringify(manifest, null, 2));
await writeFile("extension-id.txt", id + "\n");
console.log("Built Chrome MV3 extension. Registered ID: " + id);
