import http from "node:http";
import { Duplex } from "node:stream";
import { readFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  runCloudProgram,
  type ProgramSource,
  type CloudCheckDriver,
  type CloudCheckResult,
} from "./cloud-program-executor.js";

const timeout = z.number().int().min(100).max(30000).default(15000);
const headers = z
  .record(
    z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}$/),
    z
      .string()
      .max(4000)
      .refine((v) => !/[\r\n\0]/.test(v)),
  )
  .refine((v) => Object.keys(v).length <= 20);
const requestHeaders = headers.refine(
  (v) =>
    !Object.keys(v).some((k) =>
      [
        "connection",
        "content-length",
        "transfer-encoding",
        "upgrade",
        "expect",
        "proxy-authorization",
        "proxy-connection",
        "te",
      ].includes(k.toLowerCase()),
    ),
  "Transport headers are managed by the validator",
);
export const apiCheckInput = z
  .object({
    entry: z.string().min(1).max(500),
    export_name: z
      .string()
      .regex(/^[A-Za-z_$][\w$]{0,79}$/)
      .default("default"),
    requests: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            method: z.enum([
              "GET",
              "POST",
              "PUT",
              "PATCH",
              "DELETE",
              "HEAD",
              "OPTIONS",
            ]),
            path: z
              .string()
              .max(2000)
              .regex(/^\/(?!\/)[^\s\x00-\x20\x7f]*$/),
            headers: requestHeaders.default({}),
            body: z.string().max(16384).optional(),
            expect: z
              .object({
                status: z.number().int().min(200).max(599),
                json: z.json().optional(),
                text: z.string().max(16384).optional(),
                headers: headers.optional(),
              })
              .strict()
              .refine(
                (v) => v.json === undefined || v.text === undefined,
                "Choose an exact JSON or text expectation",
              ),
          })
          .strict()
          .refine(
            (v) => Buffer.byteLength(JSON.stringify(v)) <= 32768,
            "Request and expectation exceed 32 KiB",
          ),
      )
      .min(1)
      .max(20),
    timeout_ms: timeout,
  })
  .strict()
  .refine(
    (v) => Buffer.byteLength(JSON.stringify(v)) <= 262144,
    "The check batch exceeds 256 KiB",
  );

