import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, post } from "./api";
import { ErrorNotice, Field, useI18n } from "./ui";
import { MarketingWarnings } from "./marketing-warnings";
import { useWorkspace } from "./context";
import { uploadCampaignFile } from "./campaign-upload";

export function MarketingImport({
  base,
  datasets = [],
  onImported,
}: {
  base: string;
  datasets?: any[];
  onImported: (result: any) => void;
}) {
  const { t } = useI18n(),
    w = useWorkspace();
  const [form, setForm] = useState({
    name: "",
    source: "csv_upload",
    currency: "HKD",
    timezone: "Asia/Hong_Kong",
    account_id: "",
    entity_level: "dataset",
    attribution_definition: "",
    conversion_definition: "",
  });
  const [file, setFile] = useState<{
      asset_version_id: string;
      filename: string;
      headers: string[] | null;
      file_type: "csv" | "xlsx";
      sheets: { name: string; hidden: boolean }[];
      selected_sheet: string | null;
    } | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const [selection, setSelection] = useState({ sheet_name: "", header_row: 1 });
  const [headerInput, setHeaderInput] = useState("1");
  const [supersedes, setSupersedes] = useState("");
  const [chosenFile, setChosenFile] = useState<File | null>(null);
  const controller = useRef<AbortController | null>(null),
    importKey = useRef(crypto.randomUUID());
  const live = useRef(true),
    locked = useRef(false),
    readSequence = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      controller.current?.abort();
      readSequence.current++;
    };
  }, []);
  function resetPreview() {
    setPreview(null);
    setConfirmed(false);
    setError(null);
    importKey.current = crypto.randomUUID();
  }
  function change(key: keyof typeof form, value: string) {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "source"
        ? { entity_level: value === "csv_upload" ? "dataset" : "campaign" }
        : {}),
    }));
    resetPreview();
  }
  async function inspect(
    version: string,
    next: { sheet_name: string; header_row: number },
  ) {
    const info = await post(base + "/analytics/file-inspect", {
      asset_version_id: version,
      sheet_name: next.sheet_name || undefined,
      header_row: next.header_row,
    });
    if (live.current) {
      setFile(info);
      setSelection({
        sheet_name: info.selected_sheet || next.sheet_name,
        header_row: next.header_row,
      });
    }
  }
  async function choose(chosen: File | undefined) {
    const sequence = ++readSequence.current;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setFile(null);
    setChosenFile(chosen ?? null);
    resetPreview();
    setMapping({});
    setSelection({ sheet_name: "", header_row: 1 });
    setHeaderInput("1");
    if (!chosen) {
      setBusy(false);
      return;
    }
    setBusy(true);
    try {
      const uploaded = await uploadCampaignFile(
        chosen,
        {
          base: w.base,
          tenant: w.tenant,
          project: w.project,
          user: w.me.user.id,
        },
        c.signal,
      );
      if (!live.current || sequence !== readSequence.current) return;
      setFile({
        ...uploaded,
        headers: null,
        sheets: [],
        selected_sheet: null,
        file_type: /\.xlsx$/i.test(chosen.name) ? "xlsx" : "csv",
      });
      setForm((f) => ({
        ...f,
        name: f.name || chosen.name.replace(/\.(csv|xlsx)$/i, ""),
      }));
      await inspect(uploaded.asset_version_id, {
        sheet_name: "",
        header_row: 1,
      });
    } catch (e) {
      if (
        live.current &&
        sequence === readSequence.current &&
        !c.signal.aborted
      )
        setError(e);
    } finally {
      if (live.current && sequence === readSequence.current) setBusy(false);
    }
  }
  async function selectTable(next: { sheet_name: string; header_row: number }) {
    if (!file || busy) return;
    if (
      !Number.isInteger(next.header_row) ||
      next.header_row < 1 ||
      next.header_row > 100
    )
      return;
    setSelection(next);
    setHeaderInput(String(next.header_row));
    resetPreview();
    setMapping({});
    setFile((f) => (f ? { ...f, headers: null } : f));
    setBusy(true);
    try {
      await inspect(file.asset_version_id, next);
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file?.headers || locked.current || busy) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      asset_version_id: file.asset_version_id,
      sheet_name:
        file.file_type === "xlsx"
          ? selection.sheet_name || undefined
          : undefined,
      header_row: selection.header_row,
      supersedes_id: supersedes || undefined,
      mapping,
      account_id: form.account_id || undefined,
      attribution_definition: form.attribution_definition || undefined,
      conversion_definition: form.conversion_definition || undefined,
    };
    try {
      if (!preview) {
        const p = await post(base + "/analytics/file-preview", body);
        if (live.current) {
          setPreview(p);
          setConfirmed(false);
        }
      } else if (confirmed) {
        const result = await api(
          form.source === "csv_upload"
            ? base + "/analytics/file-import"
            : "/v1/dataset-imports",
          {
            method: "POST",
            headers: {
              "Idempotency-Key": importKey.current,
              "X-Tenant-ID": w.tenant,
            },
            body: JSON.stringify({
              ...body,
              ...(form.source === "csv_upload"
                ? {}
                : { project_id: w.project }),
            }),
          },
        );
        if (live.current)
          onImported({ ...result, duplicate: !!preview.existing_dataset_id });
      }
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  const definitions = form.source !== "csv_upload";
  return (
    <form
      className="form-stack marketing-import"
      onSubmit={(e) => void submit(e)}
      aria-busy={busy}
    >
      <ErrorNotice error={error} />
      <fieldset disabled={busy} className="marketing-import-fields">
        <Field
          label={t("CSV／XLSX 檔案", "CSV / XLSX file")}
          hint={t(
            "最多 5 MB、10,000 筆；原檔會保存在項目檔案庫，預覽失敗也可獨立管理。XLSX 請先貼上為值，不接受公式、宏與外部連結。",
            "Up to 5 MB and 10,000 rows. The original is saved to project files, including failed previews. For XLSX, paste values first; formulas, macros and external links are rejected.",
          )}
        >
          <input
            name="file"
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            onChange={(e) => void choose(e.target.files?.[0])}
          />
        </Field>
        {chosenFile && !file && (
          <button
            type="button"
            className="button secondary"
            onClick={() => void choose(chosenFile)}
          >
            {t("重試檔案上傳", "Retry file upload")}
          </button>
        )}
        {file?.file_type === "xlsx" && (
          <div className="marketing-field-grid">
            <Field label={t("工作表", "Worksheet")}>
              <select
                name="sheet_name"
                value={selection.sheet_name}
                required
                onChange={(e) =>
                  void selectTable({
                    ...selection,
                    sheet_name: e.target.value,
                    header_row: Number(headerInput),
                  })
                }
              >
                <option value="" disabled>
                  {t("選擇工作表", "Choose a worksheet")}
                </option>
                {file.sheets
                  .filter((s) => !s.hidden)
                  .map((s) => (
                    <option key={s.name} value={s.name}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field
              label={t("標題列", "Header row")}
              hint={t(
                "選擇 1 至 100 列，忽略之前的說明文字。",
                "Choose row 1–100 to skip introductory text.",
              )}
            >
              <input
                name="header_row"
                type="number"
                min={1}
                max={100}
                required
                value={headerInput}
                onChange={(e) => {
                  setHeaderInput(e.target.value);
                  resetPreview();
                  setFile((f) => (f ? { ...f, headers: null } : f));
                }}
              />
            </Field>
            <button
              type="button"
              className="button secondary"
              disabled={
                !/^\d+$/.test(headerInput) ||
                Number(headerInput) < 1 ||
                Number(headerInput) > 100
              }
              onClick={() =>
                void selectTable({
                  ...selection,
                  header_row: Number(headerInput),
                })
              }
            >
              {t("套用標題列", "Apply header row")}
            </button>
            {!file.headers && (
              <button
                type="button"
                className="button secondary"
                onClick={() =>
                  void selectTable({
                    ...selection,
                    header_row: Number(headerInput),
                  })
                }
              >
                {t("重新檢查工作表", "Recheck worksheet")}
              </button>
            )}
          </div>
        )}
        <Field
          label={t("更正先前快照", "Correct an earlier snapshot")}
          hint={t(
            "選填。建立新的更正版本，保留舊快照與既有報告；來源、帳戶、幣種、時區和歸因口徑須一致。",
            "Optional. Create a correction while preserving prior snapshots and reports. Keep the same source, account, currency, timezone and definitions.",
          )}
        >
          <select
            name="supersedes_id"
            value={supersedes}
            onChange={(e) => {
              setSupersedes(e.target.value);
              resetPreview();
            }}
          >
            <option value="">
              {t("新增獨立快照", "New independent snapshot")}
            </option>
            {datasets
              .filter(
                (d) => !datasets.some((child) => child.supersedes_id === d.id),
              )
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.source} · {d.currency}
                </option>
              ))}
          </select>
        </Field>
        <Field label={t("報表名稱", "Report name")}>
          <input
            name="name"
            value={form.name}
            maxLength={160}
            required
            onChange={(e) => change("name", e.target.value)}
          />
        </Field>
        <div className="marketing-field-grid">
          <Field label={t("資料來源", "Data source")}>
            <select
              name="source"
              value={form.source}
              onChange={(e) => change("source", e.target.value)}
            >
              <option value="csv_upload">
                {t("通用表格", "Generic table")}
              </option>
              <option value="google_ads">Google Ads</option>
              <option value="meta_ads">Meta Ads</option>
            </select>
          </Field>
          <Field label={t("幣種", "Currency")}>
            <input
              name="currency"
              value={form.currency}
              pattern="[A-Z]{3}"
              maxLength={3}
              required
              onChange={(e) => change("currency", e.target.value.toUpperCase())}
            />
          </Field>
          <Field label={t("報表時區", "Report timezone")}>
            <input
              name="timezone"
              value={form.timezone}
              maxLength={100}
              required
              onChange={(e) => change("timezone", e.target.value)}
            />
          </Field>
          <Field label={t("帳戶 ID", "Account ID")}>
            <input
              name="account_id"
              value={form.account_id}
              maxLength={200}
              required={definitions}
              onChange={(e) => change("account_id", e.target.value)}
            />
          </Field>
          <Field label={t("資料粒度", "Entity level")}>
            <select
              name="entity_level"
              value={form.entity_level}
              onChange={(e) => change("entity_level", e.target.value)}
            >
              {!definitions && (
                <option value="dataset">
                  {t("通用資料集", "Generic dataset")}
                </option>
              )}
              <option value="campaign">{t("廣告活動", "Campaign")}</option>
              <option value="adset">{t("廣告組合", "Ad set")}</option>
              <option value="ad">{t("廣告", "Ad")}</option>
            </select>
          </Field>
        </div>
        <Field
          label={t("歸因定義", "Attribution definition")}
          hint={t(
            "例如：7 日點擊／1 日瀏覽；請依平台實際匯出設定。",
            "For example: 7-day click / 1-day view; match the actual export settings.",
          )}
        >
          <input
            name="attribution_definition"
            value={form.attribution_definition}
            maxLength={1000}
            required={definitions}
            onChange={(e) => change("attribution_definition", e.target.value)}
          />
        </Field>
        <Field label={t("轉化定義", "Conversion definition")}>
          <input
            name="conversion_definition"
            value={form.conversion_definition}
            maxLength={1000}
            required={definitions}
            placeholder={t(
              "例如：已完成購買",
              "For example: completed purchases",
            )}
            onChange={(e) => change("conversion_definition", e.target.value)}
          />
        </Field>
        {file?.headers && (
          <details className="marketing-mapping">
            <summary>
              {t("確認欄位映射", "Review column mapping")} (
              {file.headers.length})
            </summary>
            <p className="muted">
              {t(
                "預覽會顯示實際採用的映射；有歧義時請手動選擇。",
                "Preview shows the resolved mapping. Select a column when an export is ambiguous.",
              )}
            </p>
            <div className="marketing-field-grid">
              {[
                "date",
                "date_end",
                "channel",
                "campaign",
                "entity_id",
                "account_id",
                "impressions",
                "clicks",
                "spend",
                "conversions",
                "revenue",
                "currency",
              ].map((key) => (
                <Field key={key} label={key}>
                  <select
                    aria-label={"Map " + key}
                    value={
                      Object.hasOwn(mapping, key)
                        ? mapping[key] || "__none__"
                        : "__auto__"
                    }
                    onChange={(e) => {
                      const value = e.target.value;
                      setMapping((m) => {
                        const next = { ...m };
                        if (value === "__auto__") delete next[key];
                        else next[key] = value === "__none__" ? "" : value;
                        return next;
                      });
                      resetPreview();
                    }}
                  >
                    <option value="__auto__">
                      {t("自動辨識", "Auto-detect")}
                    </option>
                    <option value="__none__">
                      {t("不提供", "Unavailable")}
                    </option>
                    {file.headers?.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </Field>
              ))}
            </div>
          </details>
        )}
      </fieldset>
      {preview && (
        <section
          className="marketing-preview"
          aria-label={t("匯入預覽", "Import preview")}
        >
          <h3>{t("確認後才建立快照", "Confirm before creating a snapshot")}</h3>
          <p>
            {preview.row_count} {t("筆資料", "rows")} · {preview.currency} ·{" "}
            {preview.timezone} · {preview.duplicate_row_count}{" "}
            {t("筆相同行已略過", "identical rows skipped")}
          </p>
          {preview.existing_dataset_id && (
            <div className="notice success">
              {t(
                "這份資料已匯入，確認後會開啟原有快照，不會重複計算。",
                "This import already exists. Confirmation opens its snapshot without counting it again.",
              )}
            </div>
          )}
          <MarketingWarnings data={preview} />
          <dl className="marketing-mapping-result">
            {Object.entries(preview.mapping).map(([key, value]) => (
              <div key={key}>
                <dt>{key}</dt>
                <dd>{String(value)}</dd>
              </div>
            ))}
          </dl>
          <p className="marketing-checksum">
            SHA-256 <code>{preview.source_sha256}</code>
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            {t(
              "我已確認幣種、時區、帳戶、粒度與欄位口徑。",
              "I have checked the currency, timezone, account, grain and column definitions.",
            )}
          </label>
        </section>
      )}
      <button
        className="button primary"
        type="submit"
        disabled={busy || !file?.headers || (!!preview && !confirmed)}
      >
        {busy
          ? t("處理中…", "Processing…")
          : preview
            ? t("確認匯入", "Confirm import")
            : t("預覽與檢查", "Preview & validate")}
      </button>
    </form>
  );
}
