import { zipSync, strToU8 } from "fflate";
export const escapeXML = (v: unknown) =>
  String(v)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
export function workbookParts(
  sheets: { name: string; xml: string; hidden?: boolean }[],
  date1904 = false,
) {
  const parts: Record<string, string> = {
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>',
    "_rels/.rels":
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    "xl/workbook.xml": `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="${date1904 ? 1 : 0}"/><sheets>${sheets.map((s, i) => `<sheet name="${escapeXML(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"${s.hidden ? ' state="hidden"' : ""}/>`).join("")}</sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="styles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml":
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
  };
  sheets.forEach(
    (s, i) =>
      (parts[`xl/worksheets/sheet${i + 1}.xml`] =
        `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${s.xml}</sheetData></worksheet>`),
  );
  return parts;
}
export const packWorkbook = (parts: Record<string, string>) =>
  Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(parts).map(([k, v]) => [k, strToU8(v)]),
      ),
    ),
  );
export const stringCell = (ref: string, value: unknown) =>
  `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXML(value)}</t></is></c>`;
export const numericCell = (ref: string, value: string, style?: number) =>
  `<c r="${ref}"${style === undefined ? "" : ` s="${style}"`}><v>${value}</v></c>`;
export function campaignWorkbook(cost = "100.125", name = "Campaigns") {
  const heads = [
    "date",
    "channel",
    "campaign",
    "impressions",
    "clicks",
    "spend",
    "conversions",
    "revenue",
    "currency",
    "entity_id",
  ];
  const header = `<row r="1">${heads.map((h, i) => stringCell(String.fromCharCode(65 + i) + "1", h)).join("")}</row>`;
  const data =
    '<row r="7">' +
    [
      stringCell("A7", "2026-10-01"),
      stringCell("B7", "Google"),
      stringCell("C7", "Launch\n香港"),
      numericCell("D7", "1000"),
      numericCell("E7", "100"),
      numericCell("F7", cost),
      numericCell("G7", "4.5"),
      numericCell("H7", "450"),
      stringCell("I7", "HKD"),
      stringCell("J7", "456"),
    ].join("") +
    "</row>";
  return workbookParts([{ name, xml: header + data }]);
}
