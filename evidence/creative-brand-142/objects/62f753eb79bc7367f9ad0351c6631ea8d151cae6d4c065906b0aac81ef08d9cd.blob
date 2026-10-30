/** A business answer cannot select resources, approve a fee, or run local tools. */
export function businessQuestion(d: any, options: {
  draft: string; language: string; busy?: boolean;
  changed: (answer: string) => void; confirmed: (answer: string) => Promise<void>;
}) {
  const t = (zh: string, en: string) => options.language === "en" ? en : zh;
  const row = document.createElement("section"); row.className = "input-request business-question"; row.dataset.dependency = d.id;
  const heading = document.createElement("strong"); heading.textContent = d.description; row.append(heading);
  if (d.state === "resolved") { const text = document.createElement("p"); text.textContent = d.answer; row.append(text); return row; }
  if (d.state !== "pending") return row;
  const form = document.createElement("form"), fieldset = document.createElement("fieldset");
  fieldset.disabled = !!options.busy;
  const label = document.createElement("label"), name = document.createElement("span"), answer = document.createElement("textarea"), button = document.createElement("button"), error = document.createElement("p");
  label.className = "field"; name.textContent = t("你的回答", "Your answer"); answer.rows = 3; answer.maxLength = 4000; answer.value = options.draft;
  label.append(name, answer); button.type = "submit"; button.className = "primary"; button.textContent = t("確認回答", "Confirm answer"); button.disabled = !answer.value.trim();
  const update = (value: string) => { answer.value = value; options.changed(value); button.disabled = !value.trim(); };
  answer.addEventListener("input", () => update(answer.value));
  if (d.question_options?.length) {
    const choices = document.createElement("div"); choices.className = "tools"; choices.setAttribute("role", "group"); choices.setAttribute("aria-label", t("建議答案", "Suggested answers"));
    for (const choice of d.question_options) {
      const pick = document.createElement("button"); pick.type = "button"; pick.className = "secondary"; pick.textContent = choice;
      pick.addEventListener("click", () => { update(choice); answer.focus(); }); choices.append(pick);
    }
    fieldset.append(choices);
  }
  const hint = document.createElement("small"); hint.className = "hint"; hint.textContent = t("可選用建議或自行回答。請勿填寫密碼或 API 密鑰。", "Choose a suggestion or write your own answer. Do not include passwords or API keys.");
  error.setAttribute("role", "alert"); error.hidden = true;
  let busy = false;
  form.addEventListener("submit", e => {
    e.preventDefault(); if (busy || !answer.value.trim()) return;
    busy = true; fieldset.disabled = true; error.hidden = true;
    void options.confirmed(answer.value.trim()).catch(e => { error.textContent = e instanceof Error ? e.message : String(e); error.hidden = false; })
      .finally(() => { busy = false; fieldset.disabled = false; });
  });
  fieldset.append(label, hint, error, button); form.append(fieldset); row.append(form); return row;
}
