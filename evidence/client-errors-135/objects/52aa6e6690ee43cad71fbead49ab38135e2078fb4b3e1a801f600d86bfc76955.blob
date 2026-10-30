export function currencyDigits(currency: string | null) {
  try {
    return new Intl.NumberFormat("en-HK", {
      style: "currency",
      currency: currency || "HKD",
    }).resolvedOptions().maximumFractionDigits!;
  } catch {
    return 2;
  }
}
/** Prices are parsed as decimal digits, without binary floating-point rounding. */
export function parseBrandAmount(
  value: string,
  currency: string | null,
): number | null {
  if (!value.trim()) return null;
  const places = currencyDigits(currency),
    match = /^(\d+)(?:\.(\d*))?$/.exec(value.trim());
  if (!match || (match[2]?.length ?? 0) > places)
    throw new Error(
      "Enter a non-negative amount with the selected currency precision",
    );
  const amount =
    BigInt(match[1]) * 10n ** BigInt(places) +
    BigInt((match[2] ?? "").padEnd(places, "0") || "0");
  if (amount > 1_000_000_000_000n)
    throw new Error("Amount exceeds the supported range");
  return Number(amount);
}
export function formatBrandAmount(
  value: number | null,
  currency: string | null,
) {
  if (value == null) return "";
  const places = currencyDigits(currency),
    raw = String(value).padStart(places + 1, "0");
  return places ? raw.slice(0, -places) + "." + raw.slice(-places) : raw;
}
