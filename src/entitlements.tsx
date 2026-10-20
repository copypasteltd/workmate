import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "./api";
import { DateText, ErrorNotice, Loading, Money, useI18n } from "./ui";

/** A tenant change unmounts this panel. Requests also carry the API session
 * revision, so a late response cannot repopulate a signed-out user's rights. */
export function Entitlements({ tenant }: { tenant: string }) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0),
    [data, setData] = useState<any>(null),
    [error, setError] = useState<Error | null>(null),
    [loading, setLoading] = useState(true),
    [inbox, setInbox] = useState<any>(null),
    [noticeError, setNoticeError] = useState<Error | null>(null),
    [cursor, setCursor] = useState<string | null>(null),
    [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true,
      timer: ReturnType<typeof setTimeout> | undefined;
    const ctrl = new AbortController();
    const load = async () => {
      try {
        const [current, plan] = await Promise.all([
          api("/v1/effective-entitlements", {
            headers: { "X-Tenant-ID": tenant },
            signal: ctrl.signal,
          }),
          api(`/v1/tenants/${tenant}/plan`, { signal: ctrl.signal }),
        ]);
        if (live) {
          // A grant or time boundary can occur between these two transactions.
          // Never pair the old plan/quota with newly confirmed rights.
          if (
            plan.entitlement_version !== current.entitlement_version ||
            JSON.stringify([...plan.plan_version_ids].sort()) !==
              JSON.stringify([...current.plan_version_ids].sort())
          ) {
            setData(null);
            setError(null);
            timer = setTimeout(load, 500);
            return;
          }
          setData({ ...current, plan_details: plan });
          setError(null);
          const boundary = current.expires_at
            ? Date.parse(current.expires_at) - Date.parse(current.as_of) + 100
            : 15000;
          timer = setTimeout(load, Math.min(15000, Math.max(500, boundary)));
        }
      } catch (e) {
        if (live) {
          setData(null);
          setError(e as Error);
          timer = setTimeout(load, 15000);
        }
      } finally {
        if (live) setLoading(false);
      }
    };
    void load();
    return () => {
      live = false;
      ctrl.abort();
      if (timer) clearTimeout(timer);
    };
  }, [tenant, revision]);
  useEffect(() => {
    let live = true;
    const ctrl = new AbortController();
    setInbox(null);
    setNoticeError(null);
    void api(
      `/v1/entitlement-notifications?limit=10${cursor ? "&cursor=" + cursor : ""}`,
      { headers: { "X-Tenant-ID": tenant }, signal: ctrl.signal },
    )
      .then((value) => {
        if (live) setInbox(value);
      })
      .catch((e) => {
        if (live) setNoticeError(e);
      });
    return () => {
      live = false;
      ctrl.abort();
    };
  }, [tenant, revision, cursor]);
  const names: Record<string, [string, string]> = {
    text: ["文字與開發", "Text & development"],
    image: ["圖片", "Images"],
    video: ["影片", "Video"],
    design: ["設計", "Design"],
    analytics: ["分析", "Analytics"],
    workflow: ["流程", "Workflows"],
    local_files: ["本機檔案", "Local files"],
  };
  const kinds: Record<string, [string, string]> = {
    changed: ["權益已更新", "Entitlements updated"],
    starts: ["授予已生效", "Grant started"],
    expires: ["授予已到期", "Grant expired"],
    replaced: ["方案已取代", "Plan replaced"],
  };
  return (
    <>
      <section className="card plan-card">
        <div>
          <span className="eyebrow">YOUR EFFECTIVE PLAN</span>
          <h2>
            {data?.plan_details.body.name ??
              t("正在確認方案", "Confirming plan")}
          </h2>
          <p className="muted">
            {t(
              "企業與個人權益會按目前有效期限合併判定。VIP 不會增加帳戶餘額。",
              "Active personal and workspace grants determine your plan. VIP does not add wallet credit.",
            )}
          </p>
          <p>
            {t("未完成工作上限", "Active task limit")}:{" "}
            {data?.plan_details.body.max_active_tasks ?? "—"} ·{" "}
            {t("單次預算上限", "Task budget limit")}:{" "}
            <Money value={data?.plan_details.body.max_task_budget_micros} />
          </p>
          <p className="muted">
            {t(
              "排隊、待補資料和待核對的工作也計入上限。實際執行另受企業共用名額與服務容量限制；排隊時不會呼叫模型。",
              "Queued work, missing inputs and reconciliation count toward this limit. Execution also depends on shared workspace slots and service capacity; queued work makes no model call.",
            )}
          </p>
        </div>
        {data?.plan_details.ends_at && (
          <DateText value={data.plan_details.ends_at} />
        )}
      </section>
      <section className="section-block">
        <div className="section-title">
          <h2>{t("目前可用權益", "Current entitlements")}</h2>
          <button
            className="button secondary"
            onClick={() => {
              setCursor(null);
              setRevision((n) => n + 1);
            }}
          >
            <RefreshCw size={16} />
            {t("更新權益", "Refresh access")}
          </button>
        </div>
        <ErrorNotice error={error} />
        {loading && <Loading />}
        {data && (
          <div className="card">
            <div className="tag-row">
              {data.feature_ids.map((id: string) => (
                <span className="badge" key={id}>
                  {names[id] ? t(...names[id]) : id}
                </span>
              ))}
            </div>
            {!data.feature_ids.length && (
              <p>
                {t(
                  "目前方案未開啟功能。",
                  "The current plan enables no features.",
                )}
              </p>
            )}
            <p className="muted">
              {t("伺服器確認時間", "Confirmed by server")}{" "}
              <DateText value={data.as_of} /> ·{" "}
              {t("權益版本", "Entitlement version")} {data.entitlement_version}
            </p>
            {data.expires_at && (
              <p>
                {t("下一個生效或到期時間", "Next activation or expiry")}{" "}
                <DateText value={data.expires_at} />
              </p>
            )}
            <p className="muted">
              {t(
                "個人與目前企業授予共同決定權益；使用時仍會檢查專案權限、本機檔案授權與預算。",
                "Personal and current workspace grants determine access. Project permissions, local file consent and budget are checked when used.",
              )}
            </p>
          </div>
        )}
        <h3>{t("權益變更通知", "Entitlement notifications")}</h3>
        <ErrorNotice error={noticeError} />
        {inbox?.items.length === 0 && (
          <p className="muted">
            {t("暫無權益變更通知。", "No entitlement notifications yet.")}
          </p>
        )}
        {inbox?.items.map((n: any) => (
          <article className="card" key={n.id}>
            <strong>{kinds[n.kind] ? t(...kinds[n.kind]) : n.kind}</strong>
            <p>
              <DateText value={n.available_at} /> ·{" "}
              {t("授予修訂", "Grant revision")} {n.grant_version}
            </p>
            <p className="muted">
              {t(
                "此通知保留當時的變更記錄，目前權益以本頁最新確認結果為準。",
                "This records a past change. Current access follows the latest confirmed result above.",
              )}
            </p>
            <button
              className="button secondary"
              disabled={n.read || busy === n.id}
              onClick={async () => {
                setBusy(n.id);
                setNoticeError(null);
                try {
                  await api("/v1/entitlement-notifications/" + n.id, {
                    method: "PATCH",
                    body: JSON.stringify({ read: true }),
                    headers: { "X-Tenant-ID": tenant },
                  });
                  setInbox((old: any) => ({
                    ...old,
                    items: old.items.map((row: any) =>
                      row.id === n.id ? { ...row, read: true } : row,
                    ),
                  }));
                } catch (e) {
                  setNoticeError(e as Error);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {n.read ? t("已讀", "Read") : t("標示已讀", "Mark read")}
            </button>
          </article>
        ))}
        {(cursor || inbox?.next_cursor) && (
          <div className="button-row">
            <button
              className="button secondary"
              disabled={!cursor}
              onClick={() => setCursor(null)}
            >
              {t("最新通知", "Latest notifications")}
            </button>
            <button
              className="button secondary"
              disabled={!inbox?.next_cursor}
              onClick={() => setCursor(inbox.next_cursor)}
            >
              {t("較早通知", "Older notifications")}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
