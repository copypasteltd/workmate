import { z } from "zod";
import { canonical, hash, uuid } from "./lib.js";

/** Every registered format shares the same explicit approval and effect protocol. */
export const publicationProtocol = "marketing-publication/1.0.0";
export const publicationFormats = [
  "facebook_post",
  "facebook_photo",
  "facebook_gallery",
  "facebook_video",
  "instagram_photo",
  "instagram_reel",
  "instagram_carousel",
  "instagram_story",
] as const;
export const publicationFormat = z.enum(publicationFormats);
export type PublicationFormat = z.infer<typeof publicationFormat>;
export const publicationStates = [
  "awaiting_confirmation",
  "queued",
  "preparing",
  "waiting_media",
  "publishing",
  "processing",
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "unknown",
  "closed_unknown",
] as const;
export const publicationState = z.enum(publicationStates);
export type PublicationState = z.infer<typeof publicationState>;
export const providerIdentifier = z.string().regex(/^[1-9][0-9]{0,29}$/);
export const remotePublicationIdentifier = z
  .string()
  .regex(/^[1-9][0-9]{0,29}(?:_[1-9][0-9]{0,29})?$/);
export const publicationSha = z.string().regex(/^[a-f0-9]{64}$/);
export const publicationDigest = (value: unknown) => hash(canonical(value));
const text = (maximum: number) =>
  z
    .string()
    .max(maximum * 2)
    .refine(
      (value) =>
        [...value].length <= maximum &&
        !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\p{Surrogate}]/u.test(
          value,
        ),
      "Use supported text within the character limit",
    );
