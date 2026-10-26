import { createCanvas } from "@napi-rs/canvas";
import { videoJobLimits } from "./video-job-protocol.js";
import { canonical, hash } from "./lib.js";

/** Fixed, versioned protocol probes; no administrator-supplied content or URL. */
export function capabilityVideoPlan() {
  const cases = videoJobLimits.sizes.flatMap(size => videoJobLimits.seconds.map(seconds => ({
    size, seconds, prompt: "Internal protocol verification: a blue square moves slowly over a plain light background.",
    reference_mime: null as "image/png" | "image/jpeg" | null,
  })));
  cases[0].reference_mime = "image/png";
  cases[1].reference_mime = "image/jpeg";
  cases.push({ size: "1280x720", seconds: 4,
    prompt: "Internal cancellation protocol verification: a blue square on a plain light background.", reference_mime: null });
  return { cases, hash: hash(canonical({ version: 1, cases })), seconds: cases.reduce((n, c) => n + c.seconds, 0) };
}

export function capabilityVideoReference(spec: ReturnType<typeof capabilityVideoPlan>["cases"][number]) {
  if (!spec.reference_mime) return undefined;
  const [width, height] = spec.size.split("x").map(Number), canvas = createCanvas(width, height), ctx = canvas.getContext("2d");
  ctx.fillStyle = "#f4f6fa"; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#1f5eff"; ctx.fillRect(width / 4, height / 4, width / 2, height / 2);
  return { mime: spec.reference_mime, bytes: spec.reference_mime === "image/png" ? canvas.toBuffer("image/png") : canvas.toBuffer("image/jpeg", 85) };
}
