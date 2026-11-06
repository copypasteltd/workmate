export type MotionRef = { asset_id: string; version: number } | null;
export type MotionScene = {
  key: string;
  start_frame: number;
  end_frame: number;
  direction: string;
  headline: string;
  body: string;
  image: MotionRef;
  transition?: { kind: "crossfade" | "slide-left"; frames: number };
};
export type MotionCue = {
  key: string;
  start_frame: number;
  end_frame: number;
  text: string;
};
export type MotionDefinition = {
  schema_version: "copypaste-video-1";
  template: "campaign-cuts-1";
  locale: string;
  width: number;
  height: number;
  frame_rate: { numerator: number; denominator: number };
  duration_frames: number;
  script: {
    title: string;
    brief: string;
    narration: string;
    call_to_action: string;
  };
  brand: {
    label: string;
    background: string;
    ink: string;
    accent: string;
    logo: MotionRef;
  };
  storyboard: MotionScene[];
  subtitles: MotionCue[];
  audio: {
    source: NonNullable<MotionRef>;
    source_in_frame: number;
    gain_db: number;
    role: string;
    rights_basis: string;
    rights_reference: string;
  } | null;
};
export const motionSeconds = (
  d: MotionDefinition,
  frames = d.duration_frames,
) => (frames * d.frame_rate.denominator) / d.frame_rate.numerator;
const integer = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max;
const printable = (v: unknown, max: number, nonempty = false) =>
  typeof v === "string" &&
  v.length <= max &&
  (!nonempty || v.trim().length > 0) &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v);
export function motionValid(d: MotionDefinition): boolean {
  try {
    if (
      d.schema_version !== "copypaste-video-1" ||
      d.template !== "campaign-cuts-1" ||
      !["zh-HK", "en"].includes(d.locale) ||
      !integer(d.width, 256, 1920) ||
      !integer(d.height, 256, 1920) ||
      d.width % 2 ||
      d.height % 2 ||
      !["24/1", "25/1", "30/1", "30000/1001"].includes(
        d.frame_rate.numerator + "/" + d.frame_rate.denominator,
      ) ||
      !integer(d.duration_frames, 72, 1800) ||
      motionSeconds(d) < 3 ||
      motionSeconds(d) > 60 ||
      d.width * d.height * d.duration_frames > 2_100_000_000 ||
      !integer(d.storyboard.length, 1, 20) ||
      !integer(d.subtitles.length, 0, 80)
    )
      return false;
    if (
      !printable(d.script.title, 160, true) ||
      !printable(d.script.brief, 2000) ||
      !printable(d.script.narration, 6000) ||
      !printable(d.script.call_to_action, 100) ||
      !printable(d.brand.label, 80)
    )
      return false;
    if (
      ![d.brand.background, d.brand.ink, d.brand.accent].every((c) =>
        /^#[a-f0-9]{6}$/i.test(c),
      )
    )
      return false;
    const ref = (r: MotionRef) =>
      r === null ||
      (typeof r?.asset_id === "string" &&
        /^[a-f\d-]{36}$/i.test(r.asset_id) &&
        integer(r.version, 1, 2147483647));
    if (!ref(d.brand.logo)) return false;
    let end = 0;
    const ids = new Set<string>();
    for (const [i, s] of d.storyboard.entries()) {
      if (
        !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(s.key) ||
        ids.has(s.key) ||
        !integer(s.start_frame, 0, 1800) ||
        !integer(s.end_frame, 1, 1800) ||
        s.start_frame !== end ||
        s.end_frame <= s.start_frame ||
        s.end_frame > d.duration_frames ||
        !printable(s.direction, 1000) ||
        !printable(s.headline, 240, true) ||
        !printable(s.body, 500) ||
        !ref(s.image)
      )
        return false;
      if (
        s.transition &&
        (i === 0 ||
          !["crossfade", "slide-left"].includes(s.transition.kind) ||
          !integer(
            s.transition.frames,
            1,
            Math.min(45, Math.floor((s.end_frame - s.start_frame) / 2)),
          ))
      )
        return false;
      end = s.end_frame;
      ids.add(s.key);
    }
    if (end !== d.duration_frames) return false;
    end = 0;
    ids.clear();
    for (const c of d.subtitles) {
      if (
        !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(c.key) ||
        ids.has(c.key) ||
        !integer(c.start_frame, 0, 1800) ||
        !integer(c.end_frame, 1, d.duration_frames) ||
        c.start_frame < end ||
        c.end_frame <= c.start_frame ||
        !printable(c.text, 240, true)
      )
        return false;
      ids.add(c.key);
      end = c.end_frame;
    }
    if (
      d.audio &&
      (!ref(d.audio.source) ||
        !integer(d.audio.source_in_frame, 0, 108000) ||
        !Number.isFinite(d.audio.gain_db) ||
        d.audio.gain_db < -36 ||
        d.audio.gain_db > 0 ||
        !["music", "provided_voice"].includes(d.audio.role) ||
        !["owned", "licensed"].includes(d.audio.rights_basis) ||
        !printable(d.audio.rights_reference, 500, true) ||
        d.audio.rights_reference.trim().length < 3)
    )
      return false;
    return true;
  } catch {
    return false;
  }
}
function checked(d: MotionDefinition) {
  if (!motionValid(d)) throw Error("MOTION_TIMELINE_INVALID");
  return d;
}
type Placement = {
  origin: string;
  scene: MotionScene;
  duration: number;
  captions?: boolean;
};
/** Split cross-scene captions before mapping. No content is silently truncated. */
function reflow(input: MotionDefinition, placements: Placement[]) {
  const d = structuredClone(input);
  let frame = 0,
    counter = 0;
  const cues: MotionCue[] = [];
  d.storyboard = placements.map(
    ({ origin, scene, duration, captions }, index) => {
      const old = input.storyboard.find((s) => s.key === origin);
      if (!old || !integer(duration, 1, 1800))
        throw Error("MOTION_TIMELINE_INVALID");
      const start = frame;
      frame += duration;
      const next = { ...scene, start_frame: start, end_frame: frame };
      if (index === 0) delete next.transition;
      for (const cue of captions === false ? [] : input.subtitles) {
        const a = Math.max(cue.start_frame, old.start_frame),
          b = Math.min(cue.end_frame, old.end_frame);
        if (a >= b) continue;
        cues.push({
          ...cue,
          key: "cue_" + counter++,
          start_frame:
            start +
            Math.round(
              ((a - old.start_frame) * duration) /
                (old.end_frame - old.start_frame),
            ),
          end_frame:
            start +
            Math.round(
              ((b - old.start_frame) * duration) /
                (old.end_frame - old.start_frame),
            ),
        });
      }
      return next;
    },
  );
  d.subtitles = cues.sort((a, b) => a.start_frame - b.start_frame);
  d.duration_frames = frame;
  return checked(d);
}
export type MotionAction =
  | { kind: "duration"; index: number; frames: number }
  | { kind: "move"; index: number; target: number }
  | { kind: "remove"; index: number }
  | { kind: "duplicate" | "add"; index: number; key: string };
