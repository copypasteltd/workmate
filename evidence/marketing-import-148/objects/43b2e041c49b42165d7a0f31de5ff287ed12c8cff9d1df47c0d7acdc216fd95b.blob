import { z } from "zod";
import { Problem } from "./lib.js";

export const numberFormat = z.enum([
  "dot_decimal",
  "comma_decimal",
  "space_dot",
  "space_comma",
]);
export const dateFormat = z.enum([
  "iso",
  "day_first",
  "month_first",
  "year_first",
]);
export type NumberFormat = z.infer<typeof numberFormat>;
export type DateFormat = z.infer<typeof dateFormat>;
export type CsvLayout = {
  delimiter?: "," | ";" | "\t";
  header_row?: number;
  // Only the trusted XLSX decoder supplies these record/column coordinates. Stored numeric
  // cells already use dot decimals; their display locale must never rescale them.
  canonical_cells?: ReadonlyMap<number, ReadonlySet<number>>;
};

function invalid(line: number, column: string, message: string): never {
  throw new Problem(400, "CSV_ROW_INVALID", message, [
    { path: `row ${line}.${column}`, message },
  ]);
}

export function campaignNumber(
  value: string,
  format: NumberFormat,
  line: number,
  column: string,
  nullable = false,
) {
  const s = value.trim();
  if (nullable && ["", "--", "—", "N/A", "null"].includes(s)) return null;
  const patterns = {
    dot_decimal: /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/,
    comma_decimal: /^(?:\d+|\d{1,3}(?:\.\d{3})+)(?:,\d+)?$/,
    space_dot: /^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:\.\d+)?$/,
    space_comma: /^(?:\d+|\d{1,3}(?:[ \u00a0\u202f]\d{3})+)(?:,\d+)?$/,
  };
  if (!patterns[format].test(s))
    invalid(
      line,
      column,
      format === "dot_decimal"
        ? "Use a non-negative decimal; leave unavailable conversions/value blank"
        : "Number does not match the selected decimal and grouping format; unavailable conversions/value may be blank",
    );
  if (format === "dot_decimal") return s.replaceAll(",", "");
  if (format === "comma_decimal")
    return s.replaceAll(".", "").replace(",", ".");
  return s.replace(/[ \u00a0\u202f]/g, "").replace(",", ".");
}

export function campaignDate(
  value: string,
  format: DateFormat,
  line: number,
  column: string,
) {
  const s = value.trim();
  // ISO dates, including typed Excel date cells, are always unambiguous.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return checkedDate(s, line, column);
  if (format === "iso")
    invalid(
      line,
      column,
      "Use YYYY-MM-DD or select the date order used in the export",
    );
  let year: string, month: string, day: string;
  if (format === "year_first") {
    const m =
      /^(\d{4})([/.\-])(\d{1,2})\2(\d{1,2})$/.exec(s) ??
      /^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(s);
    if (!m)
      invalid(line, column, "Use a four-digit year followed by month and day");
    [year, month, day] =
      m.length === 5 ? [m[1], m[3], m[4]] : [m[1], m[2], m[3]];
  } else {
    const m = /^(\d{1,2})([/.\-])(\d{1,2})\2(\d{4})$/.exec(s);
    if (!m)
      invalid(
        line,
        column,
        "Date does not match the selected day/month order and four-digit year",
      );
    year = m[4];
    [month, day] = format === "day_first" ? [m[3], m[1]] : [m[1], m[3]];
  }
  return checkedDate(
    `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`,
    line,
    column,
  );
}

function checkedDate(s: string, line: number, column: string) {
  if (
    Number.isNaN(Date.parse(s)) ||
    new Date(s).toISOString().slice(0, 10) !== s
  )
    invalid(line, column, "Date is not a valid calendar day");
  return s;
}
