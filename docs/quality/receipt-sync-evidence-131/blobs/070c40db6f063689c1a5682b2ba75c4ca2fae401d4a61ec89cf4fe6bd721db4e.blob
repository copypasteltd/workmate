import { randomUUID } from "node:crypto";
import { apiURL } from "./config.js";

const idPattern =
  "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const mediaPath = new RegExp(
  `^/v1/tenants/(${idPattern})/projects/${idPattern}/publications/(?:previews|operations)/${idPattern}/media/[0-9]$`,
  "i",
);
const idOnly = new RegExp(`^${idPattern}$`, "i");
export const publicationMediaScheme = "workmate-media";
type Session = { session_epoch: string; access_token: string };
type MediaInfo = { sha256: string; bytes: number; mime: string };
type Capability = {
  path: string;
  tenant: string;
  owner: string;
  epoch: string;
  expires: number;
  info: MediaInfo;
  controllers: Set<AbortController>;
};
type Options = {
  api: string;
  session: () => Promise<Session>;
  ownerActive: (owner: string) => boolean;
  unauthorized: (accessToken: string) => Promise<unknown>;
  fetch?: typeof fetch;
  now?: () => number;
};
const empty = (status: number) =>
  new Response(null, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });

/** Opaque, frame- and session-bound URLs. Only the main process receives credentials. */
export class PublicationMediaProxy {
  private capabilities = new Map<string, Capability>();
  private transport: typeof fetch;
  private now: () => number;
  constructor(private options: Options) {
    this.transport = options.fetch ?? fetch;
    this.now = options.now ?? Date.now;
  }

