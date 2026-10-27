import { zipSync, strToU8 } from "fflate";
const esc = (v: string) =>
  v.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
    .replace(/[^\x00-\x7f]/gu, (c) => `&#${c.codePointAt(0)};`);
export function campaignWorkbook(cost = "100.125", formula = false) {
  const strings = (row: number, values: string[]) =>
    values
      .map(
        (v, i) =>
          `<c r="${String.fromCharCode(65 + i)}${row}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`,
      )
      .join("");
  const heads = [
      "Day",
      "Campaign",
      "Campaign ID",
      "Impressions",
      "Clicks",
      "Cost",
      "Conversions",
      "Conv. value",
    ],
    parts: Record<string, string> = {
      "[Content_Types].xml":
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      "_rels/.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="office" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
      "xl/workbook.xml":
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Read me" sheetId="1" r:id="notes"/><sheet name="Campaign facts" sheetId="2" r:id="data"/></sheets></workbook>',
      "xl/_rels/workbook.xml.rels":
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="notes" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="data" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>',
      "xl/worksheets/sheet1.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">' +
        strings(1, ["Synthetic campaign workbook. No customer data."]) +
        "</row></sheetData></worksheet>",
      "xl/worksheets/sheet2.xml":
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">' +
        strings(1, ["Daily synthetic export"]) +
        `</row><row r="3">${strings(3, heads)}</row><row r="7">${strings(7, ["2026-10-01", "Harbour launch · 香港", "456"])}<c r="D7"><v>1000</v></c><c r="E7"><v>100</v></c><c r="F7">${formula ? '<f>WEBSERVICE("https://example.invalid")</f>' : ""}<v>${cost}</v></c><c r="G7"><v>4.5</v></c><c r="H7"><v>450</v></c></row></sheetData></worksheet>`,
    };
  return Buffer.from(
    zipSync(
      Object.fromEntries(
        Object.entries(parts).map(([name, value]) => [name, strToU8(value)]),
      ),
    ),
  );
}
