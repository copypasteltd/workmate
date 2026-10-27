export type FinancialNotice = {
  id: string;
  read: boolean;
  recorded_at: string;
  delivered_at: string;
  subject: { kind: "user" | "tenant"; id: string };
  billing_account_id: string;
  data_mode: "simulated" | "configured_services";
  event_type: string;
  source_id: string;
  operation_id: string;
  amount: { currency: "HKD"; amount_micros: string } | null;
  requested_amount: { currency: "HKD"; amount_micros: string } | null;
  direction: "credit" | "debit" | "neutral";
  bucket: "paid" | "promotional" | "reserved" | "credit_limit" | null;
};
export const financialLabels: Record<string, readonly [string, string]> = {
  "billing.reserve": ["預留已建立", "Funds reserved"],
  "billing.consume": ["費用已確認", "Charge confirmed"],
  "billing.release": ["預留已釋放", "Reservation released"],
  "billing.top_up": ["已核實付款入帳", "Verified payment credited"],
  "billing.gift": ["贈送額度已入帳", "Promotional credit added"],
  "billing.gift_expiry": ["贈送額度已到期", "Promotional credit expired"],
  "billing.debit": ["原來源額度已扣回", "Original credit withdrawn"],
  "billing.refund": ["現金退款扣帳已確認", "Cash refund debit confirmed"],
  "billing.compensation": [
    "費用已退回原資金來源",
    "Charge returned to original funding",
  ],
  "billing.credit_limit": ["授信上限已更新", "Credit limit updated"],
  "payment.recorded": ["收款資料已登記", "Payment receipt recorded"],
  "payment.confirmed": [
    "收款資料已獨立核實",
    "Payment receipt independently verified",
  ],
  "refund.requested": ["退款要求已登記", "Refund request recorded"],
  "refund.paid": [
    "本次實付退款已核實",
    "This actual refund payout was verified",
  ],
  "refund.not_paid": [
    "餘下退款確認未支付",
    "Remaining refund confirmed unpaid",
  ],
  "refund.unknown": ["退款結果待核對", "Refund outcome needs reconciliation"],
  "refund.mismatch": ["退款資料不一致", "Refund evidence differs"],
};
export function exactHKD(value: string) {
  if (!/^-?(0|[1-9][0-9]*)$/.test(value))
    throw new Error("Invalid exact HKD amount");
  const amount = BigInt(value),
    absolute = amount < 0n ? -amount : amount;
  return (
    "HKD " +
    (amount < 0n ? "−" : "") +
    (absolute / 1000000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    "." +
    (absolute % 1000000n).toString().padStart(6, "0")
  );
}
export function financialExplanation(event: string): readonly [string, string] {
  if (event.startsWith("payment."))
    return [
      "這是收款資料的記錄，不代表已增加可用餘額；入帳會另有記錄。",
      "This records receipt evidence. Available credit changes only when a separate posting is confirmed.",
    ];
  if (event === "refund.requested")
    return [
      "要求金額與實付退款分開記錄；費用補償只退回原資金來源。",
      "Requested amounts and actual payouts are separate. Charge compensation returns original funding only.",
    ];
  if (["refund.unknown", "refund.mismatch"].includes(event))
    return [
      "結果尚未核實，不能把這筆觀察當作已支付或零元退款。",
      "This outcome is not verified. This observation establishes neither a successful payout nor a zero refund.",
    ];
  if (event === "refund.paid")
    return [
      "顯示本次實際核實的支付額，可能只是原要求的一部分。",
      "This is the actual verified payout and may cover only part of the request.",
    ];
  if (event === "refund.not_paid")
    return [
      "已確認餘額未支付；已核實的先前支付仍保留原記錄。",
      "The remaining payout was confirmed unpaid. Earlier verified payouts retain their original records.",
    ];
  if (event === "billing.credit_limit")
    return [
      "金額是當時的新授信上限；授信不是已付款或贈送餘額。",
      "The amount is the new limit at that time. A credit limit is separate from paid or promotional funds.",
    ];
  if (["billing.reserve", "billing.release"].includes(event))
    return [
      "這是預留變動，並非另一次消費或實付退款。",
      "This changes a reservation; it is not an additional charge or cash payout.",
    ];
  return [
    "此項保留當時的資金變動；目前餘額以最新確認結果為準。",
    "This records a past funding event. Current balances follow the latest confirmed account values.",
  ];
}
