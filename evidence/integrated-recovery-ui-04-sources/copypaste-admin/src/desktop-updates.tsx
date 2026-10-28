import { useEffect, useRef, useState } from "react";
import {
  Monitor,
  Upload,
  ShieldCheck,
  RefreshCw,
  ArrowRight,
  History,
} from "lucide-react";
import { api, post } from "./api";
import {
  PageHeader,
  useData,
  useI18n,
  ErrorNotice,
  Field,
  Modal,
  DateText,
} from "./ui";
import "./desktop-updates.css";
const base = "/v1/admin/desktop-updates";
const hash = async (bytes: Uint8Array<ArrayBuffer>) =>
  [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
export function AdminDesktopUpdates({
  access,
}: {
  access: { has(permission: string): boolean };
}) {
  const { t, locale } = useI18n(),
    [channel, setChannel] = useState("stable"),
    [before, setBefore] = useState<number | null>(null),
    [refresh, setRefresh] = useState(0),
    [draft, setDraft] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [review, setReview] = useState<any>(null),
    [confirmed, setConfirmed] = useState(false),
    [progress, setProgress] = useState<{
      id: string;
      done: number;
      total: number;
    } | null>(null);
  const cancel = useRef(false),
    uploadController = useRef<AbortController | null>(null),
    stageKey = useRef(crypto.randomUUID());
  const {
    data,
    error: readError,
    loading,
  } = useData(
    `${base}?channel=${channel}${before ? "&before_sequence=" + before : ""}`,
    refresh,
  );
  useEffect(() => {
    setReview(null);
    setConfirmed(false);
  }, [channel, before, readError]);
  useEffect(
    () => () => {
      cancel.current = true;
      uploadController.current?.abort();
    },
    [],
  );
  const bump = () => setRefresh((v) => v + 1);
  const stage = async () => {
    setBusy(true);
    setError(null);
    try {
      if (draft.length > 16000)
        throw new Error(
          t("簽名清單過大。", "The signed manifest is too large."),
        );
      const envelope = JSON.parse(draft);
      if (envelope.payload?.channel !== channel)
        throw new Error(
          t("請選擇清單所屬的頻道。", "Select the manifest's channel."),
        );
      await post(base, { envelope, reason }, stageKey.current);
      stageKey.current = crypto.randomUUID();
      setDraft("");
      setReason("");
      bump();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const upload = async (row: any, file: File) => {
    const release = row.envelope.payload.release;
    setError(null);
    if (!release || file.size !== release.bytes) {
      setError(
        new Error(
          t(
            "檔案大小與簽名清單不符。",
            "File size differs from the signed manifest.",
          ),
        ),
      );
      return;
    }
    setBusy(true);
    cancel.current = false;
    const controller = new AbortController();
    uploadController.current = controller;
    setProgress({ id: row.id, done: 0, total: file.size });
    try {
      const chunk = data.chunk_bytes;
      for (let index = 0; index < Math.ceil(file.size / chunk); index++) {
        if (cancel.current) break;
        const end = Math.min(file.size, (index + 1) * chunk);
        if (!row.uploaded_parts.includes(index)) {
          const bytes = new Uint8Array(
            await file.slice(index * chunk, end).arrayBuffer(),
          );
          const sha256 = await hash(bytes);
          // Keep encoding bounded to one upload part; never read the whole installer into memory.
          let binary = "";
          for (let start = 0; start < bytes.length; start += 32768)
            binary += String.fromCharCode(
              ...bytes.subarray(start, start + 32768),
            );
          await api(`${base}/${row.id}/parts/${index}`, {
            method: "PUT",
            body: JSON.stringify({ base64: btoa(binary), sha256 }),
            signal: controller.signal,
          });
        }
        setProgress({ id: row.id, done: end, total: file.size });
      }
      if (!cancel.current) await post(`${base}/${row.id}/finalize`, {});
      bump();
    } catch (e) {
      if (!cancel.current) setError(e);
      bump();
    } finally {
      uploadController.current = null;
      setBusy(false);
      setProgress(null);
    }
  };
  const publish = async () => {
    if (!confirmed || !review) return;
    setBusy(true);
    setError(null);
    try {
      await post(
        `${base}/${review.row.id}/publish`,
        {
          expected_revision: review.revision,
          confirmed_sha256: review.row.envelope_sha256,
          reason: review.reason,
        },
        review.key,
      );
      setReview(null);
      setConfirmed(false);
      bump();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const actionName = (action: string) =>
    action === "withdraw"
      ? t("撤回頻道更新", "Withdraw channel update")
      : action === "rollback"
        ? t("回復已發佈版本", "Roll back published version")
        : t("發佈更新", "Publish update");
  return (
    <div className="admin-desktop-updates">
      <PageHeader
        eyebrow="A RELIABLE WAY FORWARD."
        title={t("Desktop 發佈", "Desktop releases")}
        description={t(
          "管理已簽署安裝包、分批推出、撤回與回復版本。客戶在本機確認安裝。",
          "Manage signed installers, gradual rollout, withdrawals and rollbacks. Customers confirm installation locally.",
        )}
        action={
          <button className="button secondary" disabled={busy} onClick={bump}>
            <RefreshCw size={16} />
            {t("重新整理", "Refresh")}
          </button>
        }
      />
      <ErrorNotice error={error ?? readError} />
      <div className="desktop-release-toolbar">
        <label>
          {t("發佈頻道", "Release channel")}
          <select
            aria-label={t("發佈頻道", "Release channel")}
            value={channel}
            disabled={busy}
            onChange={(e) => {
              setChannel(e.target.value);
              setBefore(null);
            }}
          >
            <option value="stable">{t("穩定", "Stable")}</option>
            <option value="preview">{t("預覽", "Preview")}</option>
          </select>
        </label>
        <span className="muted">
          {t("目前修訂", "Current revision")}: {data?.head.revision ?? "—"}
        </span>
      </div>
      {data && (
        <>
          {!data.trust_configured && (
            <p className="notice">
              {t(
                "部署尚未設定發佈公鑰，伺服器將拒絕新清單。私鑰由發佈人員離線保管。",
                "Release public keys are not configured. The server rejects new manifests. Signing private keys stay offline with release operators.",
              )}
            </p>
          )}
          {access.has("admin.desktop_updates.stage") && (
            <section className="card desktop-release-composer">
              <div className="section-title">
                <h2>
                  <Upload size={20} />
                  {t("新增簽名發佈", "Stage signed release")}
                </h2>
                <ShieldCheck size={21} />
              </div>
              <p className="muted">
                {t(
                  "貼上離線簽署的清單，再上傳其對應安裝程式。撤回清單無需安裝檔。",
                  "Paste the offline signed manifest, then upload its matching installer. Withdrawal manifests need no artifact.",
                )}
              </p>
              <Field label={t("簽名清單 JSON", "Signed manifest JSON")}>
                <textarea
                  value={draft}
                  maxLength={16000}
                  rows={5}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    stageKey.current = crypto.randomUUID();
                  }}
                  spellCheck={false}
                />
              </Field>
              <Field label={t("暫存原因", "Staging reason")}>
                <input
                  value={reason}
                  maxLength={1000}
                  onChange={(e) => {
                    setReason(e.target.value);
                    stageKey.current = crypto.randomUUID();
                  }}
                />
              </Field>
              <button
                className="button primary"
                disabled={
                  busy ||
                  loading ||
                  !data.trust_configured ||
                  reason.trim().length < 5 ||
                  !draft.trim()
                }
                onClick={() => void stage()}
              >
                <Upload size={16} />
                {t("驗證並暫存", "Verify and stage")}
              </button>
            </section>
          )}
          <div
            className="desktop-release-list"
            aria-label={t("簽名版本列表", "Signed releases")}
          >
            {data.items.length === 0 && (
              <section className="card">
                <Monitor size={24} />
                <h2>
                  {t("準備好第一個更新。", "Ready for your first update.")}
                </h2>
                <p className="muted">
                  {t(
                    "已通過簽名驗證的發佈將顯示在這裡。",
                    "Verified signed releases will appear here.",
                  )}
                </p>
              </section>
            )}
            {data.items.map((row: any) => {
              const p = row.envelope.payload,
                r = p.release,
                live = data.head.release_id === row.id;
              return (
                <section className="card desktop-release-item" key={row.id}>
                  <div className="desktop-release-title">
                    <div>
                      <p className="eyebrow">
                        {channel.toUpperCase()} · #{p.sequence}
                      </p>
                      <h2>
                        {r
                          ? `CopyPaste ${r.version}`
                          : t("撤回更新", "Withdraw update")}
                      </h2>
                    </div>
                    <span className={live ? "release-live" : "muted"}>
                      {live
                        ? t("目前生效", "Current")
                        : row.state === "uploading"
                          ? t("等待上傳", "Awaiting upload")
                          : row.state === "ready"
                            ? t("可以發佈", "Ready to publish")
                            : t("歷史發佈", "Published history")}
                    </span>
                  </div>
                  {r && (
                    <>
                      <p className="desktop-release-notes">
                        {locale === "en" ? r.notes.en : r.notes.zh}
                      </p>
                      <dl className="desktop-release-facts">
                        <div>
                          <dt>{t("推出範圍", "Rollout")}</dt>
                          <dd>{p.rollout_basis_points / 100}%</dd>
                        </div>
                        <div>
                          <dt>{t("檔案大小", "Installer size")}</dt>
                          <dd>{(r.bytes / 1024 / 1024).toFixed(1)} MB</dd>
                        </div>
                        <div>
                          <dt>
                            {t("最低來源版本", "Minimum installed version")}
                          </dt>
                          <dd>{r.minimum_version}</dd>
                        </div>
                        <div>
                          <dt>{t("有效期限", "Valid until")}</dt>
                          <dd>
                            <DateText value={p.expires_at} />
                          </dd>
                        </div>
                      </dl>
                      <details>
                        <summary>
                          {t("簽名與檔案校驗", "Signature and artifact checks")}
                        </summary>
                        <p>
                          SHA-256 <code>{r.sha256}</code>
                        </p>
                        <p>
                          {t("Windows 發行者", "Windows publisher")}{" "}
                          <code>{r.signer_sha256}</code>
                        </p>
                        <p>
                          {t("清單公鑰", "Manifest public key")}{" "}
                          <code>{row.envelope.key_id}</code>
                        </p>
                      </details>
                    </>
                  )}
                  {progress && progress.id === row.id && (
                    <div role="status">
                      <progress
                        max={progress.total}
                        value={progress.done}
                        aria-label={t(
                          "安裝包上傳進度",
                          "Installer upload progress",
                        )}
                      />
                      <span>
                        {Math.round((progress.done / progress.total) * 100)}%
                      </span>
                      <button
                        className="button secondary"
                        onClick={() => {
                          cancel.current = true;
                          uploadController.current?.abort();
                        }}
                      >
                        {t("暫停上傳", "Pause upload")}
                      </button>
                    </div>
                  )}
                  <div className="desktop-release-actions">
                    {row.state === "uploading" &&
                      access.has("admin.desktop_updates.stage") && (
                        <label className="button secondary">
                          <Upload size={16} />
                          {t("上傳或繼續安裝包", "Upload or resume installer")}
                          <input
                            type="file"
                            accept=".exe"
                            disabled={busy}
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              e.target.value = "";
                              if (file) void upload(row, file);
                            }}
                          />
                        </label>
                      )}
                    {row.state === "ready" &&
                      access.has("admin.desktop_updates.publish") && (
                        <button
                          className="button primary"
                          disabled={busy}
                          onClick={() => {
                            setConfirmed(false);
                            setReview({
                              row,
                              revision: data.head.revision,
                              reason: "",
                              key: crypto.randomUUID(),
                            });
                          }}
                        >
                          <ArrowRight size={16} />
                          {actionName(p.action)}
                        </button>
                      )}
                  </div>
                </section>
              );
            })}
          </div>
          <div className="desktop-release-pagination">
            <button
              className="button secondary"
              disabled={busy || before === null}
              onClick={() => setBefore(null)}
            >
              {t("最新版本", "Latest releases")}
            </button>
            <button
              className="button secondary"
              disabled={busy || !data.next_sequence}
              onClick={() => setBefore(data.next_sequence)}
            >
              {t("較早版本", "Older releases")}
            </button>
          </div>
          <section className="card">
            <h2>
              <History size={20} />
              {t("近期發佈記錄", "Recent publication history")}
            </h2>
            {data.history.map((h: any) => (
              <div className="desktop-release-history" key={h.id}>
                <strong>#{h.revision}</strong>
                <span>{h.reason}</span>
                <DateText value={h.created_at} />
              </div>
            ))}
          </section>
        </>
      )}
      {review && (
        <Modal
          title={actionName(review.row.envelope.payload.action)}
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <p>
            {t(
              "確認後，符合範圍的 Desktop 可取得這份更新。已下載的客戶仍會在安裝前重新檢查。",
              "Eligible Desktop installations can receive this update. Clients check the publication again before installing.",
            )}
          </p>
          <dl className="desktop-release-facts">
            <div>
              <dt>{t("頻道與序號", "Channel and sequence")}</dt>
              <dd>
                {channel} · #{review.row.envelope.payload.sequence}
              </dd>
            </div>
            <div>
              <dt>{t("目標版本", "Target version")}</dt>
              <dd>
                {review.row.envelope.payload.release?.version ??
                  t("撤回", "Withdrawal")}
              </dd>
            </div>
          </dl>
          <code>{review.row.envelope_sha256}</code>
          <Field label={t("發佈原因", "Publication reason")}>
            <input
              value={review.reason}
              maxLength={1000}
              onChange={(e) => setReview({ ...review, reason: e.target.value })}
            />
          </Field>
          <label className="desktop-release-confirm">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t(
              "已核對簽名版本、目標頻道、推出範圍及有效期限。",
              "I reviewed the signed version, channel, rollout and expiry.",
            )}
          </label>
          <ErrorNotice error={error} />
          <button
            className="button primary"
            disabled={busy || !confirmed || review.reason.trim().length < 5}
            onClick={() => void publish()}
          >
            {t("確認發佈", "Confirm publication")}
          </button>
        </Modal>
      )}
    </div>
  );
}
