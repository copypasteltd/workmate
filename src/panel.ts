import {
  exactHKD,
  financialLabels,
  financialExplanation,
  type FinancialNotice,
} from "./financial-notice.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let tenant = "",
  project = "",
  task = "",
  timer: ReturnType<typeof setInterval> | undefined;
let notificationTimer: ReturnType<typeof setInterval> | undefined;
let pending: { fingerprint: string; id: string } | null = null;
let workspaceRevision = 0,
  notificationRevision = 0;
let entitlementRevision = 0;
let financialRevision = 0;
let dependencyRevision = 0,
  dependencyFingerprint = "";
let taskDrawRevision = 0;
let taskVersion = 0;
let startFlow: Promise<void> | null = null;
class WorkspaceChanged extends Error {}
const base = () => `/v1/tenants/${tenant}/projects/${project}`;
function clearTask() {
  taskDrawRevision++;
  dependencyRevision++;
  dependencyFingerprint = "";
  $("input-requests").replaceChildren();
  $("input-requests").hidden = true;
  task = "";
  taskVersion = 0;
  if (timer) clearInterval(timer);
  timer = undefined;
  $("task-view").hidden = true;
  $("task-output").textContent = "";
}
async function send(type: string, body: Record<string, unknown> = {}) {
  const revision = workspaceRevision;
  const r = await chrome.runtime.sendMessage({ type, ...body });
  if (
    ["API", "UPLOAD", "STATUS"].includes(type) &&
    revision !== workspaceRevision
  )
    throw new WorkspaceChanged("Workspace changed");
  if (!r?.ok) {
    if (r?.code === "AUTH_CHANGED")
      throw new WorkspaceChanged("Sign-in state changed");
    if (r?.code === "AUTH_REQUIRED") resetSignedOut();
    throw new Error(
      r?.code === "AUTH_REQUIRED"
        ? tr("登入已失效，請重新登入。", "Your session ended. Sign in again.")
        : r?.code === "AUTH_UNAVAILABLE"
          ? tr(
              "暫時無法更新登入狀態，請稍後再試。",
              "Sign-in could not be refreshed. Try again shortly.",
            )
          : (r?.error ?? "Extension unavailable"),
    );
  }
  return r.data;
}
function resetSignedOut() {
  ++workspaceRevision;
  ++notificationRevision;
  ++financialRevision;
  startFlow = null;
  clearTask();
  if (notificationTimer) clearInterval(notificationTimer);
  notificationTimer = undefined;
  tenant = "";
  project = "";
  pending = null;
  $("login").hidden = false;
  $("workspace").hidden = true;
  $("account-actions").hidden = true;
  for (const id of [
    "notification-list",
    "task-list",
    "task-output",
    "user-name",
    "local-preview",
    "entitlement-summary",
    "entitlement-notices",
    "financial-summary",
    "financial-notices",
    "financial-status",
  ])
    $(id).replaceChildren();
  $<HTMLInputElement>("financial-unread").checked = false;
  localFile = null;
  localGrants = [];
  $("folder-browser").hidden = true;
  $("error").replaceChildren();
  $("error").hidden = true;
}
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "session" || !changes.tokens) return;
  const previous = changes.tokens.oldValue as
      | { session_epoch?: string; access_token?: string }
      | undefined,
    next = changes.tokens.newValue as
      | { session_epoch?: string; access_token?: string }
      | undefined;
  if (!next) resetSignedOut();
  else if (
    (!previous || previous.session_epoch !== next.session_epoch) &&
    previous?.access_token !== next.access_token
  ) {
    resetSignedOut();
    void run(start);
  }
});
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  idempotencyKey?: string,
) =>
  send("API", {
    path,
    method,
    body,
    idempotencyKey,
    tenantId: tenant || undefined,
  });
