// Current tests retain executed historical conversation attempts unchanged.
import {readdir} from "node:fs/promises";
import {spawn} from "node:child_process";
const files=(await readdir(new URL("../tests/",import.meta.url))).filter(n=>n.endsWith(".test.ts")&&n!=="conversation.test.ts").sort().map(n=>"tests/"+n);
if(process.argv[2]==="--list")console.log(JSON.stringify(files));
else {const child=spawn(process.execPath,["--import","tsx","--test",...files],{stdio:"inherit",windowsHide:true});child.once("error",()=>{process.exitCode=1;});child.once("exit",code=>{process.exitCode=code??1;});}
