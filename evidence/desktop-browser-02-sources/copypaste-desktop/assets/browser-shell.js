"use strict";
const browser=window.nativeBrowser;
const $=id=>document.getElementById(id);
let editing=false;
const chinese=navigator.language.startsWith('zh');
if(chinese){$('owner-label').textContent='本机浏览器';$('session-note').textContent='任务停止后，所属页面会自动关闭';$('dismiss').textContent='取消';$('accept').textContent='确认';}
const action=async(name,value)=>{try{$('status').textContent='';return await browser.action(name,value);}catch{$('status').textContent=chinese?'操作未完成，请返回工作台检查任务与权限。':'Action incomplete. Check the task and permission in your workspace.';}};
for(const id of ['minimize','maximize','close','back','forward','reload'])$(id).addEventListener('click',()=>action(id));
$('address').addEventListener('focus',()=>{editing=true;});$('address').addEventListener('blur',()=>{editing=false;});
$('address-form').addEventListener('submit',event=>{event.preventDefault();editing=false;void action('navigate',$('address').value);$('address').blur();});
$('dismiss').addEventListener('click',()=>action('dialog',false));$('accept').addEventListener('click',()=>action('dialog',true));
browser.onState(state=>{if(!editing)$('address').value=state.url==='about:blank'?'':state.url;$('back').disabled=!state.canBack;$('forward').disabled=!state.canForward;document.title=(state.title||'Local browser')+' · CopyPaste';$('dialog').hidden=!state.dialog;$('dialog-message').textContent=state.dialog?.message||'';});
void action('state');
