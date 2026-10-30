import { publicationScope, publicationSummary, type PublicationSummary } from "./publication-handoff.js";

/** Read-only publishing review inside the native Side Panel. Confirmation stays with the customer in Web. */
export function mountPublications(root: HTMLDetailsElement, io: {
  tenant: string; project: string; live: () => boolean;
  tr: (zh: string, en: string) => string;
  request: (path: string) => Promise<any>;
  open: (operation?: string) => Promise<unknown>;
}) {
  const scope = publicationScope({ tenant: io.tenant, project: io.project });
  const base = `/v1/tenants/${scope.tenant}/projects/${scope.project}/publications`;
  let disposed = false, loading = false, detailLoading = false, selected = "", selection = 0;
  let cursor: string | null = null, next: string | null = null, detailSignature = "";
  const previous: (string | null)[] = [], cards = new Map<string, HTMLElement>();
  const parentDetails = root.parentElement?.closest("details");
  const tr = io.tr, active = () => !disposed && io.live() && root.open &&
    root.getClientRects().length > 0 && document.visibilityState !== "hidden";
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    return node;
  };
  const button = (text: string, fn: () => void) => {
    const node = make("button", text); node.type = "button"; node.className = "secondary";
    node.addEventListener("click", fn); return node;
  };
  const summary = make("summary", tr("社交發布", "Social publishing")),
    body = make("div"), status = make("p"), list = make("div"), detail = make("section"), navigation = make("div");
  status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  detail.setAttribute("aria-label", tr("所選發布內容", "Selected publication"));
  list.className = "publication-list"; detail.className = "publication-detail";
  navigation.className = "publication-navigation";
  const alert = (error: unknown) => {
    clearPrivate(); cards.clear(); list.replaceChildren();
    status.textContent = (error as Error).message || tr("無法讀取發布記錄，請重試。", "Publishing records could not be read. Try again.");
    status.setAttribute("role", "alert");
    prev.disabled = true; more.disabled = true;
  };
  const open = async (id?: string) => {
    if (!active()) return;
    workbench.disabled = true;
    try { await io.open(id); }
    catch (error) { if (active()) alert(error); }
    finally { if (!disposed) workbench.disabled = false; }
  };
  const workbench = button(tr("開啟發布工作台", "Open publishing workspace"), () => { void open(); });
  const refresh = button(tr("重新整理", "Refresh"), () => { void load(); });
  const prev = button(tr("上一頁", "Previous"), () => {
    if (loading || !previous.length) return;
    cursor = previous.pop()!; clearPrivate(); void load();
  });
  const more = button(tr("下一頁", "Next"), () => {
    if (loading || !next) return;
    previous.push(cursor); cursor = next; clearPrivate(); void load();
  });
  prev.disabled = true; more.disabled = true;
  navigation.append(prev, more);
  const note = make("p", tr(
    "查看此專案的發布記錄。核對實際素材與確認發布，請開啟完整工作台。",
    "Review this project's publishing records. Open the full workspace to review actual media and confirm publication.",
  ));
  note.className = "publication-note";
  body.append(note, workbench, refresh, status, list, navigation, detail);
  root.replaceChildren(summary, body); root.hidden = false;
  const stateLabels: Record<string, [string, string]> = {
    awaiting_confirmation: ["待確認", "Awaiting confirmation"], queued: ["排隊中", "Queued"],
    preparing: ["準備中", "Preparing"], waiting_media: ["素材處理中", "Waiting for media"],
    publishing: ["發布中", "Publishing"], processing: ["平台處理中", "Processing"],
    succeeded: ["已發布", "Published"], failed: ["失敗", "Failed"], cancelled: ["已取消", "Cancelled"],
    expired: ["已到期", "Expired"], unknown: ["結果待核對", "Result unknown"], closed_unknown: ["已人工結案，結果未證實", "Closed with outcome unproven"],
  };
  const formatLabels: Record<string, [string, string]> = {
    facebook_post: ["Facebook 貼文", "Facebook post"], facebook_photo: ["Facebook 圖片", "Facebook photo"],
    facebook_gallery: ["Facebook 相簿", "Facebook gallery"], facebook_video: ["Facebook 影片", "Facebook video"],
    instagram_photo: ["Instagram 圖片", "Instagram photo"], instagram_reel: ["Instagram Reel", "Instagram Reel"],
    instagram_carousel: ["Instagram 輪播", "Instagram carousel"], instagram_story: ["Instagram 限時動態", "Instagram story"],
  };
  const label = (labels: Record<string, [string, string]>, value: string) => tr(...labels[value]);
  const time = (value: string) => new Intl.DateTimeFormat(document.documentElement.lang === "en" ? "en-HK" : "zh-HK", {
    timeZone: "Asia/Hong_Kong", dateStyle: "medium", timeStyle: "short",
  }).format(new Date(value));
  function clearPrivate() { selection++; selected = ""; detailSignature = ""; detail.replaceChildren(); }
  function renderCard(row: PublicationSummary) {
    let card = cards.get(row.id);
    if (!card) {
      card = make("article"); card.dataset.publication = row.id;
      card.append(make("strong"), make("span"), make("small"), button(tr("查看內容", "View content"), () => {
        clearPrivate(); selected = row.id; void loadDetail();
      }));
      cards.set(row.id, card);
    }
    card.children[0].textContent = label(formatLabels, row.format);
    card.children[1].textContent = label(stateLabels, row.state);
    card.children[2].textContent = time(row.created_at) + " · HKT · v" + row.version;
    return card;
  }
  async function loadDetail() {
    if (!active() || !selected || detailLoading) return;
    const id = selected, version = selection; detailLoading = true;
    try {
      const value = await io.request(base + "/operations/" + id);
      if (!active() || id !== selected || version !== selection) return;
      const row = publicationSummary(value, scope);
      if (row.id !== id) throw new Error("Publishing response does not match the selected operation");
      const content = value.can_view_content === true ? value.content : null;
      const signature = JSON.stringify(value);
      if (detailSignature === signature) return;
      const heading = make("h3", label(formatLabels, row.format));
      const facts = make("p", label(stateLabels, row.state) + " · v" + row.version);
      const nodes: Node[] = [heading, facts];
      if (row.data_mode === "simulated") nodes.push(make("p", tr("示範資料，不會發布到真實帳戶。", "Simulated data; nothing is published to a live account.")));
      if (content && typeof content.draft?.caption === "string" && Array.isArray(content.sources)) {
        nodes.push(make("p", String(content.target?.display_name ?? "")));
        if (typeof content.draft.title === "string" && content.draft.title) nodes.push(make("strong", content.draft.title));
        const caption = make("p", content.draft.caption); caption.className = "publication-caption"; nodes.push(caption);
        for (const source of content.sources) {
          nodes.push(make("small", String(source.name ?? source.mime ?? "") + " · v" + source.version));
          nodes.push(make("small", "SHA-256 " + String(source.sha256 ?? "")));
        }
        nodes.push(button(tr("核對素材與發布", "Review media and publication"), () => { void open(id); }));
      } else nodes.push(make("p", tr("內容目前無法讀取，請核對來源及權限。", "Content is unavailable. Check source availability and your access.")));
      if (row.state === "unknown" || row.state === "closed_unknown") nodes.push(make("p", tr(
        "結果尚未證實。請在工作台核對，避免重複發布。", "The outcome is unproven. Reconcile it in the workspace before publishing again.",
      )));
      detail.replaceChildren(...nodes); detailSignature = signature;
    } catch (error) { if (active() && version === selection) alert(error); }
    finally {
      detailLoading = false;
      if (active() && selected && version !== selection) void loadDetail();
    }
  }
  async function load() {
    if (!active() || loading) return;
    loading = true; refresh.disabled = true; prev.disabled = true; more.disabled = true;
    try {
      const query = new URLSearchParams({ limit: "20" }); if (cursor) query.set("cursor", cursor);
      const value = await io.request(base + "/operations?" + query);
      if (!active()) return;
      if (!Array.isArray(value.items) || value.items.length > 20) throw new Error("Invalid publishing directory");
      const rows = value.items.map((row: unknown) => publicationSummary(row, scope));
      next = value.next_cursor == null ? null : publicationScope({ ...scope, operation: value.next_cursor }).operation!;
      const ids = new Set(rows.map((row: PublicationSummary) => row.id));
      for (const [id, card] of cards) if (!ids.has(id)) { card.remove(); cards.delete(id); }
      for (const [index, row] of rows.entries()) {
        const card = renderCard(row);
        if (list.children[index] !== card) list.insertBefore(card, list.children[index] ?? null);
      }
      status.setAttribute("role", "status");
      status.textContent = rows.length ? tr("每5秒更新。時間為香港時間。", "Updates every 5 seconds. Times are in Hong Kong time.")
        : tr("此頁暫無發布記錄。可在工作台建立內容。", "No publishing records on this page. Create content in the workspace.");
      prev.disabled = !previous.length; more.disabled = !next;
      await loadDetail();
    } catch (error) { if (active()) alert(error); }
    finally { loading = false; if (!disposed) refresh.disabled = false; }
  }
  const toggle = () => { if (active()) void load(); else { clearPrivate(); cards.clear(); list.replaceChildren(); status.textContent = ""; } };
  root.addEventListener("toggle", toggle);
  parentDetails?.addEventListener("toggle", toggle);
  document.addEventListener("visibilitychange", toggle);
  const timer = setInterval(() => { void load(); }, 5000);
  if (active()) void load();
  return () => {
    disposed = true; clearInterval(timer); root.removeEventListener("toggle", toggle);
    parentDetails?.removeEventListener("toggle", toggle);
    document.removeEventListener("visibilitychange", toggle); clearPrivate(); cards.clear();
    root.replaceChildren(); root.hidden = true;
  };
}
