import catalog from "../contracts/product-downloads.json";

/** Versioned public artifacts are published with the page, never inferred from a URL. */
export const productDownloads = catalog;
export const desktopSetup = catalog.desktop.artifacts.find((a) => a.kind === "setup")!;
export const desktopPortable = catalog.desktop.artifacts.find((a) => a.kind === "portable")!;
export function downloadSize(bytes: number) {
  return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;
}
