const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let tenant = "",
  project = "",
  task = "",
  timer: ReturnType<typeof setInterval> | undefined;
const base = () => `/v1/tenants/${tenant}/projects/${project}`;
async function send(type: string, body: Record<string, unknown> = {}) {
  const r = await chrome.runtime.sendMessage({ type, ...body });
  if (!r?.ok) throw new Error(r?.error ?? "Extension unavailable");
  return r.data;
}
const request = (path: string, method = "GET", body?: unknown) =>
  send("API", { path, method, body });
function showError(e: unknown) {
  $("error").textContent = e instanceof Error ? e.message : String(e);
  $("error").hidden = false;
}
async function run(fn: () => Promise<void>) {
  $("error").hidden = true;
  try {
    await fn();
  } catch (e) {
    showError(e);
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
async function start() {
  const status = await send("STATUS");
  $("login").hidden = status.authenticated;
  $("workspace").hidden = !status.authenticated;
  $("account-actions").hidden = !status.authenticated;
  if (!status.authenticated) return;
  const me = await request("/v1/me");
  $("user-name").textContent = me.user.name;
  option(
    $<HTMLSelectElement>("tenant"),
    me.memberships.map((m: any) => ({ value: m.id, label: m.name })),
  );
  tenant = $<HTMLSelectElement>("tenant").value;
  if (!tenant) {
    $("empty-workspace").hidden = false;
    $("work-area").hidden = true;
    return;
  }
  $("empty-workspace").hidden = true;
  $("work-area").hidden = false;
  await projects();
  const catalog = await request("/v1/catalog/roles");
  option(
    $<HTMLSelectElement>("role"),
    catalog.items.map((r: any) => ({
      value: r.role_key,
      label: r.display_name + (r.available ? "" : " · 準備中"),
    })),
    "designer",
  );
}
async function projects() {
  const d = await request(`/v1/tenants/${tenant}/projects`);
  option(
    $<HTMLSelectElement>("project"),
    d.items.map((p: any) => ({ value: p.id, label: p.name })),
  );
  project = $<HTMLSelectElement>("project").value;
  await tasks();
}
async function tasks() {
  if (!project) return;
  const d = await request(base() + "/tasks");
  const list = $("task-list");
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
  task = id;
  $("task-view").hidden = false;
  const t = await request(base() + "/tasks/" + id);
  $("task-title").textContent = t.title;
  $("task-status").textContent = t.status;
  $("task-output").textContent = t.output ?? t.error_code ?? "工作正在處理中。";
  $("cancel-task").hidden = !["queued", "running", "paused"].includes(t.status);
  if (timer) clearInterval(timer);
  if (["queued", "running"].includes(t.status))
    timer = setInterval(() => void run(() => refreshTask(id)), 2500);
}
async function refreshTask(id: string) {
  if (task !== id) return;
  const t = await request(base() + "/tasks/" + id);
  $("task-status").textContent = t.status;
  $("task-output").textContent = t.output ?? t.error_code ?? "工作正在處理中。";
  if (!["queued", "running"].includes(t.status) && timer) {
    clearInterval(timer);
    timer = undefined;
    await tasks();
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
      await send("LOGOUT");
      await start();
    }),
);
$("open-web").addEventListener(
  "click",
  () =>
    void run(async () => {
      await send("OPEN_WEB");
    }),
);
$("tenant").addEventListener(
  "change",
  () =>
    void run(async () => {
      tenant = $<HTMLSelectElement>("tenant").value;
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
      task = "";
      if (timer) clearInterval(timer);
      $("task-view").hidden = true;
      await tasks();
    }),
);
$("brief-form").addEventListener("submit", (e) => {
  e.preventDefault();
  void run(async () => {
    const form = e.target as HTMLFormElement;
    const f = new FormData(form);
    ($("create-task") as HTMLButtonElement).disabled = true;
    try {
      const t = await request(base() + "/tasks", "POST", {
        title: String(f.get("title")),
        prompt: String(f.get("prompt")),
        role_key: String(f.get("role")),
        budget_micros: Math.round(Number(f.get("budget")) * 1e6),
      });
      form.reset();
      await tasks();
      await openTask(t.id);
    } finally {
      ($("create-task") as HTMLButtonElement).disabled = false;
    }
  });
});
$("cancel-task").addEventListener(
  "click",
  () =>
    void run(async () => {
      await request(base() + "/tasks/" + task + "/cancel", "POST", {});
      await openTask(task);
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
  選擇專業角色: "Choose a specialist",
  工作名稱: "Task name",
  "你想完成什麼？": "What would you like to make?",
  "＋ 目前網頁": "+ Current page",
  "＋ 選取檔案": "+ Choose file",
  "預算上限（HKD）": "Budget limit (HKD)",
  開始工作: "Start task",
  取消工作: "Cancel task",
  最近的工作: "Recent tasks",
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
