import type { Attachment, ChatIO, ChatScope } from "./conversation.js";
/** A private preview inside the native Side Panel; it creates no browser tab. */
export function openAttachmentPreview(options:{scope:ChatScope;attachment:Attachment;request:ChatIO["request"];live:()=>boolean;tr:(zh:string,en:string)=>string}){
  const {attachment:a,scope,tr}=options;
  if(!a.assetId||!a.versionId)throw new Error(tr("請先完成附件上傳。","Finish uploading this attachment first."));
  const previous=document.activeElement as HTMLElement|null,dialog=document.createElement('dialog');dialog.className='document-preview-dialog';
  const header=document.createElement('header'),title=document.createElement('h3'),closeButton=document.createElement('button');closeButton.type='button';closeButton.textContent='×';header.append(title,closeButton);
  const meta=document.createElement('p'),status=document.createElement('p');status.setAttribute('role','status');
  const navigation=document.createElement('nav'),back=document.createElement('button'),forward=document.createElement('button'),position=document.createElement('span');
  back.type=forward.type='button';navigation.className='document-preview-navigation';navigation.append(back,position,forward);
  const image=document.createElement('img'),details=document.createElement('details'),summary=document.createElement('summary'),text=document.createElement('pre');details.append(summary,text);
  const retry=document.createElement('button');retry.type='button';retry.hidden=true;
  dialog.append(header,meta,navigation,status,image,details,retry);document.body.append(dialog);
  const base=`/v1/tenants/${scope.tenant}/projects/${scope.project}/assets/${a.assetId}/document-preview?asset_version_id=${a.versionId}`;
  let page=1,count=0,closed=false,pending=false,generation=0,unavailable=false,sha=a.sha256,checking=false;
  const close=()=>{if(closed)return;closed=true;++generation;clearInterval(timer);image.removeAttribute('src');text.textContent='';dialog.close();dialog.remove();if(previous?.isConnected)previous.focus();};
  const live=()=>!closed&&options.live();
  const labels=()=>{title.textContent=unavailable?tr('無法預覽此檔案','File preview unavailable'):a.name;closeButton.ariaLabel=tr('關閉預覽','Close preview');
    back.textContent=tr('上一頁','Previous');forward.textContent=tr('下一頁','Next');summary.textContent=tr('此頁文字','Page text');retry.textContent=tr('重試預覽','Retry preview');
    navigation.ariaLabel=tr('文件頁面','Document pages');position.textContent=tr('第 ','Page ')+page+tr(' 頁，共 ',' of ')+count+tr(' 頁','');
    back.disabled=pending||page<=1;forward.disabled=pending||page>=count;navigation.hidden=count===0;};
  const clear=()=>{image.removeAttribute('src');image.hidden=true;text.textContent='';details.hidden=true;};
  const fail=(error:unknown)=>{unavailable=true;clear();labels();meta.textContent='';status.textContent=error instanceof Error?error.message:tr('請重新檢查檔案權限。','Check access to this file again.');retry.hidden=false;};
  const load=async()=>{if(!live()){close();return;}if(pending)return;const g=++generation;pending=true;unavailable=false;clear();retry.hidden=true;status.textContent=tr('正在載入頁面…','Loading page…');labels();
    try{const value=await options.request(scope,base+'&page='+page);if(!live()||g!==generation)return;
      if(value.asset_version_id!==a.versionId||sha&&sha!==value.sha256)throw new Error(tr('附件版本已改變，請關閉後重新開啟。','The attachment version changed. Close and reopen it.'));
      sha=value.sha256;meta.textContent='v'+value.source_version+' · '+Math.ceil(value.size_bytes/1024)+' KB';
      if(value.preview_image&&['image/png','image/jpeg'].includes(value.preview_image.content_type)){
        image.src='data:'+value.preview_image.content_type+';base64,'+value.preview_image.base64;image.alt=a.name+' · '+tr('第 ','Page ')+page;image.hidden=false;
        text.textContent=value.text??'';details.hidden=!value.text;count=value.page_count;status.textContent=tr('預覽不會傳送附件或產生 AI 費用。','Previewing does not send the attachment or incur AI charges.');
      }else{count=0;status.textContent=value.document_preview?.state==='setup_required'?tr('Office 預覽尚未啟用，可繼續使用原附件。','Office preview is unavailable. You can continue using the original attachment.'):tr('此檔案暫不支援分頁預覽，可繼續使用原附件。','Page preview is unavailable for this file. You can continue using the original attachment.');}
    }catch(e){if(live()&&g===generation)fail(e);}finally{if(!closed&&g===generation){pending=false;labels();}}
  };
  const check=()=>{if(!live()){close();return;}labels();};
  const timer=setInterval(()=>{check();if(!live()||checking||pending)return;checking=true;const g=generation;
    void options.request(scope,base+'&describe=true').then(value=>{if(!live()||g!==generation)return;if(value.asset_version_id!==a.versionId||sha&&value.sha256!==sha)throw new Error(tr('附件版本已改變。','The attachment version changed.'));})
      .catch(e=>{if(live()&&g===generation)fail(e);}).finally(()=>{checking=false;});
  },4000);
  back.addEventListener('click',()=>{if(!pending&&page>1){--page;void load();}});forward.addEventListener('click',()=>{if(!pending&&page<count){++page;void load();}});
  retry.addEventListener('click',()=>void load());closeButton.addEventListener('click',close);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  labels();clear();dialog.showModal();void load();return {close,check};
}
