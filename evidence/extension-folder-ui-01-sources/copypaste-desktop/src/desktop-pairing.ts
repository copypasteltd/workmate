import { randomUUID, sign } from "node:crypto";
import {
  pairingProtocol,
  pairingCanonical,
  pairingMessage,
  type PairingInput,
  type PairingRequest,
  type PairingReceipt,
  type PairingRetirement,
  type PairedDevice,
} from "./desktop-pairing-contract.js";

export interface PairingEntry {
  epoch: string;
  request: PairingRequest;
  retirement: PairingRequest;
  state: "prepared" | "paired" | "retiring";
  device?: PairedDevice;
}
export interface PairingJournal {
  version: 1;
  entries: PairingEntry[];
}
export interface PairingIO {
  read(): Promise<PairingJournal | null>;
  write(value: PairingJournal): Promise<void>;
  epoch(): Promise<string | null>;
  pair(request: PairingRequest): Promise<PairingReceipt>;
  retire(request: PairingRequest): Promise<PairingRetirement>;
  legacy(tenant: string, device: string): Promise<void>;
  connect(tenant: string, device: PairedDevice): Promise<void>;
  clear(): Promise<void>;
}
/** Intents are encrypted by the main-process store before any network effect. */
export class DesktopPairingController {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private io: PairingIO) {}
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => {});
    return result;
  }
  private async journal() {
    const value = await this.io.read();
    if (value && (value.version !== 1 || !Array.isArray(value.entries)))
      throw new Error("PAIRING_JOURNAL_INVALID");
    return value ?? { version: 1 as const, entries: [] };
  }
  private async current(epoch: string) {
    if ((await this.io.epoch()) !== epoch)
      throw new Error("PAIRING_ACCOUNT_CHANGED");
  }
  private async retireEntry(journal: PairingJournal, entry: PairingEntry) {
    entry.state = "retiring";
    await this.io.write(journal);
    const receipt = await this.io.retire(entry.retirement);
    if (
      receipt?.pairing_id !== entry.request.input.id ||
      receipt.status !== "retired"
    )
      throw new Error("PAIRING_RETIREMENT_PENDING");
    journal.entries = journal.entries.filter(
      (e) =>
        e.request.input.id !== entry.request.input.id ||
        e.epoch !== entry.epoch,
    );
    await this.io.write(journal);
  }
  pair(
    tenant: string,
    base: Omit<PairingInput, "id" | "tenant_id">,
    auth: { refresh_token: string; session_epoch: string },
    privateKey: string,
    legacyId?: string,
  ) {
    return this.serial(async () => {
      await this.current(auth.session_epoch);
      const journal = await this.journal();
      const same = (e: PairingEntry) =>
        e.epoch === auth.session_epoch &&
        e.state !== "retiring" &&
        e.request.input.tenant_id === tenant &&
        pairingCanonical({
          name: e.request.input.name,
          public_key: e.request.input.public_key,
          grants: e.request.input.grants,
        }) === pairingCanonical(base);
      const existing = journal.entries.find(same);
      const known = journal.entries.some((e) => e.device?.id === legacyId);
      for (const entry of [...journal.entries])
        if (entry.request.input.tenant_id === tenant && entry !== existing)
          await this.retireEntry(journal, entry);
      // Failed legacy revocation must stop replacement; its ID stays locally known.
      if (legacyId && !known) await this.io.legacy(tenant, legacyId);
      await this.current(auth.session_epoch);
      let entry = existing;
      if (!entry) {
        const input = {
          ...structuredClone(base),
          id: randomUUID(),
          tenant_id: tenant,
        };
        const request: PairingRequest = {
          protocol: pairingProtocol,
          refresh_token: auth.refresh_token,
          input,
          signature: "",
        };
        request.signature = sign(
          null,
          pairingMessage("pair", request),
          privateKey,
        ).toString("base64url");
        const retirement = {
          ...structuredClone(request),
          signature: sign(
            null,
            pairingMessage("retire", request),
            privateKey,
          ).toString("base64url"),
        };
        entry = {
          epoch: auth.session_epoch,
          request,
          retirement,
          state: "prepared",
        };
        journal.entries.push(entry);
        // A disk failure here prevents the request. A lost reply keeps this same ID.
        await this.io.write(journal);
      }
      await this.current(auth.session_epoch);
      let receipt: PairingReceipt;
      try {
        receipt = await this.io.pair(entry.request);
      } catch (error) {
        if (error instanceof Error && error.message === "PAIRING_RETIRED") {
          entry.state = "retiring";
          await this.io.write(journal);
        }
        throw error;
      }
      const d = receipt?.device;
      if (
        receipt?.pairing_id !== entry.request.input.id ||
        !d ||
        !/^[a-f0-9-]{36}$/i.test(d.id) ||
        d.client !== "desktop" ||
        d.state !== "active" ||
        d.name !== base.name ||
        pairingCanonical(d.grants) !== pairingCanonical(base.grants)
      )
        throw new Error("PAIRING_RECEIPT_INVALID");
      entry.device = d;
      entry.state = "paired";
      await this.io.write(journal);
      await this.current(auth.session_epoch);
      await this.io.connect(tenant, d);
      await this.current(auth.session_epoch);
      return d;
    });
  }
  withdraw() {
    return this.serial(async () => {
      const j = await this.journal();
      for (const e of j.entries) e.state = "retiring";
      await this.io.write(j);
      await this.io.clear();
    });
  }
  initialize() {
    return this.serial(async () => {
      const j = await this.journal(),
        epoch = await this.io.epoch();
      let changed = false;
      for (const e of j.entries)
        if (e.epoch !== epoch && e.state !== "retiring") {
          e.state = "retiring";
          changed = true;
        }
      if (changed) {
        await this.io.write(j);
        await this.io.clear();
      }
    });
  }
  flush() {
    return this.serial(async () => {
      const j = await this.journal();
      for (const e of [...j.entries])
        if (e.state === "retiring")
          try {
            await this.retireEntry(j, e);
          } catch {
            /* Explicit pending evidence is retained for retry/uninstall. */
          }
      return j.entries.filter((e) => e.state === "retiring").length;
    });
  }
  removals() {
    return this.serial(async () =>
      (await this.journal()).entries.map((e) => structuredClone(e.retirement)),
    );
  }
  retire(request: PairingRequest) {
    return this.serial(async () => {
      const result = await this.io.retire(request);
      if (
        result?.pairing_id === request.input.id &&
        result.status === "retired"
      ) {
        const j = await this.journal();
        j.entries = j.entries.filter(
          (e) => pairingCanonical(e.retirement) !== pairingCanonical(request),
        );
        await this.io.write(j);
      }
      return result;
    });
  }
  drain() {
    return this.tail.then(() => {});
  }
}
