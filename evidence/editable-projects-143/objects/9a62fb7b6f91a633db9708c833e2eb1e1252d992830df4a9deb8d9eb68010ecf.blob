import { exactHKD } from "./financial-notice.js";
import type { IO } from "./audio-production.js";

/** Native Side Panel customer action. No model/worker auto-confirm path. */
export function mountAudioAuthorizations(host: HTMLElement, io: IO) {
  let disposed = false, loading = false;
  const cards = new Map<string, { signature: string; element: HTMLElement }>();
  const intents = new Map<string, { body: string; key: string }>();
  const live = () => !disposed && io.live();
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) => {
    const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element;
  };
  const build = (row: any, expired: boolean) => {
    const card = make("article"); card.className = "audio-card audio-consent"; card.dataset.audioAuthorization = row.id;
    const pending = row.state === "pending", p = row.proposal;
    card.append(make("strong", pending ? io.tr("確認配音或轉寫", "Confirm speech or transcription") : row.state === "confirmed"
      ? io.tr("已由你確認", "Confirmed by you") : row.state === "withdrawn" ? io.tr("你已撤回授權", "Authorization withdrawn")
        : row.state === "declined" ? io.tr("你已拒絕", "Declined by you") : io.tr("此操作已停止或逾時", "Operation stopped or expired")),
    make("p", io.tr("本次公司費用上限：", "Company charge limit for this operation: ") + exactHKD(row.quoted_micros)),
    make("p", p.locale + (p.voice ? ` · ${p.voice} · ×${p.speed}` : "") + " · " + row.quoted_units + " " +
      (row.pricing_unit === "unicode_scalar" ? io.tr("字元", "characters") : io.tr("音訊毫秒", "audio milliseconds"))));
    const proposal = make("details"); proposal.open = pending;
    proposal.append(make("summary", io.tr("核對文案、音源與用途", "Review script, source and intended use")));
    if (p.kind === "speech") proposal.append(make("p", p.text));
    else if (row.source) proposal.append(make("p", row.source.asset_id + " · v" + row.source.version),
      make("p", "SHA-256: " + row.source.sha256), make("p", row.source.duration_ms / 1000 + " " + io.tr("秒", "seconds")));
    proposal.append(make("p", io.tr("擬定用途：", "Proposed use: ") + p.rights.purpose),
      make("p", io.tr("提案引用：", "Proposal reference: ") + p.rights.reference)); card.append(proposal);
    const error = make("p"); error.setAttribute("role", "alert"); error.hidden = true; card.append(error);
    const form = make("form"), fields = make("fieldset"); fields.className = "audio-consent-fields";
    const decide = async (action: "confirm" | "decline" | "withdraw", extra = {}) => {
      if (!live() || fields.disabled) return;
      fields.disabled = true; error.hidden = true;
      const body = { expected_revision: row.revision, specification_hash: row.specification_hash, quoted_micros: row.quoted_micros, ...extra };
      const id = row.id + ":" + action, frozen = JSON.stringify(body);
      if (intents.get(id)?.body !== frozen) intents.set(id, { body: frozen, key: crypto.randomUUID() });
      try { await io.request(`${io.base}/audio-authorizations/${row.id}/${action}`, "POST", body, intents.get(id)!.key); intents.delete(id); }
      catch (failure) { if (live() && card.isConnected) { error.textContent = (failure as Error).message; error.hidden = false; } }
      finally { fields.disabled = false; if (live()) void load(); }
    };
    if (pending) {
      const status = make("p", expired ? io.tr("確認已逾時，不會派發音訊請求。", "Confirmation expired. No audio request will be submitted.")
        : io.tr("請在五分鐘內核對並確認。等待期間不會派發音訊請求；原任務已有的用量仍按實際計費。", "Review within five minutes. Waiting submits no audio request; existing task usage remains chargeable."));
      status.setAttribute("role", "status"); fields.append(status);
      const reference = make("textarea"), purpose = make("textarea");
      for (const [input, title, name, max] of [
        [reference, io.tr("你的授權或權利依據", "Your rights or authorization reference"), "audio_rights_reference", 300],
        [purpose, io.tr("你確認的具體用途", "The specific use you approve"), "audio_purpose", 1000],
      ] as const) {
        input.name = name; input.rows = 2; input.required = true; input.minLength = 3; input.maxLength = max; input.disabled = expired;
        const label = make("label", title); label.append(input); fields.append(label);
      }
      const check = make("input"); check.type = "checkbox"; check.name = "audio_authorized"; check.required = true; check.disabled = expired;
      const label = make("label"); label.className = "audio-consent-check"; label.append(check,
        make("span", io.tr("我有權使用上述文案、音源及聲音，並確認此用途與本次費用上限。", "I have the rights to use this script, audio and voice, and approve this use and charge limit.")));
      const submit = make("button", io.tr("確認並繼續", "Confirm and continue")); submit.type = "submit"; submit.disabled = true;
      check.onchange = () => { submit.disabled = !check.checked || expired; };
      const decline = make("button", io.tr("拒絕此操作", "Decline this operation")); decline.type = "button"; decline.className = "secondary";
      decline.onclick = () => { void decide("decline"); }; fields.append(label, submit, decline);
      form.onsubmit = event => { event.preventDefault(); if (live() && !expired && check.checked)
        void decide("confirm", { confirm_authorized_use: true, rights_reference: reference.value, purpose: purpose.value }); };
    } else if (row.state === "confirmed") {
      fields.append(make("p", io.tr("撤回會阻止後續派發與交付；已發送請求的實際或待確認費用會保留。", "Withdrawal blocks later dispatch and delivery. Actual or unconfirmed submitted charges remain.")));
      const withdraw = make("button", io.tr("撤回此授權", "Withdraw this authorization")); withdraw.type = "button"; withdraw.className = "secondary";
      withdraw.onclick = () => { void decide("withdraw"); }; fields.append(withdraw);
    }
    form.append(fields); card.append(form); return card;
  };
  const load = async () => {
    if (!live() || loading) return; loading = true;
    try {
      const data = await io.request(io.base + "/audio-authorizations?" + new URLSearchParams({ task_id: io.taskId, limit: "8" }));
      if (!live()) return;
      const ids = new Set<string>(data.items.map((row: any) => row.id));
      for (const [id, card] of cards) if (!ids.has(id)) { card.element.remove(); cards.delete(id); }
      for (const row of data.items) {
        const expired = Date.now() >= new Date(row.expires_at).getTime(), signature = JSON.stringify([row, row.state === "pending" && expired]);
        const old = cards.get(row.id); if (old?.signature === signature) continue;
        const element = build(row, expired);
        if (old) old.element.replaceWith(element); else host.append(element);
        cards.set(row.id, { signature, element });
      }
      host.hidden = !data.items.length; host.querySelector("[data-audio-authorization-error]")?.remove();
    } catch (failure) {
      if (live()) {
        let error = host.querySelector<HTMLElement>("[data-audio-authorization-error]");
        if (!error) { error = make("p"); error.dataset.audioAuthorizationError = "true"; error.setAttribute("role", "alert"); host.append(error); }
        error.textContent = (failure as Error).message; host.hidden = false;
      }
    } finally { loading = false; }
  };
  host.setAttribute("aria-label", io.tr("音訊授權", "Audio authorization"));
  const timer = setInterval(() => { if (!document.hidden) void load(); }, 3000); void load();
  return () => { disposed = true; clearInterval(timer); cards.clear(); intents.clear(); host.replaceChildren(); };
}