function showError(e: unknown) {
  $("error").textContent = e instanceof Error ? e.message : String(e);
  $("error").hidden = false;
}
async function run(fn: () => Promise<void>) {
  $("error").hidden = true;
  try {
    await fn();
  } catch (e) {
    if (!(e instanceof WorkspaceChanged)) showError(e);
  }
}
function option(
  select: HTMLSelectElement,
  items: { value: string; label: string }[],
  value = "",
) {
  select.replaceChildren(
    ...items.map((i) => {
      const o = document.createElement("option");
      o.value = i.value;
      o.textContent = i.label;
      return o;
    }),
  );
  if (items.some((i) => i.value === value)) select.value = value;
}
function start(): Promise<void> {
  if (startFlow) return startFlow;
  const current = populateWorkspace();
  startFlow = current;
  void current
    .finally(() => {
      if (startFlow === current) startFlow = null;
    })
    .catch(() => {});
  return current;
}
async function populateWorkspace() {
  const revision = ++workspaceRevision;
  clearTask();
  if (notificationTimer) clearInterval(notificationTimer);
  $("notification-list").replaceChildren();
  const status = await send("STATUS");
  if (revision !== workspaceRevision) return;
  $("login").hidden = status.authenticated;
  $("workspace").hidden = true;
  $("account-actions").hidden = !status.authenticated;
  if (!status.authenticated) {
    resetSignedOut();
    return;
  }
  const me = await request("/v1/session/context");
  if (revision !== workspaceRevision) return;
  $("user-name").textContent = me.user.name;
  option(
    $<HTMLSelectElement>("tenant"),
    me.memberships.map((m: any) => ({ value: m.id, label: m.name })),
  );
  tenant = $<HTMLSelectElement>("tenant").value;
  if (!tenant) {
    $("empty-workspace").hidden = false;
    $("work-area").hidden = true;
    $("workspace").hidden = false;
    return;
  }
  $("empty-workspace").hidden = true;
  $("work-area").hidden = false;
  const catalog = await request("/v1/catalog/roles");
  if (revision !== workspaceRevision) return;
  option(
    $<HTMLSelectElement>("role"),
    [
      {
        value: "assistant",
        label:
          locale === "en"
            ? "Default assistant — text and plans"
            : "預設助手 — 文字與計畫",
      },
      ...catalog.items.map((r: any) => ({
        value: r.role_key,
        label: r.display_name + (r.available ? "" : " · 準備中"),
      })),
    ],
    "assistant",
  );
  notificationTimer = setInterval(() => {
    void run(notifications);
    void entitlements();
    void financial();
  }, 15000);
  await projects();
  if (revision === workspaceRevision) $("workspace").hidden = false;
}
async function projects() {
  $("entitlement-summary").replaceChildren();
  $("entitlement-notices").replaceChildren();
  for (const id of [
    "financial-summary",
    "financial-notices",
    "financial-status",
  ])
    $(id).replaceChildren();
  const scope = tenant,
    revision = workspaceRevision;
  const d = await request(`/v1/tenants/${scope}/projects`);
  if (revision !== workspaceRevision || scope !== tenant) return;
  option(
    $<HTMLSelectElement>("project"),
    d.items.map((p: any) => ({ value: p.id, label: p.name })),
  );
  project = $<HTMLSelectElement>("project").value;
  const me = await request("/v1/session/context");
  if (revision !== workspaceRevision || scope !== tenant) return;
  $("demo-banner").hidden =
    me.memberships.find((m: any) => m.id === tenant)?.data_mode !== "simulated";
  await tasks();
  await notifications();
  await entitlements();
  await financial();
}
async function financial() {
  const scope = tenant,
    revision = workspaceRevision,
    load = ++financialRevision,
    summary = $("financial-summary"),
    list = $("financial-notices"),
    status = $("financial-status"),
    unread = $<HTMLInputElement>("financial-unread").checked;
  const live = () =>
    scope === tenant &&
    revision === workspaceRevision &&
    load === financialRevision;
  summary.replaceChildren();
  list.replaceChildren();
  status.replaceChildren();
  if (!scope) return;
  try {
    const [accounts, inbox] = await Promise.all([
      request("/v1/me/billing-accounts"),
      request(
        "/v1/financial-notifications?limit=5&category=account_updates" +
          (unread ? "&unread=true" : ""),
      ),
    ]);
    if (!live()) return;
    for (const account of accounts.items) {
      const box = document.createElement("div");
      box.className = "financial-account";
      box.dataset.financialAccount = account.id;
      const title = document.createElement("strong");
      title.textContent = tr("我的個人帳戶", "My personal account");
      box.append(title);
      const dl = document.createElement("dl");
      for (const [label, amount] of [
        [tr("實付餘額", "Paid balance"), account.paid_balance.amount_micros],
        [
          tr("贈送餘額", "Promotional balance"),
          account.promotional_balance.amount_micros,
        ],
        [tr("已預留", "Reserved"), account.reserved.amount_micros],
        [tr("授信上限", "Credit limit"), account.credit_limit.amount_micros],
        [tr("已用授信", "Credit debt"), account.debt.amount_micros],
      ]) {
        const dt = document.createElement("dt"),
          dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = exactHKD(amount);
        dl.append(dt, dd);
      }
      const time = document.createElement("small");
      time.textContent =
        tr("確認於 ", "Confirmed at ") +
        new Date(account.as_of).toLocaleString();
      box.append(dl, time);
      summary.append(box);
    }
    const items = inbox.items as FinancialNotice[];
    status.textContent = tr(
      `本頁 ${items.length} 條通知，${items.filter((n) => !n.read).length} 條未讀。`,
      `${items.length} notices on this page, ${items.filter((n) => !n.read).length} unread.`,
    );
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = tr(
        "目前沒有符合條件的費用通知。",
        "No financial notices match these filters.",
      );
      list.append(empty);
    }
    for (const notice of items) {
      const row = document.createElement("article");
      row.className = "financial-notice";
      row.dataset.financialNotification = notice.id;
      const title = document.createElement("strong"),
        amount = document.createElement("p"),
        hint = document.createElement("p"),
        time = document.createElement("small");
      const labels =
        financialLabels[notice.event_type] ??
        ([notice.event_type, notice.event_type] as const);
      title.textContent =
        tr(...labels) +
        " · " +
        (notice.read ? tr("已讀", "Read") : tr("未讀", "Unread"));
      amount.textContent =
        (notice.amount
          ? exactHKD(notice.amount.amount_micros)
          : tr("金額待核對", "Amount unknown")) +
        " · " +
        (notice.subject.kind === "user"
          ? tr("個人帳戶", "Personal account")
          : tr("企業帳戶", "Workspace account"));
      hint.className = "hint";
      hint.textContent = tr(...financialExplanation(notice.event_type));
      time.textContent = new Date(notice.recorded_at).toLocaleString();
      row.append(title, amount);
      if (notice.requested_amount) {
        const requested = document.createElement("p");
        requested.textContent =
          tr("原退款要求：", "Original refund request: ") +
          exactHKD(notice.requested_amount.amount_micros);
        row.append(requested);
      }
      row.append(hint, time);
      const mark = document.createElement("button");
      mark.className = "secondary";
      mark.textContent = notice.read
        ? tr("標示未讀", "Mark unread")
        : tr("標示已讀", "Mark read");
      mark.setAttribute("aria-label", mark.textContent + ": " + tr(...labels));
      mark.addEventListener("click", () => {
        if (!live()) return;
        mark.disabled = true;
        void (async () => {
          try {
            await request("/v1/financial-notifications/" + notice.id, "PATCH", {
              read: !notice.read,
            });
            if (live()) await financial();
          } catch (e) {
            if (live()) {
              summary.replaceChildren();
              list.replaceChildren();
              status.textContent =
                e instanceof Error
                  ? e.message
                  : tr("暫時未能確認帳戶。", "Account could not be confirmed.");
            }
          } finally {
            mark.disabled = false;
          }
        })();
      });
      row.append(mark);
      list.append(row);
    }
  } catch (e) {
    if (live()) {
      summary.replaceChildren();
      list.replaceChildren();
      status.textContent =
        e instanceof Error
          ? e.message
          : tr("暫時未能確認帳戶。", "Account could not be confirmed.");
    }
  }
}
$("refresh-financial").addEventListener("click", () => void financial());
$("financial-unread").addEventListener("change", () => void financial());
async function entitlements() {
  const scope = tenant,
    revision = workspaceRevision,
    load = ++entitlementRevision,
    summary = $("entitlement-summary"),
    notices = $("entitlement-notices");
  summary.replaceChildren();
  notices.replaceChildren();
  if (!scope) return;
  try {
    const [current, inbox, resources] = await Promise.all([
      request("/v1/effective-entitlements"),
      request("/v1/entitlement-notifications?limit=5"),
      request(`/v1/tenants/${scope}/resource-usage`),
    ]);
    if (
      scope !== tenant ||
      revision !== workspaceRevision ||
      load !== entitlementRevision
    )
      return;
    const names: Record<string, [string, string]> = {
      text: ["文字與開發", "Text & development"],
      image: ["圖片", "Images"],
      video: ["影片", "Video"],
      design: ["設計", "Design"],
      analytics: ["分析", "Analytics"],
      workflow: ["流程", "Workflows"],
      local_files: ["本機檔案", "Local files"],
    };
    const text = document.createElement("p");
    text.textContent =
      current.feature_ids
        .map((id: string) => (names[id] ? tr(...names[id]) : id))
        .join(" · ") ||
      tr("目前方案未開啟功能。", "No features enabled by the current plan.");
    summary.append(text);
    const at = document.createElement("small");
    at.textContent =
      tr("伺服器確認：", "Server confirmed: ") +
      new Date(current.as_of).toLocaleString() +
      " · " +
      tr("權益版本 ", "Entitlement version ") +
      current.entitlement_version;
    summary.append(at);
    const capacity = document.createElement("p");
    capacity.textContent =
      tr("企業容量：席位 ", "Workspace capacity: seats ") +
      resources.seats.used.toLocaleString() +
      " / " +
      resources.seats.limit.toLocaleString() +
      " · " +
      tr("存儲 ", "storage ") +
      BigInt(resources.storage.total_bytes).toLocaleString() +
      " / " +
      BigInt(resources.storage.limit_bytes).toLocaleString() +
      " B";
    summary.append(capacity);
    const storageNote = document.createElement("small");
    storageNote.textContent = tr(
      "包含保留版本與上傳預留；個人 VIP 不會擴大企業容量。",
      "Includes retained versions and upload reservations. Personal VIP does not enlarge workspace capacity.",
    );
    summary.append(storageNote);
    if (resources.seats.over_limit || resources.storage.over_limit) {
      const warning = document.createElement("p");
      warning.setAttribute("role", "status");
      warning.textContent = tr(
        "已超出企業容量。完成清理或聯絡管理員調整企業方案後，再新增佔用。",
        "Workspace capacity is exceeded. Complete cleanup or contact an administrator to change the workspace plan before adding capacity.",
      );
      summary.append(warning);
    }
    if (current.expires_at) {
      const end = document.createElement("p");
      end.textContent =
        tr("下一個權益變更：", "Next access boundary: ") +
        new Date(current.expires_at).toLocaleString();
      summary.append(end);
    }
    const kinds: Record<string, [string, string]> = {
      changed: ["權益已更新", "Entitlements updated"],
      starts: ["授予已生效", "Grant started"],
      expires: ["授予已到期", "Grant expired"],
      replaced: ["方案已取代", "Plan replaced"],
    };
    for (const notice of inbox.items) {
      const row = document.createElement("p");
      row.textContent =
        (kinds[notice.kind] ? tr(...kinds[notice.kind]) : notice.kind) +
        " · " +
        new Date(notice.available_at).toLocaleString();
      if (!notice.read) {
        const mark = document.createElement("button");
        mark.className = "secondary";
        mark.textContent = tr("標示已讀", "Mark read");
        mark.addEventListener(
          "click",
          () =>
            void run(async () => {
              mark.disabled = true;
              try {
                await request(
                  "/v1/entitlement-notifications/" + notice.id,
                  "PATCH",
                  { read: true },
                );
                await entitlements();
              } finally {
                mark.disabled = false;
              }
            }),
        );
        row.append(mark);
      }
      notices.append(row);
    }
  } catch (e) {
    if (
      scope === tenant &&
      revision === workspaceRevision &&
      load === entitlementRevision
    )
      summary.textContent =
        e instanceof Error
          ? e.message
          : tr("暫時未能確認權益。", "Access could not be confirmed.");
  }
}
$("refresh-entitlements").addEventListener("click", () => void entitlements());
async function notifications() {
  const scope = tenant,
    list = $("notification-list"),
    revision = workspaceRevision,
    load = ++notificationRevision;
  if (!scope) {
    list.replaceChildren();
    return;
  }
  try {
    const data = await request(`/v1/tenants/${scope}/notifications?limit=20`);
    if (
      scope !== tenant ||
      revision !== workspaceRevision ||
      load !== notificationRevision
    )
      return;
    list.replaceChildren();
    for (const n of data.items) {
      const row = document.createElement("div");
      row.className = "notification-entry";
      row.dataset.notification = n.id;
      const open = document.createElement("button");
      open.className = "task-row";
      const title = document.createElement("strong");
      title.textContent = n.task_title ?? (locale === "en" ? "Task" : "工作");
      const state = document.createElement("span");
      state.textContent = n.kind.replaceAll("_", " ");
      open.append(title, state);
      open.onclick = () =>
        void run(async () => {
          await request(`/v1/tenants/${scope}/notifications/${n.id}`, "PATCH", {
            read: true,
          });
          if (tenant !== scope || revision !== workspaceRevision) return;
          const select = $<HTMLSelectElement>("project");
          if (![...select.options].some((p) => p.value === n.project_id))
            throw new Error("Project access changed. Refresh the workspace.");
          workspaceRevision++;
          pending = null;
          clearTask();
          project = n.project_id;
          select.value = project;
          const navigationRevision = workspaceRevision;
          await tasks();
          if (navigationRevision !== workspaceRevision || scope !== tenant)
            return;
          await openTask(n.task_id);
          await notifications();
        });
      const mark = document.createElement("button");
      mark.className = "notification-mark";
      mark.textContent =
        locale === "en"
          ? n.read
            ? "Mark unread"
            : "Mark read"
          : n.read
            ? "標為未讀"
            : "標為已讀";
      mark.onclick = () =>
        void run(async () => {
          mark.disabled = true;
          try {
            await request(
              `/v1/tenants/${scope}/notifications/${n.id}`,
              "PATCH",
              { read: !n.read },
            );
            if (scope === tenant && revision === workspaceRevision)
              await notifications();
          } finally {
            mark.disabled = false;
          }
        });
      row.append(open, mark);
      list.append(row);
    }
    if (!data.items.length) {
      const p = document.createElement("p");
      p.className = "muted empty-copy";
      p.textContent =
        locale === "en" ? "No notifications yet." : "暫時沒有通知。";
      list.append(p);
    }
  } catch (e) {
    if (
      scope === tenant &&
      revision === workspaceRevision &&
      load === notificationRevision
    ) {
      list.replaceChildren();
      throw e;
    }
  }
}
$("refresh-notifications").addEventListener(
  "click",
  () => void run(notifications),
);
async function tasks() {
  const list = $("task-list");
  if (!project) {
    list.replaceChildren();
    return;
  }
  const endpoint = base(),
    revision = workspaceRevision;
  const d = await request(endpoint + "/tasks");
  if (revision !== workspaceRevision || endpoint !== base()) return;
  list.replaceChildren();
  if (!d.items.length) {
    const p = document.createElement("p");
    p.className = "muted empty-copy";
    p.textContent = "新的工作，會在這裡留下進度。";
    list.append(p);
  }
  for (const t of d.items.slice(0, 8)) {
    const button = document.createElement("button");
    button.className = "task-row";
    button.dataset.task = t.id;
    const title = document.createElement("strong");
    title.textContent = t.title;
    const status = document.createElement("span");
    status.textContent = t.status;
    button.append(title, status);
    button.addEventListener("click", () => void run(() => openTask(t.id)));
    list.append(button);
  }
}
async function openTask(id: string) {
  const endpoint = base(),
    revision = workspaceRevision;
  task = id;
  if (timer) clearInterval(timer);
  const t = await request(endpoint + "/tasks/" + id);
  if (revision !== workspaceRevision || endpoint !== base() || task !== id)
    return;
  $("task-view").hidden = false;
  $("task-title").textContent = t.title;
  await drawTask(t);
  if (revision !== workspaceRevision || endpoint !== base() || task !== id)
    return;
  if (timer) clearInterval(timer);
  if (["queued", "running", "paused", "needs_input"].includes(t.status))
    timer = setInterval(() => void run(() => refreshTask(id)), 2500);
}
async function refreshTask(id: string) {
  if (task !== id) return;
  const endpoint = base(),
    revision = workspaceRevision;
  const t = await request(endpoint + "/tasks/" + id);
  if (revision !== workspaceRevision || endpoint !== base() || task !== id)
    return;
  await drawTask(t);
  if (revision !== workspaceRevision || endpoint !== base() || task !== id)
    return;
  if (
    !["queued", "running", "paused", "needs_input"].includes(t.status) &&
    timer
  ) {
    clearInterval(timer);
    timer = undefined;
    await tasks();
  }
}
const tr = (zh: string, en: string) => (locale === "en" ? en : zh);
async function drawTask(t: any) {
  const drawing = ++taskDrawRevision;
  taskVersion = t.version;
  const recentStatus = document.querySelector(
    `.task-row[data-task="${CSS.escape(t.id)}"] span`,
  );
  if (recentStatus) recentStatus.textContent = t.status;
  const control = $<HTMLButtonElement>("control-task");
  control.hidden = !(
    t.attempt === 0 && ["queued", "paused"].includes(t.status)
  );
  control.dataset.action = t.status === "paused" ? "resume" : "pause";
  control.textContent =
    t.status === "paused"
      ? tr("繼續工作", "Resume task")
      : tr("暫停排隊", "Pause queued task");
  $("task-status").textContent =
    t.status === "needs_input"
      ? tr("需要補充資料", "Needs input")
      : t.status === "paused"
        ? tr("已暫停", "Paused")
        : t.status;
  $("task-output").textContent =
    t.status === "needs_input"
      ? tr(
          "尚未呼叫模型，原預算保持預留。補齊資料後繼續同一項工作。",
          "The model has not been called. The original budget remains reserved; providing all inputs continues this same task.",
        )
      : t.status === "queued" && t.capacity_wait_reason
        ? tr(
            "正在等待執行名額，系統會自動繼續原工作。尚未呼叫模型，預算仍保持預留。",
            "Waiting for execution capacity. This same task resumes automatically; the model has not been called and the original budget remains reserved.",
          )
        : t.status === "paused"
          ? tr(
              "工作已暫停，尚未呼叫模型。繼續時沿用本工作和原預留預算。",
              "This task is paused before model execution. Resuming keeps this task and its original budget reservation.",
            )
          : t.output ||
            t.error_code ||
            tr("工作正在處理中。", "Work is in progress.");
  $("cancel-task").hidden = ![
    "queued",
    "running",
    "paused",
    "needs_input",
  ].includes(t.status);
  const area = $("input-requests"),
    endpoint = base(),
    revision = workspaceRevision;
  if (t.status !== "needs_input") {
    dependencyRevision++;
    dependencyFingerprint = "";
    area.replaceChildren();
    area.hidden = true;
    return;
  }
  let data: any;
  try {
    data = await request(endpoint + "/tasks/" + t.id + "/dependencies");
  } catch (e) {
    if (
      drawing === taskDrawRevision &&
      revision === workspaceRevision &&
      task === t.id
    ) {
      dependencyRevision++;
      dependencyFingerprint = "";
      area.replaceChildren();
      area.hidden = true;
    }
    throw e;
  }
  if (
    drawing !== taskDrawRevision ||
    revision !== workspaceRevision ||
    endpoint !== base() ||
    task !== t.id
  )
    return;
  const fingerprint = JSON.stringify([
    t.id,
    locale,
    data.items.map((d: any) => [d.id, d.version, d.state]),
  ]);
  if (fingerprint === dependencyFingerprint) return;
  dependencyFingerprint = fingerprint;
  const render = ++dependencyRevision;
  area.replaceChildren();
  area.hidden = false;
  const live = () =>
    render === dependencyRevision &&
    revision === workspaceRevision &&
    endpoint === base() &&
    task === t.id;
  for (const d of data.items) {
    const row = document.createElement("section");
    row.className = "input-request";
    row.dataset.dependency = d.id;
    const heading = document.createElement("strong");
    heading.textContent = d.description;
    row.append(heading);
    if (d.state !== "pending") {
      const ready = document.createElement("p");
      ready.textContent = tr("資料已齊", "Input ready");
      row.append(ready);
      area.append(row);
      continue;
    }
    const search = document.createElement("form"),
      searchInput = document.createElement("input"),
      label = document.createElement("label"),
      select = document.createElement("select"),
      confirm = document.createElement("button"),
      previous = document.createElement("button"),
      next = document.createElement("button"),
      refresh = document.createElement("button"),
      error = document.createElement("p");
    search.className = "input-search";
    searchInput.maxLength = 160;
    searchInput.setAttribute(
      "aria-label",
      tr("搜尋可用資料", "Search available inputs"),
    );
    const searchButton = document.createElement("button");
    searchButton.className = "secondary";
    searchButton.type = "submit";
    searchButton.textContent = tr("搜尋", "Search");
    search.append(searchInput, searchButton);
    label.className = "field";
    const labelText = document.createElement("span");
    labelText.textContent =
      d.kind === "file"
        ? tr("選擇目前檔案版本", "Choose a current file version")
        : tr("選擇已授權連接", "Choose an authorized connection");
    label.append(labelText, select);
    confirm.type = previous.type = next.type = refresh.type = "button";
    confirm.className = "primary";
    confirm.textContent = tr("確認使用此資料", "Confirm this input");
    confirm.disabled = true;
    previous.textContent = tr("上一頁", "Previous page");
    next.textContent = tr("下一頁", "Next page");
    refresh.textContent = tr("重新載入資料", "Reload inputs");
    const pages = document.createElement("div");
    pages.className = "tools";
    pages.append(previous, next, refresh);
    error.setAttribute("role", "alert");
    error.hidden = true;
    let cursor = "",
      query = "",
      nextCursor = "",
      history: string[] = [],
      loading = 0,
      busy = false;
    const root = `/v1/tenants/${tenant}/task-dependencies/${d.id}`;
    const load = async () => {
      const own = ++loading;
      select.replaceChildren();
      select.disabled = true;
      confirm.disabled = true;
      previous.disabled = next.disabled = true;
      error.hidden = true;
      try {
        const result = await request(
          root +
            "/resources?" +
            new URLSearchParams({
              q: query,
              limit: "50",
              ...(cursor ? { cursor } : {}),
            }),
        );
        if (!live() || own !== loading) return;
        option(select, [
          {
            value: "",
            label: tr("請明確選擇一項資料", "Select an input explicitly"),
          },
          ...result.items.map((r: any) => ({
            value: r.id,
            label: r.name + (r.version ? ` · v${r.version}` : ""),
          })),
        ]);
        select.disabled = busy;
        nextCursor = result.next_cursor ?? "";
        previous.disabled = !history.length;
        next.disabled = !nextCursor;
        if (!result.items.length) {
          error.textContent = tr(
            "沒有符合條件的資料。上傳後請重新載入。",
            "No matching inputs. Reload after uploading.",
          );
          error.hidden = false;
        }
      } catch (e) {
        if (live() && own === loading) {
          error.textContent = e instanceof Error ? e.message : String(e);
          error.hidden = false;
        }
      }
    };
    select.addEventListener("change", () => {
      confirm.disabled = busy || !select.value;
    });
    search.addEventListener("submit", (e) => {
      e.preventDefault();
      query = searchInput.value;
      cursor = "";
      history = [];
      void load();
    });
    refresh.addEventListener("click", () => {
      cursor = "";
      history = [];
      void load();
    });
    previous.addEventListener("click", () => {
      cursor = history.pop() ?? "";
      void load();
    });
    next.addEventListener("click", () => {
      history.push(cursor);
      cursor = nextCursor;
      void load();
    });
    confirm.addEventListener(
      "click",
      () =>
        void run(async () => {
          if (busy || !select.value) return;
          busy = true;
          confirm.disabled = true;
          select.disabled = true;
          try {
            await request(root + "/resolutions", "POST", {
              expected_version: d.version,
              resource_ids: [select.value],
            });
            if (live()) {
              dependencyFingerprint = "";
              await openTask(t.id);
              await tasks();
            }
          } finally {
            busy = false;
            if (live()) {
              select.disabled = false;
              confirm.disabled = !select.value;
            }
          }
        }),
    );
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent =
      d.kind === "file"
        ? tr(
            "可透過上方檔案選取器上傳至共享專案（5 MiB）。重新載入後明確選擇版本；來源更新或撤銷後須再選。",
            "Use the file picker above to upload to the shared project (5 MiB). Reload and explicitly choose a current version; changed or revoked sources require a fresh choice.",
          )
        : tr(
            "只選取現有連接；管理授權請開啟完整工作台。不會自動同步報表。",
            "Choose an existing connection; open the full workspace to manage authorization. This does not synchronize reports.",
          );
    row.append(search, label, error, pages, confirm, note);
    area.append(row);
    void load();
  }
}
$("sign-in").addEventListener(
  "click",
  () =>
    void run(async () => {
      ($("sign-in") as HTMLButtonElement).disabled = true;
      try {
        await send("LOGIN");
        await start();
      } finally {
        ($("sign-in") as HTMLButtonElement).disabled = false;
      }
    }),
);
$("sign-out").addEventListener(
  "click",
  () =>
    void run(async () => {
      if (timer) clearInterval(timer);
      const result = await send("LOGOUT");
      await start();
      if (result?.remote_revoked === false)
        showError(
          tr(
            "此裝置已登出，但未能確認服務端撤銷。請連線後從其他裝置的帳戶設定撤銷此會話。",
            "This device is signed out. Remote revocation could not be confirmed. When online, revoke this session from Account settings on another signed-in device.",
          ),
        );
    }),
);
$("open-web").addEventListener(
  "click",
  () =>
    void run(async () => {
      await send("OPEN_WEB");
    }),
);
$("review-models").addEventListener(
  "click",
  () =>
    void run(async () => {
      await send("OPEN_WEB", { section: "specialists" });
    }),
);
$("batch-designs").addEventListener(
  "click",
  () =>
    void run(async () => {
      await send("OPEN_WEB", { section: "creative" });
    }),
);
$("video-workspace").addEventListener(
  "click",
  () =>
    void run(async () => {
      await send("OPEN_WEB", { section: "video" });
    }),
);
$("tenant").addEventListener(
  "change",
  () =>
    void run(async () => {
      tenant = $<HTMLSelectElement>("tenant").value;
      workspaceRevision++;
      $("notification-list").replaceChildren();
      $("task-list").replaceChildren();
      pending = null;
      task = "";
      if (timer) clearInterval(timer);
      $("task-view").hidden = true;
      await projects();
    }),
);
$("project").addEventListener(
  "change",
  () =>
    void run(async () => {
      project = $<HTMLSelectElement>("project").value;
      workspaceRevision++;
      pending = null;
      task = "";
      if (timer) clearInterval(timer);
      $("task-view").hidden = true;
      await tasks();
      await notifications();
    }),
);
$("brief-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void run(async () => {
    const form = e.target as HTMLFormElement;
    const f = new FormData(form);
    const endpoint = base(),
      revision = workspaceRevision;
    ($("create-task") as HTMLButtonElement).disabled = true;
    try {
      const selectedRole = String(f.get("role")),
        body = {
          title: String(f.get("title")),
          prompt: String(f.get("prompt")),
          budget_micros: Math.round(Number(f.get("budget")) * 1e6),
          ...(f.get("required_input") === "file"
            ? {
                dependencies: [
                  {
                    kind: "file",
                    description: tr(
                      "請提供已批准的工作素材，然後開始。",
                      "Provide approved source materials before starting.",
                    ),
                  },
                ],
              }
            : {}),
        };
      const fingerprint = JSON.stringify({
        tenant,
        project,
        selectedRole,
        ...body,
      });
      if (pending?.fingerprint !== fingerprint)
        pending = { fingerprint, id: crypto.randomUUID() };
      const accepted =
        selectedRole === "assistant"
          ? await request(endpoint + "/delegations", "POST", {
              ...body,
              mode: "execute",
              client_message_id: pending!.id,
            })
          : await request(
              endpoint + "/tasks",
              "POST",
              { ...body, role_key: selectedRole },
              pending!.id,
            );
      if (revision !== workspaceRevision || endpoint !== base()) return;
      const t = selectedRole === "assistant" ? accepted.task : accepted;
      pending = null;
      form.reset();
      $<HTMLSelectElement>("role").value = "assistant";
      await tasks();
      if (revision !== workspaceRevision || endpoint !== base()) return;
      await openTask(t.id);
    } finally {
      ($("create-task") as HTMLButtonElement).disabled = false;
    }
  });
});
$("control-task").addEventListener(
  "click",
  () =>
    void run(async () => {
      const endpoint = base(),
        revision = workspaceRevision,
        id = task,
        button = $<HTMLButtonElement>("control-task"),
        version = taskVersion,
        action = button.dataset.action;
      if (!id || button.disabled || !["pause", "resume"].includes(action ?? ""))
        return;
      button.disabled = true;
      try {
        await request(endpoint + "/tasks/" + id + "/controls", "POST", {
          action,
          expected_version: version,
        });
      } finally {
        button.disabled = false;
        if (
          revision === workspaceRevision &&
          endpoint === base() &&
          task === id
        )
          await openTask(id);
      }
    }),
);
$("cancel-task").addEventListener(
  "click",
  () =>
    void run(async () => {
      const endpoint = base(),
        revision = workspaceRevision,
        id = task;
      await request(endpoint + "/tasks/" + id + "/cancel", "POST", {});
      if (revision === workspaceRevision && endpoint === base() && task === id)
        await openTask(id);
    }),
);
$("close-task").addEventListener("click", () => {
  task = "";
  if (timer) clearInterval(timer);
  $("task-view").hidden = true;
});
$("capture-page").addEventListener(
  "click",
  () =>
    void run(async () => {
      const page = await send("CAPTURE");
      const textarea = $<HTMLTextAreaElement>("prompt");
      textarea.value += `\n\n參考網頁：${page.title}\n${page.url}\n${page.text}`;
      $("capture-note").textContent =
        "已加入你主動選取的頁面文字，送出工作前仍可修改。";
    }),
);
$("file-input").addEventListener(
  "change",
  () =>
    void run(async () => {
      const input = $<HTMLInputElement>("file-input"),
        file = input.files?.[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024)
        throw new Error("請選擇小於 5 MB 的檔案。");
      const array = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let i = 0; i < array.length; i++)
        binary += String.fromCharCode(array[i]);
      const a = await send("UPLOAD", {
        path: base() + "/assets",
        file: { name: file.name, type: file.type, base64: btoa(binary) },
      });
      $("file-note").textContent = `已加入 ${a.name}，保存在目前專案。`;
      input.value = "";
    }),
);
$("choose-folder").addEventListener("click", () => {
  const grant = chrome.permissions.request({
    permissions: ["nativeMessaging"],
  });
  void run(async () => {
    if (!(await grant))
      throw new Error("Native messaging permission was not granted");
    const r = await send("HOST", { payload: { operation: "grant.choose" } });
    if (r.error) throw new Error(r.error);
    $("folder-note").textContent = "已授權：" + (r.data?.label ?? "未選取");
  });
});
window.addEventListener("pagehide", () => {
  if (timer) clearInterval(timer);
  if (notificationTimer) clearInterval(notificationTimer);
});
void run(start);

