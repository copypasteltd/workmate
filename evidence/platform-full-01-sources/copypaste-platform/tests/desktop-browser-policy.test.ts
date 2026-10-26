import { test } from "node:test";
import assert from "node:assert/strict";
import { browserNamespace, browserToolDefinitions } from "../src/browser-contract.js";
import { desktopToolDeclarations, desktopToolNames, desktopCompanyToolSchema } from "../src/desktop-tool-policy.js";
const declaration=()=>({type:"namespace",name:browserNamespace,tools:browserToolDefinitions.map(({name,inputSchema})=>({type:"function",name,parameters:structuredClone(inputSchema)}))});
test("native browser namespace accepts only the complete registered wire schemas",()=>{
  assert.equal(desktopToolDeclarations([declaration()]),true);
  for(const tool of browserToolDefinitions)assert.ok(desktopToolNames.includes(browserNamespace+"."+tool.name));
  const altered=declaration();altered.tools[0].parameters={type:"object",properties:{override:{type:"string"}},required:[],additionalProperties:false};
  assert.equal(desktopToolDeclarations([altered]),false);
});
test("native browser registrations cannot be flattened, renamed, nested or impersonated by another namespace",()=>{
  const d=declaration();
  assert.equal(desktopToolDeclarations(d.tools),false);
  assert.equal(desktopToolDeclarations([{...d,name:"copypaste_browser_override"}]),false);
  assert.equal(desktopToolDeclarations([{...d,tools:[{...d.tools[0],name:"elevate"}]}]),false);
  assert.equal(desktopToolDeclarations([{...d,tools:[d]}]),false);
  assert.equal(desktopToolDeclarations([{...d,name:"copypaste"}]),false);
});
test("native browser duplicate declarations and schema annotations are denied before provider dispatch",()=>{
  const d=declaration();assert.equal(desktopToolDeclarations([d,d]),false);
  const added=declaration();(added.tools[1].parameters as any).arbitrary_extension=true;
  assert.equal(desktopToolDeclarations([added]),false);
  assert.deepEqual(browserToolDefinitions.map(tool=>desktopCompanyToolSchema(tool.inputSchema)),browserToolDefinitions.map(tool=>tool.inputSchema));
});
