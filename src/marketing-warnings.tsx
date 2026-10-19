import { useI18n } from "./ui";
export function MarketingWarnings({ data }: { data: any }) {
  const { t } = useI18n();
  const messages: Record<string, string> = {
    assumed_currency: t(
      "幣種預設為 HKD，請在解讀金額前確認。",
      "Currency was assumed HKD; confirm before interpreting monetary values.",
    ),
    missing_definitions: t(
      "未提供歸因或轉化定義；請勿合併或比較不同平台的轉化數據。",
      "Attribution/conversion definitions were not provided; do not compare or deduplicate platform conversions.",
    ),
    duplicate_rows: t(
      `已略過 ${data?.duplicate_row_count || 0} 筆相同資料。`,
      `${data?.duplicate_row_count || 0} identical fact rows were skipped.`,
    ),
    unknown_conversions: t(
      "缺少的轉化或轉化價值保留為未知，相關比率無法計算。",
      "Unavailable conversions/value remain unknown; dependent ratios are not calculated.",
    ),
  };
  const values: string[] = data?.warning_codes?.length
    ? data.warning_codes.map((code: string) => messages[code] || code)
    : data?.warnings || [];
  return values.length ? (
    <div className="notice">
      <ul>
        {values.map((v, i) => (
          <li key={i}>{v}</li>
        ))}
      </ul>
    </div>
  ) : null;
}
