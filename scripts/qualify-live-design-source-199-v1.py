from pathlib import Path
import importlib.util,json,time,uuid
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('company_api_199',ROOT/'scripts/live-company-api-199-v1.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
out=ROOT/'.data/acceptance-199/live-source';out.mkdir(parents=True,exist_ok=False)
api=module.CompanyAPI()
report={'stage':199,'status':'running','transport':'Actual production API through authenticated SSH, without reply/model replacement. This is not a public browser or TLS-route acceptance.','checks':[]}
try:
 sources=json.loads((ROOT/'.data/acceptance-199/design-sources.private.json').read_text('utf-8'));tenant=sources['tenant'];project=sources['items'][0]['project_id'];base=f'/v1/tenants/{tenant}/projects/{project}'
 keys={k:str(uuid.uuid4()) for k in ['agent','conversation','message','publish']};(out/'operation-keys.json').write_text(json.dumps(keys,indent=2)+'\n','utf-8')
 agent=api.ok('POST',base+'/agents',{'name':'Round199 design review','role_key':'brand-visual','instructions':'Produce editable vector source through vector_render. Do not generate raster images, browse, or call paid external media tools for this controlled editor review.'},keys['agent'])
 conversation=api.ok('POST',base+'/conversations',{'name':'Round199 actual vector source','agent_id':agent['id']},keys['conversation'])
 scene={'width':1200,'height':800,'background':'#f8f2e8','layers':[
  {'kind':'rect','id':'panel','x':48,'y':48,'w':1104,'h':704,'fill':'#ead9c5','stroke':None,'stroke_width':0,'radius':24},
  {'kind':'text','id':'headline','x':140,'y':160,'w':900,'h':200,'text':'Make room for\nyour next idea.','font_size':72,'weight':700,'color':'#372f2b','align':'left','line_height':1.2},
  {'kind':'text','id':'note','x':140,'y':460,'w':700,'h':80,'text':'COPYPASTE  /  DESIGN STUDIO','font_size':24,'weight':400,'color':'#8b543a','align':'left','line_height':1.4},
  {'kind':'ellipse','id':'accent','x':930,'y':540,'w':120,'h':120,'fill':'#bc6843','stroke':None,'stroke_width':0}]}
 payload={'title':'Make room for your next idea.','locale':'en-HK','purpose':'Controlled editor acceptance artwork. Create real editable source and rendered files with no external media requests.','scene':scene}
 prompt='Create this actual editable vector design using vector_render. Use the exact supplied geometry and copy. The studio composition is already approved for this controlled review. Call the tool and deliver its vector.source.json and rendered files; do not merely return prose or invent file IDs. Do not use image generation. Input: '+json.dumps(payload,ensure_ascii=False)
 accepted=api.ok('POST',base+'/conversations/'+conversation['id']+'/messages',{'body':prompt,'expected_version':conversation['version'],'intent':'delegate','mode':'execute','budget_micros':5000000,'client_message_id':str(uuid.uuid4())},keys['message'])
 task_id=accepted['task']['id'];report.update(tenant_id=tenant,project_id=project,task_id=task_id,conversation_id=conversation['id']);(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n','utf-8');print(json.dumps({'task_id':task_id,'status':'submitted','budget_HKD':5}),flush=True)
 deadline=time.monotonic()+360;last=None
 while True:
  task=api.ok('GET',base+'/tasks/'+task_id)
  if task['status']!=last:print(json.dumps({'task_id':task_id,'status':task['status']}),flush=True);last=task['status']
  if task['status'] in ['succeeded','failed','cancelled','needs_input','reconciling']:break
  assert time.monotonic()<deadline,'The real model task did not finish within the bounded observation';time.sleep(3)
 report['task']={k:task[k] for k in ['status','error_code','charged_micros','accrued_micros','cost_state','data_mode'] if k in task};assert task['status']=='succeeded',report['task']
 workspace=api.ok('GET',base+'/tasks/'+task_id+'/workspace');matches=[f for f in workspace['files'] if f['name'].endswith('vector.source.json')];assert len(matches)==1
 f=matches[0];published=api.ok('POST',base+'/assets/'+f['asset_id']+'/publish',{'name':'Round199 actual vector.source.json','expected_version':f['version']},keys['publish'])
 current=api.ok('GET',base+'/editable-projects/sources');rows=[v for v in current['items'] if v['name']=='Round199 actual vector.source.json'];assert len(rows)==1
 report.update(status='passed',source=rows[0],transport_did_not_change_services=True,model_result_not_replaced=True)
 print(json.dumps({'status':'passed','task_id':task_id,'source_version_id':rows[0]['source_version_id'],'task':report['task']}),flush=True)
except Exception as e:
 report.update(status='failed',error=type(e).__name__+': '+str(e)[:240]);print(json.dumps({'status':'failed','error':report['error']}),flush=True);raise
finally:
 api.close();(out/'receipt.json').write_text(json.dumps(report,indent=2)+'\n','utf-8')
