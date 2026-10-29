/** Valid customer-declared brand with the repository's fixed OFL font. */
export function presetBrandDefinition(tone = "PRESET_BRAND_ORIGINAL_GUIDANCE") {
  return { schema_version: 2, name: "Preset brand", colors: ["#1F5EFF", "#F6F6F4"], tone,
    approved_copy: "Approved product facts only", fonts: [], logos: [],
    font_bindings: [{ key: "headline", label: "Noto Sans TC", source: { builtin: "noto-sans-tc" },
      rights: { source: "Repository fixed font and OFL", license: "SIL Open Font License 1.1", channels: ["social"], valid_until: null } }],
    facts: [{ key: "offer", sku: "SKU-01", kind: "promotion", text: "Approved offer", amount_minor: 12800, currency: "HKD", valid_from: "2020-01-01T00:00:00Z", valid_until: "2099-01-01T00:00:00Z" }],
    locales: ["zh-Hant-HK", "en-HK"], channels: ["social"], restrictions: "Never change the approved price" };
}
