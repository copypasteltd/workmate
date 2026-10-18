import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld(
  "copyPasteBridge",
  Object.freeze({
    version: "0.1.0",
    enableChrome: () => ipcRenderer.invoke("chrome:register"),
    request: (p: string, o: unknown) => ipcRenderer.invoke("api", p, o),
    signIn: () => ipcRenderer.invoke("auth:signin"),
    signOut: () => ipcRenderer.invoke("auth:signout"),
    chooseDirectory: () => ipcRenderer.invoke("files:choose"),
    localGrants: () => ipcRenderer.invoke("files:grants"),
    revokeGrant: (id: string) => ipcRenderer.invoke("files:revoke", id),
    localFile: (c: unknown) => ipcRenderer.invoke("files:execute", c),
    syncDevice: (t: string) => ipcRenderer.invoke("device:sync", t),
    upload: (p: string, b: unknown) => ipcRenderer.invoke("asset:upload", p, b),
    download: (p: string, n: string) =>
      ipcRenderer.invoke("asset:download", p, n),
    openExternal: (u: string) => ipcRenderer.invoke("external", u),
    onAuthChanged: (fn: () => void) => {
      ipcRenderer.on("auth:changed", fn);
      return () => ipcRenderer.removeListener("auth:changed", fn);
    },
  }),
);