export const publicationSourceInput = z
  .object({
    asset_id: uuid,
    version: z.number().int().positive(),
    expected_sha256: publicationSha,
    alt_text: text(1000).default(""),
    jpeg_background: z.string().regex(/^#[a-fA-F0-9]{6}$/).default("#ffffff"),
  })
  .strict();
export const publicationDraft = z
  .object({
    target_id: uuid,
    format: publicationFormat,
    caption: text(63206).default(""),
    title: text(255).default(""),
    link: z.string().max(4000).url().nullable().default(null),
    sources: z.array(publicationSourceInput).max(10).default([]),
    share_to_feed: z.boolean().default(true),
  })
  .strict()
  .superRefine((value, ctx) => {
    const issue = (message: string, path: string) =>
      ctx.addIssue({ code: "custom", message, path: [path] });
    const count = value.sources.length;
    const format = value.format;
    if (format.startsWith("instagram_") && [...value.caption].length > 2200)
      issue("Instagram captions support at most 2200 characters", "caption");
    if (format === "facebook_post") {
      if (count !== 0) issue("Choose a media format for attachments", "sources");
      if (!value.caption.trim() && !value.link)
        issue("Add post text or a link", "caption");
    } else if (["facebook_gallery", "instagram_carousel"].includes(format)) {
      if (count < 2) issue("Choose two to ten media items", "sources");
    } else if (count !== 1) issue("Choose one media item", "sources");
    if (value.link && format !== "facebook_post")
      issue("Links are supported in Facebook text/link posts", "link");
    if (value.link) {
      const url = new URL(value.link);
      if (url.protocol !== "https:" || url.username || url.password)
        issue("Choose an HTTPS link without embedded credentials", "link");
    }
    if (format === "instagram_story" && value.caption !== "")
      issue("Include story text in the selected media", "caption");
    if (format !== "facebook_video" && value.title !== "")
      issue("Titles apply to Facebook videos", "title");
    if (format !== "instagram_reel" && !value.share_to_feed)
      issue("Feed sharing applies to Instagram Reels", "share_to_feed");
    const identities = value.sources.map((source) =>
      [source.asset_id, source.version].join(":"),
    );
    if (new Set(identities).size !== identities.length)
      issue("Choose each media version once", "sources");
  });
export type PublicationDraft = z.infer<typeof publicationDraft>;
export const publicationPolicyBody = z
  .object({
    enabled: z.boolean(),
    formats: z.array(publicationFormat).min(1).max(publicationFormats.length),
    maximum_daily_publications: z.number().int().min(1).max(100),
    expires_at: z.string().datetime({ offset: true }),
    confirmation: z.literal("each_operation"),
  })
  .strict()
  .refine((value) => new Set(value.formats).size === value.formats.length, {
    message: "Choose each format once",
    path: ["formats"],
  });
export type PublicationPolicy = z.infer<typeof publicationPolicyBody>;
export const publicationPolicyInput = z
  .object({
    expected_version: z.number().int().nonnegative(),
    policy: publicationPolicyBody,
  })
  .strict();
export const publicationPrepareInput = z
  .object({ preview_id: uuid, payload_sha256: publicationSha })
  .strict();
export const publicationRevisionInput = z
  .object({ expected_version: z.number().int().positive() })
  .strict();
export const publicationDecisionInput = publicationRevisionInput
  .extend({
    payload_sha256: publicationSha,
    decision: z.enum(["confirm", "reject"]),
    acknowledge_publication: z.literal(true),
    acknowledge_previous_unknown: z.boolean().default(false),
  })
  .strict();
export const publicationObserveInput = publicationRevisionInput
  .extend({ remote_id: remotePublicationIdentifier.optional() })
  .strict();
export const publicationCloseInput = publicationRevisionInput
  .extend({
    observation_sha256: publicationSha,
    reason: text(1000).refine((value) => value.trim().length >= 5),
    acknowledge_unknown_attribution: z.literal(true),
  })
  .strict();
export const publicationConnectionInput = z
  .object({ project_id: uuid, connection_id: uuid.optional(), expected_version: z.number().int().positive().optional() })
  .strict().refine(value => !!value.connection_id === (value.expected_version !== undefined),
    "Reconnect using the current connection version");
export const publicationScopeInput = z
  .object({
    expected_version: z.number().int().positive(),
    project_ids: z.array(uuid).min(1).max(20),
    target_ids: z.array(uuid).max(100),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.project_ids).size === value.project_ids.length &&
      new Set(value.target_ids).size === value.target_ids.length,
    "Choose each project and account once",
  );
export const publicationPlatform = (format: PublicationFormat) =>
  format.startsWith("facebook_") ? "facebook_page" : "instagram_professional";
export const publicationTerminal = new Set<PublicationState>([
  "succeeded",
  "failed",
  "cancelled",
  "expired",
  "closed_unknown",
]);
/** Unknown effects consume the allowance until a distinct manual resolution. */
export const publicationConsumesAllowance = (state: PublicationState) =>
  !["failed", "cancelled", "expired"].includes(state);

export const publicationMedia = z.object({
  asset_id: uuid,
  asset_version_id: uuid,
  version: z.number().int().positive(),
  name: text(1000),
  source_sha256: publicationSha,
  source_mime: z.enum(["image/png", "image/jpeg", "video/mp4"]),
  source_bytes: z.number().int().positive().max(1_073_741_824),
  storage_key: z.string().regex(/^objects\/[a-f\d-]{36}$/),
  sha256: publicationSha,
  mime: z.enum(["image/png", "image/jpeg", "video/mp4"]),
  bytes: z.number().int().positive().max(1_073_741_824),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_ms: z.number().int().positive().nullable(),
  alt_text: text(1000),
  jpeg_background: z.string().regex(/^#[a-fA-F0-9]{6}$/).nullable(),
}).strict();
export type PublicationMedia = z.infer<typeof publicationMedia>;
export const publicationSpecification = z.object({
  protocol: z.literal(publicationProtocol),
  tenant_id: uuid,
  project_id: uuid,
  actor_id: uuid,
  actor_auth_version: z.number().int().positive(),
  connection_id: uuid,
  connection_auth_version: z.number().int().positive(),
  configuration_sha256: publicationSha,
  target: z.object({
    id: uuid,
    kind: z.enum(["facebook_page", "instagram_professional"]),
    external_id: providerIdentifier,
    page_id: providerIdentifier,
    name: text(1000),
    auth_version: z.number().int().positive(),
  }).strict(),
  policy_id: uuid,
  policy_version: z.number().int().positive(),
  policy_sha256: publicationSha,
  draft: publicationDraft,
  sources: z.array(publicationMedia).max(10),
  previous_unknown_ids: z.array(uuid).max(100),
  data_mode: z.enum(["simulated", "configured_services"]),
  expires_at: z.string().datetime({ offset: true }),
}).strict().superRefine((s, ctx) => {
  if (s.target.id !== s.draft.target_id || s.target.kind !== publicationPlatform(s.draft.format) ||
      s.sources.length !== s.draft.sources.length || s.sources.some((source, i) => {
        const selected = s.draft.sources[i];
        return source.asset_id !== selected.asset_id || source.version !== selected.version ||
          source.source_sha256 !== selected.expected_sha256 || source.alt_text !== selected.alt_text;
      })) ctx.addIssue({ code: "custom", message: "The frozen target and media must match the draft" });
});
export type PublicationSpecification = z.infer<typeof publicationSpecification>;
