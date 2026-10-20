"""Validate docs and fictional contracts only. Never starts services or browsers."""
from pathlib import Path
from urllib.parse import unquote, urldefrag, urlparse
import base64
import copy
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import re
import sys

from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

ROOT = Path(__file__).resolve().parents[1]
CONTRACTS = ROOT / 'contracts'
PASSED = []
FAILED = []
COUNTS = {}

def check(condition, label):
    (PASSED if condition else FAILED).append(label)

def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))

def walk(value):
    if isinstance(value, dict):
        yield value
        for item in value.values():
            yield from walk(item)
    elif isinstance(value, list):
        for item in value:
            yield from walk(item)

def pointer(document, fragment):
    if not fragment:
        return document
    if not fragment.startswith('/'):
        return next(node for node in walk(document) if node.get('$anchor') == fragment or node.get('$dynamicAnchor') == fragment)
    for part in fragment.split('/')[1:]:
        key = unquote(part).replace('~1','/').replace('~0','~')
        document = document[int(key)] if isinstance(document,list) else document[key]
    return document

def heading_ids(text):
    counts, ids = {}, set()
    text = re.sub(r'\x60{3}.*?\x60{3}','',text,flags=re.S)
    for heading in re.findall(r'^#{1,6}\s+(.+)$',text,re.M):
        h = re.sub(r'[^\w\-\s]','',heading.lower(),flags=re.UNICODE).replace(' ','-')
        n = counts.get(h,0)
        ids.add(h if n == 0 else f'{h}-{n}')
        counts[h] = n+1
    return ids

def validate_files_links():
    # Independent delivery README files are the explicit AGENTS.md exception to
    # keeping project documentation under docs/. Other outside paths stay denied.
    delivery_readmes = {
        (ROOT.parent / 'dev' / f'copypaste-{repo}' / readme).resolve()
        for repo in ['platform', 'web', 'admin', 'extension', 'desktop', 'delivery']
        for readme in ['README.md', 'README.en.md']
    }
    expected = [
        'README.md','00-document-map.md','requirements/01-srs.md','requirements/02-nonfunctional-and-service-levels.md',
        *[f'product/{x}' for x in ['01-prd.md','02-user-journeys.md','03-information-architecture-and-interactions.md','04-release-and-commercial-model.md','05-web-agent-workbench.md','06-role-templates-and-skill-presets.md','07-brand-design-system.md','08-admin-dashboard.md']],
        'research/01-web-benchmark-workbuddy-accio.md','research/02-source-checks.json',
        'research/03-copypaste-brand-reference.md','research/copypaste-brand/source-evidence.json',
        'design/brand-tokens.json','design/brand-tokens.css','design/brand-preview.html','quality/brand-preview-review.json',
        'modules/00-catalog.md',
        *[f'modules/{x}' for x in ['01-identity-workspaces-permissions.md','02-agents-tasks-memory.md','03-brand-assets-and-deliverables.md','04-marketing-production.md','05-analytics-seo-geo.md','06-connectors-workflows.md','07-web-extension-desktop.md','08-usage-billing-admin.md']],
        *[f'technical/{x}' for x in ['01-architecture-and-stack.md','02-runtime-and-ai-gateway.md','03-data-model-and-lifecycle.md','04-api-and-event-contracts.md','05-local-executor-and-browser.md','06-media-and-data-pipelines.md','07-security-and-permissions.md','08-development-and-delivery.md','09-operations-runbooks.md','10-frontend-design-system.md']],
        'quality/01-test-and-acceptance-plan.md','quality/02-requirements-traceability.md','quality/03-documentation-review.md',
        'governance/01-decisions-assumptions-and-questions.md','governance/02-glossary-and-sources.md',
        'contracts/README.md','contracts/openapi.json','contracts/task-event.schema.json','contracts/device-command.schema.json',
        'contracts/device-channel.schema.json','contracts/creative-project.schema.json','contracts/video-project.schema.json','contracts/delivery-manifest.schema.json',
        'contracts/role-preset-catalog.json','contracts/role-preset-catalog.schema.json',
        'technical/11-admin-control-plane.md','contracts/admin-permission-catalog.json','contracts/admin-permission-catalog.schema.json','tools/build_admin_contracts.py',
    ]
    for name in expected:
        p = ROOT/name
        check(p.is_file() and p.stat().st_size > 100, f'file:{name}')
    links = 0
    for p in sorted(ROOT.rglob('*.md')):
        content = p.read_text(encoding='utf-8')
        check('\ufffd' not in content, f'utf8:{p.relative_to(ROOT)}')
        content = re.sub(r'\x60{3}.*?\x60{3}','',content,flags=re.S)
        for target in re.findall(r'!?\[[^\]]*\]\(([^)\n]+)\)',content):
            target = target.strip().strip('<>')
            if re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',target):
                continue
            raw, fragment = urldefrag(target)
            destination = (p.parent/unquote(raw)).resolve() if raw else p
            links += 1
            # The report is this command's output and can legitimately be absent
            # until the final write. A write failure still prevents success.
            generated_report = destination == (ROOT/'quality/validation-report.json')
            permitted = destination.is_relative_to(ROOT) or destination in delivery_readmes
            check(permitted and (destination.is_file() or generated_report), f'link:{p.relative_to(ROOT)} -> {target}')
            if destination.is_file() and fragment and destination.suffix == '.md':
                check(unquote(fragment) in heading_ids(destination.read_text(encoding='utf-8')), f'anchor:{target}')
    COUNTS['local_links'] = links
    COUNTS['markdown_files'] = len(list(ROOT.rglob('*.md')))

def validate_benchmark_sources():
    report = (ROOT/'research/01-web-benchmark-workbuddy-accio.md').read_text(encoding='utf-8')
    documented = dict(re.findall(r'^\| ((?:WB|AC)\d{2}) / [HD] \| \[[^\]]+\]\((https://[^)]+)\) \|', report, re.M))
    sources = read_json(ROOT/'research/02-source-checks.json')['sources']
    check(len(sources) == len(documented) and {r['id'] for r in sources} == set(documented), 'benchmark:source-ledger-matches-report')
    for source in sources:
        source_id = source['id']
        check(source['url'] == documented[source_id], f'benchmark:{source_id}:exact-url')
        check(urlparse(source['url']).hostname in {'cloud.tencent.com', 'www.workbuddy.cn', 'www.accio.com'}, f'benchmark:{source_id}:official-host')
        check(source['interactive_verified'] is False, f'benchmark:{source_id}:no-interactive-claim')
        check(source['fetch_status'] == 'retrieved' and source['http_status'] == 200 and bool(source['title']), f'benchmark:{source_id}:http-metadata')
        check(bool(re.fullmatch(r'[a-f0-9]{64}', source['sha256'])), f'benchmark:{source_id}:content-fingerprint')
    COUNTS['benchmark_sources'] = len(sources)