const parameter = z.union([
  z.string().max(32768),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);
export const databaseCheckInput = z
  .object({
    engine: z.literal("sqlite").default("sqlite"),
    entry: z.string().min(1).max(500),
    checks: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(120),
            sql: z.string().min(1).max(20000),
            params: z.array(parameter).max(64).default([]),
            expect: z
              .object({
                rows: z
                  .array(z.record(z.string().max(120), z.json()))
                  .max(100)
                  .optional(),
                changes: z.number().int().nonnegative().optional(),
                lastInsertRowid: z
                  .union([z.number().int(), z.string().regex(/^-?\d+$/)])
                  .optional(),
                error_code: z.string().min(1).max(80).optional(),
                error_message: z.string().min(1).max(500).optional(),
              })
              .strict()
              .refine(
                (v) =>
                  v.rows !== undefined ||
                  v.changes !== undefined ||
                  v.lastInsertRowid !== undefined ||
                  v.error_code !== undefined,
                "Declare an observable expected result",
              )
              .refine(
                (v) =>
                  v.rows === undefined ||
                  (v.changes === undefined && v.lastInsertRowid === undefined),
                "Row and mutation expectations use separate checks",
              )
              .refine(
                (v) => !v.error_message || v.error_code !== undefined,
                "An error message requires an expected error code",
              )
              .refine(
                (v) =>
                  v.error_code === undefined ||
                  (v.rows === undefined &&
                    v.changes === undefined &&
                    v.lastInsertRowid === undefined),
                "Expected errors and successful results are separate checks",
              ),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    timeout_ms: timeout,
  })
  .strict()
  .refine(
    (v) => Buffer.byteLength(JSON.stringify(v)) <= 262144,
    "The check batch exceeds 256 KiB",
  );

const resultSchema = z
  .object({
    kind: z.enum(["api", "sqlite"]),
    passed: z.boolean(),
    checks: z
      .array(
        z
          .object({
            name: z.string().max(120),
            passed: z.boolean(),
            expected: z.unknown().optional(),
            actual: z.unknown().optional(),
            error: z.string().max(1500).optional(),
          })
          .strict(),
      )
      .max(30),
    error: z.string().max(1500).optional(),
  })
  .strict();
const bootstrap = (name: string) => readFile(new URL(name, import.meta.url));

export async function apiCheckDriver(
  input: z.input<typeof apiCheckInput>,
): Promise<CloudCheckDriver> {
  const a = apiCheckInput.parse(input);
  return {
    program: "api_test",
    bootstrap: await bootstrap("cloud-api-bootstrap.cjs"),
    configuration: a,
    arguments: [a.entry],
    stdin: true,
    async interact(io) {
      const sockets = new Map<string, Duplex>(),
        closed = new Set<string>();
      let serial = 0,
        pending = "",
        protocolError: Error | null = null,
        closing = false;
      const send = (frame: unknown) =>
        io.write(Buffer.from(JSON.stringify(frame) + "\n"));
      const fail = (error: Error) => {
        protocolError ??= error;
        for (const socket of sockets.values()) socket.destroy(error);
      };
      const data = (bytes: Buffer) => {
          try {
            pending += bytes.toString("utf8");
            let end;
            while ((end = pending.indexOf("\n")) >= 0) {
              const line = pending.slice(0, end);
              pending = pending.slice(end + 1);
              if (line.length > 32768) throw new Error("HTTP_CHANNEL_LIMIT");
              const frame = JSON.parse(line),
                socket = sockets.get(frame.id);
              if (
                !/^c\d{1,3}$/.test(frame.id) ||
                Object.keys(frame).some(
                  (k) => !["id", "data", "end"].includes(k),
                ) ||
                (frame.data !== undefined) === (frame.end === true)
              )
                throw new Error("HTTP_CHANNEL_FRAME");
              if (!socket && closed.has(frame.id)) continue;
              if (!socket) throw new Error("HTTP_CHANNEL_ID");
              if (frame.end === true) socket.push(null);
              else {
                if (typeof frame.data !== "string" || frame.data.length > 32768)
                  throw new Error("HTTP_CHANNEL_LIMIT");
                const raw = Buffer.from(frame.data, "base64");
                if (raw.toString("base64") !== frame.data)
                  throw new Error("HTTP_CHANNEL_ENCODING");
                socket.push(raw);
              }
            }
            if (pending.length > 32768) throw new Error("HTTP_CHANNEL_LIMIT");
          } catch (error) {
            fail(error instanceof Error ? error : new Error(String(error)));
          }
        },
        end = () => {
          for (const socket of sockets.values()) socket.push(null);
        };
      io.output.on("data", data);
      io.output.on("end", end);
      const abort = () => fail(new Error("The native HTTP check was stopped"));
      io.signal.addEventListener("abort", abort, { once: true });
      const agent = new http.Agent({ keepAlive: false, maxSockets: 1 });
      agent.createConnection = () => {
        const id = "c" + ++serial;
        if (serial > 20 || protocolError)
          throw protocolError ?? new Error("HTTP_CHANNEL_LIMIT");
        const socket = new Duplex({
          read() {},
          write(chunk, encoding, callback) {
            send({ id, data: Buffer.from(chunk).toString("base64") }).then(
              () => callback(),
              callback,
            );
          },
          destroy(error, callback) {
            sockets.delete(id);
            closed.add(id);
            if (!closing) send({ close: id }).catch(() => {});
            callback(error);
          },
        });
        Object.assign(socket, {
          connecting: false,
          setTimeout: () => socket,
          setNoDelay: () => socket,
          setKeepAlive: () => socket,
          ref: () => socket,
          unref: () => socket,
        });
        socket.on("error", () => {});
        sockets.set(id, socket);
        send({ open: id }).catch((error) => socket.destroy(error));
        return socket as any;
      };
      const checks: CloudCheckResult["checks"] = [];
      try {
        io.signal.throwIfAborted();
        for (const request of a.requests) {
          if (protocolError) throw protocolError;
          const expected = request.expect;
          const actual = await new Promise<{
            status: number;
            headers: Record<string, string>;
            text: string;
          }>((resolve, reject) => {
            const body =
              request.body === undefined
                ? undefined
                : Buffer.from(request.body);
            const req = http.request(
              {
                host: "task.invalid",
                port: 80,
                method: request.method,
                path: request.path,
                agent,
                signal: io.signal,
                headers: {
                  ...request.headers,
                  connection: "close",
                  ...(body ? { "content-length": String(body.length) } : {}),
                },
                maxHeaderSize: 16384,
              },
              (res) => {
                const chunks: Buffer[] = [];
                let bytes = 0;
                res.on("data", (chunk) => {
                  bytes += chunk.length;
                  if (bytes > 16384) {
                    const error = new Error("HTTP_RESPONSE_LIMIT");
                    reject(error);
                    res.destroy(error);
                    req.destroy(error);
                  } else chunks.push(chunk);
                });
                res.on("error", reject);
                res.on("aborted", () =>
                  reject(new Error("The application response was interrupted")),
                );
                res.on("end", () =>
                  resolve({
                    status: res.statusCode!,
                    headers: Object.fromEntries(
                      Object.entries(res.headers).map(([k, v]) => [
                        k,
                        Array.isArray(v) ? v.join(", ") : (v ?? ""),
                      ]),
                    ),
                    text: Buffer.concat(chunks).toString("utf8"),
                  }),
                );
              },
            );
            req.on("error", reject);
            const deadline = setTimeout(
              () => req.destroy(new Error("HTTP_REQUEST_TIMEOUT")),
              Math.min(a.timeout_ms, 5000),
            );
            req.once("close", () => clearTimeout(deadline));
            req.end(body);
          });
          const comparison: Record<string, unknown> = { status: actual.status };
          let error: string | undefined;
          if (expected.json !== undefined) {
            try {
              comparison.json = JSON.parse(actual.text);
            } catch {
              comparison.json = null;
              error = "The response is not valid JSON";
            }
          }
          if (expected.text !== undefined) comparison.text = actual.text;
          if (expected.headers)
            comparison.headers = Object.fromEntries(
              Object.keys(expected.headers).map((k) => [
                k,
                actual.headers[k.toLowerCase()] ?? null,
              ]),
            );
          const passed = !error && isDeepStrictEqual(comparison, expected);
          checks.push({
            name: request.name,
            passed,
            expected,
            actual: { ...actual, ...comparison },
            ...(error ? { error } : {}),
          });
        }
        return {
          kind: "api",
          passed:
            !protocolError &&
            checks.length === a.requests.length &&
            checks.every((row) => row.passed),
          checks,
          ...(protocolError ? { error: String(protocolError) } : {}),
        };
      } catch (error) {
        return {
          kind: "api",
          passed: false,
          checks,
          error: String(error).slice(0, 1500),
        };
      } finally {
        io.signal.removeEventListener("abort", abort);
        io.output.removeListener("data", data);
        io.output.removeListener("end", end);
        closing = true;
        agent.destroy();
        for (const socket of sockets.values()) socket.destroy();
        io.end();
      }
    },
  };
}

export async function databaseCheckDriver(
  input: z.input<typeof databaseCheckInput>,
): Promise<CloudCheckDriver> {
  const a = databaseCheckInput.parse(input);
  const output = "copypaste-database-check-" + randomUUID();
  return {
    program: "database_sqlite",
    bootstrap: await bootstrap("cloud-sqlite-bootstrap.cjs"),
    configuration: { ...a, output_directory: output },
    arguments: [a.entry],
    stdin: false,
    verify(files) {
      try {
        const file = files.find((v) => v.path === output + "/results.json");
        if (!file || file.bytes.length > 131072)
          throw new Error(
            "The trusted database result is missing or too large",
          );
        const result = resultSchema.parse(
          JSON.parse(file.bytes.toString("utf8")),
        );
        if (
          result.kind !== "sqlite" ||
          (result.passed &&
            (result.checks.length !== a.checks.length ||
              result.checks.some(
                (row, i) =>
                  !row.passed ||
                  row.name !== a.checks[i].name ||
                  !isDeepStrictEqual(row.expected, a.checks[i].expect),
              )))
        )
          throw new Error(
            "The database result does not match the declared checks",
          );
        return result;
      } catch (error) {
        return {
          kind: "sqlite",
          passed: false,
          checks: [],
          error: String(error).slice(0, 1500),
        };
      }
    },
  };
}

export async function runCloudApiCheck(
  dataDir: string,
  input: z.input<typeof apiCheckInput>,
  sources: ProgramSource[],
  signal?: AbortSignal,
) {
  const a = apiCheckInput.parse(input);
  return runCloudProgram(
    dataDir,
    { program: "node", entry: a.entry, timeout_ms: a.timeout_ms },
    sources,
    signal,
    await apiCheckDriver(a),
  );
}
export async function runCloudDatabaseCheck(
  dataDir: string,
  input: z.input<typeof databaseCheckInput>,
  sources: ProgramSource[],
  signal?: AbortSignal,
) {
  const a = databaseCheckInput.parse(input);
  return runCloudProgram(
    dataDir,
    { program: "node", entry: a.entry, timeout_ms: a.timeout_ms },
    sources,
    signal,
    await databaseCheckDriver(a),
  );
}
