import { chromium, type Browser, type Page } from "playwright";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { WorkmateRecording, saveWorkmateScreenshot } from "./record-workmate-media.js";

const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const owned = path.resolve(".data/audio-accounting-ui", randomUUID()), origin = "http://localhost:4318", root = "/v1/admin/capability-releases";
const checks: string[] = [], errors: string[] = [], screenshots: any[] = [], media: any[] = [], samples: any[] = [];
const load = (file: string) => import(pathToFileURL(path.join(platform, file)).href);
let isolated: any, system: any, provider: any, browser: Browser | undefined, recording: WorkmateRecording | undefined;
let browserClosed = false, apiClosed = false, fixtureClosed = false, providerClosed = false;
const controller = new AbortController(), validators: Record<string, any> = {};
let releaseProviderReply: (() => void) | undefined;
const pass = (label: string) => { checks.push(label); console.log("PASS: " + label); };
const sample = (schema: string, value: any, route: string) => {
  assert.ok(validators[schema](value), JSON.stringify(validators[schema].errors)); samples.push({ schema, route, value }); return value;
};
async function until(read: () => Promise<any>, ok: (value: any) => boolean, label: string, ms = 45000) {
  const end = Date.now() + ms;
  do { const value = await read(); if (ok(value)) return value; await new Promise(resolve => setTimeout(resolve, 180)); } while (Date.now() < end);
  throw new Error("Timed out: " + label);
}
async function observed(page: Page, method: string, route: string, click: () => Promise<any>, schema: string, status = 200) {
  const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === route && r.request().method() === method), click()]);
  assert.equal(response.status(), status, await response.text()); return sample(schema, await response.json(), method + " " + route);
}
async function api(page: Page, url: string, method = "GET", body?: any) {
  return page.evaluate(async ({ url, method, body }) => {
    const me = await (await fetch("/v1/admin/me", { credentials: "include" })).json();
    const response = await fetch(url, { method, credentials: "include", headers: { "Content-Type": "application/json", "X-CSRF-Token": me.csrf_token, "Idempotency-Key": crypto.randomUUID() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: response.status, data: await response.json() };
  }, { url, method, body });
}
async function fit(page: Page) {
  const overflow = await page.evaluate(() => {
    const d = document.documentElement, dialog = document.querySelector('[role="dialog"]');
    return { page: d.scrollWidth - d.clientWidth, dialog: dialog ? dialog.scrollWidth - dialog.clientWidth : 0 };
  });
  assert.ok(overflow.page <= 1 && overflow.dialog <= 1, JSON.stringify(overflow));
}
async function shot(page: Page, name: string) {
  await page.evaluate(async () => { await document.fonts.ready; }); await fit(page);
  screenshots.push(await saveWorkmateScreenshot("admin", "audio-accounting-" + attempt, name, await page.screenshot(),
    "Actual Admin login, immutable audio releases, native decoding, background processor, scoped API and PostgreSQL. Models/accounts and audio provider are explicitly synthetic; not live voice-quality acceptance.", delivery));
}
async function record(page: Page, name: string) {
  assert.equal(recording, undefined);
  recording = new WorkmateRecording("admin", name, "audio-accounting-" + attempt, () => page.screenshot({ type: "jpeg", quality: 85 }),
    "Actual Admin interaction and background service observations in wall-clock time; synthetic company audio provider and original protocol tones; no invented progress or accelerated frames.", delivery);
  await recording.start();
}
async function stopRecording() { assert.ok(recording); media.push(await recording.stop()); recording = undefined; }
async function login(label: string, readOnly = false) {
  const require = createRequire(path.join(platform, "package.json")), OTPAuth = require("otpauth"), { seal } = await load("src/lib.ts");
  const email = "managed-audio-ui-" + randomUUID() + "@example.invalid", secret = new OTPAuth.Secret({ size: 20 });
  const principal = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id", [email, label, seal(system.db.config.MASTER_KEY, secret.base32)])).rows[0].id;
  let role = "super_admin";
  if (readOnly) { role = "audio-read-" + randomUUID(); await system.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)", [role, JSON.stringify(["admin.catalog.read", "admin.ai.requests.read"])]); }
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,$2,'global')", [principal, role]);
  const context = await browser!.newContext({ viewport: { width: 1440, height: 1050 } }); context.setDefaultTimeout(20000);
  await context.addInitScript(site => {
    if (location.origin !== site) return;
    if (!localStorage.getItem("cp_locale")) localStorage.setItem("cp_locale", "en");
    if (!localStorage.getItem("cp_theme")) localStorage.setItem("cp_theme", "light");
  }, origin);
  const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
  await page.goto(origin); await page.getByLabel("Administrator email").fill(email);
  const [challenge] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/auth/challenge"), page.getByRole("button", { name: "Send admin sign-in code", exact: true }).click()]);
  assert.equal(challenge.status(), 200);
  const mail = JSON.parse(await readFile(path.join(isolated.directory, "mailbox", (await challenge.json()).challenge_id + ".json"), "utf8")); assert.equal(mail.to, email);
  await page.locator('input[name="code"]').fill(mail.text.match(/\b\d{6}\b/)[0]);
  await page.locator('input[name="totp"]').fill(new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate());
  const [verified] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === "/v1/admin/auth/verify"), page.getByRole("button", { name: "Verify & open dashboard", exact: true }).click()]);
  assert.equal(verified.status(), 200); await page.waitForURL(readOnly ? "**/provider-control" : "**/overview"); return page;
}
async function catalog(page: Page) {
  await page.goto("about:blank");
  await observed(page, "GET", root, () => page.goto(origin + "/catalog?view=capabilities"), "CapabilityReleaseList");
}
async function detail(page: Page, release: string) {
  await page.locator(`[data-release-id="${release}"]`).getByRole("button", { name: "Configuration & validation", exact: true }).click();
  const d = page.getByRole("dialog", { name: "Configuration & validation", exact: true }); await d.waitFor(); return d;
}
async function start(page: Page, release: string) {
  const d = page.getByRole("dialog", { name: "Configuration & validation", exact: true });
  await d.getByLabel("Validation reason", { exact: true }).fill("Explicit synthetic managed audio browser verification");
  return observed(page, "POST", `${root}/${release}/validations`, () => d.getByRole("button", { name: "Run validation", exact: true }).click(), "CapabilityValidation", 202);
}
async function receipt(page: Page, id: string) {
  const r = await api(page, `${root}/validations/${id}`); assert.equal(r.status, 200); return sample("CapabilityValidation", r.data, "GET audio receipt");
}
const deadline = setTimeout(() => { errors.push("Owned managed-audio Admin UI deadline exceeded"); controller.abort(); void browser?.close(); }, 900000); deadline.unref();
try {
  await mkdir(owned, { recursive: true }); assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN);
  const { isolatedTestEnvironment } = await load("tests/native-test-environment.ts"), { audioProviderFixture } = await load("tests/audio-production-fixture.ts"),
    { buildApp } = await load("src/server.ts"), { loadConfig } = await load("src/config.ts");
  process.chdir(platform); isolated = await isolatedTestEnvironment(); provider = await audioProviderFixture(owned, { allowPlatformVerification: true });
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEV_MAILBOX: "true", WORKER_ENABLED: "true", DEMO_MODE: "false",
    CODEX_BIN: process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, AI_BASE_URL: provider.origin, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "synthetic-video-provider-fixture",
    AI_MODEL: "synthetic-reasoning-v1", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "100", AI_OUTPUT_HKD_MICROS_PER_MILLION: "100",
    AI_SPEECH_VERIFIED: "true", AI_SPEECH_MODEL: "synthetic-speech-v1", AI_SPEECH_VOICES: "alloy", AI_SPEECH_LOCALES: "en", AI_SPEECH_HKD_MICROS_PER_CHARACTER: "100", AI_TRANSCRIPTION_VERIFIED: "false", AI_VERIFICATION_PER_RUN_BUDGET_MICROS: "1000000", AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS: "1000000000000",
  }));
  const capacity = async (slots = 1000) => {
    const row = (await system.db.control.query(`INSERT INTO ai_gateway_policy_versions(data_mode,version,reason,
      global_slots,tenant_slots,actor_slots,text_slots,image_slots,video_slots,audio_slots,verification_slots,
      global_rpm,tenant_rpm,actor_rpm,text_rpm,image_rpm,video_rpm,audio_rpm,verification_rpm,preparation_seconds)
      SELECT 'configured_services',coalesce(max(version),0)+1,'Explicit synthetic managed audio browser capacity',
      1000,1000,1000,1000,1000,1000,$1,1000,100000,100000,100000,100000,100000,100000,100000,100000,30
      FROM ai_gateway_policy_versions WHERE data_mode='configured_services' RETURNING id`, [slots])).rows[0];
    await system.db.control.query("UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'", [row.id]);
  };
  await capacity(); await system.app.listen({ host: "127.0.0.1", port: 4310 });
  const require = createRequire(path.join(platform, "package.json")), { Ajv2020 } = require("ajv/dist/2020.js"), ajv = new Ajv2020({ allErrors: true }); require("ajv-formats")(ajv);
  const definitions = JSON.parse(JSON.stringify(JSON.parse(await readFile(path.resolve(delivery, "../../docs/contracts/audio-accounting.openapi.json"), "utf8")).components.schemas).replaceAll("#/components/schemas/", "#/$defs/"));
  for (const name of Object.keys(definitions)) validators[name] = ajv.compile({ $defs: definitions, $ref: "#/$defs/" + name });
  browser = await chromium.launch({ executablePath: process.env.CHROME_BIN, headless: true });
  const page = await login("Audio configuration administrator"), reviewer = await login("Independent audio reviewer");
  pass("Actual administrator email challenge, TOTP session and distinct independent reviewer");
  async function create(profile: string, model: string, price: string) {
    await catalog(page); await page.getByRole("button", { name: "Create configuration", exact: true }).click();
    const form = page.getByRole("dialog", { name: "Create model configuration", exact: true });
    await form.getByLabel("Capability type", { exact: true }).selectOption(profile);
    await form.getByLabel("Internal model alias", { exact: true }).fill(model);
    await form.getByLabel("Locale codes", { exact: true }).fill("en");
    if (profile === "internal-speech-v1") await form.getByLabel("Company voice IDs", { exact: true }).fill("alloy");
    else await form.locator('input[name="timestamps"]').check();
    await form.locator('input[name="audio_rate"]').fill(price);
    await form.getByLabel("Operation reason", { exact: true }).fill("Explicit synthetic audio configuration for actual browser verification");
    await shot(page, profile === "internal-speech-v1" ? "speech-draft-en" : "transcription-draft-en");
    const drafted = await observed(page, "POST", root + "/drafts", () => form.getByRole("button", { name: "Save configuration", exact: true }).click(), "AdminOperation", 202);
    await page.getByRole("dialog", { name: "Configuration & validation", exact: true }).waitFor();
    const release = drafted.result_ids[0], frozen = await api(page, root + "/" + release); sample("CapabilityRelease", frozen.data, "GET frozen audio definition");
    return { release, frozen: frozen.data };
  }

  const service="/v1/admin/ai", queue=() => page.getByRole("region", {name:"Audio accounting",exact:true});
  const providers=async(p:Page=page)=>{await p.goto(origin+"/provider-control?view=audio");await p.getByRole("heading",{name:"Audio cost and capacity accounting",exact:true}).waitFor();};
  const {release}=await create("internal-speech-v1","synthetic-accounting-ui-v1","0.0001");
  provider.state.drop=true; const failed=await start(page,release);
  const lost=await until(()=>receipt(page,failed.id),r=>r.state==="reconciling","unknown original platform POST"); provider.state.drop=false;
  assert.equal(lost.audio_suite.cases.length,1); const id=lost.audio_suite.cases[0].id, operation=lost.audio_suite.cases[0].operation_id;
  assert.equal(await page.getByRole("button",{name:"Run validation",exact:true}).isDisabled(),true);
  assert.equal(provider.calls.filter((c:any)=>c.operation===operation).length,1);
  await shot(page,"platform-unknown-original-en");
  pass("A real dropped platform POST stays unknown, retains its hold and disables repeat validation in the actual Admin view");
  await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  await record(page,"audio-evidence-and-cost-preview"); await providers();
  const request=sample("AudioAccountingDetail",(await api(page,`${service}/audio-accounting/audio_validation/${id}`)).data,"GET original platform accounting identity");
  async function openRecord(channel:string,id:string){
    const q=queue(); await q.locator('select[name="channel"]').selectOption(channel);
    await q.getByRole("button",{name:"Filter accounting records",exact:true}).click();
    const record=page.locator(`[data-audio-accounting="${id}"]`);await record.getByText("Cost & termination accounting",{exact:true}).click();
    await record.getByText("Original operation",{exact:true}).waitFor();return record;
  }
  async function saveEvidence(record:any,r:any){
    await record.getByText("Submit external evidence for the original request",{exact:true}).click();
    const form=record.locator("form").filter({has:page.getByRole("button",{name:"Save immutable evidence",exact:true})});
    for(const [key,value] of Object.entries({provider_reference:"Synthetic final provider invoice",source_reference:"Explicit fixture original operation evidence",source_note:"Human-submitted synthetic final evidence for the original unknown POST",reason:"Retain independently reviewable original evidence",billable_units:r.cost.quoted_units,invoice_hkd:String(Number(r.cost.quoted_micros)/1000000)}))
      await form.locator(`[name="${key}"]`).fill(String(value));
    const local=await page.evaluate(()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,19));
    await form.locator('[name="observed_at"]').fill(local);await form.locator('[name="terminated"]').check();
    await shot(page,r.channel==="audio_validation"?"platform-immutable-evidence-form-en":"customer-immutable-evidence-form-en");
    const saved=await observed(page,"POST",`${service}/audio-accounting/${r.channel}/${r.id}/evidence`,()=>form.getByRole("button",{name:"Save immutable evidence",exact:true}).click(),"AdminOperation",202);
    const evidence=saved.result_ids[0];await record.locator(`[data-audio-evidence="${evidence}"]`).waitFor();return evidence;
  }
  let accountingRecord=await openRecord("audio_validation",id); const evidence=await saveEvidence(accountingRecord,request);
  await accountingRecord.getByRole("button",{name:"Read evidence",exact:true}).click();
  await accountingRecord.getByText("Original human evidence (audited)",{exact:true}).waitFor();
  const immutable=sample("AudioAccountingEvidence",(await api(page,service+"/audio-evidence/"+evidence)).data,"GET audited human evidence");
  assert.equal(immutable.provider_authenticated,false);assert.equal(immutable.document.operation_id,operation);assert.equal(immutable.document.billed_micros,request.cost.quoted_micros);
  await accountingRecord.getByRole("button",{name:"Close evidence",exact:true}).click();
  pass("The actual evidence form preserves exact micro-HKD and server-owned identity; its audited immutable read is explicitly human evidence");
  async function submitAccounting(record:any,evidence:string,capacity=false){
    const e=record.locator(`[data-audio-evidence="${evidence}"]`), label=capacity?"Preview capacity release":"Preview cost confirmation";
    const form=e.locator("form").filter({has:page.getByRole("button",{name:label,exact:true})});
    await form.locator('[name="reason"]').fill(capacity?"Independently review final termination evidence":"Independently confirm original frozen audio tariff");
    await form.getByRole("button",{name:label,exact:true}).click();
    const d=page.getByRole("dialog",{name:"Preview and independent review",exact:true});
    const preview=await observed(page,"POST",service+"/previews",()=>d.getByRole("button",{name:"Get current preview",exact:true}).click(),"AudioAccountingPreview");
    assert.equal(preview.before.request.state,"unknown");await shot(page,(capacity?"termination-preview-":"cost-preview-")+preview.before.request.channel+"-en");
    const op=await observed(page,"POST",service+"/operations",()=>d.getByRole("button",{name:"Submit for independent review",exact:true}).click(),"AdminOperation",202);
    await d.getByRole("heading",{name:"Submitted for another administrator's review",exact:true}).waitFor();
    await d.getByRole("button",{name:"Close",exact:true}).click();return op;
  }
  const cost=await submitAccounting(accountingRecord,evidence); await stopRecording();
  await page.goto(origin+"/audit?view=approvals&search="+cost.id);await page.getByRole("button",{name:"Review operation",exact:true}).click();
  const self=page.getByRole("dialog",{name:"Independent review",exact:true});await self.getByText("Another administrator must review this operation.",{exact:true}).waitFor();
  assert.equal(await self.getByRole("button",{name:"Confirm review decision",exact:true}).count(),0);await self.getByRole("button",{name:"Close",exact:true}).click();
  await recordMovie();
  async function recordMovie(){await record(reviewer,"audio-independent-cost-and-termination");}
  async function approve(op:any){
    await reviewer.goto(origin+"/audit?view=approvals&search="+op.id);await reviewer.getByRole("button",{name:"Review operation",exact:true}).click();
    const review=reviewer.getByRole("dialog",{name:"Independent review",exact:true});
    await review.getByLabel("Decision",{exact:true}).selectOption("approve");await review.getByLabel("Review reason",{exact:true}).fill("Independent source, exact rate, original operation and current authority review");
    await shot(reviewer,(op.action==="ai.cost.reconcile"?"independent-cost-review-":"independent-termination-review-")+op.id+"-en");
    const [response]=await Promise.all([reviewer.waitForResponse(r=>/\/v1\/admin\/approvals\/[^/]+\/decisions$/.test(new URL(r.url()).pathname)&&r.request().method()==="POST"),review.getByRole("button",{name:"Confirm review decision",exact:true}).click()]);
    assert.equal(response.status(),202,await response.text());const result=sample("AdminOperation",await response.json(),"POST audio accounting independent decision");assert.equal(result.state,"succeeded");
  }
  await approve(cost);
  let facts=sample("AudioAccountingDetail",(await api(page,`${service}/audio-accounting/audio_validation/${id}`)).data,"GET cost-only original accounting");
  assert.equal(facts.cost.state,"manually_confirmed");assert.equal(facts.capacity_held,true);assert.equal(facts.cost.accounting_resolved,false);
  assert.equal(facts.usage_known,false);assert.equal((await receipt(page,failed.id)).audio_suite.verified_cases,0);
  pass("Self-review is unavailable and an actual independent approval confirms cost while retaining capacity, original unknown usage and unqualified media");
  await providers();accountingRecord=await openRecord("audio_validation",id);const termination=await submitAccounting(accountingRecord,evidence,true);await approve(termination);
  facts=sample("AudioAccountingDetail",(await api(page,`${service}/audio-accounting/audio_validation/${id}`)).data,"GET separately resolved capacity");
  assert.equal(facts.capacity_held,false);assert.equal(facts.cost.accounting_resolved,true);assert.equal(facts.state,"unknown");
  assert.equal(provider.calls.filter((c:any)=>c.operation===operation).length,1);await stopRecording();
  await catalog(page);await detail(page,release);await page.getByText("Independent cost and capacity accounting is complete. The original verification remains unqualified; explicitly start a new verification if needed.",{exact:true}).waitFor();assert.equal(await page.getByRole("button",{name:"Run validation",exact:true}).isEnabled(),true);
  assert.equal((await receipt(page,failed.id)).state,"reconciling");await shot(page,"original-verification-accounted-unqualified-en");
  pass("A separate independently approved termination releases capacity; explicit new validation becomes available while the original failed verification and single POST remain");
  await page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
  const {nativeVideoFixture,startNativeVideo,videoOK,videoFinish}=await load("tests/desktop-video-fixture.ts"),{withAudioCustomerConfirmation}=await load("tests/audio-production-fixture.ts"),
    {AudioProduction}=await load("src/audio-production.ts"),{projectAccess}=await load("src/access.ts"),{canonical,hash}=await load("src/lib.ts");
  const f=await nativeVideoFixture(system),started=await startNativeVideo(system,f),task=(await system.db.control.query("SELECT * FROM tasks WHERE id=$1",[started.task.task_id])).rows[0];
  const u=(await system.db.control.query("SELECT * FROM users WHERE id=$1",[f.c.id])).rows[0],actor={id:u.id,email:u.email,name:u.name,authVersion:u.auth_version,audience:"user",sessionId:"",sessionHash:""};
  const authorize=async(tx:any)=>projectAccess(tx,actor,f.tenant,f.project,"write"),audio=new AudioProduction(system.db,system.catalog,system.storage);
  const spec={kind:"speech",text:"Customer original campaign script",locale:"en",voice:"alloy",speed:1,rights:{authorized:true,reference:"Customer-owned original campaign",purpose:"Explicit synthetic browser accounting acceptance"}};
  const job=await withAudioCustomerConfirmation(system,f.web,f.base,task.id,()=>audio.prepare(task,task.fencing_token,spec,"ui_audio_"+randomUUID(),authorize),hash(canonical(spec)));
  provider.state.drop=true;await audio.execute(task,job.id,authorize);provider.state.drop=false;await videoOK(system,f.c,"POST",started.url+"/finish",videoFinish);
  await record(page,"audio-customer-accounting-and-budget-boundary");await providers();accountingRecord=await openRecord("audio_customer",job.id);
  const customer=sample("AudioAccountingDetail",(await api(page,`${service}/audio-accounting/audio_customer/${job.id}`)).data,"GET actual customer audio accounting");
  assert.equal(customer.task_id,task.id);const customerEvidence=await saveEvidence(accountingRecord,customer),customerCost=await submitAccounting(accountingRecord,customerEvidence);await approve(customerCost);
  const actual=await audio.read(actor,f.tenant,f.project,job.id);assert.equal(actual.state,"unknown");assert.equal(actual.actual_micros,null);assert.equal(actual.accounting.cost_source,"human_evidence");assert.deepEqual(actual.assets,[]);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",[task.id])).rows[0].n,0);
  await providers();accountingRecord=await openRecord("audio_customer",job.id);await shot(page,"customer-independent-cost-no-debit-en");await stopRecording();
  pass("An actual dropped customer audio operation uses the same separate scope and approvals; confirmed provenance reaches the customer DTO without media or an automatic debit");
  await page.getByTitle("切換至繁體中文",{exact:true}).click();await page.getByTitle("Theme: light / dark / system",{exact:true}).click();
  await page.setViewportSize({width:640,height:1000});await until(()=>page.locator(".sidebar").evaluate(e=>e.getBoundingClientRect().right),right=>right<=0,"Mobile navigation is closed");await shot(page,"accounting-zh-dark-narrow");await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(()=>document.activeElement!==document.body),true);
  pass("Chinese dark and narrow accounting screens fit without horizontal overflow and keep native keyboard controls usable");
  const reader=await login("Requests-only audio observer",true);await providers(reader);
  const q=reader.getByRole("region",{name:"Audio accounting",exact:true});await q.locator('select[name="channel"]').selectOption("audio_customer");await q.getByRole("button",{name:"Filter accounting records",exact:true}).click();
  const ro=reader.locator(`[data-audio-accounting="${job.id}"]`);await ro.getByText("Cost & termination accounting",{exact:true}).click();await ro.getByText("Original operation",{exact:true}).waitFor();
  assert.equal(await ro.getByText("Submit external evidence for the original request",{exact:true}).count(),0);assert.equal(await ro.getByText("Confirmed cost",{exact:true}).count(),0);
  await shot(reader,"requests-only-no-cost-no-evidence-en");
  const hidden=sample("AudioAccountingDetail",(await api(reader,`${service}/audio-accounting/audio_customer/${job.id}`)).data,"GET requests-only redacted accounting");assert.equal(hidden.cost,undefined);assert.equal(hidden.evidence,undefined);
  assert.deepEqual(provider.errors,[]);pass("A separately authenticated requests-only observer sees operation identity without cost, evidence or financial controls");
} catch (error) {
  errors.push(error instanceof Error ? error.stack ?? error.message : String(error)); console.error(errors.at(-1));
  for (const [index, page] of (browser?.contexts().flatMap(context => context.pages()) ?? []).entries()) if (!page.isClosed()) {
    await page.screenshot({ path: path.join(owned, "failure-" + index + ".png") }).catch(() => {});
    await writeFile(path.join(owned, "failure-" + index + ".json"), JSON.stringify({ url: page.url(), text: await page.locator("body").innerText().catch(() => "unavailable") }, null, 2), { flag: "wx" }).catch(() => {});
  }
} finally {
  clearTimeout(deadline); controller.abort(); releaseProviderReply?.();
  if (recording) try { media.push(await recording.stop()); } catch (error) { errors.push(String(error)); }
  if (browser) await browser.close().then(() => { browserClosed = true; }).catch(error => errors.push(String(error)));
  if (system) await system.app.close().then(() => { apiClosed = true; }).catch((error: any) => errors.push(String(error)));
  if (provider) await provider.close().then(() => { providerClosed = true; }).catch((error: any) => errors.push(String(error)));
  if (isolated) { process.chdir(platform); await isolated.cleanup().then(() => { fixtureClosed = true; }).catch((error: any) => errors.push(String(error))); } process.chdir(delivery);
  const result = { at: new Date().toISOString(), status: !errors.length && browserClosed && apiClosed && fixtureClosed && providerClosed ? "passed" : "failed", checks, errors, screenshots, media, samples,
    browser_closed: browserClosed, api_closed: apiClosed, fixture_closed: fixtureClosed, provider_closed: providerClosed,
    route_inventory: system ? { contract: "actual_fastify_route_inventory", not_full_design_openapi: true, data_mode: "configured_services", routes: [...system.routes].sort((a: any, b: any) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)) } : null,
    not_validated: ["live_company_audio_provider", "live_voice_transcription_and_Cantonese_quality", "full_product_acceptance", "all_original_requirements"] };
  await writeFile(`evidence/audio-accounting-ui-${attempt}-journey.json`, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); assert.equal(result.status, "passed", JSON.stringify(errors));
}
