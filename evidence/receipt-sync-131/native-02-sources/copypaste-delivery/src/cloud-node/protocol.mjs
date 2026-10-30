import { createHash } from "node:crypto";

export const sha256 = value => createHash("sha256").update(value).digest("hex");
export function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
}
export function check(condition, code) { if (!condition) throw new Error(code); }
export const uuid = value => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const integer = (n, min, max) => Number.isSafeInteger(n) && n >= min && n <= max;

export function configuration(value) {
  check(value && typeof value === "object" && !Array.isArray(value), "NODE_CONFIGURATION_INVALID");
  check(Object.keys(value).every(key => ["api_origin", "node_id", "enrollment_token", "machine_fingerprint", "plan_key", "cpu_cores", "memory_mib", "disk_mib", "max_minutes"].includes(key)), "NODE_CONFIGURATION_FIELD_UNKNOWN");
  const origin = new URL(value.api_origin);
  check(origin.protocol === "https:" && !origin.username && !origin.password && origin.pathname === "/" && !origin.search && !origin.hash, "COMPANY_HTTPS_ORIGIN_REQUIRED");
  check(uuid(value.node_id) && /^[A-Za-z0-9_-]{43}$/.test(value.enrollment_token) && /^[a-f0-9]{64}$/.test(value.machine_fingerprint), "NODE_CREDENTIAL_INVALID");
  check(/^[a-z][a-z0-9-]{2,63}$/.test(value.plan_key), "NODE_PLAN_INVALID");
  check(integer(value.cpu_cores, 1, 128) && integer(value.memory_mib, 512, 1_048_576) && integer(value.disk_mib, 1024, 4_194_304) && integer(value.max_minutes, 5, 1440), "NODE_CAPACITY_INVALID");
  return Object.freeze({ ...value, api_origin: origin.origin });
}

export function startSpecification(command, config, serverTime, roundTripMilliseconds = 0) {
  check(uuid(command?.id) && uuid(command.session_id) && integer(command.generation, 1, 2_147_483_647) && command.kind === "start", "START_COMMAND_INVALID");
  const body = command.body, spec = body?.specification, plan = spec?.plan;
  check(body?.kernel === "codex" && body.company_only === true && spec?.kernel === "codex" && spec.ai_routing === "company_only" && spec.automatic_renewal === false, "COMPANY_CODEX_REQUIRED");
  check(/^[a-f0-9]{64}$/.test(body.specification_hash) && sha256(canonical(spec)) === body.specification_hash, "SPECIFICATION_HASH_MISMATCH");
  check(plan?.key === config.plan_key && spec.plan_key === config.plan_key && integer(spec.minutes, 5, config.max_minutes) && integer(spec.minutes, 5, plan.max_minutes), "PLAN_OR_DURATION_MISMATCH");
  check(integer(plan.cpu_cores, 1, config.cpu_cores) && integer(plan.memory_mib, 512, config.memory_mib) && integer(plan.disk_mib, 1024, config.disk_mib), "RESOURCE_CAPACITY_EXCEEDED");
  check(spec.workspace_file_limit === 100000, "WORKSPACE_FILE_CEILING_INVALID");
  check(integer(plan.per_minute_micros, 1, 1_000_000_000) && spec.maximum_cost_micros === String(BigInt(plan.per_minute_micros) * BigInt(spec.minutes)), "CONFIRMED_PRICE_INVALID");
  check(typeof spec.scope?.terminal === "boolean" && typeof spec.scope?.visual === "boolean" && (!spec.scope.terminal || plan.terminal === true) && (!spec.scope.visual || plan.visual === true), "CONTROL_SCOPE_INVALID");
  const ids = spec.scope.selected_asset_versions, files = spec.selected_files;
  check(Array.isArray(ids) && ids.length <= 20 && ids.every(uuid) && new Set(ids).size === ids.length && Array.isArray(files) && files.length === ids.length, "FILE_SCOPE_INVALID");
  for (let i = 0; i < ids.length; i++) {
    const file = files[i];
    check(file?.id === ids[i] && /^[a-f0-9]{64}$/.test(file.sha256) && /^[0-9]+$/.test(file.bytes) && BigInt(file.bytes) <= 5_242_880n, "FILE_FACT_INVALID");
  }
  const remaining = Date.parse(body.deadline) - Date.parse(serverTime) - Math.max(0, roundTripMilliseconds);
  check(Number.isFinite(remaining) && remaining > 0 && remaining <= spec.minutes * 60_000, "LEASE_DEADLINE_INVALID");
  return { specification: spec, remaining_milliseconds: Math.floor(remaining) };
}

export function verifySource(file, expected) {
  check(file?.id === expected.id && file.sha256 === expected.sha256 && String(file.bytes) === expected.bytes && typeof file.base64 === "string", "SELECTED_FILE_CHANGED");
  const bytes = Buffer.from(file.base64, "base64");
  check(bytes.toString("base64") === file.base64 && String(bytes.length) === expected.bytes && sha256(bytes) === expected.sha256, "SELECTED_FILE_INTEGRITY_FAILED");
  // File names from customers never become paths or shell arguments on the host.
  return { id: expected.id, bytes };
}

export function controlInput(body, scope) {
  check(body && typeof body === "object", "CONTROL_INVALID");
  if (body.kind === "terminal") {
    check(scope.terminal && typeof body.command === "string" && body.command.length > 0 && body.command.length <= 4096 && Object.keys(body).every(k => ["kind", "command"].includes(k)), "TERMINAL_SCOPE_INVALID");
  } else if (body.kind === "pointer") {
    check(scope.visual && integer(body.x, 0, 1279) && integer(body.y, 0, 719) && ["none", "left", "right"].includes(body.button) && Object.keys(body).every(k => ["kind", "x", "y", "button"].includes(k)), "POINTER_SCOPE_INVALID");
  } else {
    check(body.kind === "key" && scope.visual && ["Enter", "Escape", "Tab", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(body.key) && (body.text === undefined || typeof body.text === "string" && body.text.length <= 1000) && Object.keys(body).every(k => ["kind", "key", "text"].includes(k)), "KEY_SCOPE_INVALID");
  }
  return body;
}

export function companyApi(config, fetcher = fetch) {
  const prefix = `/v1/cloud-runtime-nodes/${config.node_id}/`;
  async function request(suffix, body, signal) {
    check(typeof suffix === "string" && /^(poll|acknowledgements|frames|sessions\/[0-9a-f-]{36}\/files\/[0-9a-f-]{36}\?generation=[1-9][0-9]*&instance_id=[0-9a-f-]{36})$/.test(suffix), "NODE_ROUTE_INVALID");
    const response = await fetcher(config.api_origin + prefix + suffix, {
      method: body === undefined ? "GET" : "POST", redirect: "error", cache: "no-store",
      headers: { authorization: "Bearer " + config.enrollment_token, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.any([AbortSignal.timeout(4000), ...(signal ? [signal] : [])]),
    });
    check(response.ok, "COMPANY_NODE_HTTP_" + response.status);
    const reader = response.body?.getReader(); check(reader, "COMPANY_RESPONSE_EMPTY");
    const chunks = []; let count = 0;
    try { while (true) { const { done, value } = await reader.read(); if (done) break; count += value.length; check(count <= 8_000_000, "COMPANY_RESPONSE_TOO_LARGE"); chunks.push(value); } }
    finally { await reader.cancel().catch(() => {}); }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  return { request };
}
