import { test } from "node:test";
import assert from "node:assert/strict";
import { beginWorkspaceAttempt, loadWorkspaceAttempt, redactWorkspaceAttempts, completeWorkspaceAttempt } from "../src/workspace-creation.js";
const values = new Map<string,string>();
Object.defineProperty(globalThis, "sessionStorage", { value: { get length() { return values.size; }, key: (i:number) => [...values.keys()][i] ?? null, getItem:(k:string) => values.get(k) ?? null, setItem:(k:string,v:string) => values.set(k,v), removeItem:(k:string) => values.delete(k) }, configurable:true });
const body = { name:"Harbour Studio", project_name:"Autumn" };
test("lost-result reload and simultaneous retries retain one original key; a changed body cannot silently create", async () => {
 values.clear(); const [a,b] = await Promise.all([beginWorkspaceAttempt("owner",body),beginWorkspaceAttempt("owner",body)]);
 assert.equal(a.key,b.key); assert.equal(loadWorkspaceAttempt("owner")?.key,a.key);
 assert.equal((await beginWorkspaceAttempt("owner",body)).key,a.key);
 await assert.rejects(beginWorkspaceAttempt("owner",{...body,name:"Changed"}));
 assert.equal(loadWorkspaceAttempt("owner")?.key,a.key);
});
test("explicit sign-out removes names but retains owner receipt, another account cannot consume it", async () => {
 values.clear(); const a=await beginWorkspaceAttempt("owner",body); redactWorkspaceAttempts();
 const saved=loadWorkspaceAttempt("owner")!; assert.equal(saved.key,a.key); assert.equal(saved.body,undefined);
 assert.equal(loadWorkspaceAttempt("different"),null); assert.ok(!JSON.stringify([...values]).includes("Harbour"));
 completeWorkspaceAttempt("different",a.key); assert.equal(loadWorkspaceAttempt("owner")?.key,a.key);
});
test("sign-out during digest cannot restore private names or a pending request", async () => {
 values.clear(); let active=true; const request=beginWorkspaceAttempt("owner",body,()=>{if(!active) throw new Error("SESSION_CHANGED");});
 active=false; redactWorkspaceAttempts(); await assert.rejects(request,/SESSION_CHANGED/); assert.equal(values.size,0);
});
test("a corrupt stored request fails closed instead of producing another key", async () => {
 values.clear(); values.set("cp_workspace_creation_v1:owner","{corrupt");
 assert.throws(()=>loadWorkspaceAttempt("owner")); await assert.rejects(beginWorkspaceAttempt("owner",body));
 assert.equal(values.get("cp_workspace_creation_v1:owner"),"{corrupt");
});
