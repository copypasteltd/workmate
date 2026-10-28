import { BrowserToolError } from "./browser-contract.js";
interface Slot<T> { value?: T; token?: symbol; task?: string; pages: number; failed?: boolean; closing?: Promise<void> }
export interface BrowserContextLease<T> { value: T; token: symbol; slot: number; task: string }
/** Two actual reusable browser contexts, with one page ledger for normal opens
 * and popups. A context stays reserved until all pages die and reset completes. */
export class BrowserResources<T> {
  private slots: Slot<T>[] = [{ pages: 0 }, { pages: 0 }];
  constructor(private create: (slot: number) => T, private reset: (value: T) => Promise<void>) {}
  async acquire(task: string): Promise<BrowserContextLease<T>> {
    const index = this.slots.findIndex(slot => !slot.token && !slot.failed);
    if (index < 0) throw new BrowserToolError("BROWSER_CONTEXT_LIMIT");
    const slot = this.slots[index], token = Symbol(task);
    slot.token = token; slot.task = task;
    try {
      slot.value ??= this.create(index); await this.reset(slot.value);
      return { value: slot.value, token, slot: index, task };
    } catch (error) { slot.failed = true; slot.token = undefined; slot.task = undefined; throw error; }
  }
  canOpen(lease: BrowserContextLease<T>) {
    const slot = this.slots[lease.slot];
    return slot?.token === lease.token && !slot.failed && !slot.closing
      && this.slots.filter(item => item.task === lease.task).reduce((sum, item) => sum + item.pages, 0) < 3;
  }
  page(lease: BrowserContextLease<T>) {
    if (!this.canOpen(lease)) throw new BrowserToolError("BROWSER_TAB_LIMIT");
    const slot = this.slots[lease.slot]; slot.pages++; let released = false;
    return () => { if (released) return; released = true; if (slot.token === lease.token) slot.pages--; };
  }
  async release(lease: BrowserContextLease<T>) {
    const slot = this.slots[lease.slot];
    if (slot.token !== lease.token) return;
    if (slot.closing) return slot.closing;
    if (slot.pages) throw new BrowserToolError("BROWSER_PAGES_STILL_OWNED", false);
    slot.closing = Promise.resolve().then(() => this.reset(slot.value!)).catch(error => { slot.failed = true; throw error; }).finally(() => {
      if (slot.token === lease.token) { slot.token = undefined; slot.task = undefined; slot.closing = undefined; }
    });
    return slot.closing;
  }
}
