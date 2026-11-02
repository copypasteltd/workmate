from pathlib import Path
root=Path(__file__).resolve().parents[3]
tests=root/'dev/copypaste-platform/tests'
text=(tests/'provider-termination-189-v1.test.ts').read_text(encoding='utf8')
before="return {...evidence(r,{kind:'text',input_tokens:0,output_tokens:0}),purpose:'termination_only',billed_micros:null,usage,outcome:'failed'};"
after="return {schema_version:1,data_mode:r.data_mode,operation_id:r.operation_id,request_hash:r.request_hash,provider_reference:'Simulated terminal provider response',source_reference:'Owned synthetic request termination observation',source_note:'Explicit simulated termination evidence; no invoice or usage quantity has been established.',observed_at:new Date().toISOString(),terminated:true,currency:'HKD',purpose:'termination_only',billed_micros:null,usage,outcome:'failed'};"
assert text.count(before)==1;text=text.replace(before,after)
assert text.count('WHERE target_id=$1')==1;text=text.replace('WHERE target_id=$1','WHERE target=$1')
with (tests/'provider-termination-189-v2.test.ts').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
