import { createContext, useEffect, useState } from "react";
import { api } from "./api";

export const ClientContentContext = createContext<{ items: any[] }>({
  items: [],
});
export function useClientContent(
  user: string | undefined,
  tenant: string,
  project: string,
) {
  const [value, setValue] = useState<{ scope: string; items: any[] } | null>(
    null,
  );
  const client = window.copyPasteBridge ? "desktop" : "web";
  const scope = [user, tenant, project, client].join(":");
  useEffect(() => {
    if (!user) return;
    let active = true,
      inFlight = false;
    const controller = new AbortController();
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const query = new URLSearchParams({ client });
        if (project) query.set("project_id", project);
        const result = await api("/v1/client-content?" + query, {
          signal: controller.signal,
          headers: tenant ? { "X-Tenant-ID": tenant } : {},
        });
        if (active) setValue({ scope, items: result.items });
      } catch {
        if (active) setValue({ scope, items: [] });
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 15000);
    const end = () => {
      active = false;
      controller.abort();
      setValue(null);
    };
    window.addEventListener("copypaste:session-ended", end);
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("copypaste:session-ended", end);
    };
  }, [user, tenant, project, client, scope]);
  return value?.scope === scope && user ? value : { items: [] };
}
