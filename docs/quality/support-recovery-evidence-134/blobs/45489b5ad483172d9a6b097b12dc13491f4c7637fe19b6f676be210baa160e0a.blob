import { useEffect, useState } from "react";
import {
  Check,
  ShieldCheck,
  AlertCircle,
  Image as ImageIcon,
} from "lucide-react";
import { ErrorNotice, Field, useI18n } from "./ui";
import {
  hkDateInput,
  publicationBytes,
  publicationFormats,
  publicationFormatName,
  publicationStates,
  publicationTime,
  usePublicationMedia,
  type PublicationContent,
  type PublicationDetail,
  type PublicationFormat,
  type PublicationPolicy,
  type PublicationSource,
  type PublicationTarget,
} from "./publication-data";

export function PublicationState({ state }: { state: string }) {
  const { t } = useI18n(),
    label = publicationStates[state];
  return (
    <span className={"publication-state " + state}>
      {label ? t(...label) : state}
    </span>
  );
}

function PublicationMedia({
  source,
  path,
  tenant,
  onWithdraw,
}: {
  source: PublicationSource;
  path: string;
  tenant: string;
  onWithdraw: () => void;
}) {
  const { t } = useI18n(),
    media = usePublicationMedia(path, tenant, source, onWithdraw);
  return (
    <figure className="publication-media">
      <div className="publication-media-frame">
        {media.src ? (
          source.mime === "video/mp4" ? (
            <video
              controls
              preload="metadata"
              src={media.src}
              onError={onWithdraw}
              crossOrigin={
                window.copyPasteBridge ? undefined : "use-credentials"
              }
              aria-label={source.alt_text || source.name}
            />
          ) : (
            <img
              src={media.src}
              onError={onWithdraw}
              crossOrigin={
                window.copyPasteBridge ? undefined : "use-credentials"
              }
              referrerPolicy="no-referrer"
              alt={source.alt_text || source.name}
            />
          )
        ) : (
          <span className="publication-media-loading">
            <ImageIcon size={24} />
            {t("讀取實際發布檔案…", "Loading the outgoing file…")}
          </span>
        )}
      </div>
      <figcaption>
        <strong>
          {source.ordinal + 1}. {source.name}
        </strong>
        <span>
          {source.width} × {source.height} · {publicationBytes(source.bytes)} ·{" "}
          {source.mime === "video/mp4"
            ? "MP4"
            : source.mime === "image/jpeg"
              ? "JPEG"
              : "PNG"}
        </span>
        {source.source_sha256 !== source.sha256 && (
          <small>
            {t(
              "透明背景已按所選底色轉成 JPEG；此處顯示實際出站檔案。",
              "Converted to JPEG using your background color. This is the outgoing file.",
            )}
          </small>
        )}
      </figcaption>
      <ErrorNotice error={media.error} />
    </figure>
  );
}

export function PublicationContentView({
  content,
  root,
  kind,
  id,
  tenant,
  digest,
  onWithdraw,
}: {
  content: PublicationContent;
  root: string;
  kind: "previews" | "operations";
  id: string;
  tenant: string;
  digest: string;
  onWithdraw: () => void;
}) {
  const { t } = useI18n();
  return (
    <section
      className="publication-preview-card"
      aria-label={t("實際發布預覽", "Outgoing publication preview")}
    >
      <header className="publication-preview-header">
        <span className="publication-avatar">
          {content.target.name.slice(0, 1)}
        </span>
        <div>
          <strong>{content.target.name}</strong>
          <span>
            {publicationFormatName(content.draft.format, t)} ·{" "}
            {content.target.external_id}
          </span>
        </div>
        <ShieldCheck size={20} aria-hidden="true" />
      </header>
      {content.draft.title && <h3>{content.draft.title}</h3>}
      {content.draft.caption && (
        <p className="publication-caption">{content.draft.caption}</p>
      )}
      {content.draft.link && (
        <a
          href={content.draft.link}
          target="_blank"
          rel="noopener noreferrer"
          className="publication-link"
        >
          {content.draft.link}
        </a>
      )}
      <div
        className={
          "publication-media-grid " +
          (content.sources.length === 1 ? "single" : "")
        }
      >
        {content.sources.map((source) => (
          <PublicationMedia
            key={source.ordinal + ":" + source.sha256}
            source={source}
            path={`${root}/${kind}/${id}/media/${source.ordinal}`}
            tenant={tenant}
            onWithdraw={onWithdraw}
          />
        ))}
      </div>
      {content.draft.format === "instagram_reel" && (
        <p className="muted">
          {content.draft.share_to_feed
            ? t("同時分享至動態消息", "Also share to feed")
            : t("只發布 Reel", "Publish as Reel only")}
        </p>
      )}
      <details className="publication-proof">
        <summary>
          {t("檔案版本與核對資料", "File versions and verification")}
        </summary>
        <dl>
          <dt>{t("內容摘要", "Content digest")}</dt>
          <dd>
            <code>{digest}</code>
          </dd>
          {content.sources.map((source) => (
            <div key={source.ordinal}>
              <dt>
                {source.name} · v{source.version}
              </dt>
              <dd>
                <code>{source.sha256}</code>
              </dd>
            </div>
          ))}
        </dl>
      </details>
    </section>
  );
}

