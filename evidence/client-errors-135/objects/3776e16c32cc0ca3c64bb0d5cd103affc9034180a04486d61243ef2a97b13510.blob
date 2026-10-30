import childProcess, { type ChildProcessWithoutNullStreams } from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { realpath } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

export interface OwnedNativeProcess {
  child: ChildProcessWithoutNullStreams;
  spawnedAt: number;
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
      const row: OwnedNativeProcess = { child, spawnedAt: Date.now(), closed: false, exitCode: null, signal: null,
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
