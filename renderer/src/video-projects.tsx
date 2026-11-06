import { useEffect, useRef, useState } from "react";
import {
  Film,
  Plus,
  Pencil,
  Play,
  Download,
  X,
  ArrowUpRight,
} from "lucide-react";
import { api, post, download } from "./api";
import {
  AsyncForm,
  ErrorNotice,
  Field,
  Modal,
  Badge,
  useData,
  useI18n,
} from "./ui";
import "./video-projects.css";

import { useWorkspace } from "./context";
import {
  motionSeconds,
  blankMotion,
  motionValid,
  type MotionDefinition as Definition,
  type MotionScene as Scene,
  type MotionCue as Cue,
} from "./motion-editor-model";
import {
  MotionStarters,
  MotionTimeline,
  MotionFramePreview,
  MotionSourceChoice as SourceChoice,
} from "./motion-production";
import { useMotionEditor } from "./use-motion-editor";
type Render = {
  id: string;
  version: number;
  revision: number;
  state: string;
  error_code: string | null;
  output_available: boolean;
  mp4_asset_id: string | null;
  project_asset_id: string | null;
  script_asset_id: string | null;
  storyboard_asset_id: string | null;
  subtitles_asset_id: string | null;
  probe_asset_id: string | null;
  created_at: string;
  elapsed_ms: number | null;
  probe: any;
};
type Project = {
  id: string;
  name: string;
  version: number;
  definition: Definition;
  renders: Render[];
  versions: { version: number; created_at: string }[];
};
const seconds = motionSeconds,
  initial = blankMotion;
