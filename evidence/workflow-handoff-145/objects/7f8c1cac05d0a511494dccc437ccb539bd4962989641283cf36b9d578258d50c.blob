// Executed historical test versions remain intact. The default suite runs
// each current version, while an old test remains directly runnable by Node.
import {readdir} from "node:fs/promises";
import {spawn} from "node:child_process";
const selected=new Map(),plain=[];
for(const name of await readdir(new URL("../tests/",import.meta.url))){
  if(!name.endsWith(".test.ts"))continue;
  const match=/^(.*)-v(\d+)\.test\.ts$/.exec(name);
  if(!match)plain.push("tests/"+name);
  else if(!selected.has(match[1]) || selected.get(match[1]).version<Number(match[2]))selected.set(match[1],{version:Number(match[2]),file:"tests/"+name});
}
const files=[...plain,...[...selected.values()].map(v=>v.file)].sort();
if(process.argv.length===3&&process.argv[2]==="--list")console.log(JSON.stringify(files));
else{
  const child=spawn(process.execPath,["--import","tsx","--test",...process.argv.slice(2),...files],{stdio:"inherit",windowsHide:true});
  child.once("error",error=>{console.error(error.message);process.exitCode=1;});
  child.once("exit",code=>{process.exitCode=code??1;});
}