def validate_traceability(api):
    srs = (ROOT/'requirements/01-srs.md').read_text(encoding='utf-8')
    reqs = re.findall(r'^\| (REQ-\d{3}) \| P[012] \|',srs,re.M)
    expected = {f'REQ-{n:03d}' for n in range(1,len(reqs)+1)}
    check(len(reqs) == len(set(reqs)) and len(reqs) >= 102 and set(reqs) == expected, 'requirements:unique-contiguous-with-admin-baseline')
    trace = read_json(ROOT/'quality/traceability.json')['requirements']
    cases = read_json(ROOT/'quality/test-cases.json')['cases']
    test_ids = {t['id'] for t in cases}
    ops = {op['operationId']:op for item in api['paths'].values() for method,op in item.items() if method in ['get','post','patch','delete','put']}
    check(len(test_ids) == len(cases) == len(reqs), 'tests:unique-per-requirement')
    check({r['requirement_id'] for r in trace} == expected and len(trace) == len(reqs),'trace:all-requirements')
    origins, modules, journeys = set(), set(), set()
    for r in trace:
        req = r['requirement_id']
        for key in ['origin_ids','journey_ids','module_ids','product_docs','module_docs','technical_docs','test_ids']:
            check(bool(r[key]), f'trace:{req}:{key}')
        for key in ['product_docs','module_docs','technical_docs']:
            for doc in r[key]:
                check((ROOT/doc).is_file(), f'trace:{req}:{doc}')
        for tc in r['test_ids']:
            check(tc in test_ids, f'trace:{req}:{tc}')
        for operation in r['operation_ids']:
            check(operation in ops and req in ops[operation]['x-requirements'], f'trace:{req}:{operation}')
        check(r['implementation_status']=='not_implemented', f'trace:{req}:implementation-not-claimed')
        origins.update(r['origin_ids']); modules.update(r['module_ids']); journeys.update(r['journey_ids'])
    check(set(f'U{n:02d}' for n in range(1,11)).issubset(origins), 'trace:all-U01-U10')
    check(set(f'F{n:02d}' for n in range(1,23)).issubset(origins), 'trace:all-F01-F22')
    check(modules == {f'M{n:02d}' for n in range(1,13)}, 'trace:all-12-modules')
    documented_journeys = set(re.findall(r'^## \d+\. (UC\d{2})\b', (ROOT/'product/02-user-journeys.md').read_text(encoding='utf-8'), re.M))
    check(journeys == documented_journeys and len(journeys) >= 24, 'trace:all-documented-journeys')
    benchmark_ids = {r['id'] for r in read_json(ROOT/'research/02-source-checks.json')['sources']}
    for r in trace:
        number = int(r['requirement_id'].split('-')[1])
        if 61 <= number <= 72:
            check('WEB01' in r['origin_ids'], f'trace:{r["requirement_id"]}:user-benchmark-origin')
            check(set(r['origin_ids']) - {'WEB01'} <= benchmark_ids, f'trace:{r["requirement_id"]}:real-source-ids')
            check(bool(r['operation_ids']), f'trace:{r["requirement_id"]}:proposed-api-coverage')
        elif 73 <= number <= 80:
            expected_origins = ['ROLE01','CORE01'] if number == 75 else ['ROLE01']
            check(r['origin_ids'] == expected_origins, f'trace:{r["requirement_id"]}:user-role-preset-origin')
            check('product/06-role-templates-and-skill-presets.md' in r['product_docs'], f'trace:{r["requirement_id"]}:role-product-definition')
            check(bool(r['operation_ids']), f'trace:{r["requirement_id"]}:role-api-coverage')
        elif number in [81,82]:
            check(r['origin_ids'] == ['BRAND01'], f'trace:{r["requirement_id"]}:user-brand-origin')
            check('product/07-brand-design-system.md' in r['product_docs'], f'trace:{r["requirement_id"]}:brand-product-definition')
            check('technical/10-frontend-design-system.md' in r['technical_docs'], f'trace:{r["requirement_id"]}:brand-implementation-definition')
        elif 83 <= number <= 102:
            check(r['origin_ids'] == ['ADMIN01'], f'trace:{r["requirement_id"]}:user-admin-origin')
            check('product/08-admin-dashboard.md' in r['product_docs'], f'trace:{r["requirement_id"]}:admin-product-definition')
            check('technical/11-admin-control-plane.md' in r['technical_docs'], f'trace:{r["requirement_id"]}:admin-implementation-definition')
            check(bool(r['operation_ids']), f'trace:{r["requirement_id"]}:admin-api-coverage')
        if number in [44,75]:
            check('CORE01' in r['origin_ids'], f'trace:{r["requirement_id"]}:codex-only-origin')
            check('technical/02-runtime-and-ai-gateway.md' in r['technical_docs'], f'trace:{r["requirement_id"]}:codex-integration-definition')
    for t in cases:
        check(t['execution_status']=='not_run' and t['evidence']==[], f'test:{t["id"]}:not-run')
        check(set(t['requirement_ids']).issubset(expected), f'test:{t["id"]}:valid-req')
        check(all(len(t[k])>=12 for k in ['precondition','action_and_fault','expected_and_evidence']),f'test:{t["id"]}:concrete-scenario')
    check(set().union(*(set(t['requirement_ids']) for t in cases))==expected, 'tests:all-requirements-covered')
    COUNTS.update(requirements=len(reqs),acceptance_cases=len(cases),modules=len(modules),journeys=len(journeys))