export function PublicationPolicyEditor({
  target,
  policy,
  busy,
  error,
  onSave,
  onClose,
}: {
  target: PublicationTarget;
  policy: PublicationPolicy | null;
  busy: boolean;
  error: unknown;
  onSave: (body: PublicationPolicy["policy"], version: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const [enabled, setEnabled] = useState(policy?.policy.enabled ?? false),
    [formats, setFormats] = useState<PublicationFormat[]>(
      policy?.policy.formats ?? [...target.capabilities.formats],
    ),
    [maximum, setMaximum] = useState(
      String(policy?.policy.maximum_daily_publications ?? 5),
    ),
    [expires, setExpires] = useState(
      hkDateInput(
        policy?.policy.expires_at ??
          new Date(Date.now() + 86400_000).toISOString(),
      ),
    );
  const toggle = (format: PublicationFormat) =>
    setFormats((old) =>
      old.includes(format) ? old.filter((f) => f !== format) : [...old, format],
    );
  return (
    <form
      className="publication-form"
      onSubmit={(event) => {
        event.preventDefault();
        const date = new Date(expires + ":00+08:00");
        if (!Number.isFinite(date.valueOf())) return;
        onSave(
          {
            enabled,
            formats,
            maximum_daily_publications: Number(maximum),
            expires_at: date.toISOString(),
            confirmation: "each_operation",
          },
          policy?.version ?? 0,
        );
      }}
    >
      <p className="muted">
        {target.name} · {target.external_id}
      </p>
      <fieldset disabled={busy}>
        <label className="publication-check">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          <span>
            {t("啟用此帳戶的發布範圍", "Enable publishing for this account")}
          </span>
        </label>
        <p className="muted">
          {t(
            "每次發布仍需原客戶確認。變更範圍會使舊確認失效。",
            "The original customer must confirm each publication. A policy change invalidates earlier approvals.",
          )}
        </p>
        <legend className="sr-only">
          {t("允許的發布格式", "Allowed publication formats")}
        </legend>
        <div className="publication-checkboxes">
          {target.capabilities.formats.map((format) => (
            <label key={format} className="publication-check">
              <input
                type="checkbox"
                checked={formats.includes(format)}
                onChange={() => toggle(format)}
              />
              <span>{publicationFormatName(format, t)}</span>
            </label>
          ))}
        </div>
        <div className="publication-field-pair">
          <Field
            label={t("每24小時上限", "Maximum in 24 hours")}
            hint={t(
              "排隊及結果不明的操作亦計入。",
              "Includes queued and unknown operations.",
            )}
          >
            <input
              type="number"
              min="1"
              max="100"
              required
              value={maximum}
              onChange={(e) => setMaximum(e.target.value)}
            />
          </Field>
          <Field
            label={t("授權到期時間（香港）", "Policy expires (Hong Kong)")}
          >
            <input
              type="datetime-local"
              required
              value={expires}
              onChange={(e) => setExpires(e.target.value)}
            />
          </Field>
        </div>
      </fieldset>
      <ErrorNotice error={error} />
      <div className="publication-actions">
        <button
          type="button"
          className="button"
          onClick={onClose}
          disabled={busy}
        >
          {t("返回", "Back")}
        </button>
        <button
          className="button primary"
          disabled={busy || !formats.length || !maximum}
        >
          {t("儲存發布範圍", "Save publishing policy")}
        </button>
      </div>
    </form>
  );
}

export function PublicationConfirmation({
  operation,
  busy,
  blocked,
  onDecision,
}: {
  operation: PublicationDetail;
  busy: boolean;
  blocked: boolean;
  onDecision: (
    decision: "confirm" | "reject",
    acknowledgePrevious: boolean,
  ) => void;
}) {
  const { t } = useI18n(),
    [checked, setChecked] = useState(false),
    [previous, setPrevious] = useState(false),
    [clock, setClock] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const hasPrevious = !!operation.content?.previous_unknown_ids.length,
    expired = Date.parse(operation.expires_at) <= clock;
  useEffect(() => {
    if (blocked) {
      setChecked(false);
      setPrevious(false);
    }
  }, [blocked]);
  return (
    <section
      className="publication-confirmation"
      aria-label={t("確認此項發布", "Confirm this publication")}
    >
      <ShieldCheck size={23} aria-hidden="true" />
      <div>
        <h3>
          {t("由你確認，才會發送", "Your confirmation starts publication")}
        </h3>
        <p>
          {t(
            "請核對上方帳戶、文字與實際檔案。",
            "Review the account, text and outgoing files above.",
          )}{" "}
          {t("此確認有效至", "This approval expires at")}{" "}
          {publicationTime(operation.expires_at)} HKT。
        </p>
        <label className="publication-check">
          <input
            type="checkbox"
            checked={checked}
            disabled={busy || blocked || expired}
            onChange={(e) => setChecked(e.target.checked)}
          />
          <span>
            {t(
              "我確認將上述內容發布至指定帳戶。",
              "I approve publishing this exact content to this account.",
            )}
          </span>
        </label>
        {hasPrevious && (
          <label className="publication-check publication-risk">
            <input
              type="checkbox"
              checked={previous}
              disabled={busy || blocked || expired}
              onChange={(e) => setPrevious(e.target.checked)}
            />
            <span>
              {t(
                "同內容曾有結果不明的操作；我了解再次發布可能重複。",
                "The same content has a previous unknown outcome. I understand that another publication may duplicate it.",
              )}
            </span>
          </label>
        )}
        {expired && (
          <p role="status">
            {t(
              "確認已過期，請重新建立預覽。",
              "This confirmation expired. Create a fresh preview.",
            )}
          </p>
        )}
        <div className="publication-actions">
          <button
            type="button"
            className="button"
            disabled={busy || blocked}
            onClick={() => onDecision("reject", false)}
          >
            {t("不發布", "Reject publication")}
          </button>
          <button
            type="button"
            className="button primary"
            disabled={
              busy ||
              blocked ||
              expired ||
              !checked ||
              (hasPrevious && !previous)
            }
            onClick={() => onDecision("confirm", previous)}
          >
            <Check size={17} />
            {t("確認並發布", "Confirm and publish")}
          </button>
        </div>
      </div>
    </section>
  );
}

export function PublicationResolution({
  operation,
  busy,
  onObserve,
  onClose,
}: {
  operation: PublicationDetail;
  busy: boolean;
  onObserve: (remote?: string) => void;
  onClose: (reason: string, observation: string) => void;
}) {
  const { t } = useI18n(),
    [remote, setRemote] = useState(""),
    [reason, setReason] = useState(""),
    [acknowledge, setAcknowledge] = useState(false);
  const observation =
    typeof operation.observation?.sha256 === "string"
      ? operation.observation.sha256
      : "";
  return (
    <section className="publication-unknown">
      <AlertCircle size={22} aria-hidden="true" />
      <div>
        <h3>{t("先核對原操作", "Review the original operation")}</h3>
        <p>
          {t(
            "平台可能已收到請求。系統不會自動重發；貼上結果編號本身不能證明來自本次操作。",
            "The provider may have received the request. It will not be resent automatically. A pasted object ID alone does not prove attribution.",
          )}
        </p>
        <Field
          label={t("平台結果編號（如有）", "Provider object ID (optional)")}
        >
          <input
            inputMode="numeric"
            value={remote}
            disabled={busy}
            onChange={(e) => setRemote(e.target.value)}
            placeholder="125001_…"
          />
        </Field>
        <button
          type="button"
          className="button"
          disabled={busy}
          onClick={() => onObserve(remote.trim() || undefined)}
        >
          {t("唯讀核對平台結果", "Check provider without resending")}
        </button>
        {observation && operation.state === "unknown" && operation.observation?.attribution === "not_proven" && (
          <>
            <p className="muted">
              {t(
                "已有核對記錄；關閉後仍保留結果不明的歸因。",
                "A check is recorded. Manual closure preserves the unknown attribution.",
              )}
            </p>
            <Field label={t("人工處置原因", "Resolution reason")}>
              <textarea
                rows={3}
                value={reason}
                disabled={busy}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
              />
            </Field>
            <label className="publication-check">
              <input
                type="checkbox"
                checked={acknowledge}
                disabled={busy}
                onChange={(e) => setAcknowledge(e.target.checked)}
              />
              <span>
                {t(
                  "我了解關閉不代表發布失敗，後續重新發布仍可能重複。",
                  "I understand that closure does not prove failure. A later publication could duplicate it.",
                )}
              </span>
            </label>
            <button
              type="button"
              className="button"
              disabled={busy || !acknowledge || reason.trim().length < 5}
              onClick={() => onClose(reason.trim(), observation)}
            >
              {t("記錄原因並關閉待處置", "Record resolution and close review")}
            </button>
          </>
        )}
      </div>
    </section>
  );
}
