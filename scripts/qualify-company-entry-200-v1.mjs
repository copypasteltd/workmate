// Read-only pre-deployment entry check; not a round200 runtime acceptance claim.
import {readFile,writeFile} from 'node:fs/promises';
import {launch} from './live-client-189-v2.mjs';
import {existingOwner} from './live-read-only-owner-198-v1.mjs';
const transport=JSON.parse(await readFile('.data/acceptance-200/transport-v1/receipt.private.json','utf8'));
process.env.WORKMATE_QA_PROXY=transport.proxy;
const result={stage:200,status:'running',scope:'Pre-deployment actual company Web and existing owner session over original public TLS with owned SSH egress. Not a new200 UI or real model operation.'};let browser,user;
try{browser=await launch();user=await existingOwner(browser);result.current_owner_authorized=true;result.status='passed';}
catch(e){result.status='failed';result.error=e.name+': '+e.message.split('\n')[0];}
finally{await user?.context.close().catch(()=>{});await browser?.close().catch(()=>{});result.owned_browser_closed=true;await writeFile('.data/deployment-200-v1/company-entry.sanitized.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));}
if(result.status!=='passed')process.exitCode=1;