def validate_openapi(api, registry):
    valid_reqs = set(re.findall(r'^\| (REQ-\d{3}) \| P[012] \|', (ROOT/'requirements/01-srs.md').read_text(encoding='utf-8'), re.M))
    meta = read_json(CONTRACTS/'vendor/openapi-3.1-meta.schema.json')
    errors = list(Draft202012Validator(meta).iter_errors(api))
    check(not errors, 'openapi:official-3.1-meta-schema')
    for error in errors:
        FAILED.append('openapi-meta:'+str(list(error.absolute_path))+':'+error.message[:160])
    operations = []
    for path,item in api['paths'].items():
        for method,op in item.items():
            if method not in ['get','post','put','patch','delete']:
                continue
            operation = op['operationId']
            operations.append(operation)
            check(bool(op.get('x-requirements')) and bool(op.get('x-stage')) and bool(op.get('x-permission')), f'api:{operation}:trace-permission-stage')
            check(set(op['x-requirements']) <= valid_reqs, f'api:{operation}:valid-req')
            parameters = [pointer(api,p['$ref'][1:]) if '$ref' in p else p for p in op.get('parameters',[])]
            names = {(p['in'],p['name']) for p in parameters}
            check(len(names)==len(parameters),f'api:{operation}:unique-params')
            path_names = re.findall(r'{([^}]+)}',path)
            check(all(any(p['in']=='path' and p['name']==key and p.get('required') for p in parameters) for key in path_names),f'api:{operation}:path-params')
            if method in ['post','patch','delete']:
                check(('header','Idempotency-Key') in names, f'api:{operation}:idempotency')
            if operation.startswith('list'):
                if operation == 'listAdminCleanupJobs':
                    check(path == '/v1/admin/deletions' and method == 'get', f'api:{operation}:specific-admin-page')
                    check(('query','page') in names and ('query','page_size') in names and ('query','cursor') not in names and ('query','limit') not in names, f'api:{operation}:page-pagination')
                    page_size = next(p['schema'] for p in parameters if p['in']=='query' and p['name']=='page_size')
                    check(page_size.get('default') == 50 and page_size.get('maximum') == 100 and page_size.get('minimum') == 1, f'api:{operation}:bounded-default-page')
                else:
                    check(('query','cursor') in names and ('query','limit') in names, f'api:{operation}:cursor-pagination')
            if op.get('security') not in [[],[{'DeviceBearer':[]}]]:
                check(bool(api.get('security')), f'api:{operation}:user-auth')
            if '202' in op['responses']:
                check(op['responses']['202'].get('content',{}).get('application/json',{}).get('schema') is not None,f'api:{operation}:async-resource')
    check(len(operations)==len(set(operations)), 'api:unique-operationIds')
    for name,schema in api['components']['schemas'].items():
        try:
            Draft202012Validator.check_schema(schema)
            check(True,f'component-schema:{name}')
        except Exception as error:
            check(False,f'component-schema:{name}:{error}')
    canonical_states = ['draft','needs_input','queued','running','waiting_approval','waiting_device','paused','cancelling','succeeded','partially_succeeded','failed','cancelled']
    check(api['components']['schemas']['TaskStatus']['enum']==canonical_states,'states:openapi-canonical')
    module = (ROOT/'modules/02-agents-tasks-memory.md').read_text(encoding='utf-8')
    for value in canonical_states:
        check(f'| {value} |' in module,f'states:documented:{value}')
    event = read_json(CONTRACTS/'task-event.schema.json')
    check(event['$defs']['status']['enum']==canonical_states,'states:event-canonical')
    COUNTS.update(api_paths=len(api['paths']),api_operations=len(operations),api_components=len(api['components']['schemas']))

