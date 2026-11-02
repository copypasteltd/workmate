from pathlib import Path
import json

scripts=Path(__file__).resolve().parent
text=(scripts/'configure-image-model-189-v1.sh').read_text(encoding='utf8')
text=text.replace('image-model-state.private.json','image-model-gpt-image-2-state.private.json').replace('gpt-image-2.5','gpt-image-2')
before="if(!state.release_id){const created=await operation('draft','/v1/admin/capability-releases/drafts',draft);assert.equal(created.state,'succeeded');state.release_id=created.result_ids[0];await save();}"
after="if(!state.release_id){const previous=await api('/v1/admin/capability-releases/a2dfd382-bc5c-492f-97d1-c93afbb25450');const edit={...draft,expected_version:previous.version,expected_revision:previous.management_revision};const created=await operation('edit','/v1/admin/capability-releases/'+previous.id+'/edits',edit);assert.equal(created.state,'succeeded');state.release_id=created.result_ids[0];state.model_id=previous.model_id;await save();}"
assert text.count(before)==1
text=text.replace(before,after)
with (scripts/'configure-image-model-189-v2.sh').open('x',encoding='utf8',newline='\n') as stream:stream.write(text)
print(json.dumps({'created':'configure-image-model-189-v2.sh','scope':'Owner-requested gpt-image-2 edit within the same model entry; previous attempts retained.'}))
