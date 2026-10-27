import { useState } from "react";
import { BookOpen, Search, ShieldCheck, Trash2 } from "lucide-react";
import { api, patch, post } from "./api";
import { useWorkspace } from "./context";
import {
  AsyncForm,
  Badge,
  Empty,
  ErrorNotice,
  Field,
  Loading,
  Modal,
  PageHeader,
  useData,
  useI18n,
} from "./ui";

export function ProjectSkills() {
  const w = useWorkspace(),
    { t } = useI18n();
  const [refresh, setRefresh] = useState(0),
    [search, setSearch] = useState(""),
    [error, setError] = useState<Error | null>(null),
    [inspect, setInspect] = useState<any>(null),
    [confirm, setConfirm] = useState<any>(null),
    [busy, setBusy] = useState("");
  const versions = useData(w.base + "/skill-versions?limit=200"),
    installed = useData(w.base + "/skill-installations?limit=200", refresh),
    detail = useData(inspect ? w.base + "/skill-versions/" + inspect.id : null);
  const manage = ["owner", "admin"].includes(
    w.me?.memberships.find((m: any) => m.id === w.tenant)?.role,
  );
  const installation = (id: string) => {
    const items =
      installed.data?.items.filter((i: any) => i.skill_version_id === id) ?? [];
    return (
      items.find((i: any) => i.state === "revoked") ??
      items.find((i: any) => i.state === "installed") ??
      items[0]
    );
  };
  async function change(s: any, i: any) {
    setBusy(s.id);
    setError(null);
    try {
      if (!i || i.state === "uninstalled")
        await post(w.base + "/skill-installations", {
          skill_version_id: s.id,
          enabled: true,
        });
      else
        await patch(w.base + "/skill-installations/" + i.id, {
          expected_version: i.version,
          enabled: !i.enabled,
        });
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy("");
    }
  }
  const items =
    versions.data?.items.filter((s: any) =>
      (s.name + " " + s.name_en + " " + s.source + " " + s.tool_ids.join(" "))
        .toLowerCase()
        .includes(search.toLowerCase()),
    ) ?? [];
  return (
    <>
      <PageHeader
        eyebrow="METHODS YOU CAN RETURN TO."
        title={t("專案技能", "Project methods")}
        description={t(
          "選擇可重用的專業方法。預設專家會自動安裝必需項目，管理員可在這裡管理它們。",
          "Choose reusable professional methods. Preset specialists install their required methods; administrators can manage them here.",
        )}
      />
      <div className="notice section-block">
        <BookOpen size={20} />
        <div>
          <strong>
            {t(
              "方法與權限分開管理",
              "Methods and access are managed separately",
            )}
          </strong>
          <p>
            {t(
              "安裝技能不會增加檔案、帳戶或模型權限。普通停用影響新工作；安全撤銷與卸載會阻止已接收工作的後續調用。",
              "Installing a method grants no file, account or model access. Disabling affects new work; security revocation and uninstall block subsequent calls in accepted work.",
            )}
          </p>
        </div>
      </div>
      {!manage && (
        <p className="muted small-text">
          {t(
            "你可以查看技能。安裝與狀態變更需要企業管理員權限。",
            "You can inspect methods. Installation and state changes require workspace administrator access.",
          )}
        </p>
      )}
      <label className="search-field section-block">
        <Search size={17} />
        <input
          aria-label={t("搜尋技能", "Search methods")}
          placeholder={t("搜尋技能…", "Find a method…")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <ErrorNotice error={versions.error ?? installed.error ?? error} />
      {(versions.loading || installed.loading) && !versions.data ? (
        <Loading />
      ) : items.length ? (
        <div className="project-grid">
          {items.map((s: any) => {
            const i = installation(s.id),
              state =
                i?.state === "revoked"
                  ? t("已安全撤銷", "Security revoked")
                  : i?.state === "installed"
                    ? i.enabled
                      ? t("已啟用", "Enabled")
                      : t("已停用", "Disabled")
                    : t("未安裝", "Not installed");
            return (
              <article
                className="card specialist-card"
                key={s.id}
                data-skill-version={s.id}
              >
                <div className="specialist-heading">
                  <BookOpen size={21} />
                  <span className="muted small-text">{state}</span>
                </div>
                <h2>{t(s.name, s.name_en ?? s.name)}</h2>
                <p className="muted small-text">
                  {t("CopyPaste 專業方法", "CopyPaste professional method")} ·{" "}
                  {s.package_version}
                </p>
                <p className="small-text">
                  {t("工具依賴", "Tool dependencies")}: {s.tool_ids.join(" · ")}
                </p>
                <footer className="row-actions">
                  <button className="text-button" onClick={() => setInspect(s)}>
                    {t("查看方法", "Inspect method")}
                  </button>
                  <button
                    className="button"
                    disabled={
                      !manage ||
                      busy === s.id ||
                      i?.state === "revoked" ||
                      s.state !== "verified"
                    }
                    onClick={() => void change(s, i)}
                  >
                    {i?.state === "installed"
                      ? i.enabled
                        ? t("停用新工作", "Disable for new work")
                        : t("啟用", "Enable")
                      : t("安裝", "Install")}
                  </button>
                </footer>
                {i?.state === "installed" && manage && (
                  <div className="row-actions">
                    <button
                      className="text-button"
                      onClick={() => setConfirm({ s, i, kind: "revoke" })}
                    >
                      <ShieldCheck size={14} />
                      {t("安全撤銷", "Security revoke")}
                    </button>
                    <button
                      className="text-button"
                      onClick={() => setConfirm({ s, i, kind: "uninstall" })}
                    >
                      <Trash2 size={14} />
                      {t("卸載", "Uninstall")}
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        <Empty
          icon={BookOpen}
          title={t("找不到技能", "No methods found")}
          body={t("請試用其他搜尋詞。", "Try another search.")}
        />
      )}
      {inspect && (
        <Modal
          title={t(inspect.name, inspect.name_en ?? inspect.name)}
          onClose={() => setInspect(null)}
        >
          <ErrorNotice error={detail.error} />
          {detail.loading ? (
            <Loading />
          ) : (
            detail.data && (
              <>
                <p className="muted small-text">
                  {detail.data.source} · {detail.data.package_version}
                </p>
                <p className="notice">
                  {t(
                    "方法套件已驗證內容摘要；角色的真實服務資格仍需獨立驗收。",
                    "Package integrity is verified. Role qualification with live services requires separate acceptance.",
                  )}
                </p>
                <details className="version-detail">
                  <summary>
                    {t("輸入與輸出約定", "Input and output contract")}
                  </summary>
                  <pre>
                    {JSON.stringify(
                      {
                        input: detail.data.input_schema,
                        output: detail.data.output_schema,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <details className="version-detail" open>
                  <summary>{t("專業工作方法", "Professional method")}</summary>
                  <pre className="preserve-text">
                    {detail.data.instructions}
                  </pre>
                </details>
                <p
                  className="muted small-text"
                  style={{ overflowWrap: "anywhere" }}
                >
                  SHA-256 · {detail.data.content_hash}
                </p>
              </>
            )
          )}
        </Modal>
      )}
      {confirm && (
        <Modal
          title={
            confirm.kind === "revoke"
              ? t("安全撤銷技能", "Security revoke method")
              : t("卸載技能", "Uninstall method")
          }
          onClose={() => setConfirm(null)}
        >
          <p>
            {confirm.kind === "revoke"
              ? t(
                  "此版本將永久撤銷，包括舊會話和執行中的工作。不能重新安裝同一版本。",
                  "This version will be permanently revoked, including old conversations and running work. The same version cannot be reinstalled.",
                )
              : t(
                  "卸載會阻止已接收工作的後續調用。重新安裝會建立新的安裝記錄；既有專家須保存新版本後才能採用。",
                  "Uninstall blocks subsequent calls in accepted work. Reinstallation creates a new installation; save a new specialist version to adopt it.",
                )}
          </p>
          <AsyncForm
            submitLabel={t("確認變更", "Confirm change")}
            onSubmit={async (f) => {
              if (f.get("confirm") !== "on") return;
              if (confirm.kind === "revoke")
                await patch(w.base + "/skill-installations/" + confirm.i.id, {
                  expected_version: confirm.i.version,
                  security_revoke: true,
                });
              else
                await api(w.base + "/skill-installations/" + confirm.i.id, {
                  method: "DELETE",
                });
              setConfirm(null);
              setRefresh((v) => v + 1);
            }}
          >
            <label className="checkbox-row">
              <input type="checkbox" name="confirm" required />
              {t(
                "我了解對現有工作的影響。",
                "I understand the impact on existing work.",
              )}
            </label>
          </AsyncForm>
        </Modal>
      )}
    </>
  );
}
