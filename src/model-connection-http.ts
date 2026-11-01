import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import ipaddr from "ipaddr.js";
import { Problem } from "./lib.js";

export function modelAddressAllowed(address: string, allowPrivate: boolean, test: boolean) {
  if (!ipaddr.isValid(address)) return false;
  const parsed = ipaddr.process(address), range = parsed.range();
  if (range === "unicast") return true;
  if (test && range === "loopback") return true;
  return allowPrivate && ["private", "uniqueLocal"].includes(range);
}

/** Resolve and pin the socket to the inspected address; redirects never carry keys. */
export async function modelConnectionFetch(url: URL, options: {
  method: string; headers: Record<string, string>; body?: Buffer; signal: AbortSignal;
  allowPrivate: boolean; test: boolean;
}): Promise<Response> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (options.signal.aborted) throw new Problem(409, "MODEL_CONNECTION_CANCELLED", "Connection check cancelled");
  const addresses = isIP(host) ? [{ address: host, family: isIP(host) }]
    : await lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(a => !modelAddressAllowed(a.address, options.allowPrivate, options.test)))
    throw new Problem(422, "MODEL_CONNECTION_ADDRESS_BLOCKED", "Use a public endpoint or explicitly permit the company private network");
  if (url.protocol === "http:" && !options.test && addresses.some(a => !["private", "uniqueLocal"].includes(ipaddr.process(a.address).range())))
    throw new Problem(422, "MODEL_CONNECTION_HTTPS_REQUIRED", "Public model services require HTTPS");
  const selected = addresses[0];
  const pinned: LookupFunction = ((_host: string, args: any, callback: any) => {
    if (args?.all) callback(null, [selected]);
    else callback(null, selected.address, selected.family);
  }) as LookupFunction;
  return new Promise<Response>((resolve, reject) => {
    const req = (url.protocol === "https:" ? https : http).request(url, {
      method: options.method, headers: { ...options.headers, "Accept-Encoding": "identity" },
      lookup: pinned, agent: false, signal: options.signal,
    }, res => {
      const headers = new Headers();
      for (const [key, value] of Object.entries(res.headers))
        if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
      const status = res.statusCode ?? 502;
      if (status >= 300 && status < 400 || ![undefined, "identity"].includes(res.headers["content-encoding"])) {
        res.destroy(); reject(new Problem(502, "MODEL_CONNECTION_RESPONSE_BLOCKED", "Redirected or encoded upstream response rejected")); return;
      }
      resolve(new Response([204, 205, 304].includes(status) ? null : Readable.toWeb(res) as ReadableStream<Uint8Array>, { status, headers }));
    });
    req.once("error", reject);
    req.end(options.body);
  });
}
