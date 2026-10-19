import { useEffect, useRef, useState, type FormEvent } from "react";
import { post } from "./api";
import { ErrorNotice, Field, useI18n } from "./ui";
import { MarketingWarnings } from "./marketing-warnings";

export function MarketingImport({
  base,
  onImported,
}: {
  base: string;
  onImported: (result: any) => void;
}) {
  const { t } = useI18n();
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
      csv: string;
      name: string;
      headers: string[];
    } | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [preview, setPreview] = useState<any>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [confirmed, setConfirmed] = useState(false);
  const live = useRef(true),
    locked = useRef(false),
    readSequence = useRef(0);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      readSequence.current++;
    };
  }, []);
  function change(key: keyof typeof form, value: string) {
    setForm((f) => ({
      ...f,
      [key]: value,
      ...(key === "source"
        ? { entity_level: value === "csv_upload" ? "dataset" : "campaign" }
        : {}),
    }));
    setPreview(null);
    setConfirmed(false);
    setError(null);
  }
  async function choose(chosen: File | undefined) {
    const sequence = ++readSequence.current;
    setFile(null);
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setMapping({});
    if (!chosen) return;
    if (
      !/\.csv$/i.test(chosen.name) ||
      chosen.size > 5_000_000 ||
      !chosen.size
    ) {
      setError(
        new Error(
          t("請選擇 5 MB 以內的 UTF-8 CSV。", "Choose a UTF-8 CSV up to 5 MB."),
        ),
      );
      return;
    }
    setBusy(true);
    try {
      // Preserve a UTF-8 BOM so the stored source hash matches the uploaded bytes.
      const csv = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await chosen.arrayBuffer());
      if (!live.current || sequence !== readSequence.current) return;
      const inspected = await post(base + "/analytics/inspect", { csv });
      if (live.current && sequence === readSequence.current) {
        setFile({ csv, name: chosen.name, headers: inspected.headers });
        setForm((f) => ({
          ...f,
          name: f.name || chosen.name.replace(/\.csv$/i, ""),
        }));
      }
    } catch (e) {
      if (live.current && sequence === readSequence.current) setError(e);
    } finally {
      if (live.current && sequence === readSequence.current) setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file || locked.current || busy) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    const body = {
      ...form,
      csv: file.csv,
      source_filename: file.name,
      mapping,
      account_id: form.account_id || undefined,
      attribution_definition: form.attribution_definition || undefined,
      conversion_definition: form.conversion_definition || undefined,
    };
    try {
      if (!preview) {
        const p = await post(base + "/analytics/preview", body);
        if (live.current) {
          setPreview(p);
          setConfirmed(false);
        }
      } else if (confirmed) {
        const result = await post(base + "/analytics/import", body);
        if (live.current) onImported(result);
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
          label={t("CSV 檔案", "CSV file")}
          hint={t(
            "UTF-8，最多 10,000 筆；保留原始檔案，不執行公式。",
            "UTF-8, up to 10,000 rows; original bytes are retained and formulas are never executed.",
          )}
        >
          <input
            name="file"
            type="file"
            accept=".csv,text/csv"
            required
            onChange={(e) => void choose(e.target.files?.[0])}
          />
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
              <option value="csv_upload">{t("通用 CSV", "Generic CSV")}</option>
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
        {file && (
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
                      setPreview(null);
                      setConfirmed(false);
                    }}
                  >
                    <option value="__auto__">
                      {t("自動辨識", "Auto-detect")}
                    </option>
                    <option value="__none__">
                      {t("不提供", "Unavailable")}
                    </option>
                    {file.headers.map((h) => (
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
        disabled={busy || !file || (!!preview && !confirmed)}
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
