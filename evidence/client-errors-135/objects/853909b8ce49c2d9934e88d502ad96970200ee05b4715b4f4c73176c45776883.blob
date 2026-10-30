import { useEffect, useState } from "react";
import { api } from "./api";

type CloudView = {
  frame: null | { png_base64: string; sequence: string; freshness_milliseconds: number };
  lease_remaining_milliseconds: number;
  commands: { id: string; state: string; result: string | null }[];
};

/** Use elapsed browser time, never the customer's wall clock, for private
 * pixels. Subtract the entire request duration conservatively from the
 * server's remaining freshness; a stalled response cannot revive old pixels. */
export function useCloudComputerView(url: string | null, refresh: number) {
  const [snapshot, setSnapshot] = useState<{
    url: string;
    data: CloudView;
    frameExpiresAt: number;
  } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    let live = true;
    let pending: AbortController | undefined;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const clock = setInterval(() => setNow(performance.now()), 250);
    setSnapshot(null);
    setError(null);
    async function load() {
      if (!url || !live) return;
      const started = performance.now();
      pending = new AbortController();
      const timeout = setTimeout(() => pending?.abort(), 3000);
      try {
        const data = await api<CloudView>(url, { signal: pending.signal });
        if (!live) return;
        const freshness = data.frame?.freshness_milliseconds;
        const lease = data.lease_remaining_milliseconds;
        const remaining = Number.isFinite(freshness) && Number.isFinite(lease)
          ? Math.max(0, Math.min(5000, freshness!, lease)) : 0;
        setSnapshot({ url, data, frameExpiresAt: started + remaining });
        setNow(performance.now());
        setError(null);
      } catch (e) {
        if (live) {
          setSnapshot(null);
          setError(e as Error);
        }
      } finally {
        clearTimeout(timeout);
        if (live) pollTimer = setTimeout(load, 1500);
      }
    }
    void load();
    return () => {
      live = false;
      pending?.abort();
      clearInterval(clock);
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [url, refresh]);
  const current = snapshot?.url === url ? snapshot : null;
  return {
    data: current ? {
      ...current.data,
      frame: now < current.frameExpiresAt ? current.data.frame : null,
    } : null,
    error,
  };
}
