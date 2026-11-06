import { motionValid, type MotionDefinition } from "./motion-editor-model";
export const motionDraftPrefix = "cp_motion_draft_201:";
const lifetime = 8 * 60 * 60 * 1000,
  limit = 2_000_000;
export type MotionSnapshot = { name: string; definition: MotionDefinition };
export type MotionPending = { key: string; signature: string };
export type MotionDraft = {
  schema: 1;
  at: number;
  version: number;
  snapshot: MotionSnapshot;
  pending: MotionPending | null;
};
const key = (scope: string, id: string) =>
  motionDraftPrefix + encodeURIComponent(scope + ":" + id);
function safeSnapshot(s: MotionSnapshot) {
  try {
    const d = structuredClone(s.definition);
    if (typeof s.name !== "string" || s.name.length > 160) return false;
    // Retain temporarily empty copy/rights fields while the user is still typing.
    d.script.title = d.script.title || "Draft";
    d.storyboard = d.storyboard.map((x) => ({
      ...x,
      headline: x.headline || "Draft",
    }));
    d.subtitles = d.subtitles.map((x) => ({ ...x, text: x.text || "Draft" }));
    if (d.audio)
      d.audio.rights_reference =
        d.audio.rights_reference.trim().length >= 3
          ? d.audio.rights_reference
          : "Draft";
    return motionValid(d);
  } catch {
    return false;
  }
}
export function readMotionDraft(scope: string, id: string): MotionDraft | null {
  try {
    const text = sessionStorage.getItem(key(scope, id));
    if (!text) return null;
    if (new TextEncoder().encode(text).length > limit) throw Error();
    const d = JSON.parse(text);
    if (
      d.schema !== 1 ||
      !Number.isSafeInteger(d.at) ||
      d.at > Date.now() + 60000 ||
      Date.now() - d.at > lifetime ||
      !Number.isSafeInteger(d.version) ||
      d.version < 0 ||
      !safeSnapshot(d.snapshot)
    )
      throw Error();
    if (
      d.pending &&
      (!/^[a-f\d-]{36}$/i.test(d.pending.key) ||
        typeof d.pending.signature !== "string" ||
        d.pending.signature.length > limit)
    )
      throw Error();
    if (
      d.pending &&
      d.pending.signature !==
        JSON.stringify({
          name: d.snapshot.name,
          definition: d.snapshot.definition,
          ...(d.version ? { expected_version: d.version } : {}),
        })
    )
      throw Error();
    return d;
  } catch {
    forgetMotionDraft(scope, id);
    return null;
  }
}
export function keepMotionDraft(
  scope: string,
  id: string,
  version: number,
  snapshot: MotionSnapshot,
  pending: MotionPending | null,
) {
  try {
    if (!scope || !safeSnapshot(snapshot)) throw Error();
    const text = JSON.stringify({
      schema: 1,
      at: Date.now(),
      version,
      snapshot,
      pending,
    });
    if (new TextEncoder().encode(text).length > limit) throw Error();
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(motionDraftPrefix)) keys.push(k);
    }
    for (const k of keys) {
      try {
        const v = JSON.parse(sessionStorage.getItem(k) ?? "null");
        if (!v || Date.now() - v.at > lifetime) sessionStorage.removeItem(k);
      } catch {
        sessionStorage.removeItem(k);
      }
    }
    if (
      sessionStorage.getItem(key(scope, id)) === null &&
      keys.filter((k) => sessionStorage.getItem(k) !== null).length >= 8
    )
      throw Error();
    sessionStorage.setItem(key(scope, id), text);
    return true;
  } catch {
    return false;
  }
}
export function forgetMotionDraft(scope: string, id: string) {
  try {
    sessionStorage.removeItem(key(scope, id));
  } catch {
    /* Live draft remains in memory. */
  }
}
export function clearMotionDrafts() {
  try {
    for (let i = sessionStorage.length - 1; i >= 0; i--) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(motionDraftPrefix)) sessionStorage.removeItem(k);
    }
  } catch {
    /* No accessible session storage. */
  }
}
