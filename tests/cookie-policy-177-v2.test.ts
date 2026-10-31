import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { loadConfig } from "../src/config.js";
import { setSessionCookie } from "../src/auth.js";
import { secureBrowserCookie } from "../src/cookie-policy.js";
import type { Database } from "../src/db.js";

for (const protocol of ["http:", "https:"]) for (const admin of [false,true]) {
  test(`${protocol} synthetic ${admin ? "admin" : "user"} session carries the right wire cookie flags`,async()=>{
    const config=loadConfig({NODE_ENV:"test",DEMO_MODE:"true",WEB_ORIGIN:protocol+"//agent.copypaste.hk",ADMIN_ORIGIN:protocol+"//agent-dashboard.copypaste.hk",API_ORIGIN:protocol+"//ai-api.copypaste.hk"});
    const app=Fastify();await app.register(cookie);
    app.get("/issue",async(_req,reply)=>{setSessionCookie({config} as Database,reply,"synthetic-cookie-value",admin);return {ok:true};});
    try{const r=await app.inject({method:"GET",url:"/issue"});assert.equal(r.statusCode,200);const header=String(r.headers["set-cookie"]);assert.equal(/; Secure(?:;|$)/.test(header),protocol==="https:");assert.match(header,/; HttpOnly/);assert.match(header,/; SameSite=Lax/i);assert.match(header,admin?/^cp_admin_session=.*Path=\/v1\/admin/:/^cp_session=.*Path=\/v1;/);}
    finally{await app.close();}
  });
}
test("each cookie uses its own explicit audience origin rather than the incoming header",()=>{
  const c={NODE_ENV:"development" as const,WEB_ORIGIN:"http://localhost:4317",ADMIN_ORIGIN:"https://agent-dashboard.copypaste.hk",API_ORIGIN:"https://ai-api.copypaste.hk"};
  assert.equal(secureBrowserCookie(c),false);assert.equal(secureBrowserCookie(c,"ADMIN_ORIGIN"),true);assert.equal(secureBrowserCookie(c,"API_ORIGIN"),true);
});
test("production still rejects an HTTP application origin and synthetic mode",()=>{
  assert.throws(()=>loadConfig({NODE_ENV:"production",DEMO_MODE:"true"}),/DEMO_MODE/);
  const c={NODE_ENV:"production" as const,WEB_ORIGIN:"http://invalid.local",ADMIN_ORIGIN:"http://invalid.local",API_ORIGIN:"http://invalid.local"};assert.equal(secureBrowserCookie(c),true);
});
