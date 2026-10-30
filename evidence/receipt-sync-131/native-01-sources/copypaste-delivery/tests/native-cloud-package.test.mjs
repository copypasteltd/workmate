import test from "node:test";
import assert from "node:assert/strict";
import { packageFiles, digest, validateNativeBundle, validateInstallEntry } from "../native/package-contract.mjs";
const encode = value => Buffer.from(JSON.stringify(value));
function fixture() {
  const text=Buffer.from("Explicit synthetic package bytes; never executed.\n");
  return {format:"copypaste-native-cloud-node-1",version:"1.0.0",platforms:["linux-x64","linux-arm64"],minimum_node_major:22,files:Object.fromEntries(packageFiles.map(name=>[name,{mode:0o644,bytes:text.length,sha256:digest(text),base64:text.toString("base64")}]))};
}
test("a native source bundle requires its externally supplied exact digest and complete fixed file inventory",()=>{
  const value=fixture(),body=encode(value);assert.equal(validateNativeBundle(body,digest(body)).format,value.format);
  assert.throws(()=>validateNativeBundle(body,"a".repeat(64)));
  for(const mutate of [v=>{delete v.files[packageFiles[0]];},v=>{v.files["../../etc/shadow"]=v.files[packageFiles[0]];},v=>{v.files[".env"]=v.files[packageFiles[0]];},v=>{v.enrollment_token="never distribute secrets";},v=>{v.files[packageFiles[0]].secret="never distribute secrets";}]){const v=fixture();mutate(v);const b=encode(v);assert.throws(()=>validateNativeBundle(b,digest(b)));}
});
test("a replacement source, permissive file mode, alternate base64 or unsupported runtime cannot enter the installer",()=>{
  for(const mutate of [v=>{v.files[packageFiles[0]].base64=Buffer.from("replacement").toString("base64");},v=>{v.files[packageFiles[0]].mode=0o777;},v=>{v.files[packageFiles[0]].base64+="\n";},v=>{v.minimum_node_major=18;},v=>{v.platforms=["windows-x64"];}]){const v=fixture();mutate(v);const b=encode(v);assert.throws(()=>validateNativeBundle(b,digest(b)));}
});
test("interrupted installation recovery can restore only fixed managed files with safe modes and exact original bytes",()=>{
  const good={target:"/etc/copypaste-cloud-node.json",mode:0o600,base64:Buffer.from("explicit synthetic prior configuration").toString("base64")};
  validateInstallEntry(good);validateInstallEntry({target:good.target,previously_absent:true});
  for(const changed of [{target:"/etc/shadow"},{target:"/opt/copypaste-cloud-node/../../etc/shadow"},{mode:0o777},{base64:good.base64+"\n"}])assert.throws(()=>validateInstallEntry({...good,...changed}));
  assert.throws(()=>validateInstallEntry({target:good.target,previously_absent:true,base64:good.base64}));
  assert.throws(()=>validateInstallEntry({...good,previously_absent:false}));
});
