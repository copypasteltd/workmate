import { exactHKD } from "./financial-notice.js";
import type { IO } from "./audio-production.js";

/** The native right Side Panel reviews cloud requests; it never runs a local Agent. */
export function mountCloudSchedules(
  host: HTMLElement,
  io: IO & { openWorkflows: () => Promise<unknown> },
) {
  let disposed = false,
    loading = false;
  const cards = new Map<string, { signature: string; element: HTMLElement }>();
  const intents = new Map<string, { body: string; key: string }>();
  const live = () => !disposed && io.live();
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
  ) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function facts(row: any) {
    const b = row.body,
      area = make("div");
    area.className = "cloud-schedule-facts";
    area.append(
      make("strong", b.calendar.time),
      make(
        "p",
        b.calendar.timezone +
          " · " +
          (b.calendar.frequency === "daily"
            ? io.tr("每日", "Daily")
            : io.tr("每週", "Weekly") + " " + b.calendar.weekdays.join(", ")),
      ),
      make(
        "p",
        io.tr("每次預算上限：", "Per-run budget: ") +
          exactHKD(b.max_budget_micros),
      ),
      make("p", b.expected_output),
      make(
        "p",
        b.catch_up === "latest"
          ? io.tr("漏跑只補最近一次", "Catch up latest only")
          : io.tr("略過漏跑", "Skip missed work"),
      ),
    );
    const details = make("details"),
      list = make("ol");
    details.append(
      make(
        "summary",
        io.tr("核對方法與固定輸入", "Review method and fixed inputs"),
      ),
    );
    for (const step of row.definition?.steps ?? [])
      list.append(
        make(
          "li",
          step.kind === "approval"
            ? io.tr("人工核對：", "Human review: ") + step.message
            : step.kind === "codex"
              ? step.role_key +
                " · " +
                step.prompt +
                " · " +
                exactHKD(step.budget_micros)
              : io.tr(
                  "計算已授權的固定資料摘要",
                  "Calculate the authorized fixed dataset summary",
                ),
        ),
      );
    details.append(
      list,
      make(
        "p",
        io.tr("固定流程版本：", "Fixed workflow version: ") +
          "v" +
          b.workflow_version,
      ),
      make(
        "p",
        io.tr(
          "固定輸入不自動刷新。顧問準備費用另計，每次執行依實際用量結算。",
          "Fixed inputs do not refresh automatically. Consultant preparation is separate; each run settles actual usage.",
        ),
      ),
    );
    for (const [kind, refs] of Object.entries(b.source_refs ?? {}))
      if (Array.isArray(refs))
        for (const ref of refs)
          details.append(
            make(
              "small",
              kind +
                " · " +
                (ref.id ?? ref.workflow_id ?? ref.asset_version_id ?? "—") +
                (ref.version != null ? " · v" + ref.version : ""),
            ),
          );
    details.append(make("small", b.workflow_definition_hash));
    area.append(details);
    if (row.next?.length) {
      const next = make("details");
      next.append(make("summary", io.tr("接下來的時刻", "Upcoming times")));
      for (const n of row.next)
        next.append(
          make(
            "p",
            n.local.replace("T", " ") +
              (n.daylight_gap
                ? io.tr(
                    " · 夏令時不存在，此次略過",
                    " · nonexistent wall time; skipped",
                  )
                : ""),
          ),
        );
      area.append(next);
    }
    return area;
  }
  function build(row: any, pending: boolean, occurrences: any[]) {
    const card = make("article");
    card.className = "cloud-schedule-card";
    if (pending) card.dataset.scheduleRequest = row.id;
    else card.dataset.cloudSchedule = row.id;
    const expired =
      pending && (row.expired || Date.now() >= Date.parse(row.expires_at));
    card.append(
      make(
        "small",
        pending
          ? io.tr("待你確認 · 尚未啟用", "Waiting for you · not active")
          : io.tr("私有雲端計劃", "Private cloud schedule"),
      ),
      make("h3", row.body.name),
      facts(row),
    );
    const error = make("p");
    error.setAttribute("role", "alert");
    error.hidden = true;
    card.append(error);
    const form = make("form"),
      fields = make("fieldset");
    fields.className = "cloud-schedule-controls";
    async function decide(action: string) {
      if (!live() || fields.disabled) return;
      const body = pending
        ? {
            decision: action,
            specification_hash: row.specification_hash,
            max_budget_micros: row.body.max_budget_micros,
          }
        : {
            action,
            expected_version: row.version,
            specification_hash: row.specification_hash,
            max_budget_micros: row.body.max_budget_micros,
          };
      const id = (pending ? "request:" : "schedule:") + row.id + ":" + action,
        encoded = JSON.stringify(body);
      if (intents.get(id)?.body !== encoded)
        intents.set(id, { body: encoded, key: crypto.randomUUID() });
      fields.disabled = true;
      error.hidden = true;
      try {
        await io.request(
          io.base +
            "/cloud-workflow-schedules/" +
            (pending ? "requests/" + row.id + "/decision" : row.id + "/status"),
          "POST",
          body,
          intents.get(id)!.key,
        );
        intents.delete(id);
      } catch (failure) {
        if (live() && card.isConnected) {
          error.textContent = (failure as Error).message;
          error.hidden = false;
        }
      } finally {
        fields.disabled = false;
        if (live()) void load();
      }
    }
    if (pending) {
      const check = make("input");
      check.type = "checkbox";
      check.name = "schedule_authorized";
      check.required = true;
      check.disabled = expired || !row.origin_ready;
      const label = make("label");
      label.append(
        check,
        make(
          "span",
          io.tr(
            "我已核對方法、資料、時區、交付及每次預算，同意關閉側欄後仍在雲端執行。",
            "I reviewed the method, inputs, time zone, outputs and per-run budget, and authorize cloud execution after I close the panel.",
          ),
        ),
      );
      const submit = make(
        "button",
        io.tr("確認並啟用計劃", "Confirm & activate schedule"),
      );
      submit.type = "submit";
      submit.disabled = true;
      check.onchange = () => {
        submit.disabled = !check.checked || expired || !row.origin_ready;
      };
      const decline = make(
        "button",
        io.tr("拒絕此提案", "Decline this request"),
      );
      decline.type = "button";
      decline.className = "secondary";
      decline.disabled = expired;
      decline.onclick = () => {
        void decide("decline");
      };
      fields.append(
        make(
          "p",
          expired
            ? io.tr(
                "此提案已逾時，請重新準備。",
                "Request expired. Prepare a new one.",
              )
            : !row.origin_ready
              ? io.tr(
                  "等待顧問成功完成，目前沒有建立未來工作。",
                  "Waiting for the consultant to finish. No future work has started.",
                )
              : io.tr(
                  "啟用不預扣未來費用，人工核對點每次保留。",
                  "Activation does not precharge future work. Human review points remain in each run.",
                ),
        ),
        label,
        submit,
        decline,
      );
      form.onsubmit = (e) => {
        e.preventDefault();
        if (check.checked && !check.disabled) void decide("activate");
      };
    } else {
      fields.append(
        make("p", io.tr("狀態：", "State: ") + row.state),
        make(
          "p",
          io.tr("下次觸發：", "Next time: ") +
            (row.next_due_at
              ? new Date(row.next_due_at).toLocaleString()
              : "—"),
        ),
        make(
          "p",
          io.tr(
            "暫停未來觸發會保留當前工作；當前執行須另行停止。",
            "Pausing future times preserves current work. Stop a current run separately.",
          ),
        ),
      );
      if (row.last_error)
        fields.append(
          make(
            "p",
            io.tr(
              "未來觸發已停止，請核對當前結果、費用、資料和權限後再確認恢復。",
              "Future times stopped. Review current results, charges, inputs and permissions before resuming.",
            ),
          ),
        );
      if (!["retired", "ended"].includes(row.state)) {
        if (row.state === "active") {
          const pause = make(
            "button",
            io.tr("暫停未來觸發", "Pause future times"),
          );
          pause.type = "button";
          pause.onclick = () => {
            void decide("pause");
          };
          fields.append(pause);
        } else {
          const check = make("input");
          check.type = "checkbox";
          check.name = "resume_authorized";
          check.required = true;
          const label = make("label");
          label.append(
            check,
            make(
              "span",
              io.tr(
                "我已重新核對方法、資料及每次預算，同意從現在起恢復並略過暫停期間。",
                "I reviewed the method, inputs and per-run budget, and authorize resumption from now, skipping paused times.",
              ),
            ),
          );
          const resume = make(
            "button",
            io.tr("確認並恢復", "Confirm & resume"),
          );
          resume.type = "submit";
          resume.disabled = true;
          check.onchange = () => {
            resume.disabled = !check.checked;
          };
          form.onsubmit = (e) => {
            e.preventDefault();
            if (check.checked) void decide("resume");
          };
          fields.append(label, resume);
        }
      }
      const history = make("details");
      history.append(
        make("summary", io.tr("最近觸發與結果", "Recent triggers & results")),
      );
      for (const o of occurrences
        .filter((o) => o.schedule_id === row.id)
        .slice(0, 10))
        history.append(
          make(
            "p",
            o.scheduled_local.replace("T", " ") +
              " · " +
              (o.calendar?.timezone ?? "") +
              " · " +
              (o.run_state ?? o.state) +
              " · " +
              exactHKD(o.charged_micros ?? "0"),
          ),
        );
      const open = make(
        "button",
        io.tr(
          "查看完整流程、交付或停止當前執行",
          "Open full workflow, results or stop current run",
        ),
      );
      open.type = "button";
      open.className = "secondary";
      open.onclick = () => {
        void io.openWorkflows();
      };
      fields.append(history, open);
    }
    form.append(fields);
    card.append(form);
    return card;
  }
  async function load() {
    if (!live() || loading) return;
    loading = true;
    try {
      const data = await io.request(
        io.base +
          "/cloud-workflow-schedules?" +
          new URLSearchParams({ task_id: io.taskId }),
      );
      if (!live()) return;
      const rows = [
        ...data.requests
          .filter((q: any) => q.state === "pending")
          .map((q: any) => ({ ...q, pending: true })),
        ...data.schedules.map((s: any) => ({ ...s, pending: false })),
      ];
      const ids = new Set<string>(rows.map((r) => r.id));
      for (const [id, card] of cards)
        if (!ids.has(id)) {
          card.element.remove();
          cards.delete(id);
        }
      for (const row of rows) {
        const signature = JSON.stringify([
            row,
            data.occurrences,
            row.pending && Date.now() >= Date.parse(row.expires_at),
          ]),
          old = cards.get(row.id);
        if (old?.signature === signature) continue;
        const element = build(row, row.pending, data.occurrences);
        if (old) old.element.replaceWith(element);
        else host.append(element);
        cards.set(row.id, { signature, element });
      }
      host.hidden = !rows.length;
      host.querySelector("[data-cloud-schedule-error]")?.remove();
    } catch (failure) {
      if (live()) {
        cards.clear();
        host.replaceChildren();
        let error = host.querySelector<HTMLElement>(
          "[data-cloud-schedule-error]",
        );
        if (!error) {
          error = make("p");
          error.dataset.cloudScheduleError = "true";
          error.setAttribute("role", "alert");
          host.append(error);
        }
        error.textContent = (failure as Error).message;
        host.hidden = false;
      }
    } finally {
      loading = false;
    }
  }
  host.setAttribute(
    "aria-label",
    io.tr("私有雲端計劃", "Private cloud schedules"),
  );
  const timer = setInterval(() => {
    if (!document.hidden) void load();
  }, 3000);
  void load();
  return () => {
    disposed = true;
    clearInterval(timer);
    cards.clear();
    intents.clear();
    host.replaceChildren();
  };
}
