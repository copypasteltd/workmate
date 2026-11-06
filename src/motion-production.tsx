import { useEffect, useRef, useState } from "react";
import { browserCrypto as crypto } from "./browser-crypto";
import { api } from "./api";
import { ErrorNotice, Field, useData, useI18n } from "./ui";
import {
  editMotionTimeline,
  retimeMotion,
  motionSeconds,
  motionValid,
  type MotionDefinition,
  type MotionRef,
  type MotionAction,
} from "./motion-editor-model";

export function MotionStarters({
  base,
  disabled,
  choose,
}: {
  base: string;
  disabled: boolean;
  choose: (d: MotionDefinition) => void;
}) {
  const { t, locale } = useI18n(),
    [open, setOpen] = useState(false),
    [format, setFormat] = useState("portrait");
  const data = useData<{
    items: {
      id: string;
      name: Record<string, string>;
      definition: MotionDefinition;
    }[];
  }>(
    open
      ? base +
          "/video-projects/templates?locale=" +
          locale +
          "&format=" +
          format
      : null,
  );
  return (
    <details
      className="motion-starters"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>{t("從影片版面開始", "Start with a video layout")}</summary>
      <p className="muted">
        {t(
          "先選結構，再換上你的真實文案和素材。選用版面會替換目前未儲存內容，可用復原返回。",
          "Choose a structure, then add your actual copy and media. Applying a layout replaces this draft; Undo takes you back.",
        )}
      </p>
      <Field label={t("版面比例", "Layout format")}>
        <select
          value={format}
          disabled={disabled}
          onChange={(e) => setFormat(e.target.value)}
        >
          <option value="portrait">9:16 · 720 × 1280</option>
          <option value="square">1:1 · 720 × 720</option>
          <option value="landscape">16:9 · 1280 × 720</option>
        </select>
      </Field>
      <ErrorNotice error={data.error} />
      <div className="motion-starter-grid">
        {data.data?.items.map((item) => (
          <button
            type="button"
            className="motion-starter"
            key={item.id}
            disabled={disabled}
            onClick={() => choose(structuredClone(item.definition))}
          >
            <span>{item.name[locale]}</span>
            <small>
              {item.definition.storyboard.length}{" "}
              {t("鏡頭 · 15秒", "scenes · 15 seconds")}
            </small>
            <i aria-hidden="true">{item.definition.storyboard[0].headline}</i>
          </button>
        ))}
      </div>
    </details>
  );
}
type Resource = {
  asset_id: string;
  version: number;
  source_version_id: string;
  name: string;
  sha256: string;
  mime_type: string;
  bytes: string;
};
export function MotionSourceChoice({
  label,
  value,
  base,
  audio = false,
  onChange,
}: {
  label: string;
  value: MotionRef;
  base: string;
  assets?: any[];
  audio?: boolean;
  onChange: (v: MotionRef) => void;
}) {
  const { t } = useI18n(),
    [open, setOpen] = useState(false);
  return (
    <details
      className="motion-resource"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>
        {label} · {value ? "v" + value.version : t("不使用", "None")}
      </summary>
      {value && (
        <button
          className="text-button"
          type="button"
          onClick={() => onChange(null)}
        >
          {t("移除這個素材引用", "Remove this source reference")}
        </button>
      )}
      {open && (
        <MotionResourcePage
          key={base + ":" + audio}
          base={base}
          audio={audio}
          value={value}
          choose={onChange}
        />
      )}
    </details>
  );
}
function MotionResourcePage({
  base,
  audio,
  value,
  choose,
}: {
  base: string;
  audio: boolean;
  value: MotionRef;
  choose: (v: MotionRef) => void;
}) {
  const { t } = useI18n(),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(""),
    [cursor, setCursor] = useState<string | null>(null);
  const data = useData<{ items: Resource[]; next_cursor: string | null }>(
    base +
      "/video-projects/resources?kind=" +
      (audio ? "audio" : "image") +
      "&q=" +
      encodeURIComponent(search) +
      (cursor ? "&cursor=" + cursor : ""),
  );
  return (
    <div className="motion-resource-page">
      <p className="muted">
        {t(
          "只列出本項目共用且有效的固定版本。素材在預覽與製作時會重新核查。",
          "Only active shared fixed versions in this project appear. Sources are rechecked when previewing and rendering.",
        )}
      </p>
      <Field label={t("搜尋影片素材", "Search video sources")}>
        <input
          value={query}
          maxLength={150}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setSearch(query.trim());
              setCursor(null);
            }
          }}
        />
      </Field>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setSearch(query.trim());
          setCursor(null);
        }}
      >
        {t("搜尋素材", "Search sources")}
      </button>
      <ErrorNotice error={data.error} />
      {data.data?.items.length === 0 && (
        <p>
          {t(
            "沒有符合的共用素材。可先到檔案上傳並明確發布。",
            "No matching shared sources. Upload and explicitly publish a file first.",
          )}
        </p>
      )}
      <div className="motion-resource-list">
        {data.data?.items.map((a) => (
          <button
            type="button"
            className="motion-resource-item"
            key={a.source_version_id}
            aria-pressed={
              value?.asset_id === a.asset_id && value.version === a.version
            }
            onClick={() => choose({ asset_id: a.asset_id, version: a.version })}
          >
            <span>{a.name}</span>
            <small>
              v{a.version} · {(Number(a.bytes) / 1024 / 1024).toFixed(2)} MB
            </small>
          </button>
        ))}
      </div>
      <div className="row-actions">
        {data.data?.next_cursor && (
          <button
            type="button"
            className="text-button"
            onClick={() => setCursor(data.data!.next_cursor)}
          >
            {t("下一頁素材", "Next sources")}
          </button>
        )}
        {cursor && (
          <button
            type="button"
            className="text-button"
            onClick={() => setCursor(null)}
          >
            {t("返回第一頁", "First page")}
          </button>
        )}
      </div>
    </div>
  );
}
export function MotionTimeline({
  definition: d,
  disabled,
  change,
}: {
  definition: MotionDefinition;
  disabled: boolean;
  change: (d: MotionDefinition) => void;
}) {
  const { t } = useI18n(),
    [error, setError] = useState<unknown>(null);
  const apply = (operation: () => MotionDefinition) => {
    try {
      const next = operation();
      if (!motionValid(next)) throw Error("MOTION_TIMELINE_INVALID");
      change(next);
      setError(null);
    } catch {
      setError(
        new Error(
          t(
            "這次調整無法保持完整時間線、字幕或製作上限。請先補齊內容、減少時長或調短轉場；原工程未變。",
            "This change cannot preserve the full timeline, captions or render limits. Complete the fields, shorten the work or reduce a transition first. The original work is unchanged.",
          ),
        ),
      );
    }
  };
  const action = (a: MotionAction) => apply(() => editMotionTimeline(d, a));
  return (
    <section
      className="motion-timeline-editor"
      aria-label={t("編排鏡頭", "Arrange scenes")}
    >
      <h3>{t("編排鏡頭", "Arrange scenes")}</h3>
      <p className="muted">
        {t(
          "延長或移動鏡頭時，字幕跟隨原鏡頭；跨鏡頭字幕會分段保留原文。移除鏡頭也會移除其字幕，可復原。",
          "When a scene moves or changes duration, its captions follow. Captions crossing cuts split with their text intact. Removing a scene also removes its captions; Undo restores them.",
        )}
      </p>
      <Field label={t("影片幀率", "Video frame rate")}>
        <select
          value={d.frame_rate.numerator + "/" + d.frame_rate.denominator}
          disabled={disabled}
          onChange={(e) => {
            const [numerator, denominator] = e.target.value
              .split("/")
              .map(Number);
            apply(() => retimeMotion(d, { numerator, denominator }));
          }}
        >
          {["24/1", "25/1", "30/1", "30000/1001"].map((rate) => (
            <option key={rate} value={rate}>
              {rate} fps
            </option>
          ))}
        </select>
      </Field>
      <ol className="motion-scene-strip">
        {d.storyboard.map((s, i) => (
          <li key={s.key}>
            <div>
              <strong>
                {i + 1}. {s.headline}
              </strong>
              <small>
                {motionSeconds(d, s.start_frame).toFixed(2)}–
                {motionSeconds(d, s.end_frame).toFixed(2)} s
              </small>
            </div>
            <Field
              label={t(
                `鏡頭 ${i + 1} 時長（幀）`,
                `Scene ${i + 1} duration (frames)`,
              )}
            >
              <input
                type="number"
                min={1}
                max={1800}
                value={s.end_frame - s.start_frame}
                disabled={disabled}
                onChange={(e) =>
                  action({
                    kind: "duration",
                    index: i,
                    frames: Number(e.target.value),
                  })
                }
              />
            </Field>
            <div className="motion-scene-actions">
              <button
                type="button"
                disabled={disabled || i === 0}
                onClick={() =>
                  action({ kind: "move", index: i, target: i - 1 })
                }
              >
                {t("提前", "Earlier")}
              </button>
              <button
                type="button"
                disabled={disabled || i === d.storyboard.length - 1}
                onClick={() =>
                  action({ kind: "move", index: i, target: i + 1 })
                }
              >
                {t("延後", "Later")}
              </button>
              <button
                type="button"
                disabled={disabled || d.storyboard.length >= 20}
                onClick={() =>
                  action({
                    kind: "duplicate",
                    index: i,
                    key: "scene_" + crypto.randomUUID().replaceAll("-", ""),
                  })
                }
              >
                {t("複製", "Duplicate")}
              </button>
              <button
                type="button"
                disabled={disabled || d.storyboard.length <= 1}
                onClick={() => action({ kind: "remove", index: i })}
              >
                {t("移除", "Remove")}
              </button>
            </div>
            {i > 0 && (
              <div className="video-form-grid">
                <Field
                  label={t(`鏡頭 ${i + 1} 轉場`, `Scene ${i + 1} transition`)}
                >
                  <select
                    value={s.transition?.kind ?? "cut"}
                    disabled={disabled}
                    onChange={(e) =>
                      apply(() => {
                        const next = structuredClone(d);
                        if (e.target.value === "cut")
                          delete next.storyboard[i].transition;
                        else
                          next.storyboard[i].transition = {
                            kind: e.target.value as "crossfade" | "slide-left",
                            frames: Math.max(
                              1,
                              Math.min(
                                15,
                                Math.floor((s.end_frame - s.start_frame) / 2),
                              ),
                            ),
                          };
                        return next;
                      })
                    }
                  >
                    <option value="cut">{t("直接剪接", "Cut")}</option>
                    <option value="crossfade">
                      {t("交叉淡化", "Crossfade")}
                    </option>
                    <option value="slide-left">
                      {t("向左滑動", "Slide left")}
                    </option>
                  </select>
                </Field>
                {s.transition && (
                  <Field
                    label={t(
                      `鏡頭 ${i + 1} 轉場幀數`,
                      `Scene ${i + 1} transition frames`,
                    )}
                  >
                    <input
                      type="number"
                      min={1}
                      max={Math.min(
                        45,
                        Math.floor((s.end_frame - s.start_frame) / 2),
                      )}
                      value={s.transition.frames}
                      disabled={disabled}
                      onChange={(e) =>
                        apply(() => {
                          const next = structuredClone(d);
                          next.storyboard[i].transition!.frames = Number(
                            e.target.value,
                          );
                          return next;
                        })
                      }
                    />
                  </Field>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
      <button
        type="button"
        className="button secondary"
        disabled={disabled || d.storyboard.length >= 20}
        onClick={() =>
          action({
            kind: "add",
            index: d.storyboard.length - 1,
            key: "scene_" + crypto.randomUUID().replaceAll("-", ""),
          })
        }
      >
        {t("新增空白鏡頭", "Add blank scene")}
      </button>
      <ErrorNotice error={error} />
    </section>
  );
}
type FramePreview = {
  content_type: "image/png";
  base64: string;
  bytes: number;
  sha256: string;
  frame: number;
  scope: "visual_frame_only";
  saved: false;
};
export function MotionFramePreview({
  base,
  definition: d,
  video,
  version,
  disabled,
}: {
  base: string;
  definition: MotionDefinition;
  video?: string;
  version?: number;
  disabled: boolean;
}) {
  const { t } = useI18n(),
    [frame, setFrame] = useState(0),
    [preview, setPreview] = useState<{
      signature: string;
      data: FramePreview;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const signature = JSON.stringify({ definition: d, frame }),
    latest = useRef(signature),
    operation = useRef<AbortController | null>(null);
  latest.current = signature;
  useEffect(() => {
    setFrame((f) => Math.min(f, d.duration_frames - 1));
  }, [d.duration_frames]);
  useEffect(() => () => operation.current?.abort(), []);
  const show = async () => {
    operation.current?.abort();
    const controller = new AbortController();
    operation.current = controller;
    const observed = signature;
    setBusy(true);
    setError(null);
    try {
      const data = await api<FramePreview>(
        base + "/video-projects/draft-preview",
        {
          method: "POST",
          body: JSON.stringify({
            definition: d,
            frame,
            ...(video ? { video_id: video, expected_version: version } : {}),
          }),
          signal: controller.signal,
        },
      );
      if (
        data.content_type !== "image/png" ||
        data.scope !== "visual_frame_only" ||
        data.saved !== false ||
        data.frame !== frame ||
        !Number.isSafeInteger(data.bytes) ||
        data.bytes < 1 ||
        data.bytes > 20_000_000
      )
        throw Error("VIDEO_PREVIEW_INVALID");
      const raw = atob(data.base64),
        bytes = Uint8Array.from(raw, (c) => c.charCodeAt(0)),
        digest = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
      if (bytes.length !== data.bytes || digest !== data.sha256)
        throw Error("VIDEO_PREVIEW_INTEGRITY");
      if (!controller.signal.aborted && latest.current === observed)
        setPreview({ signature: observed, data });
    } catch (e) {
      if (!controller.signal.aborted && latest.current === observed)
        setError(e);
    } finally {
      if (operation.current === controller) setBusy(false);
    }
  };
  const ready = preview?.signature === signature ? preview.data : null;
  return (
    <section
      className="motion-frame-preview"
      aria-label={t("目前畫面預覽", "Current frame preview")}
    >
      <h3>{t("先看看這一幀", "Review this frame")}</h3>
      <div
        className="motion-preview-stage"
        style={{ aspectRatio: d.width + "/" + d.height }}
      >
        {ready ? (
          <img
            src={"data:image/png;base64," + ready.base64}
            alt={t(`第 ${frame} 幀的實際畫面`, `Actual video frame ${frame}`)}
          />
        ) : (
          <p>
            {t(
              "選擇時間點，再製作實際畫面預覽。",
              "Choose a point, then render its actual frame.",
            )}
          </p>
        )}
      </div>
      <Field label={t("預覽幀", "Preview frame")}>
        <input
          type="range"
          min={0}
          max={Math.max(0, d.duration_frames - 1)}
          value={frame}
          disabled={disabled || busy}
          onChange={(e) => setFrame(Number(e.target.value))}
        />
      </Field>
      <div className="motion-preview-actions">
        <input
          type="number"
          aria-label={t("指定預覽幀", "Exact preview frame")}
          min={0}
          max={d.duration_frames - 1}
          value={frame}
          disabled={disabled || busy}
          onChange={(e) =>
            setFrame(
              Math.max(
                0,
                Math.min(
                  d.duration_frames - 1,
                  Math.floor(Number(e.target.value)),
                ),
              ),
            )
          }
        />
        <span>{motionSeconds(d, frame).toFixed(3)} s</span>
        <button
          type="button"
          className="button secondary"
          disabled={disabled || busy}
          onClick={() => void show()}
        >
          {busy
            ? t("繪製中…", "Rendering…")
            : t("預覽這一幀", "Preview this frame")}
        </button>
      </div>
      <p className="muted" role="status">
        {ready
          ? t(
              "實際畫面已更新 · 尚未製作成片",
              "Actual frame updated · full video not rendered",
            )
          : null}
      </p>
      <p className="muted">
        {t(
          "只預覽畫面，不播放或驗證音軌。儲存後製作成片，才會核查完整影片與聲音。此預覽不收模型費。",
          "This visual preview does not play or validate audio. Save and render the video for full picture and audio checks. This preview has no model charge.",
        )}
      </p>
      <ErrorNotice error={error} />
    </section>
  );
}
