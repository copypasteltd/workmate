import childProcess, { type ChildProcessWithoutNullStreams } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { realpath } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

export interface OwnedNativeProcess {
  child: ChildProcessWithoutNullStreams;
  closed: boolean;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  closedAt?: number;
  wait: Promise<void>;
}

/** Observe only the actual pinned executable and this test's private cwd. */
export async function withOwnedNativeProcesses<T>(
  executable: string,
  workspaceRoot: string,
  onSpawn: (process: OwnedNativeProcess, index: number) => void,
  run: (processes: OwnedNativeProcess[]) => Promise<T>,
): Promise<T> {
  const binary = await realpath(executable);
  const root = path.resolve(workspaceRoot);
  const fold = (s: string) => process.platform === "win32" ? s.toLowerCase() : s;
  const original = childProcess.spawn;
  const owned: OwnedNativeProcess[] = [];
  childProcess.spawn = ((file: string, args: string[], options: any) => {
    const child = original(file, args, options) as ChildProcessWithoutNullStreams;
    const cwd = path.resolve(options?.cwd ?? process.cwd());
    if (fold(path.resolve(file)) === fold(binary) && args?.[0] === "app-server"
      && (fold(cwd) === fold(root) || fold(cwd).startsWith(fold(root + path.sep)))) {
      let finish!: () => void;
      const row: OwnedNativeProcess = { child, closed: false, exitCode: null, signal: null,
        wait: new Promise<void>(resolve => { finish = resolve; }) };
      child.once("close", (code, signal) => {
        row.closed = true; row.exitCode = code; row.signal = signal; row.closedAt = Date.now(); finish();
      });
      owned.push(row);
      onSpawn(row, owned.length);
    }
    return child;
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  try { return await run(owned); }
  finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
    for (const row of owned) {
      if (!row.closed) row.child.kill("SIGKILL");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([row.wait, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Owned native test process did not close")), 10000);
        })]);
      } finally { if (timer) clearTimeout(timer); }
      assert.equal(row.closed, true, "Every actual native child must be reclaimed");
    }
  }
}

/** Pause only the newly captured child, never a discovered user process. */
export function suspendOwnedNative(row: OwnedNativeProcess, executable: string) {
  const pid = row.child.pid;
  assert.ok(pid && !row.closed && row.child.exitCode === null);
  if (process.platform !== "win32") {
    process.kill(pid, "SIGSTOP");
    return;
  }
  const code = `
import ctypes, os, sys, time
from ctypes import wintypes
pid, expected, earliest = int(sys.argv[1]), os.path.normcase(os.path.realpath(sys.argv[2])), int(sys.argv[3])
k = ctypes.WinDLL('kernel32', use_last_error=True)
n = ctypes.WinDLL('ntdll')
k.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
k.OpenProcess.restype = wintypes.HANDLE
k.QueryFullProcessImageNameW.argtypes = [wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR, ctypes.POINTER(wintypes.DWORD)]
k.GetProcessTimes.argtypes = [wintypes.HANDLE] + [ctypes.POINTER(wintypes.FILETIME)] * 4
k.CloseHandle.argtypes = [wintypes.HANDLE]
n.NtSuspendProcess.argtypes = [wintypes.HANDLE]
n.NtSuspendProcess.restype = ctypes.c_long
h = k.OpenProcess(0x0800 | 0x1000, False, pid)
if not h: raise ctypes.WinError(ctypes.get_last_error())
try:
    name, size = ctypes.create_unicode_buffer(32768), wintypes.DWORD(32768)
    if not k.QueryFullProcessImageNameW(h, 0, name, ctypes.byref(size)): raise ctypes.WinError(ctypes.get_last_error())
    if os.path.normcase(os.path.realpath(name.value)) != expected: raise RuntimeError('Owned native executable mismatch')
    times = [wintypes.FILETIME() for _ in range(4)]
    if not k.GetProcessTimes(h, *(ctypes.byref(t) for t in times)): raise ctypes.WinError(ctypes.get_last_error())
    created = ((times[0].dwHighDateTime << 32) | times[0].dwLowDateTime) // 10000 - 11644473600000
    if created < earliest - 1500 or created > int(time.time() * 1000) + 1500: raise RuntimeError('Owned native creation time mismatch')
    if n.NtSuspendProcess(h) != 0: raise RuntimeError('Owned native suspension failed')
finally:
    k.CloseHandle(h)
`;
  childProcess.execFileSync(process.env.COPYPASTE_TEST_PYTHON ?? "python", ["-c", code, String(pid), executable, String(Date.now())],
    { windowsHide: true, timeout: 10000, stdio: ["ignore", "pipe", "pipe"] });
}

export function injectNativeFrame(row: OwnedNativeProcess, message: unknown) {
  assert.equal(row.closed, false);
  row.child.stdout.emit("data", Buffer.from(JSON.stringify(message) + "\n"));
}

/** Do not send replies to injected request IDs into the real native server. */
export function captureInjectedReplies(row: OwnedNativeProcess) {
  const replies: any[] = [];
  const stream = row.child.stdin;
  const write = stream.write;
  stream.write = function (...args: any[]) {
    let value: any;
    try { value = JSON.parse(Buffer.isBuffer(args[0]) ? args[0].toString() : args[0]); } catch {}
    if (typeof value?.id === "string" && value.id.startsWith("copypaste_fixture_")) {
      replies.push(value);
      const callback = args.find((value, index) => index > 0 && typeof value === "function");
      if (callback) queueMicrotask(() => callback());
      return true;
    }
    return Reflect.apply(write, stream, args);
  } as typeof stream.write;
  return replies;
}

/** Drop a selected RPC at the actual native pipe boundary to model transport failure. */
export function interceptNativeRPC(row: OwnedNativeProcess, method: string,
  onRequest: (request: any, complete: (error?: Error) => void) => void) {
  const stream = row.child.stdin, write = stream.write;
  stream.write = function (...args: any[]) {
    let request: any;
    try { request = JSON.parse(Buffer.isBuffer(args[0]) ? args[0].toString() : args[0]); } catch {}
    if (request?.method === method) {
      const callback = args.find((value, index) => index > 0 && typeof value === "function");
      onRequest(request, error => { if (callback) queueMicrotask(() => callback(error)); });
      return true;
    }
    return Reflect.apply(write, stream, args);
  } as typeof stream.write;
  return () => { stream.write = write; };
}
