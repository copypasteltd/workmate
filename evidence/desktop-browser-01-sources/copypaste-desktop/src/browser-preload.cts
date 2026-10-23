const { contextBridge, ipcRenderer } = require("electron");
const actions = new Set(["state","navigate","back","forward","reload","dialog","minimize","maximize","close"]);
contextBridge.exposeInMainWorld("nativeBrowser", {
  action: (action: string,value?: string|boolean) => {
    if(!actions.has(action) || (value!==undefined && !["string","boolean"].includes(typeof value))) return Promise.reject(new Error("BROWSER_INPUT_INVALID"));
    return ipcRenderer.invoke("native-browser:action",action,value);
  },
  onState: (callback: (state: unknown)=>void) => {
    const listener=(_event: unknown,state: unknown)=>callback(state);
    ipcRenderer.on("native-browser:state",listener);
    return ()=>ipcRenderer.removeListener("native-browser:state",listener);
  },
});
