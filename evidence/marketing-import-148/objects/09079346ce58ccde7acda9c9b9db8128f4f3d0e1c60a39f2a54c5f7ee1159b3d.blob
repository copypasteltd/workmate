import {useState} from "react";
import {download} from "./api";
import {useWorkspace} from "./context";
import {useI18n,ErrorNotice} from "./ui";
import "./workflow-contracts.css";

/** Display the actual frozen run values, including false, zero and old file versions. */
export function WorkflowInputs({run}:{run:any}) {
  const {t}=useI18n();
  if(!run.input_hash)return null;
  const fields=run.definition?.input_schema?.fields??[];
  return <section className="workflow-contract" aria-label={t("本次固定輸入","Fixed inputs for this run")}>
    <h4>{t("本次固定輸入","Fixed inputs for this run")}</h4>
    <dl>{fields.map((f:any)=>{const value=run.input_values?.[f.key],file=run.input_files?.find((v:any)=>v.input_name===f.key);
      return <div key={f.key}><dt>{f.label??f.key}{f.required?" *":""}</dt><dd>{value===undefined?t("未提供","Not provided"):
        f.type==='file'?(file?`${file.name} · v${file.version}`:t("檔案不可用","File unavailable")):
        typeof value==='boolean'?(value?t("是","Yes"):t("否","No")):String(value)}</dd></div>;})}</dl>
    <p className="muted">{t("此輸入只用於本次流程。修改需重新準備並確認。","These values are fixed for this run. Changes require a newly prepared and reviewed run.")}</p>
  </section>;
}
export function WorkflowOutputs({run}:{run:any}) {
  const {t}=useI18n(),w=useWorkspace(),[error,setError]=useState<unknown>(null),outputs=Object.entries(run.named_outputs??{});
  if(!outputs.length)return null;
  return <section className="workflow-contract" aria-label={t("流程交付","Workflow deliverables")}><h4>{t("流程交付","Workflow deliverables")}</h4>
    {outputs.map(([key,value])=><details key={key}><summary>{run.definition?.output_schema?.fields?.find((f:any)=>f.key===key)?.label??key}</summary>
      {typeof value==='string'?<p className="workflow-output-text">{value}</p>:Array.isArray(value)?value.map((file:any)=><button key={file.asset_version_id} type="button" className="button secondary small"
        onClick={()=>{void download(w.base+'/assets/'+file.asset_id+'/download?version='+file.version,file.name,w.tenant).catch(setError);}}>{file.name} · v{file.version}</button>):null}</details>)}
    <ErrorNotice error={error}/></section>;
}
