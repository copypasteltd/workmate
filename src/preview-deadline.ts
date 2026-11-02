/** Return ownership to cleanup when an unresponsive browser protocol ignores
 * its normal reply timeout. The caller still closes the context and verifies
 * the independent native guardian's empty job receipt. */
export async function withinPreviewDeadline<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  if (signal.aborted) throw new Error("PREVIEW_STOPPED");
  let abort!: () => void;
  const stopped = new Promise<never>((_resolve, reject) => {
    abort = () => reject(new Error("PREVIEW_STOPPED"));
    signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work(), stopped]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}