def validate_admin_contracts(api, registry):
    catalog = read_json(CONTRACTS/'admin-permission-catalog.json')
    schema = read_json(CONTRACTS/'admin-permission-catalog.schema.json')
    Draft202012Validator.check_schema(schema)
    catalog_validator = Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())
    check(catalog_validator.is_valid(catalog), 'admin:catalog-schema-valid')
    permissions = {row['key']: row for row in catalog['permissions']}
    roles = {row['id']: set(row['permissions']) for row in catalog['roles']}
    expected_roles = {'super_admin','user_operator','finance_admin','content_admin','catalog_manager','support_agent','security_admin','auditor'}
    check(len(permissions) == len(catalog['permissions']), 'admin:unique-permission-keys')
    check(set(roles) == expected_roles and len(roles) == len(catalog['roles']), 'admin:eight-distinct-roles')
    check(roles['super_admin'] == set(permissions), 'admin:super-admin-explicit-registered-permissions')
    check(catalog['default_effect']=='deny' and catalog['explicit_deny_wins'], 'admin:default-deny-and-explicit-deny')
    check('provider_api_key' in catalog['protected_data'] and 'session_token' in catalog['protected_data'], 'admin:no-secret-reveal-permission')
    for role, keys in roles.items():
        check(keys <= set(permissions) and '*' not in ''.join(keys), f'admin:{role}:registered-no-wildcard')
        check('admin.overview.read' in keys, f'admin:{role}:basic-navigation')
    check(not any(key in roles['support_agent'] for key in ['admin.content.body.read','admin.content.download','admin.billing.gift','admin.entitlements.grant','admin.access.bindings.write']), 'admin:support-no-default-body-finance-or-privilege-write')
    check('admin.content.body.read' in roles['content_admin'] and 'admin.billing.gift' not in roles['content_admin'], 'admin:content-role-direct-read-without-finance')
    check('admin.billing.gift' in roles['finance_admin'] and 'admin.content.body.read' not in roles['finance_admin'], 'admin:finance-role-without-customer-body')
    check(permissions['admin.users.contact.read']['sensitive_field_access'] and permissions['admin.usage.internal_cost.read']['sensitive_field_access'], 'admin:sensitive-fields-separated')
    check(permissions['admin.users.status.write']['scope_kinds']==['global'], 'admin:global-user-freeze-needs-global-scope')
    check('project' not in permissions['admin.billing.gift']['scope_kinds'], 'admin:project-scope-cannot-credit-whole-tenant-wallet')
    admin_ops = []
    for path, item in api['paths'].items():
        if not path.startswith('/v1/admin/'):
            continue
        for method, op in item.items():
            if method not in ['get','post','patch','put','delete']:
                continue
            admin_ops.append(op)
            label = 'admin:api:'+op['operationId']
            check(op.get('security') == [{'AdminSession':[]}], label+':independent-session-only')
            check(op['x-permission'] in permissions, label+':registered-permission')
            check(op.get('x-admin-policy') == {'mfa_required':True,'scope_recheck':True,'audit_required':True}, label+':mfa-scope-audit')
            refs = {p.get('$ref') for p in op.get('parameters',[])}
            check('#/components/parameters/TenantHeader' not in refs, label+':scope-not-user-tenant-header')
            if method != 'get':
                check('#/components/parameters/AdminCsrfHeader' in refs and '#/components/parameters/CsrfHeader' not in refs, label+':independent-csrf')
                if op.get('x-admin-read-only'):
                    check(op['responses']['200']['content']['application/json']['schema']['$ref'].endswith('/AdminPreview'), label+':preview-has-no-business-effect')
                elif op['operationId'] == 'retryAdminCleanupJob':
                    check(path == '/v1/admin/deletions/{deletion_id}/retry' and method == 'post', label+':specific-durable-cleanup-command')
                    check(op['x-permission'] == 'admin.content.delete', label+':separate-delete-permission')
                    check(op['responses']['200']['content']['application/json']['schema']['$ref'] == '#/components/schemas/AdminCleanupResult', label+':durable-job-result')
                    check('#/components/parameters/IdempotencyKey' in refs, label+':idempotent-cleanup-retry')
                else:
                    check(op['responses']['202']['content']['application/json']['schema']['$ref'].endswith('/AdminOperation'), label+':tracked-command-result')
            actions = op.get('x-action-permissions', {})
            check(set(actions.values()) <= set(permissions), label+':registered-action-permissions')
            if actions:
                request = op['requestBody']['content']['application/json']['schema']['$ref']
                request_schema = pointer(api, request[1:])
                if 'oneOf' in request_schema:
                    command_actions = {pointer(api, variant['$ref'][1:])['properties']['action']['const'] for variant in request_schema['oneOf']}
                else:
                    command_actions = set(request_schema['properties']['action']['enum'])
                check(set(actions) == command_actions, label+':every-command-action-protected')
    schemes = api['components']['securitySchemes']
    check(schemes['AdminSession']['name'] != schemes['WebSession']['name'], 'admin:independent-cookie')
    check(api['components']['parameters']['AdminCsrfHeader']['required'], 'admin:csrf-mandatory')
    check(api['x-admin-policy']['action_permissions_are_additional'], 'admin:command-permission-additional-to-base')
    check(api['paths']['/v1/effective-entitlements']['get'].get('security') != [{'AdminSession':[]}], 'admin:user-entitlements-keep-user-auth')
    definitions = api['components']['schemas']
    validator = Draft202012Validator(api, registry=registry, format_checker=FormatChecker())
    fixture_id = '00000000-0000-4000-8000-000000000001'
    gift = read_json(CONTRACTS/'examples/admin-fee-gift.json')
    vip = read_json(CONTRACTS/'examples/admin-vip-grant.json')
    base = {'reason':'Fictional documentation example', 'expected_version':1}
    binding = {'principal_id':fixture_id,'role_version_id':fixture_id,'scope':{'kind':'tenant','tenant_ids':[fixture_id]},
               'expires_at':'2026-11-17T04:00:00Z','constraints':{'max_single_amount':{'currency':'HKD','amount_micros':'500000000'},
               'max_daily_amount':{'currency':'HKD','amount_micros':'1000000000'},'max_batch_items':100,'allowed_fields':['masked_contact']},
               'reason':'Fictional delegated tenant scope'}
    good = [('AdminFeeGift',gift),('AdminVipGrantCreate',vip),('AdminBindingCreate',binding),
            ('AdminScope',{'kind':'global'}),('AdminScope',{'kind':'project','tenant_id':fixture_id,'project_ids':[fixture_id]}),
            ('AdminContentControl',{**base,'action':'quarantine'}),('AdminVersionReason',base)]
    top_up = {**base, 'action':'top_up','amount':{'currency':'HKD','amount_micros':'500000000'}, 'payment_record_id':fixture_id}
    policy = {'base_policy_version_id':fixture_id,'kernel':'codex','provider_profile_id':fixture_id,
              'verified_capability_ids':[],'rate_version_ids':[], 'risk_rule_document_version_id':fixture_id,'reason':'Fictional verified Codex configuration'}
    good += [('AdminFeeTopUp',top_up),('AdminPolicyDraft',policy)]
    for name, value in good:
        check(validator.evolve(schema=definitions[name]).is_valid(value), 'example:admin:'+name+':valid')
    bad = []
    for amount in ['-1','0','1.5','01',500]:
        value = copy.deepcopy(gift); value['amount']['amount_micros'] = amount
        bad.append(('AdminFeeGift',value,'invalid-positive-micros-'+str(amount)))
    value = copy.deepcopy(gift); value['payment_record_id']=fixture_id
    bad.append(('AdminFeeGift',value,'gift-cannot-pretend-payment'))
    value = copy.deepcopy(gift); value['approved']=True
    bad.append(('AdminFeeGift',value,'client-cannot-approve'))
    value = copy.deepcopy(vip); value['auto_renew']=True
    bad.append(('AdminVipGrantCreate',value,'manual-grant-no-recurring-charge'))
    value = copy.deepcopy(vip); value['kernel']='external'
    bad.append(('AdminVipGrantCreate',value,'no-client-runtime-override'))
    value = copy.deepcopy(binding); value['scope']={'kind':'global','tenant_ids':[fixture_id]}
    bad.append(('AdminBindingCreate',value,'scope-not-ambiguous'))
    value = copy.deepcopy(binding); value['scope']={'kind':'tenant','tenant_ids':[]}
    bad.append(('AdminBindingCreate',value,'empty-tenant-scope'))
    value = copy.deepcopy(binding); value['is_admin']=True
    bad.append(('AdminBindingCreate',value,'no-is-admin-escalation'))
    value = copy.deepcopy(binding); value['constraints']['allowed_fields']=['*']
    bad.append(('AdminBindingCreate',value,'no-wildcard-field-access'))
    value = copy.deepcopy(top_up); value.pop('payment_record_id')
    bad.append(('AdminFeeTopUp',value,'top-up-needs-real-payment-reference'))
    value = copy.deepcopy(vip); value['source']='paid'
    bad.append(('AdminVipGrantCreate',value,'paid-grant-needs-payment-reference'))
    value = copy.deepcopy(policy); value['kernel']='external'
    bad.append(('AdminPolicyDraft',value,'admin-cannot-replace-codex'))
    value = copy.deepcopy(policy); value['provider_api_key']='forbidden'
    bad.append(('AdminPolicyDraft',value,'admin-cannot-inject-provider-secret'))
    bad += [('AdminRoleDraft',{'name':'Invalid','allow_permissions':['admin.*'],'deny_permissions':[], 'delegation_ceiling':[], 'reason':'Fictional invalid wildcard'},'no-wildcard'),
            ('AdminContentMetadata',{**base,'balance':'1000'},'no-finance-through-content'),
            ('AdminContentControl',{**base,'action':'set_succeeded'},'no-forged-task-state'),
            ('AdminSupportCreate',{'user_id':fixture_id,'tenant_id':fixture_id,'project_ids':[], 'mode':'impersonate','expires_at':'2026-11-17T04:00:00Z','reason':'Fictional invalid impersonation'},'no-user-impersonation'),
            ('AdminVersionReason',{'expected_version':0,'reason':'Bad old version'},'positive-version-required')]
    for name, value, label in bad:
        check(not validator.evolve(schema=definitions[name]).is_valid(value), 'reject:admin:'+label)
    invalid_catalog = copy.deepcopy(catalog); invalid_catalog['roles'][0]['permissions']=['*']
    check(not catalog_validator.is_valid(invalid_catalog), 'reject:admin:catalog-wildcard')
    COUNTS['valid_examples'] += len(good)+1
    COUNTS['invalid_example_cases'] += len(bad)+1
    COUNTS.update(admin_roles=len(roles), admin_permissions=len(permissions), admin_operations=len(admin_ops),
                  admin_valid_examples=len(good)+1, admin_invalid_examples=len(bad)+1)


