import { PNG } from "pngjs";

/** Explicit synthetic provider bytes; a decoded image is not live-model proof. */
export function desktopImageFixture() {
  const png = new PNG({ width: 1024, height: 1024 });
  for (let y = 0; y < 1024; y++) for (let x = 0; x < 1024; x++) {
    const index = (y * 1024 + x) * 4, light = ((x >> 7) + (y >> 7)) % 2 === 0;
    png.data[index] = light ? 244 : 64; png.data[index + 1] = light ? 244 : 113;
    png.data[index + 2] = light ? 240 : 255; png.data[index + 3] = 255;
  }
  return PNG.sync.write(png);
}
