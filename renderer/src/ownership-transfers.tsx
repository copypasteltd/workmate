import {useEffect,useRef,useState} from "react";
import {Link} from "react-router-dom";
import {post,clientSessionGeneration} from "./api";
import {operationKey,completeOperation} from "./operation-key";
import {useWorkspace} from "./context";
import {AsyncForm,DateText,ErrorNotice,Field,Modal,useData,useI18n} from "./ui";
import "./ownership-transfers.css";

export function OwnershipTransferNotice(){
 const w=useWorkspace(),{t}=useI18n();
 const incoming=useData(w.tenant?`/v1/tenants/${w.tenant}/ownership-transfers?direction=incoming&page_size=1`:null,0,15000);
 if(!incoming.data?.items.length)return null;
 return <p className="notice ownership-notice" role="status">{t("你有待確認的企業所有權交接。", "A workspace ownership handover is waiting for your decision.")} <Link to="/app/members">{t("檢視交接", "Review handover")}</Link></p>;
}
export function OwnershipTransfersPanel({recipient,onClear}:{recipient?:any;onClear?:()=>void}){
 const w=useWorkspace(),{t}=useI18n(),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[choice,setChoice]=useState<any>(null),[notice,setNotice]=useState("");
 const base=`/v1/tenants/${w.tenant}/ownership-transfers`,account=w.me.user.id;
 const workspace=w.me.memberships.find((m:any)=>m.id===w.tenant),owner=workspace?.role==="owner";
 const data=useData(base+`?page=${page}&page_size=10`,revision,5000);
 const current=useRef({base,account,recipient,choice});current.current={base,account,recipient,choice};
 const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const names:Record<string,string>={pending:t("等待接收方確認","Waiting for recipient"),accepted:t("已完成交接","Handover completed"),declined:t("接收方已拒絕","Recipient declined"),cancelled:t("已撤銷","Cancelled"),expired:t("已過期","Expired"),invalidated:t("授權已變更，請重新發起","Access changed; start a new handover")};
 async function act(endpoint:string,body:object){
  const identity=current.current,session=clientSessionGeneration(),k=await operationKey(account,endpoint,body);
  const valid=()=>live.current&&session===clientSessionGeneration()&&current.current.base===identity.base&&current.current.account===identity.account&&current.current.recipient===identity.recipient&&current.current.choice===identity.choice;
  if(!valid())return;
  const result=await post(endpoint,body,k);await completeOperation(account,endpoint,body);if(!valid())return;
  setChoice(null);onClear?.();setNotice(names[result.state]??result.state);setRevision(v=>v+1);await w.refresh();
 }
 return <section className="card ownership-panel" aria-label={t("企業所有權交接","Workspace ownership handover")}>
  <div><h2>{t("企業所有權交接","Workspace ownership handover")}</h2><p className="muted">{t("交接需由接收方親自確認；完成後原所有者成為管理員，個人私有資料與付款歸屬不會轉移。","The recipient must confirm personally. The former owner becomes an admin; private materials and billing ownership remain separate.")}</p></div>
  {notice&&<p className="notice" role="status">{notice}</p>}<ErrorNotice error={data.error}/>
  {!data.loading&&data.data&&!data.data.total&&<p className="muted">{t("沒有交接紀錄。所有者可從下方成員清單選擇接收方。","No handovers. An owner can choose a recipient from the member list below.")}</p>}
  <div className="ownership-records">{data.data?.items.map((row:any)=><article className="ownership-record" key={row.id} data-transfer-id={row.id}>
   <strong>{row.from_user?.name||row.from_user?.email} → {row.to_user?.name||row.to_user?.email}</strong><p>{row.to_user?.email}</p><p className="ownership-state">{names[row.state]??row.state}</p><p className="muted">{t("有效至","Valid until")} <DateText value={row.expires_at}/></p>
   {row.state==="pending"&&<div className="row-actions">{row.to_user?.id===account&&<><button className="button primary" onClick={()=>setChoice({row,action:"accept"})}>{t("接管所有權","Accept ownership")}</button><button className="button secondary" onClick={()=>setChoice({row,action:"decline"})}>{t("拒絕交接","Decline handover")}</button></>}{(row.from_user?.id===account||owner)&&<button className="button secondary" onClick={()=>setChoice({row,action:"cancel"})}>{t("撤銷交接","Cancel handover")}</button>}</div>}
  </article>)}</div>
  {data.data?.total>10&&<nav className="ownership-pagination" aria-label={t("交接分頁","Handover pages")}><button className="button secondary" disabled={page===1} onClick={()=>setPage(n=>n-1)}>{t("上一頁","Previous")}</button><span>{page}</span><button className="button secondary" disabled={page*10>=data.data.total} onClick={()=>setPage(n=>n+1)}>{t("下一頁","Next")}</button></nav>}
  {recipient&&owner&&<Modal title={t("交接企業所有權","Transfer workspace ownership")} onClose={()=>onClear?.()}>
   <AsyncForm submitLabel={t("發出交接邀請","Request handover")} onSubmit={f=>act(base,{recipient_id:recipient.user_id,confirmation:String(f.get("confirmation")),acknowledge_responsibility:true})}>
    <p><strong>{recipient.name||recipient.email}</strong> · {recipient.email}</p><p>{t("接收方有24小時確認。在確認之前，你仍保有所屬權限；確認後你將成為admin。其他現有owner不變。","The recipient has24 hours to confirm. You retain your current access until then and become an admin after acceptance. Other existing owners retain their role.")}</p>
    <p className="muted">{t("這不會把個人私有會話、檔案、在途任務或已發生費用交給接收方。","Private conversations, files, running work and existing charges are not transferred to the recipient.")}</p>
    <Field label={t("輸入目前企業全名","Type the current workspace name")}><input name="confirmation" required maxLength={160} autoComplete="off" placeholder={workspace?.name}/></Field><p>{workspace?.name}</p>
    <label className="checkbox-row"><input type="checkbox" required/><span>{t("我確認接收方與企業管理責任變更","I confirm this recipient and the change in workspace responsibility")}</span></label>
   </AsyncForm>
  </Modal>}
  {choice&&<Modal title={choice.action==="accept"?t("確認接管企業","Confirm workspace ownership"):choice.action==="decline"?t("拒絕交接","Decline handover"):t("撤銷交接","Cancel handover")} onClose={()=>setChoice(null)}>
   <AsyncForm submitLabel={choice.action==="accept"?t("確認接管","Confirm acceptance"):choice.action==="decline"?t("確認拒絕","Confirm decline"):t("確認撤銷","Confirm cancellation")} onSubmit={()=>act(base+`/${choice.row.id}/${choice.action}`,{expected_revision:choice.row.revision,acknowledge_responsibility:true})}>
    <p>{choice.row.from_user?.email} → {choice.row.to_user?.email}</p><p>{choice.action==="accept"?t("你將成為此企業的owner，原owner成為admin；接收不改變私人資料歸屬，也不承接其他人的個人付款責任。","You become a workspace owner and the former owner becomes an admin. Acceptance does not transfer private authorship or another person's personal billing responsibility."):t("此交接會結束，現有成員權限不會改變。","This closes the handover without changing current member access.")}</p>
    <label className="checkbox-row"><input type="checkbox" required/><span>{t("我已核對本次交接決定","I have reviewed this handover decision")}</span></label>
   </AsyncForm>
  </Modal>}
 </section>;
}