export function editMotionTimeline(
  input: MotionDefinition,
  action: MotionAction,
) {
  checked(input);
  const placements: Placement[] = input.storyboard.map((s) => ({
    origin: s.key,
    scene: structuredClone(s),
    duration: s.end_frame - s.start_frame,
  }));
  if (!integer(action.index, 0, placements.length - 1))
    throw Error("MOTION_TIMELINE_INVALID");
  const current = placements[action.index];
  if (action.kind === "duration") current.duration = action.frames;
  else if (action.kind === "remove") placements.splice(action.index, 1);
  else if (action.kind === "move") {
    if (!integer(action.target, 0, placements.length - 1))
      throw Error("MOTION_TIMELINE_INVALID");
    placements.splice(action.target, 0, ...placements.splice(action.index, 1));
  } else {
    const copy = structuredClone(current);
    copy.scene.key = action.key;
    if (action.kind === "add") {
      copy.captions = false;
      copy.scene.headline =
        input.locale === "en" ? "Add your next scene" : "加入下一個鏡頭";
      copy.scene.body = "";
      copy.scene.direction = "";
      copy.scene.image = null;
      delete copy.scene.transition;
    }
    placements.splice(action.index + 1, 0, copy);
  }
  // A newly inserted blank scene receives no copied captions.
  const result = reflow(input, placements);
  if (action.kind === "add") {
    const inserted = result.storyboard[action.index + 1];
    result.subtitles = result.subtitles.filter(
      (c) =>
        c.end_frame <= inserted.start_frame ||
        c.start_frame >= inserted.end_frame,
    );
  }
  return checked(result);
}
export function retimeMotion(
  input: MotionDefinition,
  rate: MotionDefinition["frame_rate"],
) {
  checked(input);
  const d = structuredClone(input),
    scale =
      (rate.numerator * input.frame_rate.denominator) /
      (input.frame_rate.numerator * rate.denominator),
    convert = (f: number) => Math.round(f * scale);
  d.frame_rate = { ...rate };
  d.duration_frames = convert(input.duration_frames);
  d.storyboard = d.storyboard.map((s) => ({
    ...s,
    start_frame: convert(s.start_frame),
    end_frame: convert(s.end_frame),
    ...(s.transition
      ? {
          transition: { ...s.transition, frames: convert(s.transition.frames) },
        }
      : {}),
  }));
  d.subtitles = d.subtitles.map((c) => ({
    ...c,
    start_frame: convert(c.start_frame),
    end_frame: convert(c.end_frame),
  }));
  if (d.audio) d.audio.source_in_frame = convert(d.audio.source_in_frame);
  return checked(d);
}
export function blankMotion(locale: string): MotionDefinition {
  return {
    schema_version: "copypaste-video-1",
    template: "campaign-cuts-1",
    locale,
    width: 720,
    height: 1280,
    frame_rate: { numerator: 30, denominator: 1 },
    duration_frames: 450,
    script: {
      title: locale === "en" ? "Your next story" : "下一段故事",
      brief: "",
      narration: "",
      call_to_action: locale === "en" ? "Find out more" : "了解更多",
    },
    brand: {
      label: "",
      background: "#f4f5f7",
      ink: "#161c28",
      accent: "#2458df",
      logo: null,
    },
    storyboard: [0, 1, 2].map((i) => ({
      key: "scene_" + (i + 1),
      start_frame: i * 150,
      end_frame: (i + 1) * 150,
      direction: "",
      headline:
        locale === "en"
          ? [
              "Start with an idea",
              "Share what matters",
              "Invite the next step",
            ][i]
          : ["從一個想法開始", "分享真正的亮點", "邀請下一步行動"][i],
      body: "",
      image: null,
    })),
    subtitles: [],
    audio: null,
  };
}
