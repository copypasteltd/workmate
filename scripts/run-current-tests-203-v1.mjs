import {readdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
// The old storage-disabled case describes a superseded paid-dispatch contract.
// Retain it as history; its complete suite is carried forward under203 below.
const names=(await readdir('tests')).filter(n=>n.endsWith('.test.ts')).sort(),latest=new Map();
for(const name of names){const m=/^(.+-\d+)-v([1-9]\d*)\.test\.ts$/.exec(name);if(m&&(!latest.has(m[1])||latest.get(m[1]).v<Number(m[2])))latest.set(m[1],{v:Number(m[2]),name});}
const files=names.filter(n=>n!=='work-draft.test.ts'&&(!/^(.+-\d+)-v([1-9]\d*)\.test\.ts$/.test(n)||latest.get(/^(.+-\d+)-v([1-9]\d*)\.test\.ts$/.exec(n)[1]).name===n));
assert.ok(files.includes('work-draft-203-v1.test.ts'));
if(process.argv[2]==='--list'){assert.equal(process.argv.length,3);console.log(JSON.stringify({current_test_files:files.map(n=>'tests/'+n),retained_historical:names.filter(n=>!files.includes(n))}));}
else{assert.equal(process.argv.length,2);const p=spawn(process.execPath,['--import','tsx','--test',...files.map(n=>'tests/'+n)],{env:process.env,windowsHide:true,stdio:'inherit'});p.once('error',()=>process.exitCode=1);p.once('close',c=>process.exitCode=c??1);}
