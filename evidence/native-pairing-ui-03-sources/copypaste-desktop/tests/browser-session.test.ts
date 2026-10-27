import { test } from "node:test";
import assert from "node:assert/strict";
import { browserURL, validateBrowserArguments, type BrowserToolCall } from "../src/browser-contract.js";
import { GuardedBrowserSession, type BrowserDriver } from "../src/browser-session.js";
const call = (arguments_: Record<string, unknown> = {}): BrowserToolCall => ({ namespace: "copypaste_browser", tool: "tabs", arguments: arguments_, callId: "call_browser_1", threadId: "native-thread", turnId: "native-turn" });
const result = { success: true, contentItems: [{ type: "inputText" as const, text: "actual-result" }] };
function fixture() {
  let calls=0,closed=0,permitted=true;
  const driver: BrowserDriver = { execute: async()=>{calls++;return structuredClone(result);},close:async()=>{closed++;} };
  const bridge = new GuardedBrowserSession(driver,async()=>{if(!permitted)throw new Error("permission withdrawn");});
  return {bridge,driver,calls:()=>calls,closed:()=>closed,revoke:()=>{permitted=false;}};
}
test("native browser call ID binds parameters before concurrent effects and returns immutable cached results",async()=>{
  const f=fixture(),signal=new AbortController().signal;
  const [a,b]=await Promise.all([f.bridge.call(call(),signal),f.bridge.call(call(),signal)]);
  assert.equal(f.calls(),1);a.contentItems[0]={type:"inputText",text:"tampered"};assert.deepEqual(b,result);
  assert.deepEqual(await f.bridge.call(call(),signal),result);
  await assert.rejects(f.bridge.call({...call(),tool:"open",arguments:{url:"https://example.com"}},signal),{code:"BROWSER_CALL_ID_CONFLICT"});
  assert.equal(f.calls(),1);await f.bridge.close();
});
test("revocation denies cached browser observations as well as new side effects",async()=>{
  const f=fixture(),signal=new AbortController().signal;await f.bridge.call(call(),signal);f.revoke();
  await assert.rejects(f.bridge.call(call(),signal),/permission withdrawn/);assert.equal(f.calls(),1);await f.bridge.close();
});
test("unknown browser outcomes are recorded before rejection and never replayed",async()=>{
  const f=fixture();let accepted=0;f.driver.execute=async()=>{accepted++;throw new Error("outcome unknown");};
  for(let i=0;i<2;i++)await assert.rejects(f.bridge.call(call(),new AbortController().signal),/outcome unknown/);
  assert.equal(accepted,1);await f.bridge.close();
});
test("aborting a pending browser wait closes its driver immediately and close is idempotent",async()=>{
  const f=fixture(),controller=new AbortController();let entered!:()=>void;
  const ready=new Promise<void>(resolve=>{entered=resolve;});
  f.driver.execute=async(_tool,_args,signal)=>new Promise((_resolve,reject)=>{entered();signal.addEventListener("abort",()=>reject(new Error("aborted")),{once:true});});
  const pending=f.bridge.call(call(),controller.signal);await ready;controller.abort();
  await assert.rejects(pending,/aborted/);await f.bridge.close();assert.equal(f.closed(),1);
  await assert.rejects(f.bridge.call(call(),new AbortController().signal),{code:"BROWSER_INTERRUPTED"});
});
test("strict native browser schemas reject extra fields, malformed references and incomplete actions before effects",async()=>{
  const f=fixture();await assert.rejects(f.bridge.call(call({elevate:true}),new AbortController().signal),{code:"BROWSER_INPUT_INVALID"});assert.equal(f.calls(),0);
  for(const args of [{action:"click"},{action:"fill",ref:"stale",text:"x"},{action:"scroll",x:0,y:Infinity},{action:"click",x:2,y:3,text:"extra"},{action:"upload",ref:"1234567890abcdef:1",files:[]}])
    assert.throws(()=>validateBrowserArguments("interact",{tab_id:"11111111-1111-1111-1111-111111111111",...args}),{code:"BROWSER_INPUT_INVALID"});
  assert.throws(()=>validateBrowserArguments("wait",{tab_id:"11111111-1111-1111-1111-111111111111",state:"ready",timeout_ms:30001}),{code:"BROWSER_INPUT_INVALID"});await f.bridge.close();
});
test("local browser URLs allow customer HTTP applications but reject local files, privileged schemes and embedded credentials",()=>{
  assert.equal(browserURL("http://127.0.0.1:4317/page"),"http://127.0.0.1:4317/page");
  for(const url of ["file:///C:/private.txt","javascript:alert(1)","chrome://settings","devtools://inspect","data:text/html,test","https://user:secret@example.com"])
    assert.throws(()=>browserURL(url),{code:"BROWSER_URL_INVALID"});
});
