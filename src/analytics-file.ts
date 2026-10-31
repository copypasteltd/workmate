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
import type { CsvLayout } from "./analytics-conventions.js";
import { canonical, hash, Problem } from "./lib.js";

export type FileSelection = {
  sheet_name?: string;
  header_row?: number;
  csv_delimiter?: "comma" | "semicolon" | "tab";
  csv_encoding?: "utf8" | "utf16le" | "utf16be";
};
export const csvDelimiter = (
  v?: FileSelection["csv_delimiter"],
): CsvLayout["delimiter"] =>
  v === "semicolon" ? ";" : v === "tab" ? "\t" : ",";
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
    if (selection.sheet_name)
      throw new Problem(400, "IMPORT_SELECTION", "CSV has no worksheets");
    const bom = bytes.subarray(0, 2).toString("hex");
    const detected =
      bom === "fffe" ? "utf16le" : bom === "feff" ? "utf16be" : "utf8";
    const encoding = selection.csv_encoding ?? detected;
    if ((bom === "fffe" || bom === "feff") && encoding !== detected)
      throw new Problem(
        400,
        "CSV_ENCODING",
        "The selected encoding conflicts with the file byte-order mark",
      );
    const layout: CsvLayout = {
      delimiter: csvDelimiter(selection.csv_delimiter),
      header_row: selection.header_row ?? 1,
    };
    try {
      const csv = new TextDecoder(
          encoding === "utf8"
            ? "utf-8"
            : encoding === "utf16le"
              ? "utf-16le"
              : "utf-16be",
          {
            fatal: true,
            ignoreBOM: true,
          },
        ).decode(bytes),
        inspected = inspectMetricsCSV(csv, layout);
      return {
        ...inspected,
        source_sha256: hash(bytes),
        csv,
        sheets: [],
        selected_sheet: null,
        locations: [],
        date1904: false,
        hidden_rows: 0,
        file_type: "csv" as const,
        header_row: layout.header_row!,
        csv_encoding: encoding,
        csv_delimiter: selection.csv_delimiter ?? "comma",
        canonical_cells: new Map<number, ReadonlySet<number>>(),
      };
    } catch (e) {
      if (e instanceof Problem) throw e;
      throw new Problem(
        400,
        "CSV_INVALID",
        "CSV does not match the selected text encoding",
      );
    }
  }
  if (!/\.xlsx$/i.test(filename))
    throw new Problem(
      415,
      "IMPORT_FILE_TYPE",
      "Only UTF-8 CSV and standard XLSX are supported",
    );
  if (selection.csv_delimiter || selection.csv_encoding)
    throw new Problem(
      400,
      "IMPORT_SELECTION",
      "CSV encoding and delimiter options do not apply to XLSX",
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
      csv_encoding: null,
      csv_delimiter: null,
      canonical_cells:
        book.canonical_cells ?? new Map<number, ReadonlySet<number>>(),
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
    const normalized = normalizeMetricsCSV(
      file.csv,
      {
        ...options,
        source_filename: filename,
      },
      {
        ...(file.file_type === "csv"
          ? {
              delimiter: csvDelimiter(file.csv_delimiter!),
              header_row: file.header_row,
            }
          : {}),
        canonical_cells: file.canonical_cells,
      },
    );
    // CSV retains the established identity across the legacy text endpoint and
    // the file endpoint. Existing frozen snapshots are not rebound or renamed.
    const spec =
      file.file_type === "csv"
        ? file.header_row === 1 &&
          file.csv_encoding === "utf8" &&
          file.csv_delimiter === "comma"
          ? normalized.spec
          : {
              ...normalized.spec,
              file: {
                format: "csv",
                parser_version: "campaign-file/1.1",
                header_row: file.header_row,
                encoding: file.csv_encoding,
                delimiter: file.csv_delimiter,
              },
            }
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
