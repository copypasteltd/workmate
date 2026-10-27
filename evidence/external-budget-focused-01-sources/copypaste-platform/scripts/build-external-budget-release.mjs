import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {canonical} from '../src/lib.ts';
const base=JSON.parse(await readFile('catalog/web-analytics-release-v1.json','utf8')).role;
const role=structuredClone(base);
role.version='1.3.0';
role.skill_bindings.push({skill_key:'external-budget',version:'1.0.0',required:true});
role.tool_ids=[...role.tool_ids,'connector.budget.read','connector.budget.prepare'].sort();
role.input_contract.optional_fields.push('explicit_budget_change_request');
role.acceptance_checks.push('预算修改绑定确切预览和当前策略；需逐次确认时不得自批，结果未知不得重发。');
const digest=v=>createHash('sha256').update(v).digest('hex');
const skill=digest(await readFile('skills/external-budget/1.0.0/SKILL.md'));
const release={schema:'copypaste-external-budget-release-1',previous_role_sha256:digest(canonical(base)),role,
  skill_package:{key:'external-budget',version:'1.0.0',sha256:skill,path:'skills/external-budget/1.0.0/SKILL.md',qualification:'pending_live_validation'},
  skill_definition:{skill_key:'external-budget',version:'1.0.0',purpose:'参数绑定的 Google Ads 平均每日预算修改与未知结果核对',candidate_sources:[],package_state:'installed',package_sha256:skill,ai_network_policy:'internal_only',tool_ids:['connector.budget.read','connector.budget.prepare'],required_model_profiles:[],supported_clients:['web','extension','desktop']}};
await writeFile('catalog/external-budget-release-v1.json',JSON.stringify(release,null,2)+'\n');
