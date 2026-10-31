import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
import { api, changeClientSession, endClientSession } from "./api";
interface WorkspaceState {
  me: any;
  loading: boolean;
  error: Error | null;
  tenant: string;
  project: string;
  projects: any[];
  refresh: () => Promise<void>;
  setTenant: (id: string) => void;
  setProject: (id: string) => void;
  reloadProjects: (preferredProject?: string) => Promise<void>;
  base: string;
}
const Context = createContext<WorkspaceState>(null!);
export const useWorkspace = () => useContext(Context);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<any>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState<Error | null>(null);
  const [tenant, setTenantState] = useState(""),
    [project, setProjectState] = useState(""),
    [projects, setProjects] = useState<any[]>([]);
  const loadRevision = useRef(0);
  const projectLoadRevision = useRef(0);
  const tenantRef = useRef(tenant);
  tenantRef.current = tenant;
  const clear = useCallback(() => {
    ++loadRevision.current;
    ++projectLoadRevision.current;
    tenantRef.current = "";
    setMe(null);
    setTenantState("");
    setProjectState("");
    setProjects([]);
    setError(null);
    setLoading(false);
    localStorage.removeItem("cp_tenant");
    localStorage.removeItem("cp_project");
  }, []);
  const setProject = (id: string) => {
    setProjectState(id);
    localStorage.setItem("cp_project", id);
  };
  const setTenant = (id: string) => {
    ++projectLoadRevision.current;
    tenantRef.current = id;
    setProjects([]);
    setProjectState("");
    setTenantState(id);
    localStorage.setItem("cp_tenant", id);
  };
  const refresh = useCallback(async () => {
    const revision = ++loadRevision.current;
    try {
      const m = await api("/v1/session/context");
      if (revision !== loadRevision.current) return;
      setMe(m);
      setError(null);
      const saved = localStorage.getItem("cp_tenant");
      setTenantState((old) =>
        m.memberships.some((t: any) => t.id === old)
          ? old
          : m.memberships.some((t: any) => t.id === saved)
            ? saved
            : (m.memberships[0]?.id ?? ""),
      );
    } catch (e) {
      if (
        revision !== loadRevision.current ||
        (e as any).code === "SESSION_CHANGED"
      )
        return;
      if ((e as any).status === 401) {
        clear();
      } else setError(e as Error);
    } finally {
      if (revision === loadRevision.current) setLoading(false);
    }
  }, [clear]);
  const reloadProjects = useCallback(async (preferredProject?: string) => {
    if (!tenant) return;
    const revision = ++projectLoadRevision.current;
    const d = await api(`/v1/tenants/${tenant}/projects`);
    if (tenantRef.current !== tenant || revision !== projectLoadRevision.current)
      return;
    setProjects(d.items);
    const preferred = preferredProject && d.items.some((p: any) => p.id === preferredProject) ? preferredProject : "";
    if (preferred) localStorage.setItem("cp_project", preferred);
    const saved = localStorage.getItem("cp_project");
    setProjectState((old) => preferred || (
      d.items.some((p: any) => p.id === old)
        ? old
        : d.items.some((p: any) => p.id === saved)
          ? saved
          : (d.items[0]?.id ?? "")
    ));
  }, [tenant]);
  useEffect(() => {
    window.addEventListener("copypaste:session-ended", clear);
    void refresh();
    const changed = () => {
      changeClientSession();
      clear();
      void refresh();
    };
    const off = window.copyPasteBridge?.onAuthChanged(changed);
    const storage = (event: StorageEvent) => {
      if (event.key !== "cp_auth_event" || !event.newValue) return;
      try {
        const value = JSON.parse(event.newValue);
        if (value.kind === "signed_out") endClientSession(false);
        else if (value.kind === "signed_in") changed();
      } catch {
        /* No credentials or identities are accepted from storage events. */
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("storage", storage);
    document.addEventListener("visibilitychange", visible);
    return () => {
      off?.();
      window.removeEventListener("copypaste:session-ended", clear);
      window.removeEventListener("storage", storage);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh, clear]);
  useEffect(() => {
    let live = true;
    const revision = ++projectLoadRevision.current;
    setProjects([]);
    setProjectState("");
    if (!tenant) return;
    void api(`/v1/tenants/${tenant}/projects`)
      .then((d) => {
        if (!live || revision !== projectLoadRevision.current || tenantRef.current !== tenant) return;
        setProjects(d.items);
        const saved = localStorage.getItem("cp_project");
        setProjectState(
          d.items.some((p: any) => p.id === saved)
            ? saved
            : (d.items[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (live && revision === projectLoadRevision.current && tenantRef.current === tenant) setError(e);
      });
    return () => {
      live = false;
    };
  }, [tenant]);
  return (
    <Context.Provider
      value={{
        me,
        loading,
        error,
        tenant,
        project,
        projects,
        refresh,
        setTenant,
        setProject,
        reloadProjects,
        base:
          tenant && project ? `/v1/tenants/${tenant}/projects/${project}` : "",
      }}
    >
      {children}
    </Context.Provider>
  );
}
