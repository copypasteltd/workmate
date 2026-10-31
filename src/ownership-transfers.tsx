import {useEffect,useRef,useState} from "react";
import {api,clientSessionGeneration} from "./api";
import {operationKey,completeOperation} from "./operation-key";
import {AsyncForm,DateText,ErrorNotice,useData,useI18n} from "./ui";
import "./ownership-transfers.css";

export function OwnershipTransferAdmin({tenant,account}:{tenant:string;account:string}){
 const {t}=useI18n(),[page,setPage]=useState(1),[revision,setRevision]=useState(0),[notice,setNotice]=useState("");
 const base=`/v1/admin/tenants/${tenant}/ownership-transfers`,data=useData(tenant?base+`?page=${page}&page_size=5`:null,revision,10000);
 const current=useRef({tenant,account});current.current={tenant,account};const live=useRef(true);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const names:Record<string,string>={pending:t("等待接收方確認","Waiting for recipient"),accepted:t("已交接","Accepted"),declined:t("已拒絕","Declined"),cancelled:t("已撤銷","Cancelled"),expired:t("已過期","Expired"),invalidated:t("授權已變更","Access changed")};
 async function cancel(row:any){
  const session=clientSessionGeneration(),endpoint=base+`/${row.id}/cancel`,body={expected_revision:row.revision,acknowledge_responsibility:true},key=await operationKey(account,endpoint,body);
  const valid=()=>live.current&&session===clientSessionGeneration()&&current.current.tenant===tenant&&current.current.account===account;if(!valid())return;
  await api(endpoint,{method:"POST",headers:{"Idempotency-Key":key},body:JSON.stringify(body)});await completeOperation(account,endpoint,body);if(!valid())return;
  setNotice(t("已撤銷交接，成員權限未變更。","Handover cancelled; member access was not changed."));setRevision(n=>n+1);
 }
 return <section className="card ownership-panel" aria-label={t("所有權交接管理","Ownership handover management")}><h2>{t("所有權交接管理","Ownership handover management")}</h2><p className="muted">{t("可查看或撤銷等待中的交接；接管須由指定客戶本人確認。此處不代替特權成員變更的獨立審批。","Inspect or cancel pending handovers. Only the named customer can accept. Existing independent review for privileged membership changes remains required.")}</p>
  {notice&&<p className="notice" role="status">{notice}</p>}<ErrorNotice error={data.error}/>
  {data.data&&!data.data.total&&<p className="muted">{t("此企業沒有交接紀錄。","No handovers in this workspace.")}</p>}
  <div className="ownership-records">{data.data?.items.map((row:any)=><article className="ownership-record" key={row.id} data-transfer-id={row.id}><strong>{row.from_user?.email} → {row.to_user?.email}</strong><p>{names[row.state]??row.state}</p><p>{t("有效至","Valid until")} <DateText value={row.expires_at}/></p>{row.state==="pending"&&<details><summary>{t("撤銷這筆交接","Cancel this handover")}</summary><AsyncForm submitLabel={t("確認撤銷交接","Confirm handover cancellation")} onSubmit={()=>cancel(row)}><label className="checkbox-row"><input type="checkbox" required/><span>{t("我確認撤銷這筆交接","I confirm cancellation of this handover")}</span></label></AsyncForm></details>}</article>)}</div>
  {data.data?.total>5&&<nav className="ownership-pagination"><button className="button secondary" disabled={page===1} onClick={()=>setPage(n=>n-1)}>{t("上一頁","Previous")}</button><span>{page}</span><button className="button secondary" disabled={page*5>=data.data.total} onClick={()=>setPage(n=>n+1)}>{t("下一頁","Next")}</button></nav>}
 </section>;
}
