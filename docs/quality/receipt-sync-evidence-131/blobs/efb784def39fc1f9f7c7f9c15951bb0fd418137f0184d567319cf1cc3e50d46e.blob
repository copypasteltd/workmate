import path from "node:path";
import { pathToFileURL } from "node:url";

const { CapabilityAudioVerification } = await import(pathToFileURL(path.resolve("../copypaste-platform-recovery-120/src/capability-audio-verification.ts")).href);
let records = 0, previousTick = performance.now(), maximumDelay = 0;
const clock = setInterval(() => { const now = performance.now(); maximumDelay = Math.max(maximumDelay, now - previousTick - 250); previousTick = now; }, 250);
clock.unref();
const observe = body => { if (++records <= 5000) process.stdout.write("# audio_lease_diagnostic " + JSON.stringify({ pid: process.pid, maximum_timer_delay_ms: Math.round(maximumDelay), ...body }) + "\n"); };
const observedControls = new WeakSet();
for (const method of ["advance", "prepare", "execute", "finish", "locked", "grant"]) {
  const original = CapabilityAudioVerification.prototype[method];
  if (typeof original !== "function") continue;
  CapabilityAudioVerification.prototype[method] = async function (...args) {
    const control = this.db?.control;
    if (control && !observedControls.has(control)) {
      observedControls.add(control);
      const query = control.query.bind(control);
      control.query = (sql, ...rest) => {
        if (typeof sql !== "string" || !/^UPDATE capability_audio_suites SET lease_until=/i.test(sql)) return query(sql, ...rest);
        const started = performance.now();
        return query(sql, ...rest).then(result => { observe({ event: "heartbeat", elapsed_ms: Math.round(performance.now() - started), affected_rows: result.rowCount }); return result; });
      };
    }
    const started = performance.now(); observe({ event: "enter", method });
    try {
      const result = await original.apply(this, args);
      observe({ event: "return", method, elapsed_ms: Math.round(performance.now() - started),
        validation_state: result?.validation_state ?? null, lease_current: result?.lease_current ?? null,
        grant_current: result?.grant_current ?? null, probe_state: result?.state ?? null });
      return result;
    } catch (error) { observe({ event: "throw", method, elapsed_ms: Math.round(performance.now() - started), code: error.code ?? error.name }); throw error; }
  };
}
