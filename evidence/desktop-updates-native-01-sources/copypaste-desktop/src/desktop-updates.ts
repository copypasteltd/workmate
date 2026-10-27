import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, realpath, open, rename, unlink } from "node:fs/promises";
import path from "node:path";
import {
  verifyUpdateEnvelope,
  parseUpdateKeys,
  updateCanonical,
  releaseForInstallation,
  UpdateError,
  type UpdateEnvelope,
} from "./desktop-update-contract.js";
import { UpdateAdmission } from "./update-admission.js";

export interface UpdateJournal {
  schema: 1;
  installationId: string;
  channels: Partial<
    Record<"stable" | "preview", { sequence: number; envelope_sha256: string }>
  >;
  prepared?: UpdateEnvelope;
  lastInstallation?: {
    sequence: number;
    version: string;
    requested_at: string;
  };
}
export interface UpdateStatus {
  current_version: string;
  channel: "stable" | "preview";
  state:
    | "disabled"
    | "idle"
    | "checking"
    | "available"
    | "current"
    | "downloading"
    | "verifying"
    | "ready"
    | "installing"
    | "error";
  code?: string;
  received_bytes: number;
  total_bytes: number;
  release?: UpdateEnvelope["payload"];
  installer_supported: boolean;
}
interface UpdateIO {
  origin: string;
  cache: string;
  version: string;
  channel: "stable" | "preview";
  keys: Record<string, string>;
  minimumSequence: number;
  installerSupported: boolean;
  read(): Promise<UpdateJournal | null>;
  write(value: UpdateJournal): Promise<void>;
  checkpoint(): Promise<{ safe: boolean }>;
  confirm(envelope: UpdateEnvelope): Promise<boolean>;
  verifyInstaller(file: string, sha256: string, signer: string): Promise<void>;
  install(file: string, sha256: string, signer: string): Promise<void>;
  changed(): void;
  fetch?: typeof fetch;
}
const sha = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
const code = (e: any) =>
  e instanceof UpdateError
    ? e.code
    : e?.name === "AbortError"
      ? "UPDATE_CANCELLED"
      : "UPDATE_SERVICE_UNAVAILABLE";
