import {
  inspectMetricsCSV,
  normalizeMetricsCSV,
  type ImportOptions,
} from "./analytics-import.js";
import {
  readWorkbook,
  columnName,
  WORKBOOK_VERSION,
} from "./analytics-workbook.js";
import { canonical, hash, Problem } from "./lib.js";

export type FileSelection = { sheet_name?: string; header_row?: number };
function workbookError(
  e: unknown,
  file: {
    selected_sheet: string | null;
    locations: { line: number; row: number }[];
    headers: string[] | null;
  },
  headerRow: number,
): never {
  if (e instanceof Problem && Array.isArray(e.details)) {
    const location = (line: number) =>
      file.locations.find((l) => l.line === line)?.row ?? headerRow;
    e.message = e.message.replace(
      /previous record ends at line (\d+)/g,
      (_m, line) =>
        `previous record is ${file.selected_sheet}!${location(Number(line))}`,
    );
    e.details = e.details.map((d: any) => {
      const m = /^row (\d+)\.(.*)$/.exec(d.path);
      if (!m) return d;
      const column = file.headers?.indexOf(m[2]) ?? -1;
      return {
        ...d,
        message: e.message,
        path: `${file.selected_sheet}!${column >= 0 ? columnName(column) : ""}${location(Number(m[1]))} (${m[2]})`,
      };
    });
  }
  throw e;
}
export function campaignFile(
  bytes: Buffer,
  filename: string,
  selection: FileSelection = {},
) {
  if (!bytes.length || bytes.length > 5_000_000)
    throw new Problem(
      413,
      "IMPORT_FILE_SIZE",
      "Choose a CSV or XLSX up to 5 MB",
    );
  if (/\.csv$/i.test(filename)) {
    if (
      selection.sheet_name ||
      (selection.header_row && selection.header_row !== 1)
    )
      throw new Problem(
        400,
        "IMPORT_SELECTION",
        "CSV uses its first row as headers and has no worksheets",
      );
    try {
      const csv = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(bytes),
        inspected = inspectMetricsCSV(csv);
      return {
        ...inspected,
        csv,
        sheets: [],
        selected_sheet: null,
        locations: [],
        date1904: false,
        hidden_rows: 0,
        file_type: "csv" as const,
        header_row: 1,
      };
    } catch (e) {
      if (e instanceof Problem) throw e;
      throw new Problem(400, "CSV_INVALID", "CSV must be valid UTF-8");
    }
  }
  if (!/\.xlsx$/i.test(filename))
    throw new Problem(
      415,
      "IMPORT_FILE_TYPE",
      "Only UTF-8 CSV and standard XLSX are supported",
    );
  try {
    const book = readWorkbook(
      bytes,
      selection.sheet_name,
      selection.header_row ?? 1,
    );
    let inspected;
    try {
      inspected = book.csv
        ? inspectMetricsCSV(book.csv)
        : { headers: null, input_row_count: null };
    } catch (e) {
      workbookError(e, book, selection.header_row ?? 1);
    }
    return {
      ...book,
      ...inspected,
      source_sha256: hash(bytes),
      file_type: "xlsx" as const,
      header_row: selection.header_row ?? 1,
    };
  } catch (e) {
    if (e instanceof Problem) throw e;
    throw new Problem(
      400,
      "XLSX_INVALID",
      "The workbook could not be read as a supported XLSX table",
    );
  }
}
export function normalizeCampaignFile(
  bytes: Buffer,
  filename: string,
  options: ImportOptions,
  selection: FileSelection = {},
) {
  const file = campaignFile(bytes, filename, selection);
  if (!file.csv)
    throw new Problem(
      400,
      "XLSX_SHEET_REQUIRED",
      "Choose the worksheet containing the campaign table",
    );
  try {
    const normalized = normalizeMetricsCSV(file.csv, {
      ...options,
      source_filename: filename,
    });
    // CSV retains the established identity across the legacy text endpoint and
    // the file endpoint. Existing frozen snapshots are not rebound or renamed.
    const spec =
      file.file_type === "csv"
        ? normalized.spec
        : {
            ...normalized.spec,
            file: {
              format: file.file_type,
              parser_version:
                file.file_type === "xlsx"
                  ? WORKBOOK_VERSION
                  : "campaign-csv/1.0",
              worksheet: file.selected_sheet,
              header_row: file.header_row,
              date_system:
                file.file_type === "xlsx"
                  ? file.date1904
                    ? "1904"
                    : "1900"
                  : null,
            },
          };
    const spec_hash = hash(canonical(spec)),
      source_sha256 = hash(bytes);
    if (file.hidden_rows) {
      normalized.warnings.push(
        "Hidden worksheet rows are included in the imported facts.",
      );
      normalized.warning_codes.push("hidden_rows_included");
    }
    return {
      ...normalized,
      spec,
      spec_hash,
      source_sha256,
      import_key: hash(canonical({ source_sha256, spec_hash })),
      raw_csv: file.file_type === "csv" ? file.csv : null,
      file_type: file.file_type,
    };
  } catch (e) {
    if (file.file_type === "xlsx") workbookError(e, file, file.header_row);
    throw e;
  }
}
