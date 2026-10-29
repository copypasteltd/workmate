import { writeFile, readFile } from "node:fs/promises";
const prior = JSON.parse(await readFile("deployment.json", "utf8"));
const data = {
  api: process.env.COPYPASTE_API_ORIGIN ?? prior.api,
  web: process.env.COPYPASTE_WEB_ORIGIN ?? prior.web,
  extensionId: process.env.COPYPASTE_EXTENSION_ID ?? prior.extensionId,
};
for (const value of [data.api, data.web]) {
  const u = new URL(value);
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
    throw new Error("Invalid deployment origin");
}
if (!/^[a-p]{32}$/.test(data.extensionId))
  throw new Error("Invalid Chrome extension ID");
await writeFile(
  "src/deployment.ts",
  "export const deployment = " + JSON.stringify(data) + ";\n",
);
console.log("Deployment origins compiled; no AI credentials are embedded.");
