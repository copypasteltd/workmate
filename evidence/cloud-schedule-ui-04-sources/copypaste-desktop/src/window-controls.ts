import {
  ipcMain,
  screen,
  type BrowserWindow,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type Rectangle,
} from "electron";

export const windowAppearance = Object.freeze({
  frame: false,
  thickFrame: false,
  autoHideMenuBar: true,
});

const edges = new Set(["n", "ne", "e", "se", "s", "sw", "w", "nw"]);
const coordinate = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && Math.abs(n) <= 1_000_000;

// Resize only this window, retaining the opposite corner at minimum dimensions.
export function resizedBounds(
  b: Rectangle,
  edge: string,
  dx: number,
  dy: number,
  area: Rectangle,
): Rectangle {
  const width = Math.max(
    800,
    Math.min(
      Math.max(800, area.width),
      b.width + (edge.includes("w") ? -dx : edge.includes("e") ? dx : 0),
    ),
  );
  const height = Math.max(
    600,
    Math.min(
      Math.max(600, area.height),
      b.height + (edge.includes("n") ? -dy : edge.includes("s") ? dy : 0),
    ),
  );
  return {
    x: edge.includes("w") ? b.x + b.width - width : b.x,
    y: edge.includes("n") ? b.y + b.height - height : b.y,
    width,
    height,
  };
}

export function attachWindowControls(win: BrowserWindow) {
  const trusted = (e: IpcMainEvent | IpcMainInvokeEvent) =>
    !win.isDestroyed() &&
    e.sender === win.webContents &&
    e.senderFrame === win.webContents.mainFrame;
  const state = () => ({
    maximized: win.isMaximized(),
    minimized: win.isMinimized(),
    fullscreen: win.isFullScreen(),
  });
  let drag:
    | { edge: string; x: number; y: number; bounds: Rectangle }
    | undefined;
  const publish = () => {
    drag = undefined;
    if (!win.isDestroyed()) win.webContents.send("window:state", state());
  };
  const command = (e: IpcMainInvokeEvent, action: unknown) => {
    if (!trusted(e))
      throw new Error(
        "Window control is restricted to the main application frame",
      );
    if (action === "state") return state();
    if (action === "minimize") win.minimize();
    else if (action === "toggle-maximize") {
      if (win.isFullScreen()) win.setFullScreen(false);
      else if (win.isMaximized()) win.unmaximize();
      else win.maximize();
    } else if (action === "close") win.close();
    else throw new Error("Unknown window command");
    return { ok: true };
  };
  const resize = (e: IpcMainEvent, p: any) => {
    if (!trusted(e) || !p || win.isMaximized() || win.isFullScreen()) return;
    if (p.kind === "end") {
      drag = undefined;
      return;
    }
    if (
      p.kind === "begin" &&
      edges.has(p.edge) &&
      coordinate(p.x) &&
      coordinate(p.y)
    ) {
      drag = { edge: p.edge, x: p.x, y: p.y, bounds: win.getBounds() };
    } else if (
      p.kind === "move" &&
      drag &&
      coordinate(p.x) &&
      coordinate(p.y)
    ) {
      win.setBounds(
        resizedBounds(
          drag.bounds,
          drag.edge,
          p.x - drag.x,
          p.y - drag.y,
          screen.getDisplayMatching(drag.bounds).workArea,
        ),
      );
    } else if (
      p.kind === "nudge" &&
      edges.has(p.edge) &&
      coordinate(p.dx) &&
      coordinate(p.dy) &&
      Math.abs(p.dx) <= 50 &&
      Math.abs(p.dy) <= 50
    ) {
      const b = win.getBounds();
      win.setBounds(
        resizedBounds(
          b,
          p.edge,
          p.dx,
          p.dy,
          screen.getDisplayMatching(b).workArea,
        ),
      );
    }
  };
  ipcMain.handle("window:command", command);
  ipcMain.on("window:resize", resize);
  win.on("maximize", publish);
  win.on("unmaximize", publish);
  win.on("minimize", publish);
  win.on("restore", publish);
  win.on("enter-full-screen", publish);
  win.on("leave-full-screen", publish);
  win.on("blur", () => {
    drag = undefined;
  });
  win.on("closed", () => {
    drag = undefined;
    ipcMain.removeHandler("window:command");
    ipcMain.removeListener("window:resize", resize);
  });
}
