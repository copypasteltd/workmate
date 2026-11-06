"""Bind the actual live pre-execution chart correction to this release evidence."""
from pathlib import Path
import json
R=Path(__file__).resolve().parents[2]
p=R/'docs/tools/document-integrated-round-204-v1.py';s=p.read_text('utf-8-sig')
needle="prior_roles=load(OLD/'specialist-functional-samples.json');selected=copy.deepcopy(prior_roles['selected']);assert len(selected)==11"
insert="""events_path=L/'.data/acceptance-204/marketing-correction-v2/marketing-analyst/events.private.json'
events=load(events_path)
keys=['tool','call_ref','arguments_sha256','code','category','operation_outcome','can_correct_arguments','fields']
tool_events=[{'id':e['id'],'kind':e['kind'],'body':{k:e['body'][k] for k in keys if k in e['body']}} for e in events if e['kind'] in ['runtime.tool.failed','runtime.tool.completed','runtime.tool.recovered']]
chart=[e for e in tool_events if e['body'].get('tool')=='chart_render']
assert [e['kind'] for e in chart]==['runtime.tool.failed','runtime.tool.completed','runtime.tool.recovered']
assert chart[0]['body']['code']=='TOOL_INPUT_INVALID' and chart[0]['body']['operation_outcome']=='not_performed' and chart[0]['body']['can_correct_arguments']
assert chart[0]['body']['call_ref']!=chart[1]['body']['call_ref'] and chart[1]['body']['call_ref']==chart[2]['body']['call_ref']
assert sample['task']['status']=='succeeded' and len(sample['files'])==9 and sample['task']['charged_micros']=='306432'
put('marketing-tool-recovery.json',{'stage':204,'status':'passed','task_id':sample['task_id'],'parent_task_id':sample['known_terminal_correction_of'],'events_source_sha256':sha(events_path),'events':tool_events,'actual_charge_micros':sample['task']['charged_micros'],'files':sample['files'],'scope':'One actual company Codex task corrected a proven pre-execution input-validation failure within its original HKD5 budget. Durable failed/completed/recovered events, nine downloaded files and actual usage agree. No paid task replay or historical-root-cause inference.'})
"""
assert s.count(needle)==1;s=s.replace(needle,insert+needle)
s=s.replace('| 营销样例 | [本轮唯一关联修正](marketing-functional-sample.json)，', '| 营销样例 | [本轮唯一关联修正](marketing-functional-sample.json)、[实际校验失败与同任务恢复](marketing-tool-recovery.json)，')
p.write_text(s,encoding='utf-8',newline='\n')
p=R/'docs/tools/finalize-integrated-round-204-v1.py';s=p.read_text('utf-8-sig')
needle="roles=load(Q/'specialist-functional-samples.json');"
assert s.count(needle)==1
s=s.replace(needle,"recovery=load(Q/'marketing-tool-recovery.json');assert recovery['status']=='passed' and len(recovery['files'])==9 and recovery['actual_charge_micros']=='306432'\n"+needle)
p.write_text(s,encoding='utf-8',newline='\n')
print(json.dumps({'status':'prepared','actual_event_chain':'failed/completed/recovered','new_model_calls':0}))
