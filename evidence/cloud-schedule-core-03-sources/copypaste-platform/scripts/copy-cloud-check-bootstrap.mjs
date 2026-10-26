import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await mkdir(path.join(root, "dist/src"), { recursive: true });
for (const file of ["cloud-api-bootstrap.cjs", "cloud-sqlite-bootstrap.cjs"]) {
  await copyFile(
    path.join(root, "src", file),
    path.join(root, "dist/src", file),
  );
}
