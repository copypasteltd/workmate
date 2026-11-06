import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {workInputDependencies,validWorkAttachments} from "../src/work-attachments.ts";
test("selected files satisfy the initial file dependency without an extra unresolved copy while connection approval stays explicit",()=>{
  const file={id:crypto.randomUUID(),assetId:crypto.randomUUID(),name:"approved.csv"};
  assert.deepEqual(workInputDependencies([file],"file","Files","Connection"),[{kind:"file",description:"Files",resource_ids:[file.id]}]);
  assert.deepEqual(workInputDependencies([file],"ga4","Files","Connection"),[{kind:"file",description:"Files",resource_ids:[file.id]},{kind:"connection",provider:"ga4",description:"Connection"}]);
  assert.deepEqual(workInputDependencies([],"file","Files","Connection"),[{kind:"file",description:"Files"}]);
  assert.deepEqual(workInputDependencies([],"","Files","Connection"),[]);
  assert.throws(()=>workInputDependencies([],"arbitrary-provider","Files","Connection"),/WORK_INPUT_INVALID/);
});
test("untrusted attachment metadata never supplies paths, arbitrary keys or duplicate versions",()=>{
  const file={id:crypto.randomUUID(),assetId:crypto.randomUUID(),name:"approved.csv"};
  assert.equal(validWorkAttachments([{...file,path:"C:/private"}]),false);assert.equal(validWorkAttachments([file,file]),false);
  assert.equal(validWorkAttachments([{...file,name:"x".repeat(513)}]),false);assert.equal(validWorkAttachments([file]),true);
});
test("the actual default test entry selects the complete replacement draft contract and retains its old attempt as history",()=>{
  const result=spawnSync(process.execPath,["scripts/run-current-tests-203-v1.mjs","--list"],{encoding:"utf8",windowsHide:true});assert.equal(result.status,0,result.stderr);
  const list=JSON.parse(result.stdout);assert.ok(list.current_test_files.includes("tests/work-draft-203-v1.test.ts"));assert.ok(!list.current_test_files.includes("tests/work-draft.test.ts"));assert.ok(list.retained_historical.includes("work-draft.test.ts"));
});
