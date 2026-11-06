import { toolFeedbackState, type ActivityEvent, type ToolOutcomeSummary } from "./task-tool-state";
import { useI18n } from "./ui";
import "./task-tool-feedback.css";

export function TaskToolFeedback({ events, status, errorCode, summary }: { events: ActivityEvent[]; status?: string; errorCode?: string | null; summary?: ToolOutcomeSummary }) {
  const { t } = useI18n(), {failures,total} = toolFeedbackState(events,summary);
  const deliveryFailed = ["TOOL_DELIVERY_INCOMPLETE", "IMAGE_TOOL_FAILED"].includes(errorCode ?? "");
  if (!total && !deliveryFailed) return null;
  const active = ["queued", "running", "needs_input", "paused"].includes(status ?? "");
  const description = (category: string) => category === "validation"
    ? t("輸出要求需要修正。助手可在原工作和預算內處理。", "An output requirement needs correction within this task and its original budget.")
    : category === "source" ? t("選用資料或原操作結果暫時不可用，需要先核對。", "The selected source or original operation result needs review.")
    : category === "permission" ? t("目前權限不足，請由有權限的使用者處理。", "Current access is unavailable. An authorized user needs to resolve it.")
    : t("此步驟的結果未能確認，請先核對原記錄。", "This step’s result could not be confirmed. Review its original record first.");
  return <section className="notice error task-tool-feedback" role="status" aria-label={t("交付狀態", "Delivery status")}>
    <strong>{active || status === "succeeded" && !deliveryFailed ? t("部分步驟仍待處理", "Some steps need attention") : t("此項工作尚未完整交付", "This work was not fully delivered")}</strong>
    <p>{active ? t("請保留目前工作；已完成的成果和已發生用量會保留。", "Keep this task. Completed results and recorded usage remain available.")
      : t("請查看已保留的成果與活動，再確認下一步。此狀態不代表此前模型用量免費。", "Review retained results and activity before deciding the next step. Previously used model services still count toward usage.")}</p>
    {failures.map(failure => <div key={failure.tool+":"+failure.reference}><p>{description(failure.category)}</p>{failure.reference && <details><summary>{t("支援記錄", "Support reference")}</summary><code>{failure.code} · {failure.reference}</code></details>}</div>)}
    {total>failures.length && <p>{t(`另有 ${total-failures.length} 項步驟待核對，請查看活動記錄。`,`${total-failures.length} more steps need review. Check task activity.`)}</p>}
  </section>;
}
