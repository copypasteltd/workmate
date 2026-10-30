import { check } from "./protocol.mjs";
export function requireHostCapacity(config, observation) {
  check(["running", "degraded"].includes(observation.system_state.trim()), "NATIVE_SYSTEMD_NOT_SERVING");
  const controllers = new Set(observation.controllers.trim().split(/\s+/));
  check(["cpu", "memory", "pids"].every(key => controllers.has(key)), "NATIVE_RESOURCE_CONTROLLERS_REQUIRED");
  check(Number.isSafeInteger(observation.cpu_count) && observation.cpu_count >= config.cpu_cores, "PHYSICAL_CPU_CAPACITY_UNAVAILABLE");
  const value = observation.meminfo.match(/^MemAvailable:\s+(\d+)\s+kB\s*$/m)?.[1];
  check(value && BigInt(value) >= BigInt(config.memory_mib + 512) * 1024n, "PHYSICAL_MEMORY_CAPACITY_UNAVAILABLE");
}
