import type { IO } from "./audio-production.js";
import { exactHKD } from "./financial-notice.js";
import { workflowInputsReview, workflowInputsReviewable } from "./workflow-contracts.js";

/** Native Chrome Side Panel, company cloud execution; no local Agent. */
export function mountCloudEvents(
  host: HTMLElement,
  io: IO & { openWorkflows: () => Promise<unknown> },
) {
  let disposed = false,
    loading = false,
    pending = false,
    issuedId: string | null = null;
  const cards = new Map<string, { signature: string; element: HTMLElement }>(),
    versions = new Map<string, number>(),
    intents = new Map<string, { body: string; key: string }>();
  const active = () => !disposed && io.live(),
    tr = io.tr;
  const make = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text?: string,
  ) => {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    return el;
  };
  const button = (label: string, fn: () => void) => {
    const el = make("button", label);
    el.type = "button";
    el.className = "secondary";
    el.addEventListener("click", fn);
    return el;
  };
  const list = make("div"),
    keyArea = make("section"),
    errorArea = make("div");
  host.replaceChildren(errorArea, keyArea, list);
  host.classList.add("cloud-event-panel");
  const fail = (area: HTMLElement, e: unknown) => {
    const el = make("p", (e as Error).message);
    el.setAttribute("role", "alert");
    area.replaceChildren(el);
  };
  const facts = (row: any) => {
    const b = row.body,
      area = make("div");
    area.className = "cloud-event-facts";
    area.append(
      make("strong", b.event_type),
      make("p", b.expected_output),
      make(
        "p",
        tr("每次上限：", "Per-run limit: ") + exactHKD(b.max_budget_micros),
      ),
      make(
        "p",
        tr("每日上限：", "Daily limit: ") +
          exactHKD(b.max_daily_budget_micros) +
          " · " +
          b.max_runs_per_day +
          tr(" 次 · ", " runs · ") +
          b.timezone,
      ),
      make(
        "p",
        tr("間隔／事件有效期：", "Interval / event age: ") +
          b.min_interval_seconds +
          "s / " +
          b.max_event_age_seconds +
          "s",
      ),
      make(
        "p",
        b.overlap_policy === "latest"
          ? tr("繁忙時只保留最新一個", "Keep latest only while busy")
          : tr("繁忙時略過新事件", "Skip new events while busy"),
      ),
      make(
        "p",
        new Date(b.starts_at).toLocaleString() +
          " → " +
          new Date(b.ends_at).toLocaleString(),
      ),
    );
    const details = make("details"),
      steps = make("ol");
    details.append(
      make(
        "summary",
        tr("核對固定方法與資料", "Review fixed method and inputs"),
      ),
    );
    for (const step of row.definition?.steps ?? [])
      steps.append(
        make(
          "li",
          step.kind === "codex"
            ? step.role_key +
                " · " +
                step.prompt +
                " · " +
                exactHKD(step.budget_micros)
            : step.kind === "approval"
              ? step.message
              : tr("已授權資料摘要", "Authorized dataset summary"),
        ),
      );
    details.append(steps, make("p", "v" + b.workflow_version));
    for (const [key, value] of Object.entries(b.source_refs ?? {}))
      details.append(make("small", key + " · " + JSON.stringify(value)));
    details.append(
      make("small", b.workflow_definition_hash),
      make("small", row.specification_hash),
    );
    const inputs = workflowInputsReview(row, tr);
    if (inputs) details.append(inputs);
    area.append(
      details,
      make(
        "p",
        tr(
          "固定資料不自動刷新。顧問費用另計；每次按實際用量結算，人工核對點保留。",
          "Fixed inputs do not refresh. Consultant work is separate; runs settle actual usage and keep human review points.",
        ),
      ),
    );
    return area;
  };
  async function write(id: string, path: string, body: any) {
    const text = JSON.stringify(body);
    if (intents.get(id)?.body !== text)
      intents.set(id, { body: text, key: crypto.randomUUID() });
    const r = await io.request(path, "POST", body, intents.get(id)!.key);
    intents.delete(id);
    if (r.trigger) versions.set(r.trigger.id, r.trigger.version);
    return r;
  }
  function showKey(r: any) {
    issuedId = r.trigger.id;
    keyArea.replaceChildren();
    keyArea.dataset.eventIssued = r.trigger.id;
    keyArea.append(
      make("h3", tr("連接你的事件來源", "Connect your event source")),
      make(
        "p",
        tr(
          "密鑰只顯示一次；關閉後遺失需主動輪換，舊密鑰會失效。不要交給對話中的 Agent。",
          "The key appears once. Rotate if it is lost after closing; the old key stops working. Keep it out of Agent conversations.",
        ),
      ),
      make("p", r.trigger.endpoint),
      make("p", tr("密鑰版本：", "Key version: ") + r.trigger.key_version),
    );
    if (r.signing_secret) {
      const secret = make("input");
      secret.type = "password";
      secret.readOnly = true;
      secret.autocomplete = "off";
      secret.value = r.signing_secret;
      secret.setAttribute("aria-label", tr("簽名密鑰", "Signing key"));
      const reveal = button(tr("顯示密鑰", "Reveal key"), () => {
        secret.type = secret.type === "password" ? "text" : "password";
        reveal.textContent =
          secret.type === "password"
            ? tr("顯示密鑰", "Reveal key")
            : tr("隱藏密鑰", "Hide key");
      });
      const copy = button(tr("複製密鑰", "Copy key"), () => {
        void navigator.clipboard
          .writeText(secret.value)
          .then(() => {
            if (active()) copy.textContent = tr("已複製", "Copied");
          })
          .catch((e) => fail(errorArea, e));
      });
      keyArea.append(secret, reveal, copy);
    } else
      keyArea.append(
        make(
          "p",
          tr(
            "這是已完成操作的重試回應。如需新密鑰，請輪換。",
            "This completed-operation retry does not reveal the key again. Rotate for a new key.",
          ),
        ),
      );
    keyArea.append(
      button(tr("我已保存，關閉", "Saved, close"), () => {
        issuedId = null;
        keyArea.replaceChildren();
        delete keyArea.dataset.eventIssued;
      }),
    );
  }
  async function operate(
    area: HTMLElement,
    fn: () => Promise<any>,
    withKey = false,
  ) {
    if (pending || !active()) return;
    pending = true;
    errorArea.replaceChildren();
    for (const b of list.querySelectorAll("button")) b.disabled = true;
    try {
      const r = await fn();
      if (!active()) return;
      if (withKey) showKey(r);
      cards.clear();
      list.replaceChildren();
    } catch (e) {
      if (active()) fail(errorArea, e);
    } finally {
      pending = false;
      if (active()) {
        cards.clear();
        list.replaceChildren();
        void load();
      }
    }
  }
  function card(row: any, isRequest: boolean) {
    const area = make("article");
    if (isRequest) area.dataset.eventRequest = row.id;
    else area.dataset.eventTrigger = row.id;
    area.append(
      make(
        "small",
        isRequest ? tr("待你確認", "Awaiting your confirmation") : row.state,
      ),
      make("h3", isRequest ? row.body.name : row.name),
      facts(row),
    );
    if (isRequest) {
      const review = make("details");
      review.append(
        make("summary", tr("核對事件與費用", "Review event and costs")),
      );
      const label = make("label"),
        consent = make("input"),
        activate = button(
          tr("確認啟用", "Activate confirmed work"),
          () =>
            void operate(
              area,
              () =>
                write(
                  "activate:" + row.id,
                  io.base +
                    `/cloud-workflow-events/requests/${row.id}/decision`,
                  {
                    decision: "activate",
                    specification_hash: row.specification_hash,
                    max_budget_micros: row.body.max_budget_micros,
                    max_daily_budget_micros: row.body.max_daily_budget_micros,
                  },
                ),
              true,
            ),
        );
      consent.type = "checkbox";
      consent.name = "event_authorized";
      consent.disabled = !row.origin_ready || !workflowInputsReviewable(row);
      activate.disabled = true;
      consent.addEventListener("change", () => {
        activate.disabled = pending || !consent.checked || !row.origin_ready || !workflowInputsReviewable(row);
      });
      label.append(
        consent,
        document.createTextNode(
          tr(
            "我已核對方法、資料、規則、時區及每次與每日預算，授權符合條件的雲端執行。",
            "I reviewed the method, inputs, rules, time zone and per-run and daily budgets, and authorize matching cloud work.",
          ),
        ),
      );
      if (!row.origin_ready)
        review.append(
          make(
            "p",
            tr(
              "顧問完成後才能啟用。",
              "Activation waits for the consultant to finish.",
            ),
          ),
        );
      review.append(
        label,
        activate,
        button(
          tr("拒絕提案", "Decline proposal"),
          () =>
            void operate(area, () =>
              write(
                "decline:" + row.id,
                io.base + `/cloud-workflow-events/requests/${row.id}/decision`,
                {
                  decision: "decline",
                  specification_hash: row.specification_hash,
                  max_budget_micros: row.body.max_budget_micros,
                  max_daily_budget_micros: row.body.max_daily_budget_micros,
                },
              ),
            ),
        ),
      );
      area.append(review);
    } else {
      area.append(make("p", row.endpoint));
      if (row.last_error) area.append(make("p", row.last_error));
      const history = make("details"),
        historyBody = make("div");
      history.append(
        make("summary", tr("事件紀錄", "Event history")),
        historyBody,
      );
      let cursor: string | null = null;
      const historyPage = async () => {
        try {
          const r = await io.request(
            io.base +
              `/cloud-workflow-events/${row.id}?limit=10` +
              (cursor ? "&cursor=" + cursor : ""),
          );
          if (!active()) return;
          historyBody.replaceChildren();
          for (const i of r.items) {
            const receipt = make("div");
            receipt.dataset.eventReceipt = i.id;
            receipt.append(
              make("strong", i.event_id),
              make(
                "p",
                i.state +
                  " · v" +
                  i.revision +
                  " · " +
                  new Date(i.received_at).toLocaleString(),
              ),
              make("p", i.code ?? ""),
            );
            if (i.run_id)
              receipt.append(
                button(
                  tr("查看流程與交付", "View workflows and delivery"),
                  () => void io.openWorkflows(),
                ),
              );
            historyBody.append(receipt);
          }
          if (!r.items.length)
            historyBody.append(
              make("p", tr("尚未收到事件。", "No events received yet.")),
            );
          if (r.next_cursor)
            historyBody.append(
              button(tr("下一頁", "Next"), () => {
                cursor = r.next_cursor;
                void historyPage();
              }),
            );
          if (cursor)
            historyBody.append(
              button(tr("返回最新", "Back to latest"), () => {
                cursor = null;
                void historyPage();
              }),
            );
        } catch (e) {
          if (active()) fail(historyBody, e);
        }
      };
      history.addEventListener("toggle", () => {
        if (history.open) void historyPage();
      });
      area.append(history);
      if (!["retired", "ended"].includes(row.state)) {
        const control = make("details");
        control.append(
          make("summary", tr("管理未來事件", "Manage future events")),
          make(
            "p",
            tr(
              "暫停或停止保留目前工作；輪換會立即撤銷舊密鑰。恢復與修訂請至完整工作區重新核對。",
              "Pause or stop preserves current runs. Rotation revokes the old key immediately. Review resumption and revisions in your full workspace.",
            ),
          ),
        );
        for (const action of [
          ...(row.state === "active" ? ["pause"] : []),
          "rotate-key",
          "retire",
        ]) {
          const label =
            action === "pause"
              ? tr("確認暫停", "Confirm pause")
              : action === "retire"
                ? tr("確認停止", "Confirm stop")
                : tr("確認輪換密鑰", "Confirm key rotation");
          const b = button(
            label,
            () =>
              void operate(
                area,
                () =>
                  write(
                    action + ":" + row.id,
                    io.base +
                      `/cloud-workflow-events/${row.id}/` +
                      (action === "rotate-key" ? action : "status"),
                    {
                      expected_version: row.version,
                      ...(action === "rotate-key" ? {} : { action }),
                    },
                  ),
                action === "rotate-key",
              ),
          );
          b.disabled = row.version < (versions.get(row.id) ?? 0);
          control.append(b);
        }
        control.append(
          button(
            tr("在完整工作區修訂／恢復", "Revise / resume in full workspace"),
            () => void io.openWorkflows(),
          ),
        );
        area.append(control);
      }
    }
    return area;
  }
  async function load() {
    if (!active() || loading || pending) return;
    loading = true;
    try {
      const data = await io.request(
        io.base + "/cloud-workflow-events?task_id=" + io.taskId,
      );
      if (!active() || pending) return;
      if (issuedId && !data.triggers.some((r: any) => r.id === issuedId)) {
        issuedId = null;
        keyArea.replaceChildren();
        delete keyArea.dataset.eventIssued;
      }
      const rows = [
          ...data.requests.map((r: any) => ({ r, q: true })),
          ...data.triggers.map((r: any) => ({ r, q: false })),
        ],
        keep = new Set<string>();
      for (const { r, q } of rows) {
        const id = (q ? "q:" : "t:") + r.id,
          signature = JSON.stringify(r) + ":" + (versions.get(r.id) ?? 0);
        keep.add(id);
        let cached = cards.get(id);
        if (cached?.signature !== signature) {
          const el = card(r, q);
          cached?.element.remove();
          cached = { signature, element: el };
          cards.set(id, cached);
        }
        list.append(cached!.element);
      }
      for (const [id, c] of cards)
        if (!keep.has(id)) {
          c.element.remove();
          cards.delete(id);
        }
    } catch (e) {
      if (active()) {
        cards.clear();
        list.replaceChildren();
        keyArea.replaceChildren();
        issuedId = null;
        fail(errorArea, e);
      }
    } finally {
      loading = false;
    }
  }
  void load();
  const timer = setInterval(() => void load(), 5000);
  return () => {
    disposed = true;
    clearInterval(timer);
    cards.clear();
    intents.clear();
    versions.clear();
    host.replaceChildren();
    issuedId = null;
  };
}
