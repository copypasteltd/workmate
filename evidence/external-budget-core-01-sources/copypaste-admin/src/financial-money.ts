/** HKD micro-units stay decimal strings from input through the API and display. */
export function parseHKD(value: string, allowZero = false) {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/.exec(value.trim());
  if (!match)
    throw new Error(
      "請輸入最多六位小數的港幣金額 / Enter HKD with up to six decimal places",
    );
  const n =
    BigInt(match[1]) * 1000000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (n < (allowZero ? 0n : 1n) || n > 9223372036854775807n)
    throw new Error("金額超出可用範圍 / Amount is outside the supported range");
  return n.toString();
}
export function formatHKD(value: string) {
  const n = BigInt(value),
    absolute = n < 0n ? -n : n;
  const whole = new Intl.NumberFormat("en-HK").format(absolute / 1000000n);
  const fraction = (absolute % 1000000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "")
    .padEnd(2, "0");
  return `${n < 0n ? "−" : ""}HK$${whole}.${fraction}`;
}
