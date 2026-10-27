export interface NativeTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  refresh_request_id?: string;
  session_epoch?: string;
}
export class NativeSessionError extends Error {
  constructor(
    public code: "AUTH_REQUIRED" | "AUTH_CHANGED" | "AUTH_UNAVAILABLE",
  ) {
    super(code);
  }
}
interface SessionStore {
  read: () => Promise<NativeTokens | null>;
  write: (tokens: NativeTokens | null) => Promise<void>;
  renew: (refreshToken: string, requestId: string) => Promise<unknown>;
  revoke: (refreshToken: string) => Promise<void>;
  changed: () => void;
  now?: () => number;
}
/** Each native client owns one store; an obsolete request may never restore it. */
export class NativeSession {
  private revision = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private flight?: {
    revision: number;
    source: string;
    promise: Promise<NativeTokens>;
  };
  constructor(private readonly store: SessionStore) {}
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => {});
    return result;
  }
  private decode(value: unknown): NativeTokens {
    const v = value as Record<string, unknown> | null;
    if (
      !v ||
      typeof v.access_token !== "string" ||
      !/^[\w-]{43}$/.test(v.access_token) ||
      typeof v.refresh_token !== "string" ||
      !/^[\w-]{43}$/.test(v.refresh_token) ||
      typeof v.expires_in !== "number" ||
      !Number.isSafeInteger(v.expires_in) ||
      v.expires_in < 1 ||
      v.expires_in > 86400
    )
      throw new NativeSessionError("AUTH_UNAVAILABLE");
    return {
      access_token: v.access_token,
      refresh_token: v.refresh_token,
      expires_at: (this.store.now?.() ?? Date.now()) + v.expires_in * 1000,
      refresh_request_id: crypto.randomUUID(),
      session_epoch: crypto.randomUUID(),
    };
  }
  private async revoke(tokens: NativeTokens | null): Promise<boolean> {
    if (!tokens) return true;
    try {
      await this.store.revoke(tokens.refresh_token);
      return true;
    } catch {
      return false;
    }
  }
  beginLogin(): number {
    return ++this.revision;
  }
  async acceptLogin(response: unknown, ticket: number): Promise<void> {
    const tokens = this.decode(response);
    let previous: NativeTokens | null = null;
    let accepted: boolean;
    try {
      accepted = await this.exclusive(async () => {
        if (ticket !== this.revision) return false;
        previous = await this.store.read();
        await this.store.write(tokens);
        return ticket === this.revision;
      });
    } catch {
      await this.revoke(tokens);
      throw new NativeSessionError("AUTH_UNAVAILABLE");
    }
    if (!accepted) {
      await this.revoke(tokens);
      throw new NativeSessionError("AUTH_CHANGED");
    }
    this.store.changed();
    if (
      previous &&
      (previous as NativeTokens).refresh_token !== tokens.refresh_token
    )
      await this.revoke(previous);
  }
  async get(): Promise<NativeTokens> {
    const revision = this.revision;
    let tokens = await this.exclusive(() => this.store.read());
    if (revision !== this.revision)
      throw new NativeSessionError("AUTH_CHANGED");
    if (!tokens) throw new NativeSessionError("AUTH_REQUIRED");
    if (tokens.expires_at > (this.store.now?.() ?? Date.now()) + 30000)
      return tokens;
    if (
      !tokens.refresh_request_id ||
      !/^[a-f0-9-]{36}$/.test(tokens.refresh_request_id)
    ) {
      const source = tokens.refresh_token;
      try {
        tokens = await this.exclusive(async () => {
          let current = await this.store.read();
          if (
            revision !== this.revision ||
            !current ||
            current.refresh_token !== source
          )
            throw new NativeSessionError("AUTH_CHANGED");
          if (
            !current.refresh_request_id ||
            !/^[a-f0-9-]{36}$/.test(current.refresh_request_id)
          ) {
            const updated = {
              ...current,
              refresh_request_id: crypto.randomUUID(),
              session_epoch: current.session_epoch ?? crypto.randomUUID(),
            };
            await this.store.write(updated);
            current = updated;
          }
          if (revision !== this.revision)
            throw new NativeSessionError("AUTH_CHANGED");
          return current;
        });
      } catch (error) {
        if (error instanceof NativeSessionError) throw error;
        throw new NativeSessionError("AUTH_UNAVAILABLE");
      }
    }
    if (
      this.flight?.revision === revision &&
      this.flight.source === tokens.refresh_token
    )
      return this.flight.promise;
    const promise = this.renew(tokens, revision);
    const flight = { revision, source: tokens.refresh_token, promise };
    this.flight = flight;
    void promise
      .finally(() => {
        if (this.flight === flight) this.flight = undefined;
      })
      .catch(() => {});
    return promise;
  }
  private async renew(
    previous: NativeTokens,
    revision: number,
  ): Promise<NativeTokens> {
    let next: NativeTokens;
    try {
      next = {
        ...this.decode(
          await this.store.renew(
            previous.refresh_token,
            previous.refresh_request_id!,
          ),
        ),
        session_epoch: previous.session_epoch ?? crypto.randomUUID(),
      };
    } catch (error) {
      // Transport errors, 429 and 5xx do not prove that a session was revoked.
      if (error instanceof NativeSessionError && error.code === "AUTH_REQUIRED")
        if (!(await this.invalidate(previous.access_token)))
          throw new NativeSessionError("AUTH_CHANGED");
      throw error;
    }
    let accepted: boolean;
    try {
      accepted = await this.exclusive(async () => {
        const current = await this.store.read();
        if (
          revision !== this.revision ||
          current?.refresh_token !== previous.refresh_token
        )
          return false;
        await this.store.write(next);
        return revision === this.revision;
      });
    } catch {
      await this.revoke(next);
      throw new NativeSessionError("AUTH_UNAVAILABLE");
    }
    if (!accepted) {
      await this.revoke(next);
      throw new NativeSessionError("AUTH_CHANGED");
    }
    return next;
  }
  async invalidate(accessToken: string): Promise<boolean> {
    const removed = await this.exclusive(async () => {
      const current = await this.store.read();
      if (current?.access_token !== accessToken) return null;
      ++this.revision;
      await this.store.write(null);
      return current;
    });
    if (removed) {
      this.store.changed();
      await this.revoke(removed);
    }
    return !!removed;
  }
  async signOut(options: { remote?: boolean } = {}): Promise<{ remote_revoked: boolean }> {
    ++this.revision;
    const removed = await this.exclusive(async () => {
      const current = await this.store.read();
      await this.store.write(null);
      return current;
    });
    // Local sign-out completes before any network work; late login/refresh is fenced.
    this.store.changed();
    return { remote_revoked: options.remote === false ? false : await this.revoke(removed) };
  }
}
