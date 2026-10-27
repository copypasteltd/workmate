import { UpdateError } from "./desktop-update-contract.js";
/** One event-loop admission boundary for renderer commands and background dispatch. */
export class UpdateAdmission {
  private operations = 0;
  private held = false;
  async run<T>(operation: () => Promise<T>) {
    if (this.held) throw new UpdateError("UPDATE_INSTALLATION_IN_PROGRESS");
    this.operations++;
    try {
      return await operation();
    } finally {
      this.operations--;
    }
  }
  acquire() {
    if (this.held || this.operations)
      throw new UpdateError("UPDATE_LOCAL_WORK_PENDING");
    this.held = true;
    let released = false;
    return () => {
      if (!released) {
        released = true;
        this.held = false;
      }
    };
  }
}
