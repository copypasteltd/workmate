"""Complete the explicit shared motion editor batch before unified verification."""
from pathlib import Path
import json

dev=Path(__file__).resolve().parents[2]
web=dev/'copypaste-web';desktop=dev/'copypaste-desktop';backend=dev/'copypaste-platform'
p=web/'src/motion-production.tsx';s=p.read_text('utf-8')
s=s.replace("onChange={e=>{const next=structuredClone(d);if(e.target.value==='cut')", "onChange={e=>apply(()=>{const next=structuredClone(d);if(e.target.value==='cut')")
s=s.replace(";change(next);}}><option value=\"cut\">", ";return next;})}><option value=\"cut\">")
s=s.replace("onChange={e=>{const next=structuredClone(d);next.storyboard[i].transition!.frames=Number(e.target.value);change(next);}}", "onChange={e=>apply(()=>{const next=structuredClone(d);next.storyboard[i].transition!.frames=Number(e.target.value);return next;})}")
s=s.replace('拖延或移動鏡頭時','延長或移動鏡頭時');p.write_text(s,encoding='utf-8',newline='\n')
p=web/'src/video-projects.tsx';s=p.read_text('utf-8')
a=s.index('type Ref =');b=s.index('type Render =',a)
s=s[:a]+'''import {useWorkspace} from './context';
import {motionSeconds,blankMotion,motionValid,type MotionDefinition as Definition,type MotionScene as Scene,type MotionCue as Cue} from './motion-editor-model';
import {MotionStarters,MotionTimeline,MotionFramePreview,MotionSourceChoice as SourceChoice} from './motion-production';
import {useMotionEditor} from './use-motion-editor';
'''+s[b:]
a=s.index('const seconds =');b=s.index('function Editor',a)
s=s[:a]+'''const seconds=motionSeconds,initial=blankMotion;
'''+s[b:]
a=s.index('  const { t, locale } = useI18n(),');b=s.index('  const change =',a)
s=s[:a]+'''  const {t,locale}=useI18n(),w=useWorkspace(),owner=w.me?.user?.id;
  const editor=useMotionEditor(owner?owner+':'+base:'',current?.id??'new',current?.version??0,
    {name:current?.name??'',definition:current?structuredClone(current.definition):initial(locale)});
  const {definition:d,name,setDefinition:set,setName,request}=editor;
  const [busy,setBusy]=useState(false);
'''+s[b:]
a=s.index('  const invalid =');b=s.index('  return (',a)
s=s[:a]+'''  const invalid=!motionValid(d),versionChanged=newer||editor.baseVersion!==(current?.version??0);
  const locked=busy||!!editor.pending||!!editor.recovery||versionChanged;
  const captionGap=(()=>{let start=0;for(const c of d.subtitles){if(c.start_frame>start)return {start_frame:start,end_frame:c.start_frame};start=Math.max(start,c.end_frame);}return start<d.duration_frames?{start_frame:start,end_frame:d.duration_frames}:null;})();
'''+s[b:]
s=s.replace('submitLabel={t("儲存影片工程", "Save video project")}','submitLabel={editor.pending?t("重試原儲存請求","Retry original save"):t("儲存影片工程", "Save video project")}')
s=s.replace('submitDisabled={newer || invalid}','submitDisabled={!!editor.recovery||invalid||(!editor.pending&&versionChanged)}')
s=s.replace('expected_version: current.version','expected_version: editor.baseVersion',1)
s=s.replace('''        if (request.current?.signature !== signature)
          request.current = { signature, key: crypto.randomUUID() };''','''        if(request.current&&request.current.signature!==signature)throw Error(t('請先核對原儲存請求。','Resolve the original save request first.'));
        if(!request.current)request.current={signature,key:crypto.randomUUID()};
        editor.setPending(request.current);''')
s=s.replace('''          onDone(result.id);
        } finally {''','''          editor.completed();
          onDone(result.id);
        } catch(e) {
          if([400,403,404,409,422].includes(Number((e as {status?:number}).status)))editor.setPending(null);
          throw e;
        } finally {''',1)