export class DesktopUpdateController {
  private journal?: UpdateJournal;
  private loading?: Promise<UpdateJournal>;
  private operation?: Promise<UpdateStatus>;
  private abort?: AbortController;
  private selected?: UpdateEnvelope;
  private closed = false;
  private state: UpdateStatus;
  private network: typeof fetch;
  constructor(
    private io: UpdateIO,
    private admission: UpdateAdmission,
  ) {
    parseUpdateKeys(io.keys);
    const origin = new URL(io.origin);
    if (
      origin.origin !== io.origin ||
      origin.username ||
      origin.password ||
      (origin.protocol !== "https:" &&
        !(
          origin.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(origin.hostname)
        ))
    )
      throw new UpdateError("UPDATE_ORIGIN_INVALID");
    this.network = io.fetch ?? fetch;
    this.state = {
      current_version: io.version,
      channel: io.channel,
      state: Object.keys(io.keys).length ? "idle" : "disabled",
      received_bytes: 0,
      total_bytes: 0,
      installer_supported: io.installerSupported,
    };
  }
  private async saved() {
    if (this.journal) return this.journal;
    this.loading ??= (async () => {
      const j = (await this.io.read()) ?? {
        schema: 1,
        installationId: randomUUID(),
        channels: {},
      };
      if (
        j.schema !== 1 ||
        !/^[a-f0-9-]{36}$/.test(j.installationId) ||
        !j.channels ||
        Object.keys(j.channels).some(
          (k) => !["stable", "preview"].includes(k),
        ) ||
        Object.values(j.channels).some(
          (v) =>
            !v ||
            !Number.isSafeInteger(v.sequence) ||
            v.sequence < 1 ||
            !/^[a-f0-9]{64}$/.test(v.envelope_sha256),
        )
      )
        throw new UpdateError("UPDATE_STATE_INVALID");
      await this.io.write(j);
      return (this.journal = j);
    })();
    return this.loading;
  }
  private change(value: Partial<UpdateStatus>) {
    Object.assign(this.state, value);
    this.io.changed();
  }
  status() {
    return structuredClone(this.state);
  }
  private exclusive(action: () => Promise<void>) {
    if (this.operation)
      return Promise.reject(new UpdateError("UPDATE_OPERATION_BUSY"));
    if (this.closed)
      return Promise.reject(new UpdateError("UPDATE_APP_CLOSED"));
    this.operation = (async () => {
      try {
        await action();
      } catch (error) {
        this.change({ state: "error", code: code(error) });
      } finally {
        this.operation = undefined;
        this.abort = undefined;
      }
      return this.status();
    })();
    return this.operation;
  }
  private async cache() {
    await mkdir(this.io.cache, { recursive: true });
    const actual = await realpath(this.io.cache);
    if (
      (await lstat(this.io.cache)).isSymbolicLink() ||
      path.resolve(actual).toLowerCase() !==
        path.resolve(this.io.cache).toLowerCase()
    )
      throw new UpdateError("UPDATE_CACHE_INVALID");
    return actual;
  }
  private async installer(e: UpdateEnvelope) {
    if (!e.payload?.release || !/^[a-f0-9]{64}$/.test(e.payload.release.sha256))
      throw new UpdateError("UPDATE_CACHE_INVALID");
    const file = path.join(
      await this.cache(),
      e.payload.release!.sha256 + ".exe",
    );
    try {
      const s = await lstat(file);
      if (!s.isFile() || s.isSymbolicLink())
        throw new UpdateError("UPDATE_CACHE_INVALID");
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
    return file;
  }
  private async latest(signal: AbortSignal) {
    const j = await this.saved();
    const result = await this.network(
      this.io.origin + "/v1/public/desktop-updates/" + this.io.channel,
      {
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal,
        headers: { Accept: "application/json" },
      },
    );
    if (
      !result.ok ||
      !result.headers.get("content-type")?.includes("application/json") ||
      !result.body
    )
      throw new UpdateError("UPDATE_SERVICE_UNAVAILABLE");
    const reader = result.body.getReader();
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 18000) throw new UpdateError("UPDATE_MANIFEST_INVALID");
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    let body: any;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new UpdateError("UPDATE_MANIFEST_INVALID");
    }
    if (
      !body ||
      Object.keys(body).length !== 1 ||
      !Object.hasOwn(body, "envelope")
    )
      throw new UpdateError("UPDATE_MANIFEST_INVALID");
    if (body.envelope === null) {
      if (j.channels[this.io.channel])
        throw new UpdateError("UPDATE_RELEASE_UNAVAILABLE");
      return null;
    }
    const prior = j.channels[this.io.channel];
    const e = verifyUpdateEnvelope(body.envelope, this.io.keys, {
      channel: this.io.channel,
      minimumSequence: Math.max(prior?.sequence ?? 0, this.io.minimumSequence),
    });
    const hash = sha(updateCanonical(e));
    if (
      prior?.sequence === e.payload.sequence &&
      prior.envelope_sha256 !== hash
    )
      throw new UpdateError("UPDATE_SEQUENCE_CONFLICT");
    j.channels[this.io.channel] = {
      sequence: e.payload.sequence,
      envelope_sha256: hash,
    };
    await this.io.write(j);
    return e;
  }
  check() {
    return this.exclusive(async () => {
      if (!Object.keys(this.io.keys).length) {
        this.change({ state: "disabled", code: "UPDATE_TRUST_NOT_CONFIGURED" });
        return;
      }
      this.change({
        state: "checking",
        code: undefined,
        release: undefined,
        received_bytes: 0,
        total_bytes: 0,
      });
      this.selected = undefined;
      this.abort = new AbortController();
      const e = await this.latest(
        AbortSignal.any([this.abort.signal, AbortSignal.timeout(20000)]),
      );
      if (!e) {
        this.change({ state: "current", code: "UPDATE_NO_RELEASE" });
        return;
      }
      const eligible = releaseForInstallation(
        e,
        this.io.version,
        (await this.saved()).installationId,
      );
      this.selected = e;
      this.change({
        release: e.payload,
        state: eligible.eligible ? "available" : "current",
        code: eligible.code,
        total_bytes: e.payload.release?.bytes ?? 0,
      });
      const prepared = (await this.saved()).prepared;
      if (!eligible.eligible && prepared) {
        await unlink(await this.installer(prepared)).catch((error: any) => {
          if (error.code !== "ENOENT") throw error;
        });
        const j = await this.saved();
        j.prepared = undefined;
        await this.io.write(j);
      }
      if (
        eligible.eligible &&
        prepared &&
        updateCanonical(prepared) === updateCanonical(e)
      ) {
        try {
          await this.io.verifyInstaller(
            await this.installer(e),
            e.payload.release!.sha256,
            e.payload.release!.signer_sha256,
          );
          this.change({
            state: "ready",
            received_bytes: e.payload.release!.bytes,
          });
        } catch {
          (await this.saved()).prepared = undefined;
          await this.io.write(await this.saved());
        }
      }
    });
  }
  download() {
    return this.exclusive(async () => {
      if (
        !this.selected?.payload.release ||
        !["available", "error", "ready"].includes(this.state.state)
      )
        throw new UpdateError("UPDATE_CHECK_REQUIRED");
      const expected = this.selected;
      this.abort = new AbortController();
      const signal = AbortSignal.any([
        this.abort.signal,
        AbortSignal.timeout(15 * 60000),
      ]);
      const latest = await this.latest(signal);
      if (!latest || updateCanonical(latest) !== updateCanonical(expected))
        throw new UpdateError("UPDATE_RELEASE_CHANGED");
      if (
        !releaseForInstallation(
          latest,
          this.io.version,
          (await this.saved()).installationId,
        ).eligible
      )
        throw new UpdateError("UPDATE_RELEASE_CHANGED");
      const r = latest.payload.release!,
        target = await this.installer(latest),
        temporary = path.join(await this.cache(), ".download-" + randomUUID());
      const file = await open(temporary, "wx", 0o600);
      const hash = createHash("sha256");
      let size = 0;
      this.change({
        state: "downloading",
        code: undefined,
        received_bytes: 0,
        total_bytes: r.bytes,
      });
      try {
        const result = await this.network(
          this.io.origin + "/v1/public/desktop-updates/artifacts/" + r.sha256,
          {
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            signal,
            headers: { Accept: "application/octet-stream" },
          },
        );
        if (
          !result.ok ||
          !result.body ||
          result.headers.get("content-length") !== String(r.bytes) ||
          result.headers.get("content-encoding")
        )
          throw new UpdateError("UPDATE_DOWNLOAD_INVALID");
        const reader = result.body.getReader();
        try {
          for (;;) {
            const p = await reader.read();
            if (p.done) break;
            size += p.value.length;
            if (size > r.bytes)
              throw new UpdateError("UPDATE_DOWNLOAD_INVALID");
            hash.update(p.value);
            await file.writeFile(p.value);
            this.change({ received_bytes: size });
          }
        } finally {
          await reader.cancel().catch(() => {});
        }
        if (signal.aborted) throw new UpdateError("UPDATE_CANCELLED");
        if (size !== r.bytes || hash.digest("hex") !== r.sha256)
          throw new UpdateError("UPDATE_ARTIFACT_MISMATCH");
        await file.sync();
        await file.close();
        this.change({ state: "verifying" });
        await this.io.verifyInstaller(temporary, r.sha256, r.signer_sha256);
        if (signal.aborted) throw new UpdateError("UPDATE_CANCELLED");
        const final = await this.latest(signal);
        if (!final || updateCanonical(final) !== updateCanonical(latest))
          throw new UpdateError("UPDATE_RELEASE_CHANGED");
        await unlink(target).catch((error: any) => {
          if (error.code !== "ENOENT") throw error;
        });
        await rename(temporary, target);
        const j = await this.saved(),
          previous = j.prepared;
        j.prepared = final;
        await this.io.write(j);
        if (
          previous?.payload.release?.sha256 &&
          previous.payload.release.sha256 !== r.sha256
        )
          await unlink(await this.installer(previous)).catch((error: any) => {
            if (error.code !== "ENOENT") throw error;
          });
        this.change({ state: "ready", code: undefined });
      } finally {
        await file.close().catch(() => {});
        await unlink(temporary).catch(() => {});
      }
    });
  }
  cancel() {
    this.abort?.abort();
    return this.status();
  }
  discard() {
    return this.exclusive(async () => {
      const j = await this.saved();
      if (j.prepared?.payload.release)
        await unlink(await this.installer(j.prepared)).catch((e: any) => {
          if (e.code !== "ENOENT") throw e;
        });
      j.prepared = undefined;
      await this.io.write(j);
      this.selected = undefined;
      this.change({
        state: "idle",
        release: undefined,
        code: undefined,
        received_bytes: 0,
        total_bytes: 0,
      });
    });
  }
  install() {
    return this.exclusive(async () => {
      if (!this.io.installerSupported)
        throw new UpdateError("UPDATE_MANUAL_INSTALL_REQUIRED");
      const e = this.selected,
        j = await this.saved();
      if (
        this.state.state !== "ready" ||
        !e?.payload.release ||
        !j.prepared ||
        updateCanonical(e) !== updateCanonical(j.prepared)
      )
        throw new UpdateError("UPDATE_DOWNLOAD_REQUIRED");
      // No new turn, file command or watcher dispatch may enter after this synchronous boundary.
      const release = this.admission.acquire();
      let launched = false;
      try {
        if (!(await this.io.checkpoint()).safe)
          throw new UpdateError("UPDATE_LOCAL_WORK_PENDING");
        if (!(await this.io.confirm(e))) return;
        if (!(await this.io.checkpoint()).safe)
          throw new UpdateError("UPDATE_LOCAL_WORK_PENDING");
        this.abort = new AbortController();
        const signal = AbortSignal.any([
          this.abort.signal,
          AbortSignal.timeout(20000),
        ]);
        const latest = await this.latest(signal);
        if (!latest || updateCanonical(e) !== updateCanonical(latest))
          throw new UpdateError("UPDATE_RELEASE_CHANGED");
        const file = await this.installer(e),
          r = e.payload.release;
        await this.io.verifyInstaller(file, r.sha256, r.signer_sha256);
        if (signal.aborted || !(await this.io.checkpoint()).safe)
          throw new UpdateError("UPDATE_LOCAL_WORK_PENDING");
        j.lastInstallation = {
          sequence: e.payload.sequence,
          version: r.version,
          requested_at: new Date().toISOString(),
        };
        await this.io.write(j);
        this.change({ state: "installing", code: undefined });
        // Native helper independently locks and verifies the file again before starting NSIS.
        await this.io.install(file, r.sha256, r.signer_sha256);
        launched = true;
      } finally {
        if (!launched) release();
      }
    });
  }
  async close() {
    this.closed = true;
    this.abort?.abort();
    await this.operation;
  }
}