def validate_refs(documents):
    total = 0
    # Component fixtures retain exact original definitions (including their
    # original references). Like the runtime fixture consumer, resolve those
    # definitions within an explicit components.schemas namespace. A fixture
    # is data containing definitions, rather than a standalone JSON Schema.
    contexts = dict(documents)
    for path, document in documents.items():
        if not (isinstance(document, dict) and isinstance(document.get('schemas'), dict)
                and document.get('normative_source') == 'docs/contracts/openapi.json'):
            continue
        normative = CONTRACTS / 'openapi.json'
        check(document.get('normative_source_sha256') == hashlib.sha256(normative.read_bytes()).hexdigest(),
              f'fixture:{path.name}:original-source-digest')
        check('components' not in document, f'fixture:{path.name}:unambiguous-namespace')
        original = documents[normative.resolve()]['components']['schemas']
        for name, definition in document['schemas'].items():
            if name in original:
                check(definition == original[name], f'fixture:{path.name}:{name}:exact-original')
            try:
                Draft202012Validator.check_schema(definition)
                check(True, f'fixture:{path.name}:{name}:schema-valid')
            except Exception as error:
                check(False, f'fixture:{path.name}:{name}:schema-invalid:{error}')
        contexts[path] = {**document, 'components': {'schemas': document['schemas']}}
    for path,document in documents.items():
        for node in walk(document):
            if not isinstance(node.get('$ref'), str):
                continue
            total += 1
            raw,fragment = urldefrag(node['$ref'])
            if raw and urlparse(raw).scheme not in ['', 'file']:
                check(False,f'ref:no-unresolved-remote:{node["$ref"]}')
                continue
            target = (path.parent/unquote(raw)).resolve() if raw else path
            try:
                check(target.is_relative_to(ROOT),'ref:within-docs')
                target_doc = contexts[target] if target in contexts else read_json(target)
                pointer(target_doc,fragment)
                check(True,f'ref:{path.name}:{node["$ref"]}')
            except Exception as error:
                check(False,f'ref:{path.name}:{node["$ref"]}:{error}')
    COUNTS['json_references'] = total

def validate_examples(api, registry):
    checker = FormatChecker()
    api_validator = Draft202012Validator(api,registry=registry,format_checker=checker)
    task_validator = api_validator.evolve(schema=api['components']['schemas']['TaskCreate'])
    task = read_json(CONTRACTS/'examples/task-create.json')
    check(task_validator.is_valid(task),'example:task-create-valid')
    bad = copy.deepcopy(task); bad['budget']['amount_micros']='-1'
    check(not task_validator.is_valid(bad),'reject:negative-budget')
    bad = copy.deepcopy(task); bad['input']={'snapshot_ids':[]}
    check(not task_validator.is_valid(bad),'reject:wrong-task-input-variant')
    bad = copy.deepcopy(task); bad['supplier_api_key']='forbidden'
    check(not task_validator.is_valid(bad),'reject:extra-secret-field')
    for name in ['task-event','device-command','device-channel','creative-project','video-project','delivery-manifest']:
        schema = read_json(CONTRACTS/f'{name}.schema.json')
        try:
            Draft202012Validator.check_schema(schema)
            check(True,f'schema:{name}:valid')
        except Exception as error:
            check(False,f'schema:{name}:{error}')
        validator = Draft202012Validator(schema,registry=registry,format_checker=checker)
        example = read_json(CONTRACTS/f'examples/{name}.json')
        errors = list(validator.iter_errors(example))
        check(not errors,f'example:{name}:valid')
        for error in errors:
            FAILED.append(f'example:{name}:{list(error.path)}:{error.message}')
        bad = copy.deepcopy(example)
        if name == 'task-event':
            bad['payload']['status']='finished'
        elif name == 'device-command':
            bad['args']['relative_path']='../secret.txt'
        elif name == 'device-channel':
            bad['type']='execute_arbitrary_shell'
        elif name == 'creative-project':
            bad['layers'][0]['font_asset_version_id']='not-a-uuid'
        elif name == 'video-project':
            bad['fps_den']=0
        else:
            bad['files'][0]['relative_path']='C:/secret.txt'
        check(not validator.is_valid(bad),f'reject:{name}:invalid-variant')
        if name == 'device-command':
            for invalid in ['/absolute','C:/absolute','..','x/../../outside','x\\outside','\\\\host\\share','name:stream','bad\x00name']:
                bad=copy.deepcopy(example);bad['args']['relative_path']=invalid
                check(not validator.is_valid(bad),f'reject:device-path:{invalid!r}')
    COUNTS['valid_examples'] = 7
    COUNTS['invalid_example_cases'] = 17
    # Cross-field contracts added for Web: one execution target, explicit
    # delegation budget, and versioned supplementation. Runtime behavior remains
    # not_run in the authored acceptance cases.
    fixture_id = task['project_id']
    group_task = copy.deepcopy(task)
    group_task.pop('agent_id')
    group_task.update(agent_group_id=fixture_id, type='delegation', input={'prompt':'Analyze then prepare creative'}, mode='execute')
    supplement = {'text':'Use this date range', 'asset_version_ids':[], 'client_message_id':fixture_id,
                  'intent':'supplement', 'task_id':fixture_id, 'expected_task_version':1}
    group_conversation = {'project_id':fixture_id, 'agent_group_id':fixture_id, 'mode':'plan'}
    file_node = {'name':'report.md', 'kind':'file', 'asset_version_id':fixture_id}
    good_web = [('TaskCreate',group_task), ('MessageCreate',supplement), ('ConversationCreate',group_conversation), ('WorkspaceNodeCreate',file_node)]
    for name, example in good_web:
        validator = api_validator.evolve(schema=api['components']['schemas'][name])
        check(validator.is_valid(example), f'example:web:{name}:valid')
    no_target = copy.deepcopy(group_task); no_target.pop('agent_group_id')
    both_targets = {**group_task, 'agent_id':fixture_id}
    no_version = copy.deepcopy(supplement); no_version.pop('expected_task_version')
    unpaid_delegation = {'text':'Generate creative', 'asset_version_ids':[], 'client_message_id':fixture_id, 'intent':'delegate'}
    both_conversation = {**group_conversation, 'agent_id':fixture_id}
    no_file = {'name':'report.md', 'kind':'file'}
    unbound_plan = {'expected_task_version':1, 'plan_version':1, 'decision':'execute'}
    bad_web = [('TaskCreate',no_target), ('TaskCreate',both_targets), ('MessageCreate',no_version),
               ('MessageCreate',unpaid_delegation), ('ConversationCreate',both_conversation),
               ('WorkspaceNodeCreate',no_file), ('ExecutionPlanDecision',unbound_plan)]
    for i, (name, example) in enumerate(bad_web):
        validator = api_validator.evolve(schema=api['components']['schemas'][name])
        check(not validator.is_valid(example), f'reject:web:{name}:{i}')
    COUNTS['valid_examples'] += len(good_web)
    COUNTS['invalid_example_cases'] += len(bad_web)

