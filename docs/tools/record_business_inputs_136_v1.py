"""Record bounded business-input execution, preserving every original attempt."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re
from record_source_build_reproduction_v1 import credentials, scan
ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/'dev'
DELIVERY=DEV/'copypaste-delivery'
RAW=DELIVERY/'evidence/business-inputs-136'
OUT=ROOT/'docs/quality/business-inputs-evidence-136'
CP=ROOT/'docs/quality/business-inputs-checkpoint-136.json'
PREVIOUS=DELIVERY/'.data/client-errors-135/publication-9141b64c-7cdf-4199-be72-f5f4d8336be3/receipt.json'
def sha(body): return sha256(body).hexdigest()
def read(file): return json.loads(file.read_bytes())
def ref(file): return {'path':file.relative_to(ROOT).as_posix(),'sha256':sha(file.read_bytes())}
def encoded(obj): return (json.dumps(obj,ensure_ascii=False,indent=2)+chr(10)).encode()
def report(stem):
 row=read(RAW/(stem+'.json'))
 for key in ['source_manifest','raw_log','verifier']:
  item=row[key]; assert sha((DELIVERY/item['path']).read_bytes())==item['sha256']
 sources=read(DELIVERY/row['source_manifest']['path'])
 for name,item in sources.items(): assert sha((DELIVERY/item['path']).read_bytes())==item['sha256'], name
 return row,sources
def verify():
 cp,index=read(CP),read(OUT/'index.json')
 assert cp['status']=='verified_business_clarification_and_continuation'
 assert cp['evidence_index']==ref(OUT/'index.json')
 assert index['recorder_sha256']==sha(Path(__file__).read_bytes())
 needles=credentials()
 for item in index['originals']:
  body=(OUT/item['archive']).read_bytes(); assert len(body)==item['bytes'] and sha(body)==item['sha256']; scan(item['source'],body,needles)
 for name,digest in cp['source_files'].items(): assert sha((ROOT/name).read_bytes())==digest,name
 for name,digest in cp['qualification_sources'].items(): assert sha((ROOT/name).read_bytes())==digest,name
 for item in cp['media_files']: assert sha((DEV/item['path']).read_bytes())==item['sha256']
 for stem in cp['selected_attempts'].values():
  row,_=report(stem); assert row['status']=='passed' and row['sources_unchanged'] and row['database_shutdown']==0
 assert cp['counts']['actual_client_journey_checks']==14 and cp['counts']['screenshots']==9 and cp['counts']['recording_pairs']==3
 assert cp['new_full_acceptance_closures']==0
 return {'status':'verified','checkpoint_sha256':sha(CP.read_bytes()),'source_files':len(cp['source_files']),'originals':len(index['originals']),'media_files':len(cp['media_files']),'selected_attempts':cp['selected_attempts']}
def record(backend,ui):
 assert not CP.exists() and not OUT.exists()
 selected={'backend':'backend-'+backend,'ui':'ui-'+ui}
 b,bs=report(selected['backend']); u,us=report(selected['ui'])
 assert b['status']==u['status']=='passed' and b['sources_unchanged'] and u['sources_unchanged']
 assert b['database_shutdown']==u['database_shutdown']==0 and b['port_closed'] and all(u['ports_closed'].values()) and u['package_unchanged']
 assert {k:v['sha256'] for k,v in bs.items()}=={k:v['sha256'] for k,v in us.items()}
 build=u['reused_builds']; build_file=DELIVERY/build['path']; build_receipt=read(build_file)
 assert sha(build_file.read_bytes())==build['sha256']
 assert build_receipt['commands']==build['commands'] and len(build['commands'])==11 and all(row['exit_code']==0 for row in build['commands'])
 assert build_receipt['sources_unchanged'] and build_receipt['package_unchanged']
 assert build_receipt['source_manifest']==build['source_manifest'] and build_receipt['package_files']==build['package_files']==u['package_files']
 assert {k:v['sha256'] for k,v in read(DELIVERY/build['source_manifest']['path']).items()}=={k:v['sha256'] for k,v in us.items()}
 build_log=(DELIVERY/build_receipt['raw_log']['path']).read_bytes(); assert sha(build_log)==build_receipt['raw_log']['sha256']
 assert re.findall(r'^# tests (\d+)\r?$',build_log.decode('utf-8'),re.M)==['12']
 journey=read(DELIVERY/u['journey']['path']); assert sha((DELIVERY/u['journey']['path']).read_bytes())==u['journey']['sha256']
 assert journey['status']=='passed' and len(journey['checks'])==14 and len(journey['screenshots'])==9 and len(journey['recordings'])==3 and len(journey['layouts'])==7
 assert all(journey[k] for k in ['browser_closed','extension_closed','desktop_closed','api_closed','fixture_closed'])
 assert all(r['distinct_frames']>1 and r['skipped_capture_errors']==0 for r in journey['recordings'])
 media=[*journey['screenshots'],*[f for r in journey['recordings'] for f in r['files']]]
 before=read(PREVIOUS); assert before['status']=='pushed_and_verified'
 assert before['remote_after']['docs']=='1cc879572bcb37452b00ba0d38d8a4ae63ed187e'
 OUT.mkdir(parents=True)
 originals=[]; needles=credentials()
 def retain(file):
  body=file.read_bytes(); digest=sha(body); name='blobs/'+digest+'.blob'; target=OUT/name; target.parent.mkdir(parents=True,exist_ok=True)
  scan(file.relative_to(ROOT).as_posix(),body,needles)
  if not target.exists():
   with target.open('xb') as stream: stream.write(body)
  else: assert target.read_bytes()==body
  originals.append({'source':file.relative_to(ROOT).as_posix(),'archive':name,'sha256':digest,'bytes':len(body)})
 # Source bytes already ship in delivery's immutable content-addressed objects.
 # Reports retain their exact manifests and refer to those branch-bound objects;
 # do not manufacture thousands of second copies in the documentation checkout.
 attempts=[]
 for file in sorted(RAW.rglob('*')):
  if not file.is_file() or 'objects' in file.relative_to(RAW).parts: continue
  retain(file)
  if re.fullmatch(r'(backend|ui)-\d{2}\.json',file.name): attempts.append({'source':file.relative_to(ROOT).as_posix(),'status':read(file)['status']})
 for item in media: retain(DEV/item['path'])
 for file in [PREVIOUS,PREVIOUS.with_name('commands.log'),ROOT/before['incremental_history_and_links']['path']]: retain(file)
 extra={}
 for row in [b,u]:
  content=(DELIVERY/row['verifier']['path']).read_bytes()
  matched=[file for file in (DELIVERY/'scripts').glob('qualify-business-inputs*.mjs') if file.read_bytes()==content]; assert len(matched)==1
  extra[matched[0].relative_to(ROOT).as_posix()]=sha(content)
 native_journey=RAW/(selected['ui']+'-journey-verifier.ts'); content=native_journey.read_bytes()
 matched=[file for file in (DELIVERY/'scripts').glob('qa-business-inputs-136-v*.ts') if file.read_bytes()==content]; assert len(matched)==1
 extra[matched[0].relative_to(ROOT).as_posix()]=sha(content)
 full=DELIVERY/'scripts/qualify-business-inputs-ui-136-full-v1.mjs'
 expected=(DELIVERY/'scripts/qualify-business-inputs-ui-136-v1.mjs').read_text(encoding='utf-8').replace('qa-business-inputs-136-v1.ts','qa-business-inputs-136-v4.ts')
 assert full.read_text(encoding='utf-8')==expected
 assert read(DELIVERY/'package.json')['scripts']['qa:business-inputs']=='node scripts/qualify-business-inputs-ui-136-full-v1.mjs'
 for name in ['scripts/record-workmate-media.ts','scripts/qualify-business-inputs-ui-136-full-v1.mjs','package.json','package-lock.json','tsconfig.json']:
  file=DELIVERY/name; extra[file.relative_to(ROOT).as_posix()]=sha(file.read_bytes())
 counts=[int(n) for n in re.findall(r'^# tests (\d+)\r?$',(DELIVERY/b['raw_log']['path']).read_text(encoding='utf-8'),re.M)]
 assert len(counts)==2
 index={'at':datetime.now(timezone.utc).isoformat(),'recorder_sha256':sha(Path(__file__).read_bytes()),'originals':originals,'attempts':attempts,
  'source_archive_repository':'delivery','source_archive_description':'Exact original source manifests and content-addressed source blobs are preserved in the delivery branch and bound by the publication proof manifest. Original failed attempts retain their own source snapshots.',
  'selected_attempts':selected,'scope':'Bounded business questions, actual native backend Codex and separately scripted three-client UI journeys; synthetic provider replies and business data.'}
 (OUT/'index.json').write_bytes(encoded(index))
 cp={'at':datetime.now(timezone.utc).isoformat(),'status':'verified_business_clarification_and_continuation','counts':{'backend_integration_tests':counts[0],'extension_state_tests':counts[1],'native_binding_tests':12,'actual_client_journey_checks':14,'screenshots':9,'recording_pairs':3,'actual_layouts':7,'backend_commands':len(b['commands']),'client_build_commands':len(u['commands']),'reused_identical_full_build_commands':len(build['commands'])},
  'selected_attempts':selected,'evidence_index':ref(OUT/'index.json'),'source_files':{'dev/'+name:row['sha256'] for name,row in bs.items()},'qualification_sources':extra,'media_files':media,
  'previous_checkpoint':ref(ROOT/'docs/quality/client-errors-checkpoint-135.json'),'previous_publication_receipt':next({'archive':r['archive'],'sha256':r['sha256']} for r in originals if r['source']==PREVIOUS.relative_to(ROOT).as_posix()),
  'scope':'Actual measured native Codex business clarification and original-thread continuation; Web, unsigned packaged Desktop cloud task details and actual right Chrome SIDE_PANEL tested with scripted tools and synthetic business replies. Local Desktop Codex question behavior is retained from its original qualification, not newly qualified by these cloud-task journeys.',
  'new_full_acceptance_closures':0,'whole_platform_runtime_rerun':False,'accepted_requirements_unchanged':['REQ-095'],'required_open':88,'unconfirmed_suggestions':12,'optional_open':1}
 CP.write_bytes(encoded(cp)); print(json.dumps(verify()))
if __name__=='__main__':
 parser=argparse.ArgumentParser(); group=parser.add_mutually_exclusive_group(required=True); group.add_argument('--record',action='store_true'); group.add_argument('--verify',action='store_true'); parser.add_argument('--backend',default='03'); parser.add_argument('--ui',default='05'); args=parser.parse_args()
 if args.record: record(args.backend,args.ui)
 else: print(json.dumps(verify()))
