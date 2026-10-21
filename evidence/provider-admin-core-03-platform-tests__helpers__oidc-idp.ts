/** Native, signed OIDC integration fixture. Never registered in the product API. */
import { createServer, type ServerResponse } from "node:http";
import {
  generateKeyPairSync,
  createHash,
  randomBytes,
  sign,
} from "node:crypto";

export type IdentityMode = {
  badSignature?: boolean;
  nonce?: string;
  audience?: string;
  issuer?: string;
  expired?: boolean;
  email?: string;
  verified?: boolean;
  noEmail?: boolean;
  subject?: string;
};
export async function startIdentityFixture(
  port = 0,
  alg: "RS256" | "ES256" = "RS256",
) {
  const keys = () =>
    alg === "RS256"
      ? generateKeyPairSync("rsa", { modulusLength: 2048 })
      : generateKeyPairSync("ec", { namedCurve: "P-256" });
  const pair = keys();
  const wrong = keys();
  const clientId = "copypaste-integration-client",
    secret = randomBytes(32).toString("base64url");
  let issuer = "";
  const codes = new Map<
    string,
    { params: URLSearchParams; mode: IdentityMode }
  >();
  const state = {
    mode: {} as IdentityMode,
    metadataPatch: {} as Record<string, unknown>,
    redirectKeys: false,
    tokenCalls: 0,
  };
  const json = (r: ServerResponse, value: unknown, status = 200) => {
    r.writeHead(status, {
      "content-type": "application/json",
      "cache-control": "no-store",
    });
    r.end(JSON.stringify(value));
  };
  const server = createServer(async (req, res) => {
    try {
      const u = new URL(req.url!, issuer);
      if (
        u.pathname.endsWith("/.well-known/openid-configuration") ||
        u.pathname === "/.well-known/openid-configuration/oidc"
      ) {
        return json(res, {
          issuer,
          authorization_endpoint: issuer + "/authorize",
          token_endpoint: issuer + "/token",
          jwks_uri: issuer + "/keys",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          grant_types_supported: ["authorization_code"],
          id_token_signing_alg_values_supported: [alg],
          token_endpoint_auth_methods_supported: [
            "client_secret_post",
            "client_secret_basic",
          ],
          code_challenge_methods_supported: ["S256"],
          authorization_response_iss_parameter_supported: true,
          ...state.metadataPatch,
        });
      }
      if (u.pathname === "/oidc/keys") {
        if (state.redirectKeys) {
          res.writeHead(302, { location: issuer + "/keys-real" });
          res.end();
          return;
        }
        return json(res, {
          keys: [
            {
              ...pair.publicKey.export({ format: "jwk" }),
              kid: "fixture-key",
              use: "sig",
              alg,
            },
          ],
        });
      }
      if (u.pathname === "/oidc/authorize") {
        const p = u.searchParams;
        if (
          p.get("client_id") !== clientId ||
          p.get("response_type") !== "code" ||
          p.get("code_challenge_method") !== "S256" ||
          !p.get("nonce")
        )
          return json(res, { error: "invalid_request" }, 400);
        if (p.get("approve") !== "1") {
          const link = u.href + "&approve=1";
          res.writeHead(200, {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>CopyPaste test identity</title><style>body{font:18px system-ui;max-width:640px;margin:12vh auto;padding:32px}a{display:inline-block;padding:16px 24px;background:#113eff;color:white;border-radius:9px}p{line-height:1.6}</style><h1>Company identity · integration fixture</h1><p>This local signed identity service is used only for product acceptance.</p><a href="${link.replaceAll("&", "&amp;").replaceAll('"', "&quot;")}">Continue with test identity</a></html>`,
          );
          return;
        }
        const code = randomBytes(32).toString("base64url");
        codes.set(code, {
          params: new URLSearchParams(p),
          mode: { ...state.mode },
        });
        const callback = new URL(p.get("redirect_uri")!);
        callback.searchParams.set("code", code);
        callback.searchParams.set("state", p.get("state")!);
        callback.searchParams.set("iss", issuer);
        res.writeHead(302, { location: callback.href });
        res.end();
        return;
      }
      if (u.pathname === "/oidc/token" && req.method === "POST") {
        state.tokenCalls++;
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
          if (chunks.reduce((n, b) => n + b.length, 0) > 16000)
            throw Error("oversized fixture request");
        }
        const p = new URLSearchParams(Buffer.concat(chunks).toString());
        const basic = req.headers.authorization?.startsWith("Basic ")
          ? Buffer.from(req.headers.authorization.slice(6), "base64")
              .toString()
              .split(":")
              .map(decodeURIComponent)
          : null;
        const entry = codes.get(p.get("code") ?? "");
        codes.delete(p.get("code") ?? "");
        if (
          !entry ||
          (basic?.[0] ?? p.get("client_id")) !== clientId ||
          (basic?.[1] ?? p.get("client_secret")) !== secret ||
          p.get("grant_type") !== "authorization_code" ||
          entry.params.get("redirect_uri") !== p.get("redirect_uri") ||
          entry.params.get("code_challenge") !==
            createHash("sha256")
              .update(p.get("code_verifier") ?? "")
              .digest("base64url")
        )
          return json(res, { error: "invalid_grant" }, 400);
        const now = Math.floor(Date.now() / 1000),
          m = entry.mode,
          email = m.email ?? entry.params.get("login_hint")!;
        const claims = {
          iss: m.issuer ?? issuer,
          sub: m.subject ?? "employee:" + email,
          aud: m.audience ?? clientId,
          iat: now - (m.expired ? 3600 : 0),
          exp: now + (m.expired ? -1800 : 300),
          nonce: m.nonce ?? entry.params.get("nonce"),
          ...(m.noEmail ? {} : { email, email_verified: m.verified !== false }),
        };
        const data =
          Buffer.from(
            JSON.stringify({ alg, kid: "fixture-key", typ: "JWT" }),
          ).toString("base64url") +
          "." +
          Buffer.from(JSON.stringify(claims)).toString("base64url");
        const idToken =
          data +
          "." +
          sign("sha256", Buffer.from(data), {
            key: m.badSignature ? wrong.privateKey : pair.privateKey,
            dsaEncoding: "ieee-p1363",
          }).toString("base64url");
        return json(res, {
          access_token: randomBytes(32).toString("base64url"),
          token_type: "Bearer",
          expires_in: 300,
          id_token: idToken,
        });
      }
      json(res, { error: "not_found" }, 404);
    } catch {
      if (!res.headersSent) json(res, { error: "fixture_error" }, 500);
      else res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  issuer = `http://127.0.0.1:${(server.address() as any).port}/oidc`;
  return {
    issuer,
    clientId,
    secret,
    state,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((e) => (e ? reject(e) : resolve()));
      }),
  };
}