def validate_role_presets(api, registry):
    catalog = read_json(CONTRACTS/'role-preset-catalog.json')
    schema = read_json(CONTRACTS/'role-preset-catalog.schema.json')
    Draft202012Validator.check_schema(schema)
    validator = Draft202012Validator(schema, registry=registry, format_checker=FormatChecker())
    errors = list(validator.iter_errors(catalog))
    check(not errors, 'roles:catalog-schema-valid')
    for error in errors:
        FAILED.append(f'roles:schema:{list(error.path)}:{error.message}')
    roles, skills, models, runtimes = catalog['roles'], catalog['skill_catalog'], catalog['model_profiles'], catalog['runtime_profiles']
    for label, values, key in [('roles',roles,'role_key'),('skills',skills,'skill_key'),('models',models,'profile_key'),('runtimes',runtimes,'profile_key')]:
        check(len({v[key] for v in values}) == len(values), f'roles:unique-{label}')
    skills = {v['skill_key']:v for v in skills}
    models = {v['profile_key']:v for v in models}
    runtimes = {v['profile_key']:v for v in runtimes}
    check(all(v['kernel']=='codex' for v in runtimes.values()), 'roles:all-runtime-profiles-codex')
    documented = set(re.findall(r'^### (R\d{2}) ', (ROOT/'product/06-role-templates-and-skill-presets.md').read_text(encoding='utf-8'), re.M))
    check(len(roles) >= catalog['minimum_qualified_roles'] >= 12, 'roles:minimum-design-coverage')
    check({r['catalog_id'] for r in roles} == documented and len(documented) == len(roles), 'roles:human-and-machine-catalog-match')
    check(set(catalog['required_categories']) <= {r['category'] for r in roles}, 'roles:engineering-and-design-covered')
    for role in roles:
        key = role['role_key']
        check(role['runtime_profile'] in runtimes, f'roles:{key}:known-runtime')
        check(runtimes.get(role['runtime_profile'],{}).get('kernel')=='codex', f'roles:{key}:codex-only')
        bindings = role['skill_bindings']
        check(len({b['skill_key'] for b in bindings}) == len(bindings), f'roles:{key}:unique-skill-bindings')
        check(any(b['skill_key']=='delivery-core' and b['required'] for b in bindings), f'roles:{key}:versioned-delivery')
        profiles = {b['profile_key']:b['required'] for b in role['model_bindings']}
        check(len(profiles) == len(role['model_bindings']), f'roles:{key}:unique-model-bindings')
        check(profiles.get('internal-text-v1') is True, f'roles:{key}:internal-text-required')
        allowed_tools = set()
        for binding in bindings:
            skill = skills.get(binding['skill_key'])
            check(skill is not None, f'roles:{key}:registered-skill:{binding["skill_key"]}')
            if skill is None:
                continue
            check(binding['version'] == skill['version'], f'roles:{key}:pinned-skill-version:{skill["skill_key"]}')
            check(skill['package_state']=='planned' and skill['package_sha256'] is None, f'roles:{key}:package-implementation-not-claimed:{skill["skill_key"]}')
            check(skill['ai_network_policy']=='internal_only', f'roles:{key}:skill-ai-route:{skill["skill_key"]}')
            allowed_tools.update(skill['tool_ids'])
            for profile in skill['required_model_profiles']:
                check(profile in profiles and (not binding['required'] or profiles[profile]), f'roles:{key}:transitive-model-dependency:{profile}')
        check(set(role['tool_ids']) == allowed_tools, f'roles:{key}:tools-derived-from-declared-skills')
        for profile in profiles:
            check(profile in models and models[profile]['gateway_route']=='company_internal', f'roles:{key}:internal-model-profile:{profile}')
        check(role['qualification_cases']['execution_status']=='not_run' and not role['readiness_evidence'], f'roles:{key}:no-runtime-proof-claimed')
        check(len(set(role['input_contract']['required_fields']) & set(role['input_contract']['optional_fields'])) == 0, f'roles:{key}:input-required-optional-disjoint')
    designer = next(r for r in roles if r['role_key']=='designer')
    required = {b['skill_key'] for b in designer['skill_bindings'] if b['required']}
    check(designer['display_name']=='设计师' and runtimes[designer['runtime_profile']]['kernel']=='codex', 'roles:designer-codex')
    check({'creative-direction','image-art-direction','image2-production','typography-layout'} <= required, 'roles:designer-design-skill-bundle')
    check(any(b['profile_key']=='internal-image2-v1' and b['required'] for b in designer['model_bindings']), 'roles:designer-image2-required')
    check(models['internal-image2-v1']['requested_model']=='Image 2' and models['internal-image2-v1']['official_model_reference']=='gpt-image-2', 'roles:image2-user-selection-preserved')
    check(all(m['internal_model_alias'] is None and m['verification_state']=='unverified' and not m['silent_substitution_allowed'] for m in models.values()), 'roles:no-internal-model-verification-invented')
    bad_examples = []
    bad = copy.deepcopy(catalog); bad['roles']=bad['roles'][:11]; bad_examples.append(('fewer-than-12',bad))
    bad = copy.deepcopy(catalog); bad['all_ai_via_internal_gateway']=False; bad_examples.append(('gateway-bypass',bad))
    bad = copy.deepcopy(catalog); bad['runtime_profiles'][0]['kernel']='alternative_kernel'; bad_examples.append(('non-codex-kernel',bad))
    bad = copy.deepcopy(catalog); bad['model_profiles'][1]['gateway_route']='external_supplier'; bad_examples.append(('external-ai-route',bad))
    bad = copy.deepcopy(catalog); del bad['roles'][5]['skill_bindings'][0]['version']; bad_examples.append(('unversioned-skill',bad))
    bad = copy.deepcopy(catalog); bad['roles'][5]['status']='ready'; bad_examples.append(('fake-ready-state',bad))
    bad = copy.deepcopy(catalog); del bad['roles'][5]['qualification_cases']['revision']; bad_examples.append(('missing-revision-case',bad))
    for label,bad in bad_examples:
        check(not validator.is_valid(bad), f'reject:role-catalog:{label}')
    api_validator = Draft202012Validator(api,registry=registry,format_checker=FormatChecker())
    fixture = read_json(CONTRACTS/'examples/task-create.json')['project_id']
    use = {'project_id':fixture,'template_version':1,'overrides':{'locale':'zh-HK','delivery_preferences':['繁中可编辑文字层']}}
    publication = {'expected_version':1,'validation_task_ids':[
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002',
        '00000000-0000-4000-8000-000000000003']}
    good = [('AgentTemplateUse',use),('RoleTemplatePublication',publication)]
    for name, value in good:
        check(api_validator.evolve(schema=api['components']['schemas'][name]).is_valid(value),f'example:roles:{name}:valid')
    bad = copy.deepcopy(use); del bad['template_version']
    bad_api = [('AgentTemplateUse',bad)]
    bad = copy.deepcopy(use); bad['overrides']['base_url']='https://supplier.example.invalid'
    bad_api.append(('AgentTemplateUse',bad))
    bad = copy.deepcopy(use); bad['overrides']['kernel']='alternative_kernel'
    bad_api.append(('AgentTemplateUse',bad))
    bad = copy.deepcopy(publication); bad['validation_task_ids']=bad['validation_task_ids'][:2]
    bad_api.append(('RoleTemplatePublication',bad))
    bad = copy.deepcopy(publication); bad['validation_task_ids']=[fixture]*3
    bad_api.append(('RoleTemplatePublication',bad))
    for i,(name,value) in enumerate(bad_api):
        check(not api_validator.evolve(schema=api['components']['schemas'][name]).is_valid(value),f'reject:roles:{name}:{i}')
    COUNTS['valid_examples'] += 1 + len(good)
    COUNTS['invalid_example_cases'] += len(bad_examples) + len(bad_api)
    COUNTS.update(role_presets=len(roles),planned_skill_packages=len(skills),qualified_roles=0,
                  codex_runtime_profiles=len(runtimes),codex_only_roles=len(roles))


