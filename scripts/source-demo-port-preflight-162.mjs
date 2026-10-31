import {createServer} from "node:net";
import {sourceDatabasePort} from "./source-demo-runtime-158.mjs";

/** Check before installing dependencies or creating local configuration.
 * These short-lived listeners belong to this check; other applications are
 * never contacted or stopped. Availability is observed at check time. */
export async function assertSourceDemoPortsAvailable() {
  const ports = [4310, 4317, 4318, 4319, sourceDatabasePort()];
  for (const port of ports) {
    const server = createServer();
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen({host: "127.0.0.1", port, exclusive: true}, resolve);
      });
    } catch (cause) {
      throw new Error(
        `Local startup port ${port} is unavailable (${cause.code ?? "listen failed"}). ` +
        "Existing applications were preserved. Select COPYPASTE_SOURCE_DATABASE_PORT before first setup for a database conflict; " +
        "stop your own prior CopyPaste controller before reusing its application ports.",
        {cause},
      );
    } finally {
      if (server.listening) await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
    }
  }
  return {ports, availability: "observed_at_check_time"};
}
