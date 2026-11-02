import React from "react";

/** A local report is diagnostic metadata, separate from the settlement state. */
export function NativeTaskNoticeView({ code, t = (zh) => zh }: { code?: string | null; t?: (zh: string, en: string) => string }) {
  if (!code || code !== code.trim() || !/^[A-Z][A-Z0-9_]{2,79}$/.test(code)) return null;
  const message = code === "LOCAL_CODEX_STREAM_DISCONNECTED"
    ? t("模型連線在工作完成前中斷，請核對本機結果與費用記錄。", "The model connection ended before completion. Review the local results and usage record.")
    : code === "LOCAL_COMPANY_API_UNAVAILABLE"
      ? t("執行時未能連接公司服務，請查看工作記錄。", "The company service was unreachable during execution. Review the activity record.")
      : code === "LOCAL_EXECUTION_CANCELLED"
        ? t("本機工作已停止，請核對已完成的內容。", "Local work stopped. Review any completed changes.")
        : t("本機回報工作未完成，請查看桌面端的執行記錄。", "The local client reported incomplete work. Review the activity in the desktop app.");
  return <div className="native-task-notice" data-client-error-code={code}
    style={{ maxWidth: "28rem", minWidth: 0, whiteSpace: "normal", overflowWrap: "anywhere" }}>
    <strong>{t("本機回報原因", "Reported local cause")}</strong>
    <div>{message}</div>
    <code style={{ whiteSpace: "normal", overflowWrap: "anywhere" }}>{code}</code>
  </div>;
}
