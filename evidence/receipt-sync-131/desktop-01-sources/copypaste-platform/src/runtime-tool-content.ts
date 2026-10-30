import { validateDedicatedFrame } from "./dedicated-cloud-frame.js";

/** Only an in-process trusted tool can construct image content. A connector's
 * JSON, a file or a model cannot forge this class by returning similarly named fields. */
export class RuntimeImageResult {
  readonly imageUrl: string;
  constructor(readonly metadata: unknown, pixels: Buffer) {
    validateDedicatedFrame(pixels.toString("base64"));
    this.imageUrl = "data:image/png;base64," + pixels.toString("base64");
  }
}
export function runtimeToolContent(value: unknown) {
  return value instanceof RuntimeImageResult
    ? [{ type: "inputText" as const, text: JSON.stringify(value.metadata) }, { type: "inputImage" as const, imageUrl: value.imageUrl }]
    : [{ type: "inputText" as const, text: JSON.stringify(value) }];
}
