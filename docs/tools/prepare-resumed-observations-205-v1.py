from pathlib import Path
import json
R=Path(__file__).resolve().parents[2];L=R/'dev/copypaste-delivery'
def fresh(p,s):
 assert not p.exists(),p;p.write_text(s,'utf-8')
s=(L/'scripts/collect-deployment-observations-205-v1.py').read_text('utf-8').replace('post-deployment-observations-v1.json','post-deployment-observations-v2.json').replace('network-preserved-v1','network-preserved-v2').replace('verify-network-preserved-205-v1','verify-network-preserved-205-v2').replace('final-service-state-v1','final-service-state-v2').replace('collect-final-service-state-205-v1','collect-final-service-state-205-v2')
fresh(L/'scripts/collect-deployment-observations-205-v2.py',s)
s=(L/'scripts/company-qa-tunnel-205-v1.py').read_text('utf-8').replace('acceptance-205/transport-v1','acceptance-205/transport-v2')
fresh(L/'scripts/company-qa-tunnel-205-v2.py',s)
# These documentation assemblers have not been executed; bind their first run
# to the newly observed interrupted deployment and exact resumed receipts.
p=R/'docs/tools/document-integrated-round-205-v1.py';s=p.read_text('utf-8').replace('deploy-steps-v1/read-deployment.stdout.log','deploy-steps-v2/read-deployment.stdout.log').replace('network-preserved-v1.sanitized.json','network-preserved-v2.sanitized.json').replace('final-service-state-v1.sanitized.json','final-service-state-v2.sanitized.json')
needle="write('retained-attempts',{'stage':205,"
assert needle in s
s=s.replace(needle,"resume=load(L/'.data/deployment-205-v1/resume-baseline-v1.sanitized.json');write('interrupted-deployment-baseline',resume)\nwrite('retained-attempts',{'interrupted_deployment':{'original_receipt_sha256':sha(L/'.data/deployment-205-v1/deploy-steps-v1/receipt.json'),'server_boot_time':resume['server_boot_time'],'partial_files_preserved':True,'fresh_preservation_baseline':True},'stage':205,")
p.write_text(s,'utf-8')
print(json.dumps({'status':'prepared','resumed_deployment_receipts':'v2','no_product_source_changes':True}))
