"""Prepare one linked paid correction and current real-client observations."""
from pathlib import Path
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery';S=L/'scripts'
def put(p,s):
 assert not p.exists(),p
 p.write_text(s,encoding='utf-8',newline='\n')
s=(S/'qualify-specialist-roles-203-v4.py').read_text('utf-8')
s=s.replace("OUT=R/'.data/acceptance-203/real-specialists-v4'","OUT=R/'.data/acceptance-204/marketing-correction-v1'")
s=s.replace("previous=load(R/'.data/acceptance-203/real-specialists-v3/receipt.json')","previous=load(R/'.data/acceptance-203/real-specialists-v4/receipt.json')")
anchor="save(OUT/'planned-cases.private.json'";i=s.index(anchor)
s=s[:i]+'''cases=[next(c for c in cases if c['role']=='marketing-analyst')]
cases[0]['prompt'] += " Use a nonnumerical chart title. Keep actual date values in the returned calculation/specification, not in title or narrative prose. Use exact returned current scope IDs and calculation_sha256. Optional narrative can be omitted; this must not remove any requested data or evidence. If a safe tool response explicitly proves input validation did not execute the operation, correct those arguments within this same task and original budget once. Never retry an unknown operation, rerun completed paid work, weaken evidence validation, or report prose as file delivery."
'''+s[i:]
s=s.replace("'retained_passes_not_repeated':8,'new_task_budgets_HKD':5,'new_tasks_maximum':3","'retained_passes_not_repeated':11,'new_task_budgets_HKD':5,'new_tasks_maximum':1")
s=s.replace("'203 corrected controlled '","'204 linked controlled '").replace("'stage':203","'stage':204").replace("'maximum_new_task_HKD':15","'maximum_new_task_HKD':5")
put(S/'qualify-marketing-correction-204-v1.py',s)
s=(S/'qualify-live-marketing-review-203-v4.mjs').read_text('utf-8')
for a,b in [('deployment-203-v1','deployment-204-v1'),('acceptance-203/live-review-','acceptance-204/live-review-'),('203-v4-marketing-review-live','204-v1-marketing-review-live'),('0.7.16','0.7.17'),('stage:203','stage:204')]:
 assert a in s,a;s=s.replace(a,b)
put(S/'qualify-live-marketing-review-204-v1.mjs',s)
print('Prepared one linked terminal marketing correction, retained eleven functional samples, and actual deployed Web/packaged Desktop review observations.')
