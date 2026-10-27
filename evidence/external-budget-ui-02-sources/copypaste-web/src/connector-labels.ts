const limits: Record<string, [string, string]> = {
  WEB_ANALYTICS_PARTIAL_SOURCE: ["此快照只包含部分同步結果。", "This snapshot contains only a partial synchronization."],
  WEB_ANALYTICS_OBSERVED_ROWS_ONLY: ["摘要只反映已捕獲資料，不能當作全站總量。", "The summary covers captured rows, not complete website totals."],
  WEB_ANALYTICS_NO_CROSS_PLATFORM_ATTRIBUTION: ["沒有跨平台去重、歸因或因果推斷。", "No cross-platform deduplication, attribution or causal inference is applied."],
  WEB_ANALYTICS_MISSING_DATES_NOT_ZERO: ["沒有返回資料的日期保持未知，不補零。", "Dates without returned rows remain unknown, not zero."],
  CONNECTOR_RATE_OR_TRANSIENT: [
    "來源暫時限流，系統會按供應商指定時間重試。",
    "The provider is temporarily rate-limiting requests. A retry follows its requested delay.",
  ],
  CONNECTOR_AUTH_EXPIRED: [
    "來源授權已失效，請重新連接帳戶。",
    "Provider authorization expired. Connect the account again.",
  ],
  CONNECTOR_SCHEMA_CHANGED: [
    "來源返回的資料格式不符合目前報表規格，已停止讀取。",
    "The source returned an unexpected report format. Reading has stopped.",
  ],
  CONNECTOR_ROW_COUNT_CHANGED: [
    "分頁期間來源總行數改變，已保留部分結果；請建立新同步。",
    "The source row count changed during pagination. A partial result is retained; start a new sync.",
  ],
  PROVIDER_DATA_CUTOFF_UNAVAILABLE: [
    "供應商沒有提供數據提取截止時間。",
    "The provider does not supply a data extraction cutoff.",
  ],
  LATE_ATTRIBUTION_CAN_CHANGE_NEW_SNAPSHOTS: [
    "遲到轉換及歸因修訂可能改變後續快照；舊快照不會被覆蓋。",
    "Late conversions and attribution revisions may change future snapshots; existing snapshots stay fixed.",
  ],
  GOOGLE_ADS_CONFIGURED_CONVERSION_ACTIONS_AND_ATTRIBUTION: [
    "轉換及轉換價值採用 Google Ads 帳戶當時設定的轉換動作與歸因方式。",
    "Conversions and value follow the Google Ads account’s configured conversion actions and attribution.",
  ],
  META_ACTION_TYPE_EXACT_MATCH_MISSING_IS_UNKNOWN: [
    "只讀取 purchase 動作，不合計重疊購買類型；未返回的值保持未知。",
    "Only the exact purchase action is used. Overlapping purchase types are not summed, and missing values remain unknown.",
  ],
  META_CONVERSION_TIME_ACCOUNT_ATTRIBUTION: [
    "Meta 以轉換發生時間及帳戶歸因設定建立報告。",
    "Meta reports use conversion time and the account’s attribution settings.",
  ],
  GA4_USERS_NOT_ADDITIVE_ACROSS_ROWS_OR_REPORTS: [
    "GA4 用戶數不能跨維度、日期或流量與事件報告直接相加。",
    "GA4 user counts cannot be added across dimensions, dates, or traffic and event reports.",
  ],
  GA4_DATES_WITHOUT_ROWS_ARE_NOT_ZERO: [
    "沒有返回的 GA4 日期或維度組合不會被補成零。",
    "Missing GA4 dates and dimension combinations are not filled with zeroes.",
  ],
  GA4_THRESHOLDING: [
    "此 GA4 報告受資料閾值限制，部分資料可能被隱藏。",
    "This GA4 report is subject to data thresholds; some data may be withheld.",
  ],
  GA4_OTHER_ROW_DATA_LOSS: [
    "GA4 高基數資料可能被合併至 other 行，明細存在資料損失。",
    "High-cardinality GA4 data may be grouped into an other row, reducing detail.",
  ],
  GA4_SAMPLING: ["GA4 返回了抽樣資訊。", "GA4 returned sampling metadata."],
  GA4_METRIC_RESTRICTIONS: [
    "部分 GA4 指標受到屬性存取限制。",
    "Some GA4 metrics are restricted by property access settings.",
  ],
  GA4_REPORTING_IDENTITY_UNAVAILABLE: [
    "無法讀取 GA4 報告身份設定，跨平台身份比較缺少依據。",
    "GA4 reporting identity could not be read, so identity comparisons lack this context.",
  ],
  GSC_TOP_ROWS_ONLY_NOT_FULL_COVERAGE: [
    "Search Console 只返回主要搜尋明細；分頁完成不表示完整覆蓋。",
    "Search Console returns top search rows; finished pagination does not mean full coverage.",
  ],
  GSC_ANONYMIZED_QUERIES_OMITTED: [
    "Search Console 可能省略匿名查詢。",
    "Search Console may omit anonymized queries.",
  ],
  GSC_AVERAGE_POSITION_NOT_ADDITIVE: [
    "平均搜尋位置不能跨行直接相加或作簡單平均。",
    "Average search position cannot be summed or averaged directly across rows.",
  ],
  GSC_WEB_FINAL_BY_PAGE_PACIFIC_TIME: [
    "Search Console 採用 web 搜尋、最終資料、頁面彙總及太平洋時區。",
    "Search Console uses web search, final data, page aggregation and Pacific time.",
  ],
  GSC_INCOMPLETE_DATES: [
    "來源標示部分日期資料尚未完整。",
    "The source marks some dates as incomplete.",
  ],
  CONNECTOR_CURSOR_LOOP: [
    "供應商重複返回相同分頁位置，已停止同步並保留部分結果。",
    "The provider repeated a page cursor. Synchronization stopped with a partial result.",
  ],
  CONNECTOR_RESOURCE_LIMIT: [
    "本次同步達到處理上限，請縮小日期或帳戶範圍後重新同步。",
    "This sync reached its processing limit. Narrow the date or account range and sync again.",
  ],
  CONNECTOR_OVERLAPPING_PAGES: [
    "不同分頁包含重疊明細；重複行已排除，快照保留部分完成狀態。",
    "Pages contained overlapping facts. Duplicate rows were excluded and the snapshot remains partial.",
  ],
  CONNECTOR_CATALOG_INCOMPLETE: [
    "帳戶發現尚未完整，請重新整理授權目錄。",
    "Account discovery is incomplete; refresh the authorized account directory.",
  ],
  LEGACY_RECONNECT_REQUIRED: [
    "這是舊版連接，請重新授權並確認帳戶範圍。",
    "This legacy connection requires new authorization and confirmed account scope.",
  ],
};
export function connectorLimit(
  code: string,
  t: (zh: string, en: string) => string,
) {
  const v = limits[code];
  return v
    ? t(...v)
    : t(
        "來源處理未完成，請查看同步記錄或聯絡支援。",
        "Source processing is incomplete. Review the sync history or contact support.",
      );
}
