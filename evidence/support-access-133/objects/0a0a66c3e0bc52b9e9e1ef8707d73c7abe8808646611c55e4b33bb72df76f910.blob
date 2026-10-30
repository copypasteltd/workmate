import { useEffect, useRef, useState } from "react";
import { KeyRound, Monitor, Plus, RefreshCw, Server, Square, Wallet } from "lucide-react";
import { api } from "./api";
import type { CapabilityAccess } from "./capability-model";
import { completeOperation, operationKey } from "./operation-key";
import { AsyncForm, DateText, ErrorNotice, Field, Modal, Money, PageHeader, useData, useI18n } from "./ui";
import "./cloud-computers.css";

const infrastructure = "admin.cloud_runtime.infrastructure.write";
const root = "/v1/admin/cloud-computers";
export function AdminCloudComputers({ access }: { access: CapabilityAccess }) {
  return <AdminCloudComputerPanel key={access.me.user.id} access={access}/>;
}
function AdminCloudComputerPanel({ access }: { access: CapabilityAccess }) {
  const { t } = useI18n();
  const [tab, setTab] = useState(access.has("admin.cloud_runtime.sessions.read") ? "sessions" : "nodes"),
    [refresh, setRefresh] = useState(0), [cursor, setCursor] = useState<string | null>(null),
    [dialog, setDialog] = useState<any>(null), [credential, setCredential] = useState<any>(null);
  const currentAccess = useRef(access), lifetime = useRef<AbortController | null>(null);
  currentAccess.current = access;
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    return () => { controller.abort(); };
  }, []);
  useEffect(() => {
    if (!access.has(infrastructure)) setCredential(null);
  }, [access]);
  const dialogPermission = dialog?.kind === "stop" ? "admin.cloud_runtime.sessions.stop"
    : dialog?.kind === "reconciliation" ? "admin.cloud_runtime.sessions.reconcile" : infrastructure;
  const allowed = tab === "sessions" ? access.has("admin.cloud_runtime.sessions.read") : access.has(infrastructure);
  const data = useData(allowed ? `${root}/${tab}?limit=12${cursor ? "&cursor=" + encodeURIComponent(cursor) : ""}` : null, refresh),
    plans = useData(access.has(infrastructure) ? root + "/plans?limit=100" : null, refresh);
  const rows = data.data?.items ?? [];
  async function change(url: string, body: unknown) {
    const account = access.me.user.id;
    const controller = lifetime.current;
    const permission = url.endsWith("/stop") ? "admin.cloud_runtime.sessions.stop"
      : url.endsWith("/reconciliation") ? "admin.cloud_runtime.sessions.reconcile" : infrastructure;
    const key = await operationKey(account, url, body);
    if (!controller || controller.signal.aborted || !currentAccess.current.has(permission))
      throw new DOMException("The account or permission changed", "AbortError");
    const result = await api(url, { method: "POST", body: JSON.stringify(body), signal: controller.signal, headers: { "Idempotency-Key": key } });
    await completeOperation(account, url, body);
    if (!controller.signal.aborted) setRefresh(v => v + 1);
    return result;
  }
  const state = (value: string) => ({registered:t("等待節點接入","Awaiting enrollment"),available:t("可分配","Available"),occupied:t("使用中","Occupied"),
    draining:t("正在清理","Draining"),quarantined:t("已隔離","Quarantined"),starting:t("正在啟動","Starting"),running:t("運行中","Running"),
    stop_requested:t("等待停機回執","Awaiting stop receipt"),reconciling:t("待核對","Reconciliation"),stopped:t("已停止","Stopped"),failed:t("未能啟動","Failed")}[value] ?? value);
  return <>
    <PageHeader eyebrow="A PLACE FOR LONGER WORK." title={t("專屬雲端電腦","Dedicated cloud computers")}
      description={t("管理已準備的運行資源、客戶確認的費用上限與清理狀態。私人畫面、輸入和檔案不會在此顯示。","Manage prepared capacity, customer-approved spending ceilings and cleanup. Private screens, inputs and files stay outside this view.")}
      action={<button className="button secondary" onClick={() => { setCursor(null); setRefresh(v => v + 1); }}><RefreshCw size={16}/>{t("重新整理","Refresh")}</button>}/>
    <div className="cloud-admin" data-testid="admin-cloud-computers">
      <div className="cloud-admin-tabs" role="tablist" aria-label={t("雲端電腦管理","Computer administration")}>
        {[...(access.has("admin.cloud_runtime.sessions.read") ? [["sessions",t("客戶會話","Sessions")]] : []),...(access.has(infrastructure) ? [["nodes",t("運行節點","Computers")],["plans",t("資源方案","Plans")]] : [])].map(([key,label]) =>
          <button role="tab" aria-selected={tab===key} key={key} className={tab===key?"selected":""} onClick={() => {setTab(key);setCursor(null);setDialog(null);}}>{label}</button>)}
      </div>
      <ErrorNotice error={data.error ?? plans.error}/>
      <div className="cloud-admin-summary"><section><Monitor size={21}/><span>{t("本頁記錄","Records on this page")}</span><strong>{rows.length}</strong></section>
        <section><Wallet size={21}/><span>{t("費用原則","Spending policy")}</span><strong>{t("先確認・後啟用","Approve before activation")}</strong></section>
        <section><Server size={21}/><span>{t("再次分配條件","Before reassignment")}</span><strong>{t("已確認清理","Verified cleanup")}</strong></section></div>
      <section className="card cloud-admin-records">
        <header><h2>{tab==="sessions"?t("會話與預留費用","Sessions and reserved funds"):tab==="nodes"?t("已準備的節點","Prepared computers"):t("已發佈方案","Published plans")}</h2>
          {tab!=="sessions" && access.has(infrastructure) && <button className="button primary" onClick={() => setDialog({kind:tab==="nodes"?"enroll":"plan"})}><Plus size={16}/>{tab==="nodes"?t("登記節點","Enroll computer"):t("新增方案","New plan")}</button>}</header>
        {data.loading && !data.data && <p role="status">{t("正在核對資源狀態…","Checking resource status…")}</p>}
        {!data.loading && rows.length===0 && <p className="cloud-admin-empty">{t("尚無記錄。先由獲授權的管理員發佈方案並登記節點，節點接入後才可分配。","No records yet. An authorized operator publishes a plan and enrolls a prepared computer before customers can allocate it.")}</p>}
        <div className="cloud-admin-list">{rows.map((row:any) => <article key={row.id??row.key} className="cloud-admin-row">
          <div><b>{tab==="plans"?row.body.name:tab==="nodes"?row.name:row.id}</b><small>{tab==="sessions"?`${row.tenant_id} / ${row.project_id}`:row.plan_key??row.key}</small>
            <span className="cloud-admin-state">{tab==="plans"?(row.enabled?t("已開放","Enabled"):t("已停用","Disabled")):state(row.state)}</span></div>
          <div>{tab==="sessions"?<><span>{t("確認上限","Approved ceiling")} <Money value={row.maximum_cost_micros}/></span><small>{t("已結算","Charged")} <Money value={row.charged_micros}/></small><small>{row.cleanup_verified?t("清理已確認","Cleanup verified"):t("保留原預留，直到用量和清理核實","Original hold remains until usage and cleanup are verified")}</small></>:tab==="nodes"?<><span>{t("分配代次","Generation")} {row.generation}</span><small>{t("最近心跳","Last heartbeat")} <DateText value={row.last_heartbeat_at}/></small></>:<><span><Money value={row.body.per_minute_micros}/> / {t("分鐘","min")}</span><small>{row.body.cpu_cores} CPU · {row.body.memory_mib/1024} GiB · {row.body.region}</small><small>v{row.version}</small></>}</div>
          <div className="row-actions">{tab==="sessions" && !["stopped","failed"].includes(row.state) && <>
            {access.has("admin.cloud_runtime.sessions.stop") && <button className="button secondary" onClick={() => setDialog({kind:"stop",row})}><Square size={14}/>{t("要求停機","Request stop")}</button>}
            {access.has("admin.cloud_runtime.sessions.reconcile") && <button className="button quiet" onClick={() => setDialog({kind:"reconciliation",row})}>{t("要求核對","Reconcile")}</button>}</>}
            {tab==="nodes" && !["occupied","draining"].includes(row.state) && <button className="button secondary" onClick={() => setDialog({kind:"rotate",row})}><KeyRound size={14}/>{t("輪換憑證","Rotate credential")}</button>}
            {tab==="plans" && <button className="button secondary" onClick={() => setDialog({kind:"plan",row})}>{t("發佈新版本","Publish revision")}</button>}</div>
        </article>)}</div>
        <footer>{cursor && <button className="button quiet" onClick={() => setCursor(null)}>{t("回到最新","Latest")}</button>}{data.data?.next_cursor && <button className="button secondary" onClick={() => setCursor(data.data.next_cursor)}>{t("下一頁","Next page")}</button>}</footer>
      </section>
    </div>
    {dialog && access.has(dialogPermission) && <Modal title={dialog.kind==="enroll"?t("登記運行節點","Enroll a computer"):dialog.kind==="plan"?t("發佈資源方案","Publish a resource plan"):dialog.kind==="rotate"?t("輪換節點憑證","Rotate computer credential"):t("要求停機與清理","Request stop and cleanup")} onClose={() => setDialog(null)}>
      <AsyncForm key={dialog.kind+":"+(dialog.row?.id??dialog.row?.key??"new")+":"+(dialog.row?.version??0)} submitLabel={t("確認操作","Confirm operation")} onSubmit={async form => {
        const reason=String(form.get("reason")??"").trim();let result:any;
        if(dialog.kind==="enroll") result=await change(root+"/nodes",{name:form.get("name"),plan_key:form.get("plan_key"),machine_fingerprint:form.get("machine_fingerprint"),reason});
        else if(dialog.kind==="rotate") result=await change(root+"/nodes/"+dialog.row.id+"/rotate-credential",{expected_version:dialog.row.version,reason});
        else if(dialog.kind==="plan") {
          const names=["cpu_cores","memory_mib","disk_mib","per_minute_micros","max_minutes"],numbers=Object.fromEntries(names.map(key=>[key,Number(form.get(key))]));
          result=await change(root+"/plans",{plan:{key:form.get("key"),name:form.get("name"),region:form.get("region"),...numbers,terminal:form.get("terminal")==="on",visual:form.get("visual")==="on",reason},enabled:form.get("enabled")==="on",expected_version:dialog.row?.version??0});
        } else result=await change(root+"/sessions/"+dialog.row.id+"/"+dialog.kind,{expected_version:dialog.row.version,reason});
        if(lifetime.current?.signal.aborted)return;
        setDialog(null);if(currentAccess.current.has(infrastructure)&&(result?.enrollment_token || result?.enrollment_token_unavailable_on_retry))setCredential(result);
      }}>
        {dialog.kind==="enroll" && <><Field label={t("節點名稱","Computer name")}><input name="name" required maxLength={100}/></Field>
          <Field label={t("對應方案","Resource plan")}><select name="plan_key" required><option value="">{t("選擇已準備的方案","Choose a prepared plan")}</option>{(plans.data?.items??[]).map((p:any)=><option key={p.key} value={p.key}>{p.body.name}</option>)}</select></Field>
          <Field label={t("機器指紋 SHA-256","Machine fingerprint SHA-256")}><input name="machine_fingerprint" required pattern="[a-f0-9]{64}" minLength={64} maxLength={64}/></Field></>}
        {dialog.kind==="plan" && <div className="cloud-plan-fields">{[["key",t("方案代碼","Plan key"),"hk-windows"],["name",t("方案名稱","Plan name"),"Hong Kong workspace"],["region",t("地區","Region"),"Hong Kong"]].map(([key,label,fallback]) => <Field key={key} label={label}><input name={key} required defaultValue={dialog.row?.body?.[key]??fallback} readOnly={key==="key"&&!!dialog.row}/></Field>)}
          {[["cpu_cores","CPU",4],["memory_mib",t("記憶體 MiB","Memory MiB"),8192],["disk_mib",t("磁碟 MiB","Disk MiB"),32768],["per_minute_micros",t("每分鐘費率（微港元）","Rate per minute (micro-HKD)"),1000],["max_minutes",t("最長分鐘數","Maximum minutes"),60]].map(([key,label,fallback]) => <Field key={String(key)} label={String(label)}><input type="number" name={String(key)} min={1} step={1} required defaultValue={dialog.row?.body?.[key]??fallback}/></Field>)}
          {[["terminal",t("終端操作","Terminal access")],["visual",t("可視操作","Visual access")],["enabled",t("開放給客戶","Available to customers")]].map(([key,label])=><label className="check-line" key={key}><input type="checkbox" name={key} defaultChecked={key==="enabled"?!!dialog.row?.enabled:dialog.row?.body?.[key]??true}/>{label}</label>)}</div>}
        {["stop","reconciliation"].includes(dialog.kind) && <p className="notice">{t("此操作會要求結束會話；它不會替代清理回執、釋放未知費用或把仍被佔用的機器分配給其他客戶。","This requests the session to end. A verified cleanup receipt is still required before uncertain funds or occupied capacity can be released.")}</p>}
        <Field label={t("操作原因","Reason")}><textarea name="reason" minLength={8} maxLength={500} required rows={3}/></Field>
      </AsyncForm>
    </Modal>}
    {credential && access.has(infrastructure) && <Modal title={t("節點接入憑證","Computer enrollment credential")} onClose={() => setCredential(null)}>
      {credential.enrollment_token?<><p>{t("憑證只顯示這一次。將其交給該節點的部署負責人；關閉後不會保留在此頁。","This credential is shown once. Give it to the computer's deployment operator; closing this view removes it from the page.")}</p><textarea className="cloud-enrollment-secret" rows={3} readOnly value={credential.enrollment_token} aria-label={t("接入憑證","Enrollment credential")}/></>:<p className="notice">{t("此前操作已成功，但一次性憑證不會隨重試再次顯示。確認節點尚未使用後，可輪換其憑證。","The earlier operation succeeded, but its one-time credential cannot be shown again on retry. Rotate the credential after confirming the computer is unoccupied.")}</p>}
      <button className="button primary" onClick={() => setCredential(null)}>{t("完成並關閉","Done and close")}</button>
    </Modal>}
  </>;
}
