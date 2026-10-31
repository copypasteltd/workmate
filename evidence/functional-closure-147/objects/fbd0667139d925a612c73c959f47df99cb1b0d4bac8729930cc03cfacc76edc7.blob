import { Problem } from "./lib.js";
import {
  publicationSpecification,
  remotePublicationIdentifier,
  type PublicationSpecification,
} from "./publication-model.js";

export interface PublicationEffect {
  step_key: string;
  state: "prepared" | "dispatched" | "applied" | "rejected" | "unknown";
  remote_id: string | null;
}
export interface PublicationProgress {
  containers?: Record<string, {
    status: "IN_PROGRESS" | "FINISHED" | "ERROR" | "EXPIRED" | "PUBLISHED";
    checked_at: string;
  }>;
  quota?: { usage: number; total: number; checked_at: string };
  video?: { published: boolean; status: string; checked_at: string };
}
export interface PublicationWrite {
  kind: "write";
  step_key: string;
  edge: "feed" | "photos" | "videos" | "media" | "media_publish";
  owner_id: string;
  parameters: Record<string, string>;
  public_effect: boolean;
}
export type PublicationPlan = PublicationWrite | {
  kind: "read";
  purpose: "container" | "quota" | "video";
  remote_id: string;
} | { kind: "succeeded" } | { kind: "failed"; error_code: string } | { kind: "unknown"; error_code: string };