anchor='''      {newer && ('''
s=s.replace(anchor,'''      <div className="motion-draft-toolbar"><button type="button" className="text-button" disabled={locked||!editor.canUndo} onClick={editor.undo}>{t('復原','Undo')}</button><button type="button" className="text-button" disabled={locked||!editor.canRedo} onClick={editor.redo}>{t('重做','Redo')}</button><span role="status">{editor.dirty?(editor.stored?t('草稿已保留在此工作階段','Draft kept in this session'):t('草稿僅保留於目前視窗，關閉前請儲存','Draft stays in this window; save before closing')):t('尚未修改','No unsaved changes')}</span></div>
      {editor.recovery&&<div className="notice" role="status"><p>{t('找到此帳戶、項目與工程的工作階段草稿。請選擇恢復或捨棄。','A session draft was found for this account, project and work. Restore or discard it.')}</p><button type="button" disabled={editor.recovery.version!==(current?.version??0)&&!editor.recovery.pending} onClick={editor.restore}>{t('恢復草稿','Restore draft')}</button><button type="button" disabled={!!editor.recovery.pending} onClick={editor.discard}>{t('捨棄草稿','Discard draft')}</button>{editor.recovery.pending&&<p>{t('原儲存請求的結果尚未確認。恢復後重試同一請求，不會建立第二份工程。','The original save is unconfirmed. Restore and retry the same request to avoid creating a duplicate work.')}</p>}</div>}
      {editor.pending&&<p className="notice" role="status">{t('正在核對原儲存請求。連線失敗可按重試；確認結果前暫停編輯並保留原請求鍵。','Resolving the original save. Retry if the connection failed; editing is paused and the original request key is retained until the result is known.')}</p>}
      {newer && (''',1)
s=s.replace('<fieldset disabled={busy} className="video-editor-fields">','<div className="motion-editor-layout"><fieldset disabled={locked} className="video-editor-fields">',1)
s=s.replace('''        {text(t("工程名稱", "Project name"), name, 160, setName, false, true)}''','''        <MotionStarters base={base} disabled={locked} choose={set}/>
        {text(t("工程名稱", "Project name"), name, 160, setName, false, true)}
        <p className="muted">{t('儲存後，工程將與此項目有權限的成員共用。','Saving shares this work with authorized members of this project.')}</p>
        <MotionTimeline definition={d} disabled={locked} change={set}/>''',1)
a=s.index('          <Field label={t("幀率", "Frame rate")}>');b=s.index('        <h3>{t("品牌", "Brand")}</h3>',a)
s=s[:a]+'''        </div>
        <p className="muted">{seconds(d).toFixed(3)} s · {d.duration_frames} {t('幀；使用鏡頭編排調整時長與幀率。','frames; use scene arrangement to change timing and frame rate.')}</p>
'''+s[b:]
s=s.replace('<SourceChoice\n','<SourceChoice\n          base={base}\n')
a=s.index('            <div className="video-form-grid">',s.index('{d.storyboard.map'))
b=s.index('            {text(',a)
s=s[:a]+'''            <p className="muted">{s.start_frame}–{s.end_frame} {t('幀；使用上方編排控制調整。','frames; adjust with the arrangement controls above.')}</p>
'''+s[b:]
a=s.index('            <button',s.index('label={t("固定畫面 PNG"'));b=s.index('        <h3>{t("字幕", "Captions")}</h3>',a)
s=s[:a]+'''          </fieldset>
        ))}
'''+s[b:]
a=s.index('          disabled={d.subtitles.length >= 80}');b=s.index('        <h3>{t("音軌與授權", "Audio and rights")}</h3>',a)
s=s[:a]+'''          disabled={d.subtitles.length>=80||!captionGap}
          onClick={()=>{if(captionGap)change({subtitles:[...d.subtitles,{key:'cue_'+crypto.randomUUID().replaceAll('-',''),...captionGap,text:t('加入字幕','Add your caption')}].sort((a,b)=>a.start_frame-b.start_frame)});}}
        ><Plus size={15}/>{t('新增字幕','Add caption')}</button>
'''+s[b:]
s=s.replace('''      </fieldset>
      {invalid && (''','''      </fieldset><MotionFramePreview base={base} definition={d} video={current?.id} version={editor.baseVersion} disabled={invalid||locked}/></div>
      {invalid && (''',1)
s=s.replace('function Player({','export function VideoPlayer({').replace('<Player key=','<VideoPlayer key=')
s=s.replace('''          <Editor
''','''          <Editor key={base+':'+(editing==='new'?'new':editing.id+':'+editing.version)}
''')
p.write_text(s,encoding='utf-8',newline='\n')

