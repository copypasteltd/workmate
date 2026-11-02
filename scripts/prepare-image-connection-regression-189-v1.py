"""Keep the historical binding suite and add real gateway/image persistence cases."""
from pathlib import Path

root=Path(__file__).resolve().parents[3]
platform=root/'dev/copypaste-platform'
source=(platform/'tests/capability-bindings.test.ts').read_bytes()
addition=r'''

test("image generation and edit use the frozen per-model resolver without duplicate global credentials", async () => {
  const f=await fixture(),queued=await createTask(f,"designer"),fixed=await binding(queued.id);
  const original={...s.db.config};let generated:any;
  const seen:any[]=[];const start=requests.length;
  const runtime=new ControlledRuntime(async ctx=>{
    try {
      s.db.config.AI_BASE_URL=undefined;s.db.config.AI_API_KEY=undefined;
      s.db.config.MODEL_CONNECTION_RESOLVER=async request=>{
        seen.push(request);assert.equal(request.taskId,queued.id);
        assert.equal(request.capabilityVersionId,fixed.image!.id);
        assert.equal(request.model,"image-original-fixture");
        return {id:randomUUID(),baseURL:original.AI_BASE_URL!,apiKey:fixtureKey,allowPrivateNetwork:true};
      };
      generated=await ctx.tools.find(t=>t.name==="image2_generate")!.run({prompt:"Create the independently configured image fixture.",filename:"per-model.png"},"per-model-create");
      await ctx.tools.find(t=>t.name==="image2_edit")!.run({asset_id:generated.id,prompt:"Edit the independently configured image fixture.",filename:"per-model-edited.png"},"per-model-edit");
    } finally {Object.assign(s.db.config,original);}
  });
  await worker(runtime).run(f.tenant,queued.id);
  assert.equal((await task(queued.id)).status,"succeeded");
  assert.equal((await task(queued.id)).charged_micros,"400");
  assert.deepEqual(seen.map(v=>v.operation),["images.generate","images.edit"]);
  assert.equal(requests.slice(start).filter(v=>v.path.startsWith("/v1/images/")).length,2);
  assert.ok(generated.id);
});

test("a larger decoded gateway image retains its exact original as an authorized artifact and bills only one image",async()=>{
  const f=await fixture(),queued=await createTask(f,"designer");
  const original=pngFromSVG('<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254"><rect width="1254" height="1254" fill="#2584c6"/></svg>');
  imageResponse={data:[{b64_json:original.toString("base64")}]};let delivered:any;
  await worker(new ControlledRuntime(async ctx=>{
    delivered=await ctx.tools.find(t=>t.name==="image2_generate")!.run({prompt:"Keep the complete upstream original fixture.",filename:"preserved.png"},"preserved-image");
  })).run(f.tenant,queued.id);
  const completed=await task(queued.id);assert.equal(completed.status,"succeeded",completed.error_code);assert.equal(completed.charged_micros,"200");
  const saved=(await s.db.control.query("SELECT a.id,a.name,v.sha256,v.storage_key,v.metadata FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.project_id=$1 ORDER BY a.name",[f.project])).rows;
  assert.equal(saved.length,2);
  const source=saved.find(v=>v.name==="preserved.original.png"),output=saved.find(v=>v.id===delivered.id);
  assert.ok(source&&output);assert.equal(source.sha256,hash(original));
  assert.deepEqual(await s.storage.get(source.storage_key),original);
  assert.equal(output.metadata.image_normalization.original_asset_id,source.id);
  assert.equal(output.metadata.image_normalization.source.sha256,source.sha256);
  assert.equal(output.metadata.image_normalization.source.width,1254);
  assert.equal(output.metadata.image_normalization.output.width,1024);
  assert.equal(output.metadata.image_normalization.applied,true);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM ai_gateway_requests WHERE task_id=$1 AND operation='images.generate'",[queued.id])).rows[0].n,1);
});
'''
target=platform/'tests/capability-bindings-189-v1.test.ts'
with target.open('xb') as output:output.write(source+addition.encode())
print(target)
