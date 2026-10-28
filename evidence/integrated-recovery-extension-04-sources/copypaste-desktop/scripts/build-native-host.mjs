import { build } from "esbuild";
await build({
  entryPoints: ["src/native-host.ts"],
  outfile: "dist/native-host.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  sourcemap: true,
});
