import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankMotion,
  motionValid,
  motionSeconds,
  editMotionTimeline,
  retimeMotion,
} from "../src/motion-editor-model.ts";
import {
  keepMotionDraft,
  readMotionDraft,
  clearMotionDrafts,
  motionDraftPrefix,
} from "../src/motion-draft-state.ts";
const withCues = () => {
  const d = blankMotion("en");
  d.subtitles = [
    { key: "cross", start_frame: 120, end_frame: 180, text: "Across the cut" },
    {
      key: "next",
      start_frame: 300,
      end_frame: 400,
      text: "Keep this wording",
    },
  ];
  return d;
};
test("atomic scene reflow maps cross-cut captions, copying, removal and insertion without mutating input", () => {
  const original = withCues(),
    before = structuredClone(original);
  const moved = editMotionTimeline(original, {
    kind: "move",
    index: 1,
    target: 0,
  });
  assert.deepEqual(
    moved.subtitles.map((c) => [c.start_frame, c.end_frame, c.text]),
    [
      [0, 30, "Across the cut"],
      [270, 300, "Across the cut"],
      [300, 400, "Keep this wording"],
    ],
  );
  const shorter = editMotionTimeline(original, {
    kind: "duration",
    index: 0,
    frames: 75,
  });
  assert.equal(shorter.duration_frames, 375);
  assert.deepEqual(
    shorter.subtitles.map((c) => [c.start_frame, c.end_frame]),
    [
      [60, 75],
      [75, 105],
      [225, 325],
    ],
  );
  const copy = editMotionTimeline(original, {
    kind: "duplicate",
    index: 0,
    key: "copy",
  });
  assert.equal(copy.duration_frames, 600);
  assert.equal(
    copy.subtitles.filter((c) => c.text === "Across the cut").length,
    3,
  );
  assert.equal(
    new Set(copy.subtitles.map((c) => c.key)).size,
    copy.subtitles.length,
  );
  const removed = editMotionTimeline(original, { kind: "remove", index: 0 });
  assert.equal(removed.duration_frames, 300);
  assert.equal(removed.subtitles[0].end_frame, 30);
  const added = editMotionTimeline(original, {
    kind: "add",
    index: 0,
    key: "blank",
  });
  assert.equal(added.storyboard[1].image, null);
  assert.ok(
    added.subtitles.every((c) => c.end_frame <= 150 || c.start_frame >= 300),
  );
  assert.deepEqual(original, before);
  for (const d of [moved, shorter, copy, removed, added])
    assert.ok(motionValid(d));
});
test("rational rate conversion preserves seconds and owned-audio in point within half a frame", () => {
  const d = withCues();
  d.audio = {
    source: { asset_id: "00000000-0000-4000-8000-000000000001", version: 7 },
    source_in_frame: 300,
    gain_db: -3,
    role: "music",
    rights_basis: "owned",
    rights_reference: "Provided by the team",
  };
  d.storyboard[1].transition = { kind: "crossfade", frames: 15 };
  for (const rate of [
    { numerator: 24, denominator: 1 },
    { numerator: 30000, denominator: 1001 },
  ]) {
    const x = retimeMotion(d, rate),
      epsilon = rate.denominator / rate.numerator / 2;
    assert.ok(Math.abs(motionSeconds(x) - motionSeconds(d)) <= epsilon);
    assert.ok(
      Math.abs(motionSeconds(x, x.audio!.source_in_frame) - 10) <= epsilon,
    );
    assert.equal(x.audio!.source.version, 7);
    assert.equal(x.storyboard[1].transition!.kind, "crossfade");
  }
  assert.equal(d.frame_rate.numerator, 30);
  assert.equal(d.audio.source_in_frame, 300);
});
test("invalid and over-budget timeline operations are refused with exact original contents retained", () => {
  const d = withCues(),
    before = structuredClone(d);
  d.storyboard[1].transition = { kind: "slide-left", frames: 15 };
  const saved = structuredClone(d);
  for (const action of [
    { kind: "duration", index: 1, frames: 1 },
    { kind: "duration", index: 0, frames: 0 },
    { kind: "duration", index: 0, frames: 1800 },
    { kind: "move", index: 0, target: 3 },
    { kind: "duplicate", index: 0, key: "scene_1" },
  ] as const) {
    assert.throws(() => editMotionTimeline(d, action));
    assert.deepEqual(d, saved);
  }
  const next = editMotionTimeline(d, { kind: "move", index: 1, target: 0 });
  assert.equal(next.storyboard[0].transition, undefined);
  assert.ok(motionValid(before));
  const invalid = structuredClone(before);
  invalid.storyboard[0].transition = { kind: "crossfade", frames: 1 };
  assert.equal(motionValid(invalid), false);
});
class Store {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(i: number) {
    return [...this.values.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.values.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.values.set(k, v);
  }
  removeItem(k: string) {
    this.values.delete(k);
  }
}
test("session drafts are owner/project scoped, bounded, explicit and retain only the exact original pending request", () => {
  const store = new Store();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: store,
  });
  const snapshot = { name: "Actual draft", definition: blankMotion("en") },
    key = "00000000-0000-4000-8000-000000000001",
    pending = {
      key,
      signature: JSON.stringify({
        name: snapshot.name,
        definition: snapshot.definition,
        expected_version: 2,
      }),
    };
  assert.ok(keepMotionDraft("user:project", "work", 2, snapshot, pending));
  assert.deepEqual(readMotionDraft("user:project", "work")!.pending, pending);
  assert.equal(readMotionDraft("other:project", "work"), null);
  assert.equal(readMotionDraft("user:other", "work"), null);
  assert.ok(
    keepMotionDraft("user:project", "tampered", 2, snapshot, {
      ...pending,
      signature: "different body",
    }),
  );
  assert.equal(readMotionDraft("user:project", "tampered"), null);
  for (let i = 0; i < 7; i++)
    assert.ok(keepMotionDraft("user:project", "other" + i, 0, snapshot, null));
  assert.equal(
    keepMotionDraft("user:project", "ninth", 0, snapshot, null),
    false,
  );
  assert.ok(readMotionDraft("user:project", "work"));
  const draftKey = motionDraftPrefix + encodeURIComponent("user:project:work"),
    old = JSON.parse(store.getItem(draftKey)!);
  old.at = Date.now() - 8 * 60 * 60 * 1000 - 1;
  store.setItem(draftKey, JSON.stringify(old));
  assert.equal(readMotionDraft("user:project", "work"), null);
  assert.ok(keepMotionDraft("user:project", "ninth", 0, snapshot, null));
  store.setItem("unrelated", "retained");
  clearMotionDrafts();
  assert.equal(store.length, 1);
  assert.equal(store.getItem("unrelated"), "retained");
});
