import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

/** Explicit synthetic Responses; every observation below comes back from the
 * real customer-device Codex/browser. No inserted browser results. */
export class DesktopBrowserModelFixture {
  private mode: "execute"|"denied"|"stop"|"revoke"|null=null;
  private actions: string[]=[];
  private pending?: {name:string;call:string;action:string};
  private tab="";
  private snapshot:any;
  private server?: ReturnType<typeof createServer>;
  origin="";
  saves:any[]=[];
  observations:{tool:string;action:string;actual_output:boolean}[]=[];
  screenshotObserved=false;
  download?:{path:string;sha256:string;bytes:number};
  readonly bytes=Buffer.from("Harbour Studio campaign brief\nAudience: Hong Kong teams\n");
  constructor(private desktop:string,private workspace:string){}
  async start(){
    const page=await readFile(path.join(this.desktop,"tests/fixtures/browser-campaign.html"));
    await writeFile(path.join(this.workspace,"native-browser-reference.txt"),"Actual native browser reference bytes");
    this.server=createServer(async(req,res)=>{
      if(req.url==="/save"){
        const bytes=[];for await(const part of req)bytes.push(Buffer.from(part));const value=JSON.parse(Buffer.concat(bytes).toString());this.saves.push(value);
        res.writeHead(200,{"Content-Type":"application/json"}).end(JSON.stringify({count:this.saves.length,name:value.name}));return;
      }
      if(req.url==="/download"){res.writeHead(200,{"Content-Type":"text/plain","Content-Disposition":"attachment; filename=campaign-brief.txt","Content-Length":this.bytes.length}).end(this.bytes);return;}
      res.writeHead(200,{"Content-Type":"text/html"}).end(page);
    });
    await new Promise<void>(resolve=>this.server!.listen(0,"127.0.0.1",resolve));this.origin="http://127.0.0.1:"+(this.server.address() as any).port;
  }
  async close(){if(this.server){this.server.closeAllConnections();await new Promise<void>(resolve=>this.server!.close(()=>resolve()));}}
  get closed(){return !this.server?.listening;}
  begin(mode:NonNullable<typeof this.mode>){
    this.mode=mode;this.pending=undefined;this.tab="";this.snapshot=undefined;
    this.actions=mode==="execute"?["open","question_before","snapshot","fill_name","select","fill_notes","upload","save","wait_saved","screenshot","snapshot","download","wait_download","question_after","close"]:mode==="denied"?["open"]:["open","wait_forever"];
  }
  end(){this.mode=null;this.actions=[];this.pending=undefined;}
  private consume(body:any,pending:NonNullable<typeof this.pending>){
    const result=body.input.find((item:any)=>item.type==="function_call_output"&&item.call_id===pending.call);
    assert.ok(result,"Native browser result must arrive from the actual Codex process");
    const items=typeof result.output==="string"?[{type:"input_text",text:result.output}]:result.output;
    assert.ok(Array.isArray(items));const text=items.filter((item:any)=>["text","input_text"].includes(item.type)).map((item:any)=>item.text).join("\n");
    this.observations.push({tool:pending.name,action:pending.action,actual_output:true});
    if(this.mode==="denied"){assert.match(text,/BROWSER_FULL_ACCESS_REQUIRED/);return;}
    const value=JSON.parse(text);
    if(pending.name==="open"){assert.match(value.tab_id,/^[a-f0-9-]{36}$/);this.tab=value.tab_id;}
    if(pending.name==="snapshot"){assert.ok(Array.isArray(value.elements));this.snapshot=value;}
    if(pending.name==="screenshot"){
      const image=items.find((item:any)=>["image","input_image"].includes(item.type));assert.ok(image,"Actual native image content must reach the company Responses request");
      const url=image.image_url?.url??image.image_url??image.url;assert.match(url,/^data:image\/png;base64,/);assert.equal(Buffer.from(url.split(",")[1],"base64").subarray(1,4).toString(),"PNG");this.screenshotObserved=true;
    }
    if(pending.action==="wait_download"){
      this.download=value.downloads.find((item:any)=>item.state==="completed"&&item.sha256);assert.ok(this.download);
      assert.equal(this.download.sha256,createHash("sha256").update(this.bytes).digest("hex"));assert.equal(this.download.bytes,this.bytes.length);
    }
    if(pending.name==="request_user_input")assert.deepEqual(Object.values(value.answers),[{answers:["Continue"]}]);
    if(pending.name==="close")assert.equal(value.closed,true);
  }
  next(body:any,serial:number):any|null{
    if(!this.mode)return null;
    if(this.pending){this.consume(body,this.pending);this.pending=undefined;}
    const action=this.actions.shift();
    if(!action){const denied=this.mode==="denied";this.end();return {type:"message",id:"msg_browser_"+serial,role:"assistant",status:"completed",content:[{type:"output_text",text:denied?"The browser was not opened because this session has read-only permission. Grant full local access in the application to use it.":"The campaign was saved in the actual local browser. The downloaded brief is in browser-downloads, and this task's page is closed.",annotations:[]}]};}
    const tool=action.startsWith("question_")?"request_user_input":["fill_name","fill_notes","select","upload","save","download"].includes(action)?"interact":action.startsWith("wait_")?"wait":action;
    const tools=(body.tools??[]).flatMap((ns:any)=>ns.type==="namespace"?ns.tools.map((child:any)=>({...child,qualified:ns.name+"."+child.name})): [{...ns,qualified:ns.name}]);
    const selected=tools.find((item:any)=>action.startsWith("question_")?/(^|\.)request_user_input$/.test(item.qualified):item.qualified==="copypaste_browser."+tool);assert.ok(selected,"Exact native browser declaration required");
    const ref=(name:string)=>{const element=this.snapshot?.elements.find((item:any)=>item.name===name);assert.ok(element,"Fresh real snapshot reference required: "+name);return element.ref;};
    const args=action==="open"?{url:this.origin}:action.startsWith("question_")?{questions:[{id:action,header:"Browser",question:action==="question_before"?"Continue with this local campaign form?":"Review the actual saved campaign and download, then close this task's page?",options:[{label:"Continue",description:"Continue this customer-device browser task."},{label:"Stop",description:"Keep the task paused until you stop it."}]}]}
      : action==="fill_name"?{tab_id:this.tab,action:"fill",ref:ref("Campaign name"),text:"Victoria Harbour local launch"}
      : action==="fill_notes"?{tab_id:this.tab,action:"fill",ref:ref("Creative notes"),text:"Actual customer-device browser; editable launch assets."}
      : action==="select"?{tab_id:this.tab,action:"select",ref:ref("Primary channel"),text:"meta"}
      : action==="upload"?{tab_id:this.tab,action:"upload",ref:ref("Reference file"),files:[path.join(this.workspace,"native-browser-reference.txt")]}
      : ["save","download"].includes(action)?{tab_id:this.tab,action:"click",ref:ref(action==="save"?"Save campaign":"Download brief")}
      : action==="wait_saved"?{tab_id:this.tab,state:"text",text:"Saved campaign"}
      : action==="wait_download"?{tab_id:this.tab,state:"download"}
      : action==="wait_forever"?{tab_id:this.tab,state:"text",text:"this text never arrives",timeout_ms:30000}:{tab_id:this.tab};
    const call="call_browser_ui_"+serial;this.pending={name:tool,call,action};
    return {type:"function_call",id:"fc_browser_ui_"+serial,call_id:call,...(action.startsWith("question_")?{name:selected.qualified}:{namespace:"copypaste_browser",name:tool}),arguments:JSON.stringify(args)};
  }
}
