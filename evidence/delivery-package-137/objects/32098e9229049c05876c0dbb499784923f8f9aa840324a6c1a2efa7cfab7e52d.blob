type IO = {
  path: string; live: () => boolean; tr: (zh: string,en: string) => string;
  request: (path: string,method?: string,body?: unknown,key?: string) => Promise<any>;
  download: (version: number, hash: string) => Promise<unknown>;
};
/** The side panel reviews cloud results. It never starts a local Agent. */
export function mountDeliveryQuality(container: HTMLElement, io: IO) {
  container.replaceChildren();
  const details=document.createElement("details"),heading=document.createElement("summary"),area=document.createElement("div");
  details.className="delivery-quality";heading.textContent=io.tr("審閱交付與人工投入","Review delivery & human effort");details.append(heading,area);container.append(details);
  let loading=false,loaded=false,pending=false,attempt:{fingerprint:string;key:string}|undefined;
  const make=(tag:string,text?:string)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  const load=async()=>{
    if(loading||!io.live())return;loading=true;area.textContent=io.tr("正在載入…","Loading…");
    try{const data=await io.request(io.path+"/quality");if(!io.live())return;loaded=true;area.replaceChildren();
      const labels:Record<string,string>={pending_review:io.tr("待審閱","Awaiting review"),accepted:io.tr("已接受","Accepted"),changes_requested:io.tr("需修改","Changes requested"),discarded:io.tr("已棄用","Discarded")};
      area.append(make("strong",labels[data.review_state]??data.review_state),make("p",io.tr("你的評價會保留所審閱的版本。","Your review keeps the version you reviewed.")));
      if(data.delivery&&(data.delivery.output_sha256||data.delivery.artifacts.length)){
        const button=document.createElement("button"),status=make("p");button.type="button";
        button.textContent=io.tr("下載完整交付包","Download delivery package");status.setAttribute("role","status");
        button.onclick=()=>{if(pending||!io.live())return;button.disabled=true;
          void io.download(data.task_version,data.delivery_hash).then(()=>{if(io.live())status.textContent=io.tr("已交給瀏覽器下載管理器。","Passed to the browser download manager.");})
            .catch(e=>{if(io.live()){status.setAttribute("role","alert");status.textContent=(e as Error).message;}}).finally(()=>{button.disabled=false;});};
        area.append(button,make("p",io.tr("包含本次雲端成果、版本清單及編輯說明。","Includes this task’s cloud outputs, version manifest and editing instructions.")),status);
      }
      const send=async(action:string,body:unknown,form:HTMLFormElement)=>{
        if(pending||!io.live())return;pending=true;const fingerprint=JSON.stringify([action,body]);
        if(attempt?.fingerprint!==fingerprint)attempt={fingerprint,key:crypto.randomUUID()};
        for(const e of area.querySelectorAll<HTMLButtonElement>("button"))e.disabled=true;
        try{await io.request(io.path+action,"POST",body,attempt.key);if(!io.live())return;attempt=undefined;await load();}
        catch(e){if(io.live()){form.querySelector('[role="alert"]')?.remove();const error=make("p",(e as Error).message);error.setAttribute("role","alert");form.append(error);}}
        finally{pending=false;for(const e of area.querySelectorAll<HTMLButtonElement>("button"))e.disabled=false;}
      };
      if(data.can_review){
        const form=document.createElement("form"),choice=document.createElement("select"),label=make("label",io.tr("整份交付的評價","Review of the complete delivery")),comment=document.createElement("textarea"),note=make("label",io.tr("你的意見（選填）","Your feedback (optional)"));
        for(const key of ["accepted","changes_requested","discarded"]){const o=document.createElement("option");o.value=key;o.textContent=labels[key];choice.append(o);}label.append(choice);comment.maxLength=5000;note.append(comment);
        const save=document.createElement("button");save.type="submit";save.textContent=io.tr("儲存審閱","Save review");form.append(label,note,save);
        form.addEventListener("submit",e=>{e.preventDefault();void send("/reviews",{expected_version:data.task_version,expected_delivery_hash:data.delivery_hash,decision:choice.value,comment:comment.value},form);});area.append(form);
      }
      if(data.can_measure){
        const more=document.createElement("details"),form=document.createElement("form");more.append(make("summary",io.tr("記錄人工投入","Record human effort")));
        form.append(make("p",io.tr("填寫累計數字。未知請留空；0 表示沒有投入。","Enter cumulative figures. Leave unknowns blank; zero means none.")));
        const fields:Record<string,HTMLInputElement>={};
        for(const [key,label,max]of [["baseline_minutes",io.tr("全人工基線（分鐘）","Manual baseline (minutes)"),525600],["human_minutes",io.tr("實際人工投入（分鐘）","Actual human effort (minutes)"),525600],["manual_revisions",io.tr("人工修改次數","Manual revisions"),10000]] as const){
          const item=make("label",label),input=document.createElement("input");input.type="number";input.min="0";input.max=String(max);input.step="1";input.value=data.measurements?.[key]?.toString()??"";fields[key]=input;item.append(input);form.append(item);
        }
        const save=document.createElement("button");save.type="submit";save.textContent=io.tr("儲存人工記錄","Save human effort");form.append(save);more.append(form);area.append(more);
        form.addEventListener("submit",e=>{e.preventDefault();void send("/quality/measurements",{expected_version:data.task_version,...Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,input.value===""?null:Number(input.value)]))},form);});
      }
      for(const review of data.reviews){const item=make("p");item.append(make("strong",labels[review.decision]),make("small",new Date(review.created_at).toLocaleString()+" · "+io.tr(review.current_delivery?"目前交付":"歷史交付",review.current_delivery?"Current delivery":"Historical delivery")));if(review.comment)item.append(make("span",review.comment));area.append(item);}
    }catch(e){if(io.live()){area.textContent=(e as Error).message;const retry=document.createElement("button");retry.type="button";retry.textContent=io.tr("重新載入","Reload");retry.addEventListener("click",()=>void load());area.append(retry);}}
    finally{loading=false;}
  };
  details.addEventListener("toggle",()=>{if(details.open&&!loaded)void load();});
}
