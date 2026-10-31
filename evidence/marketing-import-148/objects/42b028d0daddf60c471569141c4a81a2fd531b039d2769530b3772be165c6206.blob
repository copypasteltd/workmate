import { useI18n } from "./ui";

const money = (micros: number | null) => {
  if (micros === null) return null;
  const s = String(micros).padStart(7, "0");
  return `${s.slice(0, -6)}.${s.slice(-6)}`;
};

export function MarketingImportPreview({ preview }: { preview: any }) {
  const { t } = useI18n();
  const exact = preview.summary?.exact;
  const unknown = t("未提供", "Unknown");
  return (
    <section aria-label={t("解析後的資料", "Parsed data")}>
      <h4>{t("核對實際日期與金額", "Check the parsed dates and amounts")}</h4>
      <p>
        {t(
          "以下為前五筆資料，總額包含全部有效行。更改格式會清除原確認。",
          "The first five facts appear below. Totals include all accepted rows. Changing a format clears the previous confirmation.",
        )}
      </p>
      {exact && (
        <dl className="marketing-mapping-result">
          <div>
            <dt>
              {t("總花費", "Total spend")} · {preview.currency}
            </dt>
            <dd>{exact.spend}</dd>
          </div>
          <div>
            <dt>{t("曝光", "Impressions")}</dt>
            <dd>{exact.impressions}</dd>
          </div>
          <div>
            <dt>{t("點擊", "Clicks")}</dt>
            <dd>{exact.clicks}</dd>
          </div>
          <div>
            <dt>{t("轉換", "Conversions")}</dt>
            <dd>{exact.conversions ?? unknown}</dd>
          </div>
          <div>
            <dt>
              {t("轉換價值", "Conversion value")} · {preview.currency}
            </dt>
            <dd>{exact.conversion_value ?? unknown}</dd>
          </div>
        </dl>
      )}
      <ol className="marketing-import-sample">
        {(preview.sample ?? []).map((row: any, index: number) => (
          <li key={index}>
            <strong>
              {row.date} · {row.channel}
            </strong>
            <p>
              {row.campaign ||
                row.entity_id ||
                t("未命名項目", "Unnamed entity")}
              {row.campaign && row.entity_id ? ` · ${row.entity_id}` : ""}
            </p>
            <dl className="marketing-mapping-result">
              <div>
                <dt>
                  {t("花費", "Spend")} · {preview.currency}
                </dt>
                <dd>{money(row.spend_micros)}</dd>
              </div>
              <div>
                <dt>{t("曝光／點擊", "Impressions / clicks")}</dt>
                <dd>
                  {row.impressions} / {row.clicks}
                </dd>
              </div>
              <div>
                <dt>{t("轉換", "Conversions")}</dt>
                <dd>{row.conversions ?? unknown}</dd>
              </div>
              <div>
                <dt>
                  {t("轉換價值", "Conversion value")} · {preview.currency}
                </dt>
                <dd>{money(row.revenue_micros) ?? unknown}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
    </section>
  );
}
