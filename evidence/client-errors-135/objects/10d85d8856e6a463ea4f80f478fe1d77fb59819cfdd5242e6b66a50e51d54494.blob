export function cloudAgentBudget(value: string): number {
  if (!/^(0|[1-9][0-9]{0,6})(?:\.[0-9]{1,6})?$/.test(value)) throw new Error("AI_BUDGET_INVALID");
  const [whole, fraction = ""] = value.split(".");
  const micros = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (micros < 1n || micros > 1_000_000_000_000n) throw new Error("AI_BUDGET_INVALID");
  return Number(micros);
}
