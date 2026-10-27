const { contextBridge, ipcRenderer } = require("electron");
// Electron replaces prompt() with a throwing function. Restore that one web
// feature through a narrowly validated, task-owned dialog; no generic IPC API.
contextBridge.exposeInMainWorld("__copypastePrompt", (message: unknown = "", initial: unknown = "") => {
  if (!["string","number","boolean"].includes(typeof message) || !["string","number","boolean"].includes(typeof initial)) return null;
  return ipcRenderer.sendSync("native-browser:prompt", { message: String(message).slice(0,2000), defaultPrompt: String(initial).slice(0,4096) });
});
const restorePrompt = () => contextBridge.executeInMainWorld({ func: () => {
  (window as any).prompt = (message: unknown = "", initial: unknown = "") => (window as any).__copypastePrompt(message, initial);
} });
// Electron's own window setup runs around preload initialization. Restore at
// DOM readiness as well; the CDP new-document script covers inline page code.
restorePrompt();
window.addEventListener("DOMContentLoaded", restorePrompt, { once: true });
