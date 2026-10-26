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

// Protocol references are runtime dependencies of the compiled audio verifier.
const audio = path.join(root, "dist/assets/audio");
await mkdir(audio, { recursive: true });
for (const file of ["LICENSE.txt", "protocol-tone-v1.wav", "protocol-tone-v1.mp3"]) {
  await copyFile(path.join(root, "assets/audio", file), path.join(audio, file));
}
