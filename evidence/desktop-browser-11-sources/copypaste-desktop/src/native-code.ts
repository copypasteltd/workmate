class AuthorizationRejected extends Error {}

/** Keep the same request identity after an unknown first response. */
export async function exchangeNativeCode(
  url: string,
  body: Record<string, string>,
  send: typeof fetch = fetch,
): Promise<unknown> {
  const key = crypto.randomUUID(),
    payload = JSON.stringify(body);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await send(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: payload,
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
      if (response.status >= 500) {
        await response.body?.cancel();
        throw new Error("Temporary authentication failure");
      }
      if (response.status !== 201)
        throw new AuthorizationRejected(
          "Authorization expired or was rejected. Sign in again.",
        );
      return await response.json();
    } catch (error) {
      if (error instanceof AuthorizationRejected) throw error;
      if (attempt === 1)
        throw new Error("Sign-in could not be completed. Try again shortly.");
    }
  }
  throw new Error("Sign-in could not be completed. Try again shortly.");
}