css='''
/* Brand-aligned motion production; no horizontal overflow on any editor surface. */
.modal:has(.motion-editor-layout){width:min(1160px,calc(100vw - 32px));max-width:1160px}
.motion-editor-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(250px,340px);gap:24px;align-items:start;min-width:0}
.motion-editor-layout>*{min-width:0}.motion-editor-layout input,.motion-editor-layout textarea,.motion-editor-layout select{max-width:100%;min-width:0}
.motion-draft-toolbar,.motion-scene-actions,.motion-preview-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.motion-draft-toolbar span{font-size:12px;color:var(--muted)}
.motion-starters,.motion-resource,.motion-timeline-editor{border:1px solid var(--line,#e0e3e9);border-radius:12px;padding:14px;background:var(--surface,#fff)}
.motion-starters summary,.motion-resource summary{cursor:pointer;font-weight:600;overflow-wrap:anywhere}
.motion-starter-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:12px}
.motion-starter,.motion-resource-item{padding:12px;border:1px solid var(--line,#e0e3e9);border-radius:10px;background:var(--surface,#fff);color:var(--ink,#161c28);text-align:start;min-width:0;overflow-wrap:anywhere}
.motion-starter span,.motion-starter small,.motion-resource-item span,.motion-resource-item small{display:block}.motion-starter small,.motion-resource-item small{color:var(--muted);font-size:11px;margin-top:5px}
.motion-starter i{display:block;margin-top:12px;padding:14px 8px;background:#f4f5f7;color:#2458df;border-radius:6px;font-size:13px;font-style:normal}
.motion-starter:hover,.motion-resource-item:hover,.motion-resource-item[aria-pressed=true]{border-color:#2458df;background:#f3f6ff}
.motion-scene-strip{list-style:none;padding:0;display:grid;gap:12px}.motion-scene-strip li{padding:12px;background:#f4f5f7;border-radius:10px;min-width:0}.motion-scene-strip strong{display:block;overflow-wrap:anywhere}.motion-scene-strip small{color:var(--muted);font-size:12px}
.motion-scene-actions{margin:8px 0}.motion-scene-actions button{border:1px solid var(--line,#dce1e9);border-radius:6px;padding:6px 9px;background:#fff;color:var(--ink,#161c28);font-size:12px}
.motion-resource-page{margin-top:12px}.motion-resource-list{display:grid;gap:7px;margin:10px 0}.motion-resource-list .motion-resource-item{width:100%}
.motion-frame-preview{position:sticky;top:0;padding:16px;border:1px solid var(--line,#e0e3e9);border-radius:14px;background:#f4f5f7;min-width:0}
.motion-frame-preview h3{margin:0 0 12px}.motion-preview-stage{display:grid;place-items:center;max-width:100%;max-height:470px;margin:0 auto 14px;background:#e6e9f0;border-radius:8px;overflow:hidden}.motion-preview-stage img{width:100%;height:100%;object-fit:contain;display:block}.motion-preview-stage p{font-size:13px;padding:18px;text-align:center;color:#525e71}.motion-preview-actions input{width:90px}.motion-preview-actions span{font-size:12px}.motion-frame-preview .muted{font-size:12px;line-height:1.6}
@media(max-width:1000px){.motion-editor-layout{grid-template-columns:minmax(0,1fr)}.motion-frame-preview{position:static}.motion-preview-stage{max-width:330px}}
@media(max-width:560px){.motion-starter-grid{grid-template-columns:minmax(0,1fr)}.modal:has(.motion-editor-layout){width:calc(100vw - 16px)}}
@media(prefers-reduced-motion:reduce){.motion-editor-layout *{scroll-behavior:auto;transition:none}}
'''
p=web/'src/video-projects.css';p.write_text(p.read_text('utf-8')+css,encoding='utf-8',newline='\n')
names=['video-projects.tsx','video-projects.css','motion-production.tsx','motion-editor-model.ts','motion-draft-state.ts','use-motion-editor.ts']
for name in names:(desktop/'renderer/src'/name).write_text((web/'src'/name).read_text('utf-8'),encoding='utf-8',newline='\n')
for p in [web/'src/api.ts',desktop/'renderer/src/api.ts']:
 s=p.read_text('utf-8');s='import {clearMotionDrafts} from "./motion-draft-state";\n'+s
 s=s.replace('clearDesignDrafts();','clearDesignDrafts(); clearMotionDrafts();');p.write_text(s,encoding='utf-8',newline='\n')
for old,new in [('brand-production-189-v3','brand-production-189-v4'),('dedicated-cloud-189-v3','dedicated-cloud-189-v4'),('workspace-completion-196-v3','workspace-completion-196-v4')]:
 p=backend/'tests'/(new+'.test.ts');assert not p.exists();s=(backend/'tests'/(old+'.test.ts')).read_text('utf-8').replace('./route-inventory-200-v1.js','./route-inventory-201-v1.js').replace('inventory.routes.length,756','inventory.routes.length,759');p.write_text(s,encoding='utf-8',newline='\n')
for folder,version in [('copypaste-platform','0.5.9'),('copypaste-web','0.5.10'),('copypaste-desktop','0.7.14'),('copypaste-delivery','0.5.8')]:
 for name in ['package.json','package-lock.json']:
  p=dev/folder/name;v=json.loads(p.read_text('utf-8'));v['version']=version
  if 'packages' in v:v['packages']['']['version']=version
  p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print(json.dumps({'shared_motion_files':len(names),'route_count':759,'native_main_unchanged':True}))
