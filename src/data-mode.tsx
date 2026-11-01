import { useState } from "react";
import { post } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, useData, useI18n } from "./ui";
export function DataModeNotice() {
  const { t } = useI18n(),
    w = useWorkspace(),
    config = useData("/v1/public/config"),
    [error, setError] = useState<Error | null>(null),
    [busy, setBusy] = useState(false),
    [granted, setGranted] = useState("");
  if (config.data?.data_mode !== "simulated") return null;
  const membership = w.me?.memberships?.find((m: any) => m.id === w.tenant);
  return (
    <aside className="demo-notice" role="status">
      <strong>
        {t("演示環境 · 模擬資料", "Demo environment · simulated data")}
      </strong>
      <span>
        {t(
          "試用額度及未接入服務使用模擬資料；已獨立設定的模型會呼叫實際上游。檔案與工作記錄會保存。",
          "Trial credit and unconfigured services are simulated. Independently configured models use their actual upstream. Files and task records are saved.",
        )}
      </span>
      {membership?.role === "owner" && membership.data_mode === "simulated" && (
        <button
          className="text-button"
          disabled={busy || granted === w.tenant}
          onClick={() => {
            setBusy(true);
            setError(null);
            void post(`/v1/tenants/${w.tenant}/demo-credit`)
              .then(() => setGranted(w.tenant))
              .catch(setError)
              .finally(() => setBusy(false));
          }}
        >
          {granted === w.tenant
            ? t("模擬額度已領取", "Demo credit added")
            : t("領取一次模擬額度", "Add one-time demo credit")}
        </button>
      )}
      <ErrorNotice error={error} />
    </aside>
  );
}
