import { readFile } from "node:fs/promises";
import type { CapabilityDocument } from "./capability-verification.js";
import { canonical, hash, Problem } from "./lib.js";

export type AudioProbeSpecification = {
  kind: "speech"; locale: "en" | "zh-HK" | "yue-HK"; voice: string; speed: number; text: string;
} | {
  kind: "transcription"; locale: "en" | "zh-HK" | "yue-HK";
  mime_type: "audio/wav" | "audio/mpeg"; timestamps: boolean;
};
const copy = {
  en: "An original internal protocol sample. This check does not qualify voice quality.",
  "zh-HK": "這是公司原創的協議驗證文字，僅檢查音訊交付格式，不代表聲音品質驗收。",
  "yue-HK": "呢段係公司原創嘅協議測試文字，只用嚟檢查音訊交付格式，唔代表粵語質素驗收。",
};

/** Every advertised voice/locale and speed boundary is exercised. Transcription
 * checks both advertised containers and, when enabled, real segment structure.
 * The original tone is a protocol fixture, never semantic quality evidence. */
export function capabilityAudioPlan(document: CapabilityDocument) {
  const cases: AudioProbeSpecification[] = [];
  if (document.profile_key === "internal-speech-v1") {
    for (const locale of [...document.locales].sort()) for (const voice of [...document.voices].sort())
      for (const speed of [0.25, 1, 4]) cases.push({ kind: "speech", locale, voice, speed, text: copy[locale] });
  } else if (document.profile_key === "internal-transcription-v1") {
    for (const locale of [...document.locales].sort()) for (const mime_type of ["audio/wav", "audio/mpeg"] as const)
      for (const timestamps of document.timestamps ? [false, true] : [false])
        cases.push({ kind: "transcription", locale, mime_type, timestamps });
  } else throw new Problem(409, "AUDIO_VERIFICATION_PROFILE_INVALID", "Choose a speech or transcription configuration");
  const units = cases.map(spec => spec.kind === "speech" ? [...spec.text].length : 3000);
  const quote = units.reduce((total, count) => total + BigInt(count) * BigInt(document.rates[0]), 0n);
  if (quote <= 0n || quote > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Problem(422, "AUDIO_VERIFICATION_QUOTE_INVALID", "The complete verification quote is out of bounds");
  return { cases, units, hash: hash(canonical(cases)), quoted_micros: quote.toString(), quality_scope: "protocol_only" as const };
}

export async function capabilityAudioReference(mime: "audio/wav" | "audio/mpeg") {
  const filename = mime === "audio/wav" ? "protocol-tone-v1.wav" : "protocol-tone-v1.mp3";
  const expected = mime === "audio/wav"
    ? "9572fbd512b2547afa755d70beb3c62aa1f7b550611e67c196747ec1146b5f86"
    : "4a706b4a7a052a58a8412b106bb564dbc214b6f2d14c52e8084f2af3ed9191a9";
  const bytes = await readFile(new URL("../assets/audio/" + filename, import.meta.url));
  if (hash(bytes) !== expected) throw new Problem(409, "AUDIO_VERIFICATION_REFERENCE_CHANGED", "The original protocol reference changed");
  return { bytes, filename, sha256: expected };
}
