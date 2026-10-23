"use strict";
const browser=window.nativeBrowser;
const $=id=>document.getElementById(id);
let editing=false;
const chinese=(new URLSearchParams(location.search).get('lang')||navigator.language).startsWith('zh');
if(chinese){$('owner-label').textContent='本机浏览器';$('session-note').textContent='任务停止后，所属页面会自动关闭';$('dismiss').textContent='取消';$('accept').textContent='确认';}
const action=async(name,value)=>{try{$('status').textContent='';return await browser.action(name,value);}catch{$('status').textContent=chinese?'操作未完成，请返回工作台检查任务与权限。':'Action incomplete. Check the task and permission in your workspace.';}};
for(const id of ['minimize','maximize','close','back','forward','reload'])$(id).addEventListener('click',()=>action(id));
$('address').addEventListener('focus',()=>{editing=true;});$('address').addEventListener('blur',()=>{editing=false;});
$('address-form').addEventListener('submit',event=>{event.preventDefault();editing=false;void action('navigate',$('address').value);$('address').blur();});
$('dismiss').addEventListener('click',()=>action('dialog',{accept:false}));$('accept').addEventListener('click',()=>action('dialog',{accept:true,prompt_text:$('prompt-value').value}));
browser.onState(state=>{if(!editing)$('address').value=state.url==='about:blank'?'':state.url;$('back').disabled=!state.canBack;$('forward').disabled=!state.canForward;document.title=(state.title||'Local browser')+' · CopyPaste';$('dialog').hidden=!state.dialog;$('dialog-message').textContent=state.dialog?.message||'';$('prompt-value').hidden=state.dialog?.type!=='prompt';if(state.dialog?.type==='prompt')$('prompt-value').value=state.dialog.defaultPrompt||'';});
void action('state');