function Editor({
  base,
  assets,
  current,
  newer,
  onDone,
}: {
  base: string;
  assets: any[];
  current: Project | null;
  newer: boolean;
  onDone: (id: string) => void;
}) {
  const { t, locale } = useI18n(),
    w = useWorkspace(),
    owner = w.me?.user?.id;
  const editor = useMotionEditor(
    owner ? owner + ":" + base : "",
    current?.id ?? "new",
    current?.version ?? 0,
    {
      name: current?.name ?? "",
      definition: current
        ? structuredClone(current.definition)
        : initial(locale),
    },
  );
  const { definition: d, name, setDefinition: set, setName, request } = editor;
  const [busy, setBusy] = useState(false);
  const change = (patch: Partial<Definition>) =>
    set((d) => ({ ...d, ...patch }));
  const scene = (i: number, patch: Partial<Scene>) =>
    set((d) => ({
      ...d,
      storyboard: d.storyboard.map((s, n) =>
        n === i ? { ...s, ...patch } : s,
      ),
    }));
  const cue = (i: number, patch: Partial<Cue>) =>
    set((d) => ({
      ...d,
      subtitles: d.subtitles.map((s, n) => (n === i ? { ...s, ...patch } : s)),
    }));
  const text = (
    label: string,
    value: string,
    max: number,
    onChange: (v: string) => void,
    multiline = false,
    required = false,
  ) => (
    <Field label={label}>
      {multiline ? (
        <textarea
          rows={3}
          value={value}
          maxLength={max}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          value={value}
          maxLength={max}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </Field>
  );
  const number = (
    label: string,
    value: number,
    min: number,
    max: number,
    onChange: (v: number) => void,
  ) => (
    <Field label={label}>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={1}
        required
        onChange={(e) =>
          onChange(e.target.value === "" ? 0 : Number(e.target.value))
        }
      />
    </Field>
  );
  const invalid = !motionValid(d),
    versionChanged = newer || editor.baseVersion !== (current?.version ?? 0);
  const locked =
    busy || !!editor.pending || !!editor.recovery || versionChanged;
  const captionGap = (() => {
    let start = 0;
    for (const c of d.subtitles) {
      if (c.start_frame > start)
        return { start_frame: start, end_frame: c.start_frame };
      start = Math.max(start, c.end_frame);
    }
    return start < d.duration_frames
      ? { start_frame: start, end_frame: d.duration_frames }
      : null;
  })();
  return (
    <AsyncForm
      submitLabel={
        editor.pending
          ? t("重試原儲存請求", "Retry original save")
          : t("儲存影片工程", "Save video project")
      }
      submitDisabled={
        !!editor.recovery || invalid || (!editor.pending && versionChanged)
      }
      onSubmit={async () => {
        const body = {
            name,
            definition: d,
            ...(current ? { expected_version: editor.baseVersion } : {}),
          },
          signature = JSON.stringify(body);
        if (request.current && request.current.signature !== signature)
          throw Error(
            t(
              "請先核對原儲存請求。",
              "Resolve the original save request first.",
            ),
          );
        if (!request.current)
          request.current = { signature, key: crypto.randomUUID() };
        editor.setPending(request.current);
        setBusy(true);
        try {
          const result = await post(
            base +
              "/video-projects" +
              (current ? "/" + current.id + "/edit" : ""),
            body,
            request.current.key,
          );
          editor.completed();
          onDone(result.id);
        } catch (e) {
          if (
            [400, 403, 404, 409, 422].includes(
              Number((e as { status?: number }).status),
            )
          )
            editor.setPending(null);
          throw e;
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="motion-draft-toolbar">
        <button
          type="button"
          className="text-button"
          disabled={locked || !editor.canUndo}
          onClick={editor.undo}
        >
          {t("復原", "Undo")}
        </button>
        <button
          type="button"
          className="text-button"
          disabled={locked || !editor.canRedo}
          onClick={editor.redo}
        >
          {t("重做", "Redo")}
        </button>
        <span role="status">
          {editor.dirty
            ? editor.stored
              ? t("草稿已保留在此工作階段", "Draft kept in this session")
              : t(
                  "草稿僅保留於目前視窗，關閉前請儲存",
                  "Draft stays in this window; save before closing",
                )
            : t("尚未修改", "No unsaved changes")}
        </span>
      </div>
      {editor.recovery && (
        <div className="notice" role="status">
          <p>
            {t(
              "找到此帳戶、項目與工程的工作階段草稿。請選擇恢復或捨棄。",
              "A session draft was found for this account, project and work. Restore or discard it.",
            )}
          </p>
          <button
            type="button"
            disabled={
              editor.recovery.version !== (current?.version ?? 0) &&
              !editor.recovery.pending
            }
            onClick={editor.restore}
          >
            {t("恢復草稿", "Restore draft")}
          </button>
          <button
            type="button"
            disabled={!!editor.recovery.pending}
            onClick={editor.discard}
          >
            {t("捨棄草稿", "Discard draft")}
          </button>
          {editor.recovery.pending && (
            <p>
              {t(
                "原儲存請求的結果尚未確認。恢復後重試同一請求，不會建立第二份工程。",
                "The original save is unconfirmed. Restore and retry the same request to avoid creating a duplicate work.",
              )}
            </p>
          )}
        </div>
      )}
      {editor.pending && (
        <p className="notice" role="status">
          {t(
            "正在核對原儲存請求。連線失敗可按重試；確認結果前暫停編輯並保留原請求鍵。",
            "Resolving the original save. Retry if the connection failed; editing is paused and the original request key is retained until the result is known.",
          )}
        </p>
      )}
      {newer && (
        <p className="notice" role="status">
          {t(
            "工程已有新版本。請關閉並重新開啟，避免覆寫其他人的修改。",
            "A newer project version is available. Close and reopen before saving.",
          )}
        </p>
      )}
      <p className="muted">
        {t(
          "提供腳本、分鏡、素材與字幕；配樂使用已獲授權的專案素材。渲染不產生 AI 費用。",
          "Provide your script, scenes, sources and captions. Use audio you own or have licensed. Rendering has no AI charge.",
        )}
      </p>
      <div className="motion-editor-layout">
        <fieldset disabled={locked} className="video-editor-fields">
          <legend className="sr-only">
            {t("影片工程內容", "Video project content")}
          </legend>
          <MotionStarters base={base} disabled={locked} choose={set} />
          {text(t("工程名稱", "Project name"), name, 160, setName, false, true)}
          <p className="muted">
            {t(
              "儲存後，工程將與此項目有權限的成員共用。",
              "Saving shares this work with authorized members of this project.",
            )}
          </p>
          <MotionTimeline definition={d} disabled={locked} change={set} />
          <h3>{t("腳本與規格", "Script and format")}</h3>
          {text(
            t("腳本標題", "Script title"),
            d.script.title,
            160,
            (title) => change({ script: { ...d.script, title } }),
            false,
            true,
          )}
          {text(
            t("創作簡報", "Creative brief"),
            d.script.brief,
            2000,
            (brief) => change({ script: { ...d.script, brief } }),
            true,
          )}
          {text(
            t("提供的旁白文稿", "Provided narration text"),
            d.script.narration,
            6000,
            (narration) => change({ script: { ...d.script, narration } }),
            true,
          )}
          <p className="muted">
            {t(
              "文稿不會自動合成語音；需要配音請選擇已上傳的音軌。",
              "Text is not synthesized into voice. Select an uploaded audio track when voice is needed.",
            )}
          </p>
          {text(
            t("行動文案", "Call to action"),
            d.script.call_to_action,
            100,
            (call_to_action) =>
              change({ script: { ...d.script, call_to_action } }),
          )}
          <div className="video-form-grid">
            {number(t("寬度 px", "Width px"), d.width, 256, 1920, (width) =>
              change({ width }),
            )}
            {number(t("高度 px", "Height px"), d.height, 256, 1920, (height) =>
              change({ height }),
            )}
          </div>
          <p className="muted">
            {seconds(d).toFixed(3)} s · {d.duration_frames}{" "}
            {t(
              "幀；使用鏡頭編排調整時長與幀率。",
              "frames; use scene arrangement to change timing and frame rate.",
            )}
          </p>
          <h3>{t("品牌", "Brand")}</h3>
          {text(t("品牌名稱", "Brand label"), d.brand.label, 80, (label) =>
            change({ brand: { ...d.brand, label } }),
          )}
          <div className="video-form-grid">
            {(
              [
                ["background", t("背景色", "Background")],
                ["ink", t("文字色", "Text color")],
                ["accent", t("強調色", "Accent")],
              ] as const
            ).map(([key, label]) => (
              <Field key={key} label={label}>
                <input
                  type="color"
                  value={d.brand[key]}
                  onChange={(e) =>
                    change({ brand: { ...d.brand, [key]: e.target.value } })
                  }
                />
              </Field>
            ))}
          </div>
          <SourceChoice
            base={base}
            label={t("固定品牌標誌 PNG", "Fixed brand logo PNG")}
            value={d.brand.logo}
            assets={assets}
            onChange={(logo) => change({ brand: { ...d.brand, logo } })}
          />
          <h3>{t("分鏡時間線", "Storyboard timeline")}</h3>
          <p className="muted">
            {t(
              "首幀為 0，結束幀不包含在片段中。分鏡須無縫涵蓋完整影片。",
              "Frame zero starts the video; end frames are exclusive. Scenes must cover the full timeline without gaps.",
            )}
          </p>
          {d.storyboard.map((s, i) => (
            <fieldset
              className="video-track"
              key={s.key}
              aria-label={`${t("分鏡", "Scene")} ${i + 1}`}
            >
              <legend>
                {t("分鏡", "Scene")} {i + 1}
              </legend>
              <p className="muted">
                {s.start_frame}–{s.end_frame}{" "}
                {t(
                  "幀；使用上方編排控制調整。",
                  "frames; adjust with the arrangement controls above.",
                )}
              </p>
              {text(
                t("畫面說明", "Scene direction"),
                s.direction,
                1000,
                (direction) => scene(i, { direction }),
                true,
              )}
              {text(
                t("畫面標題", "Scene headline"),
                s.headline,
                240,
                (headline) => scene(i, { headline }),
                false,
                true,
              )}
              {text(
                t("畫面正文", "Scene body"),
                s.body,
                500,
                (body) => scene(i, { body }),
                true,
              )}
              <SourceChoice
                base={base}
                label={t("固定畫面 PNG", "Fixed scene PNG")}
                value={s.image}
                assets={assets}
                onChange={(image) => scene(i, { image })}
              />
            </fieldset>
          ))}
          <h3>{t("字幕", "Captions")}</h3>
          {d.subtitles.map((s, i) => (
            <fieldset
              className="video-track"
              key={s.key}
              aria-label={`${t("字幕", "Caption")} ${i + 1}`}
            >
              <legend>
                {t("字幕", "Caption")} {i + 1}
              </legend>
              <div className="video-form-grid">
                {number(
                  t("起始幀", "Start frame"),
                  s.start_frame,
                  0,
                  1800,
                  (start_frame) => cue(i, { start_frame }),
                )}
                {number(
                  t("結束幀", "End frame"),
                  s.end_frame,
                  1,
                  1800,
                  (end_frame) => cue(i, { end_frame }),
                )}
              </div>
              {text(
                t("字幕文字", "Caption text"),
                s.text,
                240,
                (text) => cue(i, { text }),
                true,
                true,
              )}
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  change({ subtitles: d.subtitles.filter((_, n) => n !== i) })
                }
              >
                <X size={14} />
                {t("移除字幕", "Remove caption")}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={d.subtitles.length >= 80 || !captionGap}
            onClick={() => {
              if (captionGap)
                change({
                  subtitles: [
                    ...d.subtitles,
                    {
                      key: "cue_" + crypto.randomUUID().replaceAll("-", ""),
                      ...captionGap,
                      text: t("加入字幕", "Add your caption"),
                    },
                  ].sort((a, b) => a.start_frame - b.start_frame),
                });
            }}
          >
            <Plus size={15} />
            {t("新增字幕", "Add caption")}
          </button>
          <h3>{t("音軌與授權", "Audio and rights")}</h3>
          <SourceChoice
            base={base}
            label={t("固定音軌 WAV / MP3", "Fixed audio WAV / MP3")}
            value={d.audio?.source ?? null}
            assets={assets}
            audio
            onChange={(source) =>
              change({
                audio: source
                  ? {
                      source,
                      source_in_frame: 0,
                      gain_db: -3,
                      role: "music",
                      rights_basis: "owned",
                      rights_reference: "",
                    }
                  : null,
              })
            }
          />
          {d.audio ? (
            <>
              <div className="video-form-grid">
                {number(
                  t("音軌入點（幀）", "Audio in point (frames)"),
                  d.audio.source_in_frame,
                  0,
                  108000,
                  (source_in_frame) =>
                    change({ audio: { ...d.audio!, source_in_frame } }),
                )}
                {number(
                  t("增益 dB", "Gain dB"),
                  d.audio.gain_db,
                  -36,
                  0,
                  (gain_db) => change({ audio: { ...d.audio!, gain_db } }),
                )}
                <Field label={t("音軌用途", "Audio role")}>
                  <select
                    value={d.audio.role}
                    onChange={(e) =>
                      change({ audio: { ...d.audio!, role: e.target.value } })
                    }
                  >
                    <option value="music">{t("配樂", "Music")}</option>
                    <option value="provided_voice">
                      {t("提供的配音", "Provided voice")}
                    </option>
                  </select>
                </Field>
                <Field label={t("授權依據", "Rights basis")}>
                  <select
                    value={d.audio.rights_basis}
                    onChange={(e) =>
                      change({
                        audio: { ...d.audio!, rights_basis: e.target.value },
                      })
                    }
                  >
                    <option value="owned">{t("自有", "Owned")}</option>
                    <option value="licensed">
                      {t("已獲授權", "Licensed")}
                    </option>
                  </select>
                </Field>
              </div>
              {text(
                t(
                  "授權引用或自有聲明",
                  "License reference or ownership statement",
                ),
                d.audio.rights_reference,
                500,
                (rights_reference) =>
                  change({ audio: { ...d.audio!, rights_reference } }),
                true,
                true,
              )}
            </>
          ) : (
            <p className="muted">
              {t(
                "此工程沒有音軌，將交付無聲影片。",
                "This project has no audio track and will export without audio.",
              )}
            </p>
          )}
        </fieldset>
        <MotionFramePreview
          base={base}
          definition={d}
          video={current?.id}
          version={editor.baseVersion}
          disabled={invalid || locked}
        />
      </div>
      {invalid && (
        <p className="notice" role="status">
          {t(
            "請修正時間線、尺寸或渲染預算：分鏡連續、字幕不重疊，且末幀等於總幀數。",
            "Check timeline, dimensions and render budget: scenes must be contiguous, captions must not overlap, and the final scene must end at total frames.",
          )}
        </p>
      )}
    </AsyncForm>
  );
}
export function VideoPlayer({
  base,
  video,
  render,
}: {
  base: string;
  video: string;
  render: string;
}) {
  const { t } = useI18n(),
    [url, setUrl] = useState<string | null>(null),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true,
      objectUrl: string | null = null;
    void api<{ base64: string; sha256: string; bytes: number }>(
      `${base}/video-projects/${video}/renders/${render}/preview`,
    )
      .then(async (r) => {
        const bytes = Uint8Array.from(atob(r.base64), (c) => c.charCodeAt(0));
        const digest = [
          ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        ]
          .map((n) => n.toString(16).padStart(2, "0"))
          .join("");
        if (digest !== r.sha256 || bytes.length !== r.bytes)
          throw new Error(
            t("影片完整性檢查失敗", "Video integrity check failed"),
          );
        if (!live) return;
        objectUrl = URL.createObjectURL(
          new Blob([bytes], { type: "video/mp4" }),
        );
        setUrl(objectUrl);
      })
      .catch((e) => {
        if (live) setError(e);
      });
    return () => {
      live = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [base, video, render]);
  return (
    <div className="video-player">
      <ErrorNotice error={error} />
      {url ? (
        <video
          controls
          playsInline
          preload="metadata"
          src={url}
          aria-label={t("影片成片預覽", "Rendered video preview")}
        />
      ) : (
        !error && <span>{t("讀取影片…", "Loading video…")}</span>
      )}
    </div>
  );
}
export function VideoProjects({
  base,
  assets,
}: {
  base: string;
  assets: any[];
}) {
  const { t } = useI18n(),
    [selected, setSelected] = useState<string | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [refresh, setRefresh] = useState(0),
    [editing, setEditing] = useState<Project | "new" | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<string | null>(null);
  const live = useRef(true),
    request = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const list = useData<{
    items: { id: string; name: string; version: number }[];
    next_cursor: string | null;
  }>(base + "/video-projects" + (cursor ? "?before=" + cursor : ""), refresh);
  const result = useData<Project>(
      selected ? `${base}/video-projects/${selected}` : null,
      refresh,
      2500,
    ),
    p = result.error ? null : result.data;
  const active = p?.renders.find((r) =>
    ["queued", "rendering"].includes(r.state),
  );
  async function action(path: string, body: unknown) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const signature = JSON.stringify({ path, body });
    if (request.current?.signature !== signature)
      request.current = { signature, key: crypto.randomUUID() };
    try {
      await post(path, body, request.current.key);
      request.current = null;
      if (live.current) setRefresh((v) => v + 1);
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  const names = [
    ["mp4_asset_id", "MP4"],
    ["project_asset_id", t("工程 JSON", "Project JSON")],
    ["script_asset_id", t("腳本", "Script")],
    ["storyboard_asset_id", t("分鏡", "Storyboard")],
    ["subtitles_asset_id", "WebVTT"],
    ["probe_asset_id", t("媒體檢測", "Media probe")],
  ] as const;
  return (
    <section
      id="video-production"
      className="video-projects"
      aria-label={t("影片製作", "Video production")}
    >
      <header className="matrix-section-heading">
        <div>
          <p className="eyebrow">CAMPAIGN / MOTION</p>
          <h2>{t("從一段想法，到一支影片。", "A story, ready to move.")}</h2>
          <p className="muted">
            {t(
              "獨立腳本、逐幀分鏡、字幕與音軌。保留每次成片和可重做工程。",
              "Script, storyboard, captions and audio. Keep every render with its reproducible project.",
            )}
          </p>
        </div>
        <button className="button secondary" onClick={() => setEditing("new")}>
          <Film size={17} />
          {t("新建影片工程", "New video project")}
        </button>
      </header>
      <ErrorNotice error={list.error ?? result.error ?? error} />
      <div className="matrix-list">
        <label>
          {t("選擇影片工程", "Choose video project")}
          <select
            aria-label={t("選擇影片工程", "Choose video project")}
            value={selected ?? ""}
            onChange={(e) => {
              setSelected(e.target.value || null);
              setPreview(null);
              setError(null);
            }}
          >
            <option value="">
              {t(
                "選擇工程查看時間線與成片",
                "Choose a project to review its timeline and renders",
              )}
            </option>
            {list.data?.items.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} · v{v.version}
              </option>
            ))}
          </select>
        </label>
        {list.data?.next_cursor && (
          <button
            className="text-button"
            onClick={() => {
              setCursor(list.data!.next_cursor);
              setSelected(null);
            }}
          >
            {t("下一頁影片", "Next videos")}
            <ArrowUpRight size={14} />
          </button>
        )}
        {cursor && (
          <button
            className="text-button"
            onClick={() => {
              setCursor(null);
              setSelected(null);
            }}
          >
            {t("最新影片", "Latest videos")}
          </button>
        )}
      </div>
      {p && (
        <div className="video-workspace">
          <header className="video-summary">
            <div>
              <h3>{p.name}</h3>
              <p className="muted">
                v{p.version} · {p.definition.width} × {p.definition.height} ·{" "}
                {seconds(p.definition).toFixed(3)} s ·{" "}
                {p.definition.frame_rate.numerator}/
                {p.definition.frame_rate.denominator} fps
              </p>
              <p className="muted">
                {p.definition.audio
                  ? t("提供的授權音軌", "Provided authorized audio")
                  : t("無音軌", "No audio track")}{" "}
                · AI HK$0
              </p>
            </div>
            <div className="video-actions">
              <button
                className="button secondary"
                onClick={() => setEditing(structuredClone(p))}
              >
                <Pencil size={15} />
                {t("編輯工程", "Edit project")}
              </button>
              <button
                className="button primary"
                disabled={busy || !!active}
                onClick={() =>
                  void action(`${base}/video-projects/${p.id}/renders`, {
                    expected_version: p.version,
                  })
                }
              >
                <Play size={15} />
                {t("渲染影片", "Render video")}
              </button>
            </div>
          </header>
          <div
            className="video-timeline"
            aria-label={t("分鏡時間線", "Storyboard timeline")}
          >
            {p.definition.storyboard.map((s, i) => (
              <article key={s.key}>
                <span className="eyebrow">
                  {String(i + 1).padStart(2, "0")} / {s.start_frame}–
                  {s.end_frame}
                </span>
                <strong>{s.headline}</strong>
                <p>{s.direction || s.body}</p>
              </article>
            ))}
          </div>
          <details>
            <summary>
              {t("工程版本", "Project versions")} ({p.versions.length})
            </summary>
            <ul>
              {p.versions.map((v) => (
                <li key={v.version}>
                  v{v.version} · {new Date(v.created_at).toLocaleString()}
                </li>
              ))}
            </ul>
          </details>
          <h3>{t("成片與渲染歷史", "Renders and history")}</h3>
          {!p.renders.length && (
            <p className="muted">
              {t(
                "工程已保存，可以開始渲染。",
                "Project saved. Ready to render.",
              )}
            </p>
          )}
          {p.renders.map((r) => (
            <article className="video-render" key={r.id} data-render-id={r.id}>
              <header>
                <div>
                  <Badge
                    value={r.state === "rendering" ? "running" : r.state}
                  />
                  <span>
                    v{r.version} · {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>
                {["queued", "rendering"].includes(r.state) && (
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void action(
                        `${base}/video-projects/${p.id}/renders/${r.id}/cancel`,
                        { expected_revision: r.revision },
                      )
                    }
                  >
                    {t("取消渲染", "Cancel render")}
                  </button>
                )}
              </header>
              {r.error_code && (
                <p className="notice">
                  {t(
                    "此輪未交付成片；處理後可重新渲染。",
                    "This attempt delivered no video. Resolve the issue and render again.",
                  )}{" "}
                  <code>{r.error_code}</code>
                </p>
              )}
              {r.state === "succeeded" && !r.output_available && (
                <p className="muted">
                  {t(
                    "來源或成片目前不可用。",
                    "A source or output is currently unavailable.",
                  )}
                </p>
              )}
              {r.output_available && (
                <>
                  <div className="video-actions">
                    <button
                      className="button secondary"
                      onClick={() => setPreview(preview === r.id ? null : r.id)}
                    >
                      <Play size={15} />
                      {preview === r.id
                        ? t("關閉預覽", "Close preview")
                        : t("播放成片", "Play video")}
                    </button>
                    {names.map(([column, label]) => (
                      <button
                        key={column}
                        className="text-button"
                        onClick={() => {
                          void download(
                            `${base}/assets/${r[column]}/download`,
                            `${p.name}-v${r.version}-${label}.${column === "mp4_asset_id" ? "mp4" : column === "script_asset_id" ? "md" : column === "subtitles_asset_id" ? "vtt" : "json"}`,
                          ).catch((e) => {
                            if (live.current) setError(e);
                          });
                        }}
                      >
                        <Download size={14} />
                        {label}
                      </button>
                    ))}
                  </div>
                  {preview === r.id && (
                    <VideoPlayer
                      key={r.id}
                      base={base}
                      video={p.id}
                      render={r.id}
                    />
                  )}
                  <p className="muted">
                    {r.probe.duration_frames} {t("幀", "frames")} ·{" "}
                    {r.probe.video_codec}/{r.probe.pixel_format} ·{" "}
                    {r.probe.audio_codec ?? t("無音軌", "no audio")} ·{" "}
                    {t("完整解碼通過", "Fully decoded")} · AI HK$0
                  </p>
                </>
              )}
            </article>
          ))}
        </div>
      )}
      {editing && (
        <Modal
          title={
            editing === "new"
              ? t("新建影片工程", "New video project")
              : t("編輯影片工程", "Edit video project")
          }
          onClose={() => setEditing(null)}
        >
          <Editor
            key={
              base +
              ":" +
              (editing === "new" ? "new" : editing.id + ":" + editing.version)
            }
            base={base}
            assets={assets}
            current={editing === "new" ? null : editing}
            newer={
              editing !== "new" &&
              !!p &&
              p.id === editing.id &&
              p.version !== editing.version
            }
            onDone={(id) => {
              if (!live.current) return;
              setEditing(null);
              setCursor(null);
              setSelected(id);
              setRefresh((v) => v + 1);
            }}
          />
        </Modal>
      )}
    </section>
  );
}
