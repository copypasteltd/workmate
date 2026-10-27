import { randomUUID, sign } from "node:crypto";
import {
  disconnectProtocol,
  disconnectMessage,
  type DesktopDisconnectRequest,
  type DesktopDisconnectReceipt,
} from "./desktop-disconnect-contract.js";
import type { RegistrationState } from "./chrome-registration.js";

export interface RemovalJournal {
  version: 1;
  pending: DesktopDisconnectRequest[];
  completedAt?: string;
  cache: "retained" | "cleared" | "retry";
  host: RegistrationState | "retry";
  remote: "disconnected" | "pending" | "unverified";
}
export interface RemovalIO {
  read(): Promise<RemovalJournal | null>;
  write(value: RemovalJournal): Promise<void>;
  marked(): Promise<boolean>;
  mark(): Promise<void>;
  unmark(): Promise<void>;
  exclusive<T>(fn: () => Promise<T>): Promise<T>;
  acquire(): () => void;
  block(value: boolean): void;
  confirm(
    clearCache: boolean,
  ): Promise<{ confirmed: boolean; clearCache: boolean }>;
  capture(): Promise<{
    refresh_token?: string;
    private_key?: string;
    devices: Record<string, string>;
  }>;
  withdraw(): Promise<void>;
  unregister(): Promise<RegistrationState>;
  clearCache(): Promise<void>;
  post(request: DesktopDisconnectRequest): Promise<DesktopDisconnectReceipt>;
  changed(): void;
}
export class DesktopRemovalController {
  private flight?: Promise<ReturnType<DesktopRemovalController["view"]>>;
  constructor(private io: RemovalIO) {}
  private initial(): RemovalJournal {
    return {
      version: 1,
      pending: [],
      cache: "retained",
      host: "retry",
      remote: "disconnected",
    };
  }
  private async capture(value: RemovalJournal) {
    const snapshot = await this.io.capture(),
      entries = Object.entries(snapshot.devices).sort(([a], [b]) =>
        a.localeCompare(b),
      );
    if (entries.length && (!snapshot.refresh_token || !snapshot.private_key))
      throw new Error("DISCONNECT_IDENTITY_UNAVAILABLE");
    if (
      snapshot.refresh_token &&
      !value.pending.some(
        (r) =>
          r.refresh_token === snapshot.refresh_token &&
          r.devices.length === entries.length &&
          r.devices.every((d) => snapshot.devices[d.tenant_id] === d.device_id),
      )
    ) {
      for (let start = 0; start < Math.max(1, entries.length); start += 64) {
        const request: DesktopDisconnectRequest = {
          protocol: disconnectProtocol,
          client_id: "desktop",
          request_id: randomUUID(),
          refresh_token: snapshot.refresh_token,
          devices: [],
        };
        request.devices = entries
          .slice(start, start + 64)
          .map(([tenant_id, device_id]) => ({
            tenant_id,
            device_id,
            signature: sign(
              null,
              disconnectMessage(request, { tenant_id, device_id }),
              snapshot.private_key!,
            ).toString("base64url"),
          }));
        value.pending.push(request);
      }
    }
    value.remote = value.pending.length ? "pending" : "disconnected";
  }
  private view(value: RemovalJournal, disabled: boolean) {
    return {
      disabled,
      cancelled: false,
      pending: value.pending.reduce(
        (n, r) => n + Math.max(1, r.devices.length),
        0,
      ),
      remote: value.remote,
      cache: value.cache,
      host: value.host,
      completedAt: value.completedAt ?? null,
    };
  }
  async initialize() {
    const value = await this.io.read();
    // A durable confirmed intent also resumes if a crash occurred before marker
    // creation. Do not send its credentials while local access is still enabled.
    if (value && !value.completedAt && !(await this.io.marked()))
      await this.io.exclusive(() => this.io.mark());
    this.io.block(await this.io.marked());
  }
  async status() {
    return this.view(
      (await this.io.read()) ?? this.initial(),
      await this.io.marked(),
    );
  }
  private async flush(value: RemovalJournal) {
    let uncertain = false;
    for (const request of [...value.pending]) {
      try {
        const receipt = await this.io.post(request);
        if (
          receipt?.ok !== true ||
          receipt.request_id !== request.request_id ||
          receipt.devices?.length !== request.devices.length ||
          receipt.devices.some(
            (d, i) =>
              d.tenant_id !== request.devices[i].tenant_id ||
              d.device_id !== request.devices[i].device_id ||
              !["revoked", "unverified"].includes(d.status),
          )
        )
          throw new Error("DISCONNECT_RECEIPT_INVALID");
        if (receipt.devices.some((d) => d.status !== "revoked")) {
          uncertain = true;
          continue;
        }
        value.pending = value.pending.filter(
          (r) => r.request_id !== request.request_id,
        );
        // Keep retries durable after EACH acknowledgement, including a lost reply.
        await this.io.write(value);
      } catch {
        /* Offline and malformed acknowledgements remain recoverable. */
      }
    }
    value.remote = value.pending.length
      ? uncertain
        ? "unverified"
        : "pending"
      : "disconnected";
    await this.io.write(value);
  }
  private once(
    work: () => Promise<ReturnType<DesktopRemovalController["view"]>>,
  ) {
    if (this.flight) return this.flight;
    const flight = work();
    this.flight = flight;
    void flight
      .finally(() => {
        if (this.flight === flight) this.flight = undefined;
        this.io.changed();
      })
      .catch(() => {});
    return flight;
  }
  prepare(clearCache: boolean) {
    return this.once(async () => {
      const release = this.io.acquire();
      try {
        const consent = await this.io.confirm(clearCache);
        if (!consent.confirmed)
          return { ...(await this.status()), cancelled: true };
        clearCache = consent.clearCache;
        const value = (await this.io.read()) ?? this.initial();
        delete value.completedAt;
        value.cache = clearCache
          ? "retry"
          : value.cache === "retry"
            ? "retained"
            : value.cache;
        if (!(await this.io.marked())) {
          await this.capture(value);
          // Persist credentials/proofs before clearing auth or retiring the Host.
          await this.io.exclusive(async () => {
            await this.io.write(value);
            await this.io.mark();
          });
        }
        this.io.block(true);
        // A crash with the marker present resumes this same idempotent withdrawal.
        await this.io.withdraw();
        try {
          value.host = await this.io.unregister();
        } catch {
          value.host = "retry";
        }
        if (clearCache) {
          value.cache = "retry";
          await this.io.write(value);
          try {
            await this.io.clearCache();
            value.cache = "cleared";
          } catch {
            /* UI retains the specific cache retry state. */
          }
        }
        value.completedAt = new Date().toISOString();
        await this.io.write(value);
        await this.flush(value);
        return this.status();
      } finally {
        release();
      }
    });
  }
  retry() {
    return this.once(async () => {
      const value = await this.io.read();
      if (!value) return this.status();
      if (await this.io.marked()) {
        // Retrying a crashed preparation must finish local withdrawal first.
        const release = this.io.acquire();
        try {
          this.io.block(true);
          await this.io.withdraw();
          if (value.host === "retry")
            try {
              value.host = await this.io.unregister();
            } catch {}
          if (value.cache === "retry")
            try {
              await this.io.clearCache();
              value.cache = "cleared";
            } catch {}
          value.completedAt = new Date().toISOString();
        } finally {
          release();
        }
      }
      await this.flush(value);
      return this.status();
    });
  }
  async activate(signIn: () => Promise<void>) {
    if (this.flight) throw new Error("DESKTOP_REMOVAL_IN_PROGRESS");
    // Reconnection is always a new customer login; old grants are never restored.
    await signIn();
    try {
      await this.io.unmark();
    } catch (error) {
      // A failed marker removal must not orphan the newly issued credential.
      // Keep its signed withdrawal durably before clearing the new login.
      const value = (await this.io.read()) ?? this.initial();
      await this.capture(value);
      await this.io.write(value);
      this.io.block(true);
      await this.io.withdraw();
      throw error;
    }
    this.io.block(false);
    this.io.changed();
  }
}