  async issue(path: unknown, tenant: unknown, owner: string) {
    if (
      typeof path !== "string" ||
      typeof tenant !== "string" ||
      !idOnly.test(tenant) ||
      mediaPath.exec(path)?.[1].toLowerCase() !== tenant.toLowerCase() ||
      !this.options.ownerActive(owner)
    )
      throw new Error("PUBLICATION_MEDIA_PATH_DENIED");
    this.prune();
    if (this.capabilities.size >= 24)
      throw new Error("PUBLICATION_MEDIA_LIMIT");
    const session = await this.options.session(),
      controller = new AbortController();
    const response = await this.transport(
      apiURL(this.options.api, path + "/info"),
      {
        headers: {
          Authorization: "Bearer " + session.access_token,
          "X-Tenant-ID": tenant,
        },
        redirect: "error",
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(20_000),
        ]),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status === 401)
        await this.options.unauthorized(session.access_token);
      throw new Error("PUBLICATION_MEDIA_UNAVAILABLE");
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("PUBLICATION_MEDIA_INFO_INVALID");
    const pieces: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 4096) throw new Error("PUBLICATION_MEDIA_INFO_INVALID");
        pieces.push(chunk.value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const text = Buffer.concat(pieces).toString("utf8");
    let info: MediaInfo;
    try {
      info = JSON.parse(text);
    } catch {
      throw new Error("PUBLICATION_MEDIA_INFO_INVALID");
    }
    if (
      !info ||
      !/^[a-f0-9]{64}$/.test(info.sha256) ||
      !Number.isSafeInteger(info.bytes) ||
      info.bytes < 1 ||
      info.bytes > 1_073_741_824 ||
      !["image/png", "image/jpeg", "video/mp4"].includes(info.mime)
    )
      throw new Error("PUBLICATION_MEDIA_INFO_INVALID");
    const current = await this.options.session();
    if (
      current.session_epoch !== session.session_epoch ||
      !this.options.ownerActive(owner)
    )
      throw new Error("PUBLICATION_MEDIA_SESSION_CHANGED");
    this.prune();
    if (this.capabilities.size >= 24)
      throw new Error("PUBLICATION_MEDIA_LIMIT");
    const id = randomUUID();
    this.capabilities.set(id, {
      path,
      tenant,
      owner,
      epoch: session.session_epoch,
      expires: this.now() + 30 * 60_000,
      info: { sha256: info.sha256, bytes: info.bytes, mime: info.mime },
      controllers: new Set(),
    });
    return { id, url: `${publicationMediaScheme}://publication/${id}` };
  }

  close(id: unknown, owner: string) {
    if (typeof id !== "string" || !idOnly.test(id))
      throw new Error("PUBLICATION_MEDIA_CAPABILITY_DENIED");
    const cap = this.capabilities.get(id);
    if (cap && cap.owner !== owner)
      throw new Error("PUBLICATION_MEDIA_CAPABILITY_DENIED");
    if (cap) this.retire(id, cap);
  }
  closeOwner(owner: string) {
    for (const [id, cap] of this.capabilities)
      if (cap.owner === owner) this.retire(id, cap);
  }
  closeAll() {
    for (const [id, cap] of this.capabilities) this.retire(id, cap);
  }
  private retire(id: string, cap: Capability) {
    this.capabilities.delete(id);
    for (const controller of cap.controllers) controller.abort();
    cap.controllers.clear();
  }
  private prune() {
    for (const [id, cap] of this.capabilities)
      if (cap.expires <= this.now() || !this.options.ownerActive(cap.owner))
        this.retire(id, cap);
  }

  async handle(request: Request): Promise<Response> {
    this.prune();
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return empty(404);
    }
    const id = url.pathname.slice(1);
    if (
      url.protocol !== publicationMediaScheme + ":" ||
      url.hostname !== "publication" ||
      url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !idOnly.test(id)
    )
      return empty(404);
    if (!["GET", "HEAD"].includes(request.method)) return empty(405);
    const cap = this.capabilities.get(id);
    if (!cap) return empty(404);
    if (cap.controllers.size >= 8) return empty(429);
    const range = request.headers.get("Range");
    const expected = requestedRange(range, cap.info.bytes);
    if (expected === false) return empty(416);
    const controller = new AbortController();
    cap.controllers.add(controller);
    const finish = () => cap.controllers.delete(controller);
    const current = async () => {
      const session = await this.options.session();
      if (
        session.session_epoch !== cap.epoch ||
        this.capabilities.get(id) !== cap ||
        !this.options.ownerActive(cap.owner) ||
        cap.expires <= this.now()
      ) {
        this.retire(id, cap);
        throw new Error("PUBLICATION_MEDIA_SESSION_CHANGED");
      }
      return session;
    };
    try {
      const session = await current();
      const upstream = await this.transport(
        apiURL(this.options.api, cap.path),
        {
          method: request.method,
          headers: {
            Authorization: "Bearer " + session.access_token,
            "X-Tenant-ID": cap.tenant,
            ...(range ? { Range: range } : {}),
          },
          redirect: "error",
          signal: AbortSignal.any([
            controller.signal,
            request.signal,
            AbortSignal.timeout(30 * 60_000),
          ]),
        },
      );
      await current();
      if (![200, 206].includes(upstream.status)) {
        await upstream.body?.cancel();
        finish();
        if (upstream.status === 401) {
          await this.options.unauthorized(session.access_token);
          this.retire(id, cap);
        }
        return empty(
          [401, 403, 404, 409, 410, 416].includes(upstream.status)
            ? upstream.status
            : 502,
        );
      }
      const size = expected
        ? expected.end - expected.start + 1
        : cap.info.bytes;
      if (
        upstream.status !== (expected ? 206 : 200) ||
        upstream.headers.get("Content-Type")?.split(";")[0] !== cap.info.mime ||
        upstream.headers.get("X-Content-SHA256") !== cap.info.sha256 ||
        upstream.headers.get("Content-Length") !== String(size) ||
        (expected &&
          upstream.headers.get("Content-Range") !==
            `bytes ${expected.start}-${expected.end}/${cap.info.bytes}`)
      ) {
        await upstream.body?.cancel();
        finish();
        return empty(502);
      }
      const headers = new Headers({
        "Content-Type": cap.info.mime,
        "Content-Length": String(size),
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      });
      if (expected)
        headers.set(
          "Content-Range",
          `bytes ${expected.start}-${expected.end}/${cap.info.bytes}`,
        );
      if (request.method === "HEAD") {
        await upstream.body?.cancel();
        finish();
        return new Response(null, { status: upstream.status, headers });
      }
      if (!upstream.body) {
        finish();
        return empty(502);
      }
      const reader = upstream.body.getReader();
      let received = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull: async (target) => {
          try {
            await current();
            const chunk = await reader.read();
            await current();
            if (chunk.done) {
              finish();
              if (received !== size) {
                target.error(new Error("PUBLICATION_MEDIA_LENGTH_CHANGED"));
                return;
              }
              target.close();
              return;
            }
            received += chunk.value.byteLength;
            if (received > size)
              throw new Error("PUBLICATION_MEDIA_LENGTH_CHANGED");
            target.enqueue(chunk.value);
          } catch {
            finish();
            controller.abort();
            void reader.cancel().catch(() => {});
            target.error(new Error("PUBLICATION_MEDIA_UNAVAILABLE"));
          }
        },
        cancel: async () => {
          finish();
          controller.abort();
          await reader.cancel().catch(() => {});
        },
      });
      return new Response(stream, { status: upstream.status, headers });
    } catch {
      finish();
      controller.abort();
      return empty(409);
    }
  }
}

function requestedRange(
  value: string | null,
  bytes: number,
): { start: number; end: number } | null | false {
  if (value === null) return null;
  const match = /^bytes=(\d{0,16})-(\d{0,16})$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, bytes - Number(match[2]));
  const end =
    match[1] && match[2] ? Math.min(bytes - 1, Number(match[2])) : bytes - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    start >= bytes ||
    (!match[1] && Number(match[2]) <= 0)
  )
    return false;
  return { start, end };
}
