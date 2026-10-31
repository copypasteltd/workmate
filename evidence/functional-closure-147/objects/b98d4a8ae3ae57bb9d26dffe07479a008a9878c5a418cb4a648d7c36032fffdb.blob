import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import * as OTPAuth from "otpauth";
import type { VideoSystem, VideoClient } from "./desktop-video-fixture.js";
import { seal } from "../src/lib.js";

export async function videoAdminCall(s: VideoSystem, client: VideoClient | undefined, method: string, url: string, body?: unknown, key = randomUUID() as string) {
  const response = await s.app.inject({ method: method as any, url, headers: {
    origin: s.db.config.ADMIN_ORIGIN, "Idempotency-Key": key,
    ...(client ? { cookie: client.cookie!, "x-csrf-token": client.csrf! } : {}),
    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
  }, ...(body === undefined ? {} : { payload: JSON.stringify(body) }) });
  return { status: response.statusCode, data: response.json(), response };
}

export async function videoAdmin(s: VideoSystem, permissions?: string[], scope = "global", target: string | null = null) {
  const secret = new OTPAuth.Secret({ size: 20 }), email = "generated-video-admin-" + randomUUID() + "@example.invalid";
  const principal = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Synthetic video operator',$2) RETURNING id",
    [email, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0];
  const role = permissions ? "generated-video-fixture-" + randomUUID() : "super_admin";
  if (permissions) await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)", [role, JSON.stringify(permissions)]);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)", [principal.id, role, scope, target]);
  const challenge = await videoAdminCall(s, undefined, "POST", "/v1/admin/auth/challenge", { email });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.data));
  const mail = JSON.parse(await readFile(s.db.config.DATA_DIR + "/mailbox/" + challenge.data.challenge_id + ".json", "utf8"));
  const login = await videoAdminCall(s, undefined, "POST", "/v1/admin/auth/verify", { challenge_id: challenge.data.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0], totp: new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate() });
  assert.equal(login.status, 200, JSON.stringify(login.data));
  const cookie = login.response.cookies.find(c => c.name === "cp_admin_session")!;
  return { id: principal.id, csrf: login.data.csrf_token, cookie: cookie.name + "=" + cookie.value } as VideoClient;
}