let localGrants: any[] = [],
  localFile: any = null;
async function native(payload: Record<string, unknown>) {
  const r = await send("HOST", { payload });
  if (!r.ok) throw new Error(r.error ?? "Native helper unavailable");
  return r.data;
}
async function folders() {
  localGrants = await native({ operation: "grant.list" });
  $("folder-browser").hidden = !localGrants.length;
  option(
    $<HTMLSelectElement>("folder-grant"),
    localGrants.map((g) => ({ value: g.id, label: g.label })),
  );
}
const localCommand = (operation: string) =>
  native({
    operation,
    grant_id: $<HTMLSelectElement>("folder-grant").value,
    path: $<HTMLInputElement>("local-path").value,
    content: $<HTMLTextAreaElement>("local-content").value,
    request_id: crypto.randomUUID(),
  });
$("refresh-folders").addEventListener("click", () => void run(folders));
$("local-list").addEventListener(
  "click",
  () =>
    void run(async () => {
      const r = await localCommand("file.list");
      $("local-listing").replaceChildren(
        ...r.items.map((e: any) => {
          const b = document.createElement("button");
          b.className = "task-row";
          b.textContent = (e.type === "directory" ? "▸ " : "") + e.name;
          b.onclick = () => {
            const p = $<HTMLInputElement>("local-path");
            p.value =
              p.value === "."
                ? e.name
                : p.value.replace(/[\\/]$/, "") + "/" + e.name;
          };
          return b;
        }),
      );
    }),
);
$("local-read").addEventListener(
  "click",
  () =>
    void run(async () => {
      localFile = await localCommand("file.read");
      $("local-preview").textContent = new TextDecoder()
        .decode(Uint8Array.from(atob(localFile.base64), (c) => c.charCodeAt(0)))
        .slice(0, 50000);
    }),
);
$("local-upload").addEventListener(
  "click",
  () =>
    void run(async () => {
      if (!localFile) throw new Error("Read a file first");
      const a = await send("UPLOAD", {
        path: base() + "/assets",
        file: {
          name: localFile.name,
          type: "application/octet-stream",
          base64: localFile.base64,
        },
      });
      $("folder-note").textContent = "Uploaded: " + a.name;
    }),
);
$("local-write").addEventListener(
  "click",
  () =>
    void run(async () => {
      await localCommand("file.write");
      $("folder-note").textContent = "New file created.";
    }),
);
$("local-revoke").addEventListener(
  "click",
  () =>
    void run(async () => {
      await native({
        operation: "grant.revoke",
        grant_id: $<HTMLSelectElement>("folder-grant").value,
      });
      localFile = null;
      $("local-preview").textContent = "";
      await folders();
    }),
);
const translations: Record<string, string> = {
  批量設計工作台: "Open batch design workspace",
  影片製作工作台: "Open video production workspace",
  檢視模型與費率版本: "Review model and rate versions",
  "工作，就從": "Your next idea,",
  "這裡開始。": "starts here.",
  "把網頁、素材和想法帶到你的工作空間。專業角色，隨時接手下一步。":
    "Bring pages, materials and ideas into your workspace. A specialist is ready for your next step.",
  透過瀏覽器登入: "Sign in in your browser",
  "企業帳戶安全登入。本機檔案由你主動選取或授權。":
    "Secure company sign-in. You choose files and explicitly grant local folders.",
  "專案裡的每一步，都接得上。": "Keep every step of your project connected.",
  "設計與品牌 · 行銷分析 · 軟件開發":
    "Design & brand · Marketing insights · Software",
  企業: "Workspace",
  專案: "Project",
  選擇助手或專業角色: "Choose an assistant or specialist",
  工作名稱: "Task name",
  "你想完成什麼？": "What would you like to make?",
  "＋ 目前網頁": "+ Current page",
  "＋ 選取檔案": "+ Choose file",
  "預算上限（HKD）": "Budget limit (HKD)",
  "開始前需要補齊資料嗎？": "Inputs needed before starting?",
  "資料已齊，可開始": "Ready to start",
  先等我提供檔案: "Wait for my file",
  開始工作: "Start task",
  取消工作: "Cancel task",
  最近的工作: "Recent tasks",
  工作通知: "Work notifications",
  目前可用權益: "Current entitlements",
  更新權益: "Refresh access",
  費用與帳戶通知: "Financial account notifications",
  更新帳戶與通知: "Refresh accounts and notices",
  只看未讀: "Unread only",
  "企業帳戶通知只對目前的 Owner 或 Admin 顯示。通知保留歷史變更，目前餘額以最新確認結果為準。":
    "Workspace account notices are available to current owners and admins. Notices record history; current balances follow the latest confirmation.",
  "最近 5 條帳戶通知；工作預留、消費及較早記錄可在完整工作台查看。":
    "Latest 5 account notices. Task reservations, charges and older records are available in the full workspace.",
  "使用時仍會檢查專案權限、本機授權與預算。通知顯示最近 5 條，完整記錄請開啟工作台。":
    "Project permissions, local consent and budget still apply. Latest 5 notifications; open the workspace for the complete inbox.",
  重新整理通知: "Refresh notifications",
  "最近 20 條；完整記錄請開啟工作台。":
    "Latest 20; open the full workspace for the complete inbox.",
  "示範環境：AI 回覆及用量為模擬資料，檔案與任務確實保存。":
    "Demo environment: AI responses and usage are simulated. Files and tasks are actually saved.",
  本機目錄授權: "Local folder access",
  "需要安裝 CopyPaste Desktop 原生助手。每個目錄由你選擇，雲端不能任意存取本機路徑。":
    "Install the CopyPaste Desktop helper. You choose each folder and grant its allowed operations.",
  選擇並授權目錄: "Choose and grant folder",
  載入已授權目錄: "Load granted folders",
  資料夾授權: "Folder grant",
  相對路徑: "Relative path",
  列出檔案: "List files",
  讀取預覽: "Read preview",
  上傳至專案: "Upload to project",
  "新檔內容（只限已授予寫入權限）": "New file content (write grant required)",
  建立新檔案: "Create new file",
  撤銷此授權: "Revoke this grant",
  登出: "Sign out",
  "先開啟完整工作台建立企業與專案，再返回此側欄。":
    "Open the full workspace to create your company and project, then return here.",
};
const original = new Map<Text, string>();
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
let node: Node | null;
while ((node = walker.nextNode())) {
  const n = node as Text;
  if (translations[n.textContent?.trim() ?? ""])
    original.set(n, n.textContent!);
}
let locale = "zh-HK";
async function applyLocale() {
  for (const [n, zh] of original)
    n.textContent = locale === "en" ? translations[zh.trim()] : zh;
  document.documentElement.lang = locale === "en" ? "en" : "zh-Hant-HK";
  $("locale").textContent = locale === "en" ? "繁中" : "EN";
  const helper = document.querySelector<HTMLOptionElement>(
    '#role option[value="assistant"]',
  );
  if (helper)
    helper.textContent =
      locale === "en"
        ? "Default assistant — text and plans"
        : "預設助手 — 文字與計畫";
  if (tenant) {
    await notifications();
    await entitlements();
    await financial();
  }
  if (task) await refreshTask(task);
}
$("locale").addEventListener(
  "click",
  () =>
    void run(async () => {
      locale = locale === "en" ? "zh-HK" : "en";
      await chrome.storage.local.set({ locale });
      await applyLocale();
    }),
);
void chrome.storage.local.get("locale").then((r) => {
  locale = r.locale === "en" ? "en" : "zh-HK";
  return applyLocale();
});
