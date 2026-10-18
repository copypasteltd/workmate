import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { api } from "./api";
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
  reloadProjects: () => Promise<void>;
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
  const setProject = (id: string) => {
    setProjectState(id);
    localStorage.setItem("cp_project", id);
  };
  const setTenant = (id: string) => {
    setProjects([]);
    setProjectState("");
    setTenantState(id);
    localStorage.setItem("cp_tenant", id);
  };
  const refresh = useCallback(async () => {
    try {
      const m = await api("/v1/me");
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
      if ((e as any).status === 401) {
        setMe(null);
        setTenantState("");
        setProjectState("");
        setProjects([]);
      } else setError(e as Error);
    } finally {
      setLoading(false);
    }
  }, []);
  const reloadProjects = useCallback(async () => {
    if (!tenant) return;
    const d = await api(`/v1/tenants/${tenant}/projects`);
    setProjects(d.items);
    const saved = localStorage.getItem("cp_project");
    setProjectState((old) =>
      d.items.some((p: any) => p.id === old)
        ? old
        : d.items.some((p: any) => p.id === saved)
          ? saved
          : (d.items[0]?.id ?? ""),
    );
  }, [tenant]);
  useEffect(() => {
    void refresh();
    const off = window.copyPasteBridge?.onAuthChanged(() => void refresh());
    return () => off?.();
  }, [refresh]);
  useEffect(() => {
    let live = true;
    setProjects([]);
    setProjectState("");
    if (!tenant) return;
    void api(`/v1/tenants/${tenant}/projects`)
      .then((d) => {
        if (!live) return;
        setProjects(d.items);
        const saved = localStorage.getItem("cp_project");
        setProjectState(
          d.items.some((p: any) => p.id === saved)
            ? saved
            : (d.items[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (live) setError(e);
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
