type Scope = { actor: string; tenant: string; project: string };
const menu = ["batch-designs", "video-workspace", "marketing-connections", "website-audits", "creative-feedback", "geo-observations"];
const english = ["Design batches", "Video workspace", "Marketing connections", "Website & SEO audits", "Creative feedback", "GEO observations"];
/** Public presentation only. Plain text never becomes HTML or an API grant. */
export class ClientContent {
  private revision = 0;
  private key = "";
  private items: any[] = [];
  private defaults = new Map<string, string>();
  private group: HTMLElement;
  constructor(private container: HTMLElement, private request: (path: string) => Promise<any>, private locale: () => string) {
    this.group = document.createElement("div");
    this.group.className = "client-content-menu";
    const first = document.getElementById(menu[0])!;
    first.before(this.group);
    for (const id of menu) {
      const node = document.getElementById(id)!;
      this.defaults.set(id, node.textContent ?? "");
      this.group.append(node);
    }
  }
  clear() {
    ++this.revision; this.key = ""; this.items = [];
    this.container.replaceChildren(); this.container.hidden = true;
    for (const id of menu) {
      const node = document.getElementById(id)!;
      node.hidden = false;
      node.textContent = this.locale() === "en" ? english[menu.indexOf(id)] : this.defaults.get(id)!;
      this.group.append(node);
    }
  }
  async refresh(scope: Scope) {
    const key = [scope.actor, scope.tenant, scope.project].join(":");
    if (this.key !== key) { this.clear(); this.key = key; }
    const revision = ++this.revision;
    try {
      const result = await this.request("/v1/client-content?" + new URLSearchParams({ client: "extension", ...(scope.project ? { project_id: scope.project } : {}) }));
      if (revision !== this.revision || this.key !== key) return;
      this.items = result.items; this.draw();
    } catch {
      if (revision === this.revision && this.key === key) this.clear();
    }
  }
  draw() {
    const en = this.locale() === "en", fragment = document.createDocumentFragment();
    for (const item of this.items) {
      if (!["help", "announcement"].includes(item.kind)) continue;
      const body = item.body, element = document.createElement(item.kind === "help" ? "details" : "article"), title = document.createElement(item.kind === "help" ? "summary" : "strong"), text = document.createElement("p");
      title.textContent = en ? (body.title_en ?? body.title) : body.title;
      text.textContent = en ? (body.text_en ?? body.text) : body.text;
      element.className = "client-content-" + item.kind;
      element.append(title, text); fragment.append(element);
    }
    this.container.replaceChildren(fragment); this.container.hidden = !this.container.childElementCount;
    const config = (id: string) => this.items.find(v => v.kind === "navigation" && v.body.path === id)?.body;
    for (const id of [...menu].sort((a, b) => (config(a)?.order ?? 50) - (config(b)?.order ?? 50))) {
      const node = document.getElementById(id)!, value = config(id);
      node.hidden = value?.enabled === false;
      // applyLocale retains the original translation nodes for uncustomized items.
      node.textContent = value ? (en ? value.label_en : value.label) : (en ? english[menu.indexOf(id)] : this.defaults.get(id)!);
      this.group.append(node);
    }
  }
}
