/** Format integer micro-HKD without a lossy Number conversion. */
export function adoptionPrice(value: string | null) {
  if (value === null) return null;
  const micros = BigInt(value);
  const whole = micros / 1_000_000n;
  const fraction = (micros % 1_000_000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `HK$${whole}${fraction ? "." + fraction : ""}`;
}
