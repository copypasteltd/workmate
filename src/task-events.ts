import { useEffect, useRef, useState } from "react";
import { api, ApiError, clientSessionGeneration, endClientSession } from "./api";

export function useTaskEvents(
  base: string,
  tenant: string,
  task: string | undefined,
  onChange: () => void,
) {
  const [items, setItems] = useState<any[]>([]),
    [error, setError] = useState<Error | null>(null),
    [state, setState] = useState("connecting");
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    const abort = new AbortController();
    let after = 0,
      refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const signal = abort.signal;
    const generation = clientSessionGeneration();
    const current = () => !signal.aborted && generation === clientSessionGeneration();
    const wait = (ms: number) =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          signal.removeEventListener("abort", done);
          resolve();
        };
        const timer = setTimeout(done, ms);
        signal.addEventListener("abort", done, { once: true });
        if (signal.aborted) done();
      });
    const invalidate = () => {
      refreshTimer ??= setTimeout(() => {
        refreshTimer = undefined;
        if (current()) changed.current();
      }, 350);
    };
    const merge = (batch: any[]) => {
      if (!current()) return;
      setItems((old) =>
        [
          ...new Map([...old, ...batch].map((e) => [String(e.id), e])).values(),
        ].slice(-400),
      );
    };
    setItems([]);
    setError(null);
    setState("connecting");
    const run = async () => {
      while (current() && task) {
        try {
          if (window.copyPasteBridge) {
            // Native IPC remains JSON-only. Drain every page with a cursor;
            // never repeatedly request the first 200 historical events.
            let batch: any[] = [];
            do {
              const data = await api(
                `${base}/tasks/${task}/events?after=${after}`,
                { signal },
              );
              batch = data.items;
              merge(batch);
              if (batch.length) after = Number(batch.at(-1).id);
            } while (batch.length === 200 && !signal.aborted);
            if (current()) {
              setState("polling");
              invalidate();
              await wait(2500);
            }
            continue;
          }
          const r = await fetch(
            (import.meta.env.VITE_API_BASE ?? "") + `/v1/tasks/${task}/events`,
            {
              credentials: "include",
              headers: {
                "X-Tenant-ID": tenant,
                "Last-Event-ID": String(after),
              },
              signal,
            },
          );
          if (!current()) {
            await r.body?.cancel().catch(() => {});
            break;
          }
          if (r.status === 410) {
            const snapshot = await api(`${base}/tasks/${task}`, { signal });
            after = Number(snapshot.last_event_seq ?? 0);
            if (current()) {
              setItems([]);
              setState("snapshot");
              invalidate();
            }
            continue;
          }
          if (!r.ok)
            throw new ApiError(
              "EVENT_STREAM_UNAVAILABLE",
              "Progress stream unavailable",
              r.status,
            );
          if (current()) {
            setState("live");
            setError(null);
          }
          const reader = r.body!.getReader(),
            decoder = new TextDecoder();
          let pending = "";
          try {
            while (!signal.aborted) {
              const chunk = await reader.read();
              if (!current() || chunk.done) break;
              pending += decoder.decode(chunk.value, { stream: true });
              if (pending.length > 2 * 1024 * 1024)
                throw new Error("Progress event exceeds the display limit");
              const frames = pending.split("\n\n");
              pending = frames.pop()!;
              const batch: any[] = [];
              for (const frame of frames) {
                const lines = frame.split("\n"),
                  body = lines.find((l) => l.startsWith("data: "));
                if (!body) continue;
                const e = JSON.parse(body.slice(6));
                if (lines.includes("event: stream.reset"))
                  throw new ApiError(
                    e.code,
                    "Progress access changed; refresh your session",
                    ["AUTH_REQUIRED", "SESSION_EXPIRED"].includes(e.code)
                      ? 401
                      : e.code === "EVENT_CURSOR_EXPIRED"
                        ? 410
                        : 403,
                  );
                if (
                  e.task_id !== task ||
                  e.tenant_id !== tenant ||
                  !Number.isSafeInteger(e.seq) ||
                  e.seq <= after
                )
                  continue;
                after = e.seq;
                batch.push({
                  id: e.seq,
                  kind: e.type,
                  body: e.payload,
                  created_at: e.occurred_at,
                });
              }
              if (batch.length) {
                merge(batch);
                invalidate();
              }
            }
          } finally {
            await reader.cancel().catch(() => {});
          }
        } catch (e) {
          if (!current()) break;
          if (e instanceof ApiError && e.status === 401) {
            endClientSession(false, "expired");
            return;
          }
          if (e instanceof ApiError && e.status === 410) {
            const snapshot = await api(`${base}/tasks/${task}`, { signal });
            if (!current()) break;
            after = Number(snapshot.last_event_seq ?? 0);
            setItems([]);
            invalidate();
            continue;
          }
          if (e instanceof ApiError && [401, 403, 404].includes(e.status)) {
            setItems([]);
            setError(e);
            setState("unavailable");
            return;
          }
          setState("reconnecting");
        }
        if (current()) await wait(1500);
      }
    };
    void run().catch((e) => {
      if (current()) {
        setError(e);
        setState("unavailable");
      }
    });
    return () => {
      abort.abort();
      if (refreshTimer) clearTimeout(refreshTimer);
    };
  }, [base, tenant, task]);
  return { data: { items }, error, state };
}
