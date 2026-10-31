import { sha256 } from "@noble/hashes/sha2.js";

type NativeCrypto = Pick<Crypto, "getRandomValues"> & Partial<Pick<Crypto, "randomUUID" | "subtle">>;

/** HTTP on a private IP has CSPRNG, but may omit UUID and SubtleCrypto. */
export function createBrowserCrypto(native: NativeCrypto) {
  const getRandomValues = <T extends ArrayBufferView<ArrayBuffer>>(value: T): T => {
    if (!native?.getRandomValues) throw new Error("Secure random generation is unavailable");
    return native.getRandomValues(value);
  };
  return {
    getRandomValues,
    randomUUID(): string {
      if (native.randomUUID) return native.randomUUID();
      const bytes = getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const h = Array.from(bytes, n => n.toString(16).padStart(2, "0")).join("");
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
    subtle: {
      async digest(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
        if (native.subtle) return native.subtle.digest(algorithm, data);
        const name = typeof algorithm === "string" ? algorithm : algorithm.name;
        if (name.toUpperCase() !== "SHA-256")
          throw new DOMException("Only SHA-256 is supported without SubtleCrypto", "NotSupportedError");
        const bytes = ArrayBuffer.isView(data)
          ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
          : new Uint8Array(data);
        return Uint8Array.from(sha256(bytes)).buffer;
      },
    },
  };
}

export const browserCrypto = createBrowserCrypto(globalThis.crypto);

export async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const active = document.activeElement;
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.cssText = "position:fixed;top:0;left:0;opacity:0;pointer-events:none";
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand("copy")) throw new Error("Clipboard access is unavailable");
  } finally {
    field.remove();
    if (active instanceof HTMLElement) active.focus({ preventScroll: true });
  }
}
