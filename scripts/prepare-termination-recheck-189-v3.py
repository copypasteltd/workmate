from pathlib import Path
root=Path(__file__).resolve().parents[3]
tests=root/'dev/copypaste-platform/tests'
fixture=(tests/'provider-termination-fixture-189-v1.ts').read_text(encoding='utf8')
before='export {s,a,reviewer,fixture,evidence,registerEvidence,submit,decision,call,ok,root,admin};'
assert fixture.count(before)==1
fixture=fixture.replace(before,'export {s,a,reviewer,fixture,evidence,registerEvidence,submit,decision,call,ok,root,admin,publish};')
with (tests/'provider-termination-fixture-189-v2.ts').open('x',encoding='utf8',newline='\n') as stream:stream.write(fixture)
text=(tests/'provider-termination-189-v3.test.ts').read_text(encoding='utf8')
text=text.replace("import test from 'node:test';","import test,{before} from 'node:test';")
text=text.replace('root,admin} from', 'root,admin,publish} from').replace('provider-termination-fixture-189-v1.js','provider-termination-fixture-189-v2.js')
text=text.replace('\nfunction termination(r:any){', '\n// The source suite established this explicit paid counting policy in an earlier\n// test. Establish it independently here through its actual audited publication.\nbefore(async()=>{await publish();});\n\nfunction termination(r:any){')
with (tests/'provider-termination-189-v4.test.ts').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