/** Pure planner. Only an attributed receipt can advance an irreversible step. */
export function nextPublicationStep(
  input: PublicationSpecification,
  effects: readonly PublicationEffect[],
  progress: PublicationProgress,
  mediaURLs: readonly string[],
  now = Date.now(),
): PublicationPlan {
  const s = publicationSpecification.parse(input), f = s.draft.format;
  if (effects.length > 12 || new Set(effects.map(e => e.step_key)).size !== effects.length)
    throw new Problem(409, "PUBLICATION_EFFECT_CONFLICT", "Inspect the original publication effects");
  if (effects.some(e => ["unknown", "dispatched"].includes(e.state)))
    return { kind: "unknown", error_code: "PUBLICATION_OUTCOME_UNKNOWN" };
  if (effects.some(e => e.state === "rejected"))
    return { kind: "failed", error_code: "PUBLICATION_PROVIDER_REJECTED" };
  const byKey = new Map(effects.map(e => [e.step_key, e]));
  const fresh = (at: string, maximum: number) => {
    const timestamp = Date.parse(at);
    return Number.isFinite(timestamp) && timestamp <= now + 1000 && timestamp >= now - maximum;
  };
  const id = (key: string) => {
    const effect = byKey.get(key);
    if (effect?.state !== "applied") return null;
    const parsed = remotePublicationIdentifier.safeParse(effect.remote_id);
    if (!parsed.success) throw new Problem(409, "PUBLICATION_RECEIPT_INVALID", "Inspect the exact provider receipt");
    return parsed.data;
  };
  const write = (step_key: string, edge: PublicationWrite["edge"],
    parameters: PublicationWrite["parameters"], public_effect = false): PublicationWrite => ({
      kind: "write", step_key, edge, parameters, public_effect,
      owner_id: s.target.external_id,
    });
  const mediaURL = (i: number) => {
    const value = mediaURLs[i];
    if (!value) throw new Problem(409, "PUBLICATION_MEDIA_UNAVAILABLE", "The approved media grant is unavailable");
    return value;
  };
  const isVideo = (i: number) => s.sources[i].mime === "video/mp4";
  const containerReady = (remote_id: string): PublicationPlan | null => {
    const observation = progress.containers?.[remote_id];
    if (!observation || !fresh(observation.checked_at, 300_000))
      return { kind: "read", purpose: "container", remote_id };
    if (["ERROR", "EXPIRED"].includes(observation.status))
      return { kind: "failed", error_code: "PUBLICATION_MEDIA_" + observation.status };
    if (observation.status === "PUBLISHED")
      return { kind: "unknown", error_code: "PUBLICATION_ALREADY_PUBLISHED" };
    return observation.status === "FINISHED" ? null : { kind: "read", purpose: "container", remote_id };
  };
  const published = id("publish");
  if (published) {
    if (f !== "facebook_video") return { kind: "succeeded" };
    const video = progress.video;
    if (!video || !fresh(video.checked_at, 300_000))
      return { kind: "read", purpose: "video", remote_id: published };
    if (video.published && video.status === "ready") return { kind: "succeeded" };
    if (video.status === "error")
      return video.published ? { kind: "unknown", error_code: "PUBLICATION_VIDEO_CONFLICT" } :
        { kind: "failed", error_code: "PUBLICATION_VIDEO_PROCESSING_FAILED" };
    return { kind: "read", purpose: "video", remote_id: published };
  }
  if (f === "facebook_post") return write("publish", "feed", {
    message: s.draft.caption,
    ...(s.draft.link ? { link: s.draft.link } : {}), published: "true",
  }, true);
  if (["facebook_photo", "facebook_gallery"].includes(f)) {
    const photos: string[] = [];
    for (let i = 0; i < s.sources.length; i++) {
      if (isVideo(i)) throw new Problem(422, "PUBLICATION_MEDIA_TYPE", "Facebook photo posts require images");
      const uploaded = id("upload_" + i);
      if (!uploaded) return write("upload_" + i, "photos", {
        url: mediaURL(i), published: "false",
        ...(s.sources[i].alt_text ? { alt_text_custom: s.sources[i].alt_text } : {}),
      });
      photos.push(uploaded);
    }
    return write("publish", "feed", {
      message: s.draft.caption, published: "true",
      attached_media: JSON.stringify(photos.map(media_fbid => ({ media_fbid }))),
    }, true);
  }
  if (f === "facebook_video") {
    if (!isVideo(0)) throw new Problem(422, "PUBLICATION_MEDIA_TYPE", "Choose an MP4 video");
    return write("publish", "videos", {
      file_url: mediaURL(0), description: s.draft.caption, title: s.draft.title, published: "true",
    }, true);
  }
  if (f === "instagram_photo" && isVideo(0))
    throw new Problem(422, "PUBLICATION_MEDIA_TYPE", "Choose a JPEG image");
  if (f === "instagram_reel" && !isVideo(0))
    throw new Problem(422, "PUBLICATION_MEDIA_TYPE", "Choose an MP4 video");
  if (s.sources.some(source => source.mime !== "image/jpeg" && source.mime !== "video/mp4"))
    throw new Problem(422, "PUBLICATION_MEDIA_TYPE", "Approve the JPEG rendition before publishing");
  let container = id("container");
  if (!container) {
    if (f === "instagram_carousel") {
      const children: string[] = [];
      for (let i = 0; i < s.sources.length; i++) {
        const child = id("child_" + i);
        if (!child) return write("child_" + i, "media", {
          is_carousel_item: "true",
          ...(isVideo(i) ? { media_type: "VIDEO", video_url: mediaURL(i) } : {
            image_url: mediaURL(i), ...(s.sources[i].alt_text ? { alt_text: s.sources[i].alt_text } : {}),
          }),
        });
        const check = containerReady(child);
        if (check) return check;
        children.push(child);
      }
      return write("container", "media", {
        media_type: "CAROUSEL", children: children.join(","), caption: s.draft.caption,
      });
    }
    return write("container", "media", {
      ...(isVideo(0) ? { video_url: mediaURL(0) } : { image_url: mediaURL(0) }),
      ...(f === "instagram_reel" ? { media_type: "REELS", share_to_feed: String(s.draft.share_to_feed) } : {}),
      ...(f === "instagram_story" ? { media_type: "STORIES" } : { caption: s.draft.caption }),
      ...(f === "instagram_photo" && s.sources[0].alt_text ? { alt_text: s.sources[0].alt_text } : {}),
    });
  }
  const check = containerReady(container);
  if (check) return check;
  const quota = progress.quota;
  if (!quota || !fresh(quota.checked_at, 30_000))
    return { kind: "read", purpose: "quota", remote_id: s.target.external_id };
  if (!Number.isSafeInteger(quota.usage) || !Number.isSafeInteger(quota.total) || quota.usage < 0 || quota.total < 1)
    return { kind: "failed", error_code: "PUBLICATION_QUOTA_INVALID" };
  if (quota.usage >= quota.total) return { kind: "failed", error_code: "PUBLICATION_PROVIDER_QUOTA" };
  return write("publish", "media_publish", { creation_id: container }, true);
}