def validate_codex_policy(api):
    expected = {'origin_id':'CORE01','kernel':'codex','integration':'app-server',
                'default_transport':'stdio','automatic_kernel_fallback':False}
    check(api.get('x-runtime-policy')==expected, 'codex:product-contract-policy')
    schema = read_json(CONTRACTS/'role-preset-catalog.schema.json')
    check(schema['$defs']['runtime']['properties']['kernel']=={'const':'codex'}, 'codex:catalog-kernel-constant')
    data_model = (ROOT/'technical/03-data-model-and-lifecycle.md').read_text(encoding='utf-8')
    check("CHECK(kernel = 'codex')" in data_model, 'codex:data-model-constraint-documented')
    retired = re.compile(r'\bdsh\b|deepseek-harness|两个候选内核', re.I)
    for path in sorted(ROOT.rglob('*.md')):
        check(not retired.search(path.read_text(encoding='utf-8')), f'codex:no-retired-direction:{path.relative_to(ROOT)}')


def validate_brand_design():
    base = ROOT/'research/copypaste-brand'
    evidence = read_json(base/'source-evidence.json')
    tokens = read_json(ROOT/'design/brand-tokens.json')
    css = (base/'styles-source.css').read_text(encoding='utf-8')
    product_css = (ROOT/'design/brand-tokens.css').read_text(encoding='utf-8')
    check(tokens['origin_id']=='BRAND01' and tokens['status']=='design_only', 'brand:design-origin-and-status')
    check(tokens['base_color_origin']=='official_site_css_snapshot' and tokens['semantic_color_origin']=='product_extension', 'brand:source-versus-extension')
    check(tokens['source_url']==evidence['source_url']=='https://copypaste.hk/', 'brand:official-source')
    expected_sources = {
        'homepage-source.html':'https://copypaste.hk/',
        'styles-source.css':'https://copypaste.hk/styles.css',
        'app-source.js':'https://copypaste.hk/app.js',
        **{name:'https://copypaste.hk/assets/logo/'+name for name in ['CopyPaste_Light.svg','CopyPaste_Dark.svg','CopyPaste_Light.png','CopyPaste_Dark.png']},
    }
    check(len(evidence['sources'])==7 and {s['local_file'] for s in evidence['sources']}==set(expected_sources), 'brand:seven-source-files')
    for source in evidence['sources']:
        name=source['local_file']
        path=(base/name).resolve()
        check(source['url']==expected_sources.get(name) and source['http_status']==200, f'brand:source:{name}:url-and-status')
        check(path.is_relative_to(base.resolve()) and path.is_file(), f'brand:source:{name}:local-file')
        if path.is_file():
            data=path.read_bytes()
            check(hashlib.sha256(data).hexdigest()==source['sha256'] and len(data)==source['bytes'], f'brand:source:{name}:fingerprint')
    check(evidence['browser_cleanup']=={'contexts_closed':True,'owned_browser_closed':True}, 'brand:reference-browser-cleaned')
    check({v['key'] for v in evidence['views']}=={'homepage-light','homepage-dark','homepage-mobile'} and len(evidence['views'])==3, 'brand:three-reference-views')
    for view in evidence['views']:
        check(view['http_status']==200 and (base/view['screenshot']).is_file(), f'brand:reference:{view["key"]}:screenshot')
        check(bool(view['platform_fonts']), f'brand:reference:{view["key"]}:actual-font-record')
    pairs = [
        ('text','bg',4.5),('text-muted','bg',4.5),('text','surface',4.5),('text-muted','surface',4.5),
        ('action-text','action-fill',4.5),('accent','surface',4.5),('focus','bg',3),
        ('control-border','surface',3),('control-border','bg',3),
        ('success','success-soft',4.5),('warning','warning-soft',4.5),('error','error-soft',4.5),('info','info-soft',4.5),
    ]
    check([(p['foreground'],p['background'],p['minimum_ratio']) for p in tokens['contrast_pairs']]==pairs, 'brand:specified-contrast-combinations')

    def luminance(color):
        values=[int(color[i:i+2],16)/255 for i in (1,3,5)]
        linear=[v/12.92 if v<=0.04045 else ((v+0.055)/1.055)**2.4 for v in values]
        return sum(v*w for v,w in zip(linear,[0.2126,0.7152,0.0722]))

    checks = 0
    for theme,source_pattern,output_pattern in [
        ('light',r':root\s*\{(.*?)\}',r':root, :root\[data-theme="light"\]\s*\{(.*?)\}'),
        ('dark',r'html\[data-theme="dark"\]\s*\{(.*?)\}',r':root\[data-theme="dark"\]\s*\{(.*?)\}'),
    ]:
        source_block=re.search(source_pattern,css,re.S).group(1)
        source_values=dict(re.findall(r'--color-([a-z-]+):\s*([^;]+);',source_block))
        theme_data=tokens['themes'][theme]
        check(theme_data['base_colors']=={k:v.lower() for k,v in source_values.items() if k!='shadow'}, f'brand:{theme}:exact-official-colors')
        check(theme_data['source_shadow']==source_values['shadow'], f'brand:{theme}:official-shadow')
        recorded=next(v for v in evidence['views'] if v['key']=='homepage-'+theme)['computed']['tokens']
        check(all(recorded['--color-'+key].lower()==value for key,value in theme_data['base_colors'].items()), f'brand:{theme}:browser-source-agrees')
        output_block=re.search(output_pattern,product_css,re.S).group(1)
        output_values=dict(re.findall(r'--cp-color-([a-z-]+):\s*([^;]+);',output_block))
        colors={**theme_data['base_colors'],**theme_data['product_semantic_colors']}
        check(output_values==colors, f'brand:{theme}:css-token-sync')
        check(colors['action-fill']==colors['text'] and colors['action-text']==colors['bg'], f'brand:{theme}:primary-button-mapping')
        for foreground,background,minimum in pairs:
            dark,light=sorted([luminance(colors[foreground]),luminance(colors[background])])
            ratio=(light+0.05)/(dark+0.05)
            check(ratio>=minimum, f'brand:{theme}:contrast:{foreground}/{background}:{ratio:.3f}>={minimum}')
            checks+=1
    check('Noto Serif TC' in tokens['fonts']['display'] and 'Noto Sans TC' in tokens['fonts']['body'], 'brand:traditional-chinese-fallbacks')
    check(tokens['theme_preferences']==['light','dark','system'] and tokens['default_theme']=='light', 'brand:theme-options')
    check(tokens['layout']['test_widths_px']==[375,768,1024,1440], 'brand:responsive-widths')
    check(tokens['customer_artifact_theme_policy']=='customer_brand_only_platform_theme_does_not_modify_exports', 'brand:customer-theme-separate')
    for theme,asset in tokens['logo_assets'].items():
        check((ROOT/'design'/asset).resolve().is_file(), f'brand:{theme}:logo-asset')
    for name in ['product/01-prd.md','product/03-information-architecture-and-interactions.md','product/05-web-agent-workbench.md','product/06-role-templates-and-skill-presets.md','modules/07-web-extension-desktop.md']:
        check('07-brand-design-system.md' in (ROOT/name).read_text(encoding='utf-8'),f'brand:linked-definition:{name}')
    ia=(ROOT/'product/03-information-architecture-and-interactions.md').read_text(encoding='utf-8')
    check(all(color not in ia for color in ['#2563EB','#F8FAFC','#1E293B']), 'brand:obsolete-generic-theme-replaced')
    preview=read_json(ROOT/'quality/brand-preview-review.json')
    check(preview['scope']=='documentation_visual_sample_only' and preview['status']=='passed', 'brand:preview-scope-and-result')
    check(preview['checks_failed']==0 and len(preview['checks'])>=50 and preview['checks_passed']==len(preview['checks']), 'brand:preview-check-counts')
    check(not preview['network_requests'] and not preview['browser_errors'], 'brand:preview-offline-and-error-free')
    check(preview['browser_cleanup']=={'contexts_closed':True,'owned_browser_closed':True}, 'brand:preview-browser-cleaned')
    check(len(preview['screenshots'])==4 and all((ROOT/path).is_file() for path in preview['screenshots']), 'brand:preview-four-screenshots')
    check(set(preview['inputs'])=={'brand-preview.html','brand-tokens.css','brand-tokens.json'},'brand:preview-input-ledger')
    for name,digest in preview['inputs'].items():
        check(hashlib.sha256((ROOT/'design'/name).read_bytes()).hexdigest()==digest, f'brand:preview-current-input:{name}')
    for result in preview['checks']:
        check(result['passed'], 'brand:preview:'+result['name'])
    COUNTS.update(brand_source_files=len(evidence['sources']),brand_reference_views=len(evidence['views']),
                  brand_base_color_tokens=18,brand_contrast_combinations=checks,
                  brand_preview_checks=preview['checks_passed'])


