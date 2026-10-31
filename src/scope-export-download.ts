/** Native Desktop and supporting browsers save large archives without a Blob. */
export async function saveScopeArchive(options: {
  path: string; filename: string; signal?: AbortSignal; current: () => void;
  native?: () => Promise<unknown>; fetch: (signal: AbortSignal) => Promise<Response>; unauthorized: () => void;
}) {
  const url = new URL(options.path, "https://scope-export.invalid");
  if (url.origin !== "https://scope-export.invalid" || !/^\/v1\/(?:tenants\/[a-f0-9-]{36}(?:\/projects\/[a-f0-9-]{36})?|admin\/scopes\/(?:projects|tenants)\/[a-f0-9-]{36})\/export-package$/i.test(url.pathname))
    throw new Error("Invalid scope export operation");
  options.current(); options.signal?.throwIfAborted();
  if (options.native) {
    const result = await options.native(); options.current();
    return { saved: !(result && typeof result === "object" && "saved" in result && result.saved === false) };
  }
  const controller = new AbortController(), signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const current = () => { options.current(); signal.throwIfAborted(); };
  let destination: any, output: WritableStream | undefined;
  try {
    const picker = (window as any).showSaveFilePicker;
    if (picker) {
      try { destination = await picker.call(window, { suggestedName: options.filename, types: [{ description: "ZIP archive", accept: { "application/zip": [".zip"] } }] }); }
      catch (error) { if ((error as Error).name === "AbortError") return { saved: false }; throw error; }
    }
    current(); const response = await options.fetch(signal); current();
    if (response.status === 401) { options.unauthorized(); throw new Error("登入已失效，請重新登入 / Please sign in again"); }
    if (!response.ok) {
      const problem = await response.json().catch(() => null);
      throw new Error(problem?.error?.message ?? "無法下載，請更新預覽 / Refresh the preview and retry");
    }
    if (!response.body) throw new Error("Download unavailable");
    const declared = Number(response.headers.get("Content-Length"));
    if (!Number.isSafeInteger(declared) || declared < 1 || declared > 17 * 1024 ** 3) {
      await response.body.cancel(); throw new Error("Invalid export size");
    }
    if (destination) {
      current(); output = await destination.createWritable({ keepExistingData: false });
      let bytes = 0;
      const checked = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, writer) { current(); bytes += chunk.byteLength; if (bytes > declared) throw new Error("Export size changed"); writer.enqueue(chunk); },
        flush() { current(); if (bytes !== declared) throw new Error("Export interrupted"); },
      }));
      await checked.pipeTo(output!, { signal }); output = undefined; current();
    } else {
      if (declared > 64 * 1024 ** 2) { await response.body.cancel(); throw new Error("大型匯出請使用 Chrome、Edge 的檔案儲存功能或 Desktop / Use Chrome, Edge or Desktop to save this large archive"); }
      const blob = await response.blob(); current();
      if (blob.size !== declared) throw new Error("Export interrupted");
      const url = URL.createObjectURL(blob), link = document.createElement("a");
      try { link.href = url; link.download = options.filename; link.click(); } finally { URL.revokeObjectURL(url); }
    }
    return { saved: true };
  } catch (error) {
    controller.abort(); if (output) await output.abort().catch(() => {}); throw error;
  }
}
