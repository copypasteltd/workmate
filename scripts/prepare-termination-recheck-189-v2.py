from pathlib import Path
root=Path(__file__).resolve().parents[3]
tests=root/'dev/copypaste-platform/tests'
text=(tests/'provider-termination-189-v2.test.ts').read_text(encoding='utf8')
assert text.count('ai_budget_used(envelope_id,NULL)')==2
text=text.replace('ai_budget_used(envelope_id,NULL)','ai_budget_used(envelope_id,platform_period_id)')
before="const receipt=await s.db.tx(tx=>taskProviderBudgetReceipt(tx,f.task.id),undefined,true);assert.equal(receipt.uncertain,true);"
after="const receipt=await s.db.tx(tx=>taskProviderBudgetReceipt(tx,f.task.id),undefined,true);assert.equal(receipt.uncertain,name!=='input_count');assert.ok(BigInt(after.used)>0n);if(name==='input_count'){assert.equal(receipt.requests,0);assert.equal(receipt.knownChargeMicros,0);}"
assert text.count(before)==1;text=text.replace(before,after)
with (tests/'provider-termination-189-v3.test.ts').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