def validate_signature():
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
    command = read_json(CONTRACTS/'examples/device-command.json')
    public = read_json(CONTRACTS/'examples/device-public-key.json')
    b64 = lambda s:base64.urlsafe_b64decode(s+'='*(-len(s)%4))
    signature = command.pop('signature')
    key = Ed25519PublicKey.from_public_bytes(b64(public['public_key']))
    canonical = lambda value:json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')
    input_hash = hashlib.sha256(canonical({'action':command['action'],'args':command['args']})).hexdigest()
    check(command['input_hash']==input_hash,'signature:action-args-input-hash')
    try:
        key.verify(b64(signature['value']),canonical(command))
        check(True,'signature:public-fixture-verifies')
    except InvalidSignature:
        check(False,'signature:public-fixture-verifies')
    command['args']['max_bytes']+=1
    try:
        key.verify(b64(signature['value']),canonical(command))
        check(False,'signature:tampering-rejected')
    except InvalidSignature:
        check(True,'signature:tampering-rejected')
    # Integral ASCII-key fixtures do not establish full RFC 8785 compliance.

def calculate_metrics(rows):
    groups = {}
    for currency in {r['currency'] for r in rows}:
        selected = [r for r in rows if r['currency']==currency]
        totals = {}
        for field in ['impressions','clicks','spend','conversions','conversion_value']:
            values = [r.get(field) for r in selected]
            totals[field] = None if any(v is None for v in values) else sum((Decimal(str(v)) for v in values),Decimal(0))
        def ratio(top,bottom,factor=1):
            if totals[top] is None or totals[bottom] is None or totals[bottom]==0:
                return None
            return (totals[top]*factor/totals[bottom]).quantize(Decimal('0.00000001'),rounding=ROUND_HALF_UP)
        totals.update(ctr=ratio('clicks','impressions'),cpc=ratio('spend','clicks'),cpm=ratio('spend','impressions',1000),cvr=ratio('conversions','clicks'),cpa=ratio('spend','conversions'),roas=ratio('conversion_value','spend'))
        groups[currency]=totals
    return groups

def validate_metrics():
    vectors=read_json(CONTRACTS/'analytics-metric-vectors.json')
    assertions=0
    for case in vectors['cases']:
        actual=calculate_metrics(case['rows'])
        check(set(actual)==set(case['expected']),f'metrics:{case["id"]}:currency-groups')
        for currency,values in case['expected'].items():
            for key,expected in values.items():
                assertions+=1
                check(actual[currency][key]==(Decimal(str(expected)) if expected is not None else None),f'metrics:{case["id"]}:{currency}:{key}')
    weighted=vectors['cases'][0]
    naive=sum(Decimal(r['clicks'])/Decimal(r['impressions']) for r in weighted['rows'])/len(weighted['rows'])
    check(naive!=calculate_metrics(weighted['rows'])['HKD']['ctr'],'metrics:reject-mean-of-ratios')
    COUNTS.update(metric_cases=len(vectors['cases']),metric_value_assertions=assertions)

def main():
    documents = {}
    for p in sorted(ROOT.rglob('*.json')):
        if p.name=='validation-report.json':
            continue
        documents[p.resolve()]=read_json(p)
    resources=[]
    for path,document in documents.items():
        resource=Resource.from_contents(document,default_specification=DRAFT202012)
        resources.append((path.as_uri(),resource))
        if '$id' in document:
            resources.append((document['$id'],resource))
    registry=Registry().with_resources(resources)
    api=read_json(CONTRACTS/'openapi.json')
    validate_files_links()
    validate_benchmark_sources()
    validate_traceability(api)
    validate_openapi(api,registry)
    validate_refs(documents)
    validate_examples(api,registry)
    validate_role_presets(api,registry)
    validate_admin_contracts(api,registry)
    validate_codex_policy(api)
    validate_brand_design()
    validate_signature()
    validate_metrics()
    report={'scope':'documentation_contracts_and_recorded_design_evidence_only','checked_at':datetime.now(timezone.utc).isoformat(),
            'status':'passed' if not FAILED else 'failed','counts':COUNTS,
            'checks_passed':len(PASSED),'checks_failed':len(FAILED),'failures':FAILED,
            'not_validated':['real_admin_dashboard_identity_authorization_financial_and_entitlement_enforcement','real_codex_app_server_integration_and_kernel_enforcement','real_internal_gateway_and_model','real_media_output','real_role_skill_loading_and_qualification','external_platform_authorization','running_web_extension_desktop','complete_product_visual_and_accessibility_acceptance','performance_recovery_security_in_production','full_RFC8785_cross_language_conformance']}
    report_path=ROOT/'quality/validation-report.json'
    report_path.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
    return 1 if FAILED else 0

if __name__=='__main__':
    sys.exit(main())
