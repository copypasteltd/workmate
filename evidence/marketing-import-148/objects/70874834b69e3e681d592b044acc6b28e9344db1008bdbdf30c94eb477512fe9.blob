type Translate = (zh: string, en: string) => string;

/** A recurring authorization must show the actual frozen business values. */
export function workflowInputsReviewable(row: any): boolean {
  const fields = row.definition?.input_schema?.fields;
  if (!fields) return !row.body?.input_binding;
  const binding = row.body?.input_binding;
  if (!binding || !/^[a-f0-9]{64}$/.test(binding.input_hash ?? "") || !binding.values || !Array.isArray(binding.files)) return false;
  return fields.every((field: any) => {
    const value = binding.values[field.key];
    if (value === undefined) return !field.required;
    if (field.type === "file") return binding.files.some((file: any) => file.input_name === field.key && file.asset_version_id === value && Number.isInteger(file.version) && file.version > 0 && /^[a-f0-9]{64}$/.test(file.sha256 ?? ""));
    return typeof value === ({ text: "string", number: "number", boolean: "boolean" } as Record<string, string>)[field.type];
  });
}

export function workflowInputsReview(row: any, tr: Translate): HTMLElement | null {
  const fields = row.definition?.input_schema?.fields;
  if (!fields && !row.body?.input_binding) return null;
  const area = document.createElement("section");
  area.className = "workflow-contract";
  area.setAttribute("aria-label", tr("本次固定輸入", "Fixed inputs for this run"));
  const title = document.createElement("h4");
  title.textContent = tr("本次固定輸入", "Fixed inputs for this run");
  area.append(title);
  if (!workflowInputsReviewable(row)) {
    const error = document.createElement("p");
    error.setAttribute("role", "alert");
    error.textContent = tr("固定輸入不完整，請在完整工作區重新準備後確認。", "Fixed inputs are incomplete. Prepare and review this work again in the full workspace.");
    area.append(error);
    return area;
  }
  const binding = row.body.input_binding, list = document.createElement("dl");
  for (const field of fields) {
    const item = document.createElement("div"), label = document.createElement("dt"), value = document.createElement("dd");
    label.textContent = (field.label ?? field.key) + (field.required ? " *" : "");
    const actual = binding.values[field.key];
    if (actual === undefined) value.textContent = tr("未提供", "Not provided");
    else if (field.type === "file") {
      const file = binding.files.find((f: any) => f.input_name === field.key);
      value.textContent = `${file.name} · v${file.version}`;
    } else value.textContent = typeof actual === "boolean" ? (actual ? tr("是", "Yes") : tr("否", "No")) : String(actual);
    item.append(label, value); list.append(item);
  }
  const note = document.createElement("p");
  note.textContent = tr("後續每次執行均使用此組值及檔案版本；更改需重新準備並確認。", "Every later run uses these values and file versions. Changes require a newly prepared and reviewed proposal.");
  area.append(list, note);
  return area;
}
