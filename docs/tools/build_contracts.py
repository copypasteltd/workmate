"""Build documentation contracts and fictional fixtures. Does not start any service."""
from pathlib import Path
import base64
import hashlib
import json
import sys
import uuid

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'contracts'
STATES = ['draft', 'needs_input', 'queued', 'running', 'waiting_approval', 'waiting_device', 'paused', 'cancelling', 'succeeded', 'partially_succeeded', 'failed', 'cancelled']
S = {}
ID = {'type': 'string', 'format': 'uuid'}
TEXT = {'type': 'string', 'minLength': 1}
TIME = {'type': 'string', 'format': 'date-time'}
INT = {'type': 'integer', 'minimum': 0}
BOOL = {'type': 'boolean'}
HASH = {'type': 'string', 'pattern': '^[a-f0-9]{64}$'}

def ref(name):
    return {'$ref': '#/components/schemas/' + name}

def arr(item, minimum=0):
    return {'type': 'array', 'items': item, 'minItems': minimum}

def enum(*values):
    return {'type': 'string', 'enum': list(values)}

def obj(props, required=None):
    return {'type': 'object', 'properties': props, 'required': list(props) if required is None else required, 'additionalProperties': False}

def add(name, props, required=None):
    S[name] = obj(props, required)

def uid(label):
    return str(uuid.uuid5(uuid.NAMESPACE_URL, 'https://example.invalid/copypaste-fixture/' + label))

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

def define_schemas():
    S['TaskStatus'] = enum(*STATES)
    S['TaskType'] = enum('delegation', 'creative_image', 'creative_video', 'analysis', 'seo', 'geo', 'workflow', 'local_file')
    add('Money', {'currency': enum('HKD'), 'amount_micros': {'type': 'string', 'pattern': '^(0|[1-9][0-9]*)$', 'description': 'One millionth of currency; decimal integer string.'}})
    add('ErrorDetail', {'code': TEXT, 'message': TEXT, 'request_id': TEXT, 'retryable': BOOL, 'details': {'type': 'object', 'additionalProperties': {'type': 'string'}}}, ['code', 'message', 'request_id', 'retryable'])
    add('Error', {'error': ref('ErrorDetail')})
    add('User', {'id': ID, 'email': {'type': 'string', 'format': 'email'}, 'display_name': TEXT})
    add('TenantCreate', {'name': TEXT, 'timezone': TEXT}, ['name'])
    add('Tenant', {'id': ID, 'name': TEXT, 'timezone': TEXT, 'version': INT, 'state': enum('active', 'suspended', 'closed')})
    add('ProjectCreate', {'name': TEXT, 'timezone': TEXT, 'default_locale': enum('zh-HK', 'en-HK')}, ['name'])
    add('Project', {'id': ID, 'tenant_id': ID, 'name': TEXT, 'timezone': TEXT, 'default_locale': TEXT, 'version': INT})
    S['Role'] = enum('owner', 'admin', 'member', 'approver', 'viewer')
    add('Member', {'id': ID, 'user_id': ID, 'role': ref('Role'), 'project_ids': arr(ID), 'state': enum('active', 'removed'), 'auth_version': INT})
    add('InviteCreate', {'email': {'type': 'string', 'format': 'email'}, 'role': ref('Role'), 'project_ids': arr(ID)})
    add('Invite', {'id': ID, 'email': {'type': 'string', 'format': 'email'}, 'role': ref('Role'), 'expires_at': TIME, 'state': enum('pending', 'accepted', 'expired', 'revoked')})
    add('InviteAccept', {'token': TEXT})
    add('AuthChallengeCreate', {'email': {'type': 'string', 'format': 'email'}})
    add('AuthChallenge', {'challenge_id': ID, 'expires_at': TIME})
    add('SessionCreate', {'challenge_id': ID, 'code': {'type': 'string', 'pattern': '^[0-9]{6}$'}})
    add('UserSession', {'user': ref('User'), 'expires_at': TIME, 'csrf_token': TEXT})
    add('CodeExchange', {'grant_type': {'const': 'authorization_code'}, 'code': TEXT, 'code_verifier': TEXT, 'redirect_uri': {'type': 'string', 'format': 'uri'}, 'client_id': TEXT})
    add('RefreshExchange', {'grant_type': {'const': 'refresh_token'}, 'refresh_token': TEXT, 'client_id': TEXT})
    S['TokenExchange'] = {'oneOf': [ref('CodeExchange'), ref('RefreshExchange')]}
    add('Tokens', {'access_token': TEXT, 'refresh_token': TEXT, 'token_type': {'const': 'Bearer'}, 'expires_in': {'type': 'integer', 'minimum': 1}})
    add('AgentCreate', {'project_id': ID, 'name': TEXT, 'instructions': TEXT, 'brand_version_id': ID, 'tool_ids': arr(TEXT), 'capability_id': TEXT}, ['project_id', 'name', 'instructions', 'tool_ids', 'capability_id'])
    add('Agent', {'id': ID, 'project_id': ID, 'name': TEXT, 'agent_version_id': ID, 'version': INT, 'tool_ids': arr(TEXT), 'capability_id': TEXT})
    add('AgentUpdate', {'expected_version': INT, 'name': TEXT, 'instructions': TEXT, 'brand_version_id': ID, 'tool_ids': arr(TEXT), 'capability_id': TEXT}, ['expected_version'])
    add('MemoryCreate', {'project_id': ID, 'scope': enum('enterprise', 'project', 'brand', 'personal', 'conversation'), 'scope_id': ID, 'content': TEXT, 'source_asset_version_id': ID}, ['project_id', 'scope', 'scope_id', 'content'])
    add('Memory', {'id': ID, 'project_id': ID, 'scope': TEXT, 'scope_id': ID, 'content': TEXT, 'version': INT, 'state': enum('active', 'deleted')})
    add('Size', {'width': {'type': 'integer', 'minimum': 1, 'maximum': 16384}, 'height': {'type': 'integer', 'minimum': 1, 'maximum': 16384}})
    add('CreativeInput', {'prompt': TEXT, 'asset_version_ids': arr(ID), 'brand_version_id': ID, 'locales': arr(enum('zh-HK', 'en-HK'), 1), 'sizes': arr(ref('Size'), 1), 'factual_text': TEXT}, ['prompt', 'locales', 'sizes'])
    add('VideoInput', {'prompt': TEXT, 'mode': enum('template', 'generative'), 'template_version_id': ID, 'asset_version_ids': arr(ID), 'duration_frames': {'type': 'integer', 'minimum': 1}, 'fps_num': {'type': 'integer', 'minimum': 1}, 'fps_den': {'type': 'integer', 'minimum': 1}, 'locale': TEXT}, ['prompt', 'mode', 'asset_version_ids', 'duration_frames', 'fps_num', 'fps_den', 'locale'])
    add('AnalysisSpec', {'prompt': TEXT, 'snapshot_ids': arr(ID), 'connection_ids': arr(ID), 'date_from': {'type': 'string', 'format': 'date'}, 'date_to': {'type': 'string', 'format': 'date'}, 'timezone': TEXT, 'currency_policy': enum('group_by_currency'), 'metrics': arr(enum('spend', 'impressions', 'clicks', 'conversions', 'conversion_value', 'ctr', 'cpc', 'cpm', 'cvr', 'cpa', 'roas'), 1), 'dimensions': arr(TEXT)}, ['prompt', 'date_from', 'date_to', 'timezone', 'currency_policy', 'metrics', 'dimensions'])
    add('SeoInput', {'prompt': TEXT, 'start_urls': arr({'type': 'string', 'format': 'uri'}, 1), 'allowed_hosts': arr(TEXT, 1), 'max_pages': {'type': 'integer', 'minimum': 1, 'maximum': 1000}, 'connection_id': ID}, ['prompt', 'start_urls', 'allowed_hosts', 'max_pages'])
    add('GeoInput', {'prompt': TEXT, 'experiment_id': ID}, ['prompt', 'experiment_id'])
    add('WorkflowInput', {'prompt': TEXT, 'workflow_version_id': ID, 'asset_version_ids': arr(ID)}, ['prompt', 'workflow_version_id'])
    add('LocalInput', {'prompt': TEXT, 'grant_id': ID, 'relative_paths': arr(TEXT, 1), 'operation': enum('scan', 'read', 'transform')})
    add('DelegationInput', {'prompt': TEXT, 'asset_version_ids': arr(ID)}, ['prompt'])
    add('TaskCreate', {'project_id': ID, 'agent_id': ID, 'type': ref('TaskType'), 'input': {'type': 'object'}, 'budget': ref('Money'), 'device_id': ID}, ['project_id', 'agent_id', 'type', 'input', 'budget'])
    variants = {'delegation': 'DelegationInput', 'creative_image': 'CreativeInput', 'creative_video': 'VideoInput', 'analysis': 'AnalysisSpec', 'seo': 'SeoInput', 'geo': 'GeoInput', 'workflow': 'WorkflowInput', 'local_file': 'LocalInput'}
    S['TaskCreate']['allOf'] = [{'if': {'properties': {'type': {'const': key}}, 'required': ['type']}, 'then': {'properties': {'input': ref(value)}}} for key, value in variants.items()]
    add('Task', {'id': ID, 'tenant_id': ID, 'project_id': ID, 'agent_id': ID, 'attempt_id': ID, 'type': ref('TaskType'), 'status': ref('TaskStatus'), 'version': INT, 'last_seq': INT, 'created_at': TIME, 'review_state': enum('pending_review', 'accepted', 'changes_requested', 'discarded'), 'artifact_ids': arr(ID), 'confirmed_cost': ref('Money'), 'cost_state': enum('estimated', 'confirmed', 'reconciling')})
    add('TaskAccepted', {'task_id': ID, 'status': ref('TaskStatus'), 'version': INT, 'location': TEXT})
    add('TaskControl', {'action': enum('cancel', 'pause', 'resume', 'retry'), 'expected_version': INT, 'reason': TEXT}, ['action', 'expected_version'])
    add('ReviewCreate', {'artifact_ids': arr(ID, 1), 'decision': enum('accepted', 'changes_requested', 'discarded'), 'comment': TEXT}, ['artifact_ids', 'decision'])
    add('Review', {'id': ID, 'task_id': ID, 'decision': TEXT, 'created_at': TIME})
    add('ApprovalDecision', {'decision': enum('approve', 'reject'), 'action_hash': HASH, 'expected_version': INT})
    add('Approval', {'id': ID, 'task_id': ID, 'action_type': TEXT, 'action_hash': HASH, 'state': enum('pending', 'approved', 'rejected', 'expired', 'revoked'), 'expires_at': TIME, 'version': INT})
    add('UploadCreate', {'project_id': ID, 'filename': TEXT, 'content_type': TEXT, 'size_bytes': {'type': 'integer', 'minimum': 1, 'maximum': 1073741824}, 'sha256': HASH})
    S['UploadCreate']['properties']['conversation_id'] = ID
    add('UploadSession', {'upload_id': ID, 'upload_url': {'type': 'string', 'format': 'uri'}, 'expires_at': TIME, 'part_size_bytes': {'type': 'integer', 'minimum': 1}})
    add('UploadComplete', {'sha256': HASH, 'size_bytes': {'type': 'integer', 'minimum': 1}})
    add('Asset', {'id': ID, 'project_id': ID, 'asset_version_id': ID, 'kind': enum('image', 'video', 'audio', 'font', 'document', 'dataset', 'project'), 'state': enum('pending_upload', 'processing', 'ready', 'rejected', 'deleted'), 'content_type': TEXT, 'size_bytes': INT, 'sha256': HASH})
    add('Download', {'url': {'type': 'string', 'format': 'uri'}, 'expires_at': TIME, 'mode': enum('signed_url', 'authenticated_proxy')})
    add('FontRule', {'font_asset_version_id': ID, 'weight': {'type': 'integer', 'minimum': 100, 'maximum': 900}, 'usage_scope': TEXT})
    add('BrandCreate', {'project_id': ID, 'name': TEXT, 'logo_asset_version_ids': arr(ID), 'colors': arr({'type': 'string', 'pattern': '^#[0-9A-Fa-f]{6}$'}), 'fonts': arr(ref('FontRule')), 'tone': TEXT, 'product_facts': arr(TEXT)}, ['project_id', 'name', 'logo_asset_version_ids', 'colors', 'fonts', 'tone', 'product_facts'])
    add('BrandVersion', {'id': ID, 'project_id': ID, 'brand_id': ID, 'version_no': {'type': 'integer', 'minimum': 1}, 'created_at': TIME})
    add('Artifact', {'id': ID, 'task_id': ID, 'asset_version_id': ID, 'specification_id': TEXT, 'state': enum('preview', 'ready', 'failed'), 'locale': TEXT}, ['id', 'task_id', 'asset_version_id', 'specification_id', 'state'])
    add('ExportCreate', {'artifact_ids': arr(ID, 1), 'format': enum('zip', 'png', 'jpeg', 'mp4', 'json', 'html', 'pdf'), 'include_editing_project': BOOL})
    add('ExportJob', {'id': ID, 'task_id': ID, 'status': enum('queued', 'running', 'succeeded', 'failed'), 'asset_version_id': ID}, ['id', 'task_id', 'status'])
    add('MediaCreate', {'task_id': ID, 'capability_id': TEXT, 'mode': enum('image_generate', 'image_edit', 'video_generate', 'template_render', 'audio_generate', 'transcribe'), 'prompt': TEXT, 'asset_version_ids': arr(ID), 'size': ref('Size'), 'effect_id': TEXT}, ['task_id', 'capability_id', 'mode', 'asset_version_ids'])
    add('MediaJob', {'id': ID, 'task_id': ID, 'operation_id': ID, 'status': enum('created', 'submitted', 'running', 'cancel_requested', 'succeeded', 'failed', 'cancelled', 'unknown'), 'artifact_ids': arr(ID), 'cost_state': enum('estimated', 'confirmed', 'reconciling')})
    add('ImportCreate', {'project_id': ID, 'asset_version_id': ID, 'source': enum('google_ads', 'meta_ads'), 'account_id': TEXT, 'timezone': TEXT, 'currency': TEXT, 'mapping': {'type': 'object', 'additionalProperties': {'type': 'string'}}, 'attribution_definition': TEXT})
    add('Snapshot', {'id': ID, 'project_id': ID, 'source': TEXT, 'state': enum('processing', 'complete', 'partial', 'failed'), 'row_count': INT, 'data_as_of': TIME, 'spec_hash': HASH})
    add('ReportCreate', {'project_id': ID, 'agent_id': ID, 'analysis': ref('AnalysisSpec'), 'budget': ref('Money')})
    add('Report', {'id': ID, 'task_id': ID, 'snapshot_ids': arr(ID), 'state': enum('queued', 'running', 'ready', 'failed'), 'evidence_ids': arr(ID), 'asset_version_id': ID}, ['id', 'task_id', 'snapshot_ids', 'state', 'evidence_ids'])
    add('Evidence', {'id': ID, 'snapshot_id': ID, 'metric_id': TEXT, 'value': {'type': ['string', 'null']}, 'unit': TEXT, 'formula_version': TEXT, 'scope': TEXT, 'null_reason': {'type': ['string', 'null']}})
    add('GeoExperimentCreate', {'project_id': ID, 'brand_aliases': arr(TEXT, 1), 'prompts': arr(TEXT, 1), 'locale': TEXT, 'region': TEXT, 'capability_id': TEXT, 'retrieval_enabled': BOOL, 'observation_type': enum('model_api', 'consumer_product'), 'repetitions': {'type': 'integer', 'minimum': 1, 'maximum': 20}})
    add('GeoExperiment', {'id': ID, 'project_id': ID, 'version': INT, 'spec_hash': HASH})
    S['Provider'] = enum('google_ads', 'meta_ads', 'ga4', 'search_console')
    add('ConnectionCreate', {'project_id': ID, 'provider': ref('Provider')})
    add('Connection', {'id': ID, 'project_id': ID, 'provider': ref('Provider'), 'state': enum('pending', 'active', 'reauth_required', 'degraded', 'revoked'), 'auth_version': INT, 'account_ids': arr(TEXT), 'data_as_of': {'type': ['string', 'null'], 'format': 'date-time'}, 'authorization_url': {'type': 'string', 'format': 'uri'}}, ['id', 'project_id', 'provider', 'state', 'auth_version', 'account_ids', 'data_as_of'])
    add('ConnectionUpdate', {'account_ids': arr(TEXT), 'project_ids': arr(ID), 'expected_version': INT})
    add('SyncCreate', {'date_from': {'type': 'string', 'format': 'date'}, 'date_to': {'type': 'string', 'format': 'date'}})
    add('Sync', {'id': ID, 'connection_id': ID, 'state': enum('queued', 'running', 'complete', 'partial', 'failed'), 'snapshot_id': ID}, ['id', 'connection_id', 'state'])
    add('WorkflowStep', {'key': TEXT, 'type': enum('agent_task', 'query', 'transform', 'render', 'approval', 'local_command', 'export'), 'depends_on': arr(TEXT), 'tool_id': TEXT})
    add('WorkflowCreate', {'project_id': ID, 'name': TEXT, 'steps': arr(ref('WorkflowStep'), 1), 'tool_ids': arr(TEXT), 'budget': ref('Money')})
    add('Workflow', {'id': ID, 'project_id': ID, 'workflow_version_id': ID, 'name': TEXT, 'version': INT})
    add('WorkflowRun', {'agent_id': ID, 'asset_version_ids': arr(ID), 'budget': ref('Money')})
    add('TriggerCreate', {'project_id': ID, 'workflow_version_id': ID, 'timezone': TEXT, 'expression': TEXT, 'catch_up': enum('latest_only', 'skip'), 'enabled': BOOL})
    add('Trigger', {'id': ID, 'project_id': ID, 'version': INT, 'enabled': BOOL, 'next_run_at': {'type': ['string', 'null'], 'format': 'date-time'}})
    add('TriggerUpdate', {'expected_version': INT, 'enabled': BOOL})
    add('PairingCreate', {'project_id': ID, 'device_name': TEXT})
    add('Pairing', {'id': ID, 'code': TEXT, 'expires_at': TIME})
    add('PairingComplete', {'code': TEXT, 'public_key': TEXT, 'key_proof': TEXT, 'protocol_version': TEXT, 'os': enum('windows', 'macos', 'linux')})
    add('Device', {'id': ID, 'name': TEXT, 'os': TEXT, 'state': enum('online', 'offline', 'revoked'), 'auth_version': INT, 'protocol_version': TEXT, 'capabilities': arr(TEXT)})
    add('DeviceCredentials', {'device': ref('Device'), 'access_token': TEXT, 'refresh_token': TEXT, 'expires_in': {'type': 'integer', 'minimum': 1}})
    add('GrantCreate', {'project_id': ID, 'root_label': TEXT, 'local_grant_proof': TEXT, 'actions': arr(enum('read', 'write', 'watch', 'program', 'browser'), 1)})
    add('Grant', {'id': ID, 'device_id': ID, 'project_id': ID, 'root_label': TEXT, 'actions': arr(TEXT), 'state': enum('active', 'revoked'), 'version': INT})
    add('CommandResult', {'command_id': ID, 'fencing_token': {'type': 'integer', 'minimum': 1}, 'state': enum('accepted', 'running', 'succeeded', 'failed', 'cancelled', 'unknown'), 'artifact_ids': arr(ID), 'output_sha256': HASH, 'error_code': TEXT}, ['command_id', 'fencing_token', 'state', 'artifact_ids'])
    add('Capability', {'id': TEXT, 'version': TEXT, 'kind': enum('llm', 'image', 'video', 'audio', 'embedding', 'other_ai'), 'state': enum('unverified', 'verified', 'degraded', 'disabled'), 'model_alias': TEXT, 'wire_protocol': TEXT, 'reasoning_effort': TEXT, 'supported_operations': arr(TEXT)}, ['id', 'version', 'kind', 'state', 'supported_operations'])
    add('UsageSummary', {'confirmed': ref('Money'), 'reserved': ref('Money'), 'reconciling': ref('Money'), 'period_from': {'type': 'string', 'format': 'date'}, 'period_to': {'type': 'string', 'format': 'date'}})
    add('Budget', {'available': ref('Money'), 'reserved': ref('Money'), 'version': INT})
    add('BudgetUpdate', {'expected_version': INT, 'new_limit': ref('Money'), 'reason': TEXT})
    add('Plan', {'id': ID, 'name': TEXT, 'version': INT, 'seats': {'type': 'integer', 'minimum': 1}, 'included_credit': ref('Money'), 'capability_ids': arr(TEXT)})
    add('SubscriptionUpdate', {'plan_id': ID, 'expected_version': INT})
    add('Subscription', {'id': ID, 'plan_id': ID, 'state': enum('trial', 'active', 'suspended', 'closed'), 'version': INT, 'effective_at': TIME})
    add('Invoice', {'id': ID, 'state': enum('draft', 'issued', 'paid', 'void'), 'amount': ref('Money'), 'period_from': {'type': 'string', 'format': 'date'}, 'period_to': {'type': 'string', 'format': 'date'}})
    add('DeletionCreate', {'project_id': ID, 'target_type': enum('project', 'asset', 'memory', 'tenant'), 'target_id': ID, 'reason': TEXT}, ['target_type', 'target_id', 'reason'])
    add('Deletion', {'id': ID, 'state': enum('queued', 'restricting', 'cleaning', 'completed', 'completed_with_exceptions', 'failed'), 'exceptions': arr(TEXT)})
    add('SupportGrantCreate', {'reason': TEXT, 'project_ids': arr(ID), 'expires_at': TIME})
    add('SupportGrant', {'id': ID, 'expires_at': TIME, 'state': enum('active', 'revoked', 'expired')})
    add('Health', {'status': enum('healthy', 'degraded', 'unavailable'), 'checked_at': TIME, 'queued_tasks': INT, 'unknown_operations': INT})
    add('Ack', {'ok': {'const': True}})

def extend_schemas():
    """Complete authoring and continuation contracts without exposing runtime internals."""
    S['Agent']['properties'].update({'instructions': TEXT, 'brand_version_id': ID})
    S['Agent']['required'].append('instructions')
    S['BrandCreate']['properties']['brand_id'] = ID
    S['BrandVersion']['properties']['configuration'] = ref('BrandCreate')
    S['BrandVersion']['required'].append('configuration')
    S['Connection']['properties']['version'] = INT
    S['Connection']['required'].append('version')
    S['Artifact']['required'].append('version')
    S['VideoInput']['allOf'] = [{'if': {'properties': {'mode': {'const': 'template'}}}, 'then': {'required': ['template_version_id']}}]
    S['AnalysisSpec']['properties'].update({'account_ids': arr(TEXT), 'attribution_definition': TEXT, 'comparison': obj({'date_from': {'type': 'string', 'format': 'date'}, 'date_to': {'type': 'string', 'format': 'date'}})})
    S['SeoInput']['properties'].update({'allowed_path_prefixes': arr({'type':'string','pattern':'^/'}), 'concurrency': {'type':'integer','minimum':1,'maximum':10}, 'cache_policy': enum('reuse_valid', 'refresh')})
    add('MemoryUpdate', {'expected_version': INT, 'content': TEXT})
    add('ConversationCreate', {'project_id': ID, 'agent_id': ID, 'title': TEXT}, ['project_id', 'agent_id'])
    add('Conversation', {'id': ID, 'project_id': ID, 'agent_id': ID, 'title': TEXT, 'version': INT, 'created_at': TIME})
    add('MessageCreate', {'text': TEXT, 'asset_version_ids': arr(ID), 'task_id': ID, 'expected_task_version': INT, 'client_message_id': ID}, ['text', 'asset_version_ids', 'client_message_id'])
    add('Message', {'id': ID, 'conversation_id': ID, 'role': enum('user', 'assistant', 'system'), 'text': TEXT, 'asset_version_ids': arr(ID), 'task_id': ID, 'created_at': TIME}, ['id', 'conversation_id', 'role', 'text', 'asset_version_ids', 'created_at'])
    S['TaskCreate']['properties'].update({'conversation_id': ID, 'source_artifact_id': ID, 'source_cell_ids': arr(TEXT)})
    add('TaskStep', {'key': TEXT, 'state': enum('pending', 'running', 'waiting', 'completed', 'failed', 'skipped', 'cancelled', 'unknown'), 'attempt_id': ID, 'artifact_ids': arr(ID), 'error_code': TEXT}, ['key', 'state', 'attempt_id', 'artifact_ids'])
    S['Task']['properties'].update({'input': {'type': 'object'}, 'steps': arr(ref('TaskStep')), 'conversation_id': ID, 'pending_input_fields': arr(TEXT)})
    add('TaskInput', {'expected_version': INT, 'answers': {'type': 'object', 'minProperties': 1}, 'asset_version_ids': arr(ID)}, ['expected_version', 'answers'])
    add('ArtifactEdit', {'base_asset_version_id': ID, 'expected_version': INT, 'editing_asset_version_id': ID, 'budget': ref('Money')})
    S['Artifact']['properties'].update({'version': INT, 'editing_asset_version_id': ID, 'parent_artifact_id': ID})
    add('CommentCreate', {'text': TEXT, 'artifact_id': ID, 'anchor': TEXT}, ['text'])
    add('Comment', {'id': ID, 'task_id': ID, 'text': TEXT, 'artifact_id': ID, 'created_at': TIME}, ['id', 'task_id', 'text', 'created_at'])
    add('CreativeMappingCreate', {'project_id': ID, 'artifact_id': ID, 'connection_id': ID, 'account_id': TEXT, 'campaign_id': TEXT, 'creative_id': TEXT, 'match_type': enum('user_confirmed', 'platform_verified')})
    add('CreativeMapping', {'id': ID, 'project_id': ID, 'artifact_id': ID, 'creative_id': TEXT, 'state': enum('confirmed', 'removed'), 'version': INT})
    add('Effect', {'id': TEXT, 'version': TEXT, 'state': enum('unverified', 'verified', 'disabled'), 'input_kinds': arr(TEXT), 'parameter_schema': {'type': 'object'}, 'example_asset_version_id': ID}, ['id', 'version', 'state', 'input_kinds', 'parameter_schema'])
    S['MediaCreate']['properties'].update({'capability_version': TEXT, 'parameters': {'type': 'object', 'description': 'Validated against the selected versioned capability parameter schema; never forwarded as arbitrary tool execution.'}})
    S['Capability']['properties'].update({'parameter_schema': {'type': 'object'}, 'limits': {'type': 'object'}, 'verified_at': TIME})
    add('WorkflowBinding', {'source': enum('input', 'step_output', 'constant'), 'source_key': TEXT, 'pointer': {'type': 'string', 'pattern': '^(|/.*)$'}, 'value': {}}, ['source'])
    S['WorkflowBinding']['allOf'] = [
        {'if': {'properties': {'source': {'const': 'constant'}}}, 'then': {'required': ['value']}},
        {'if': {'properties': {'source': {'enum': ['input', 'step_output']}}}, 'then': {'required': ['source_key', 'pointer']}}]
    add('RetryPolicy', {'max_attempts': {'type': 'integer', 'minimum': 1, 'maximum': 5}, 'backoff_seconds': {'type': 'integer', 'minimum': 1, 'maximum': 3600}})
    S['WorkflowStep']['properties'].update({'bindings': {'type': 'object', 'additionalProperties': ref('WorkflowBinding')}, 'output_schema': {'type': 'object'}, 'on_failure': enum('stop', 'continue', 'retry'), 'retry_policy': ref('RetryPolicy'), 'repeat_limit': {'type': 'integer', 'minimum': 1, 'maximum': 10}})
    S['WorkflowStep']['required'] += ['bindings', 'output_schema', 'on_failure']
    S['WorkflowCreate']['properties'].update({'workflow_id': ID, 'input_schema': {'type': 'object'}, 'output_schema': {'type': 'object'}, 'output_bindings': {'type': 'object', 'additionalProperties': ref('WorkflowBinding')}, 'timeout_seconds': {'type': 'integer', 'minimum': 1, 'maximum': 86400}})
    S['WorkflowCreate']['required'] += ['input_schema', 'output_schema', 'output_bindings', 'timeout_seconds']
    add('WorkflowVersion', {'id':ID, 'workflow_id':ID, 'project_id':ID, 'version_no':{'type':'integer','minimum':1}, 'definition':ref('WorkflowCreate'), 'created_at':TIME})
    S['WorkflowRun']['properties'].update({'workflow_version_id': ID, 'inputs': {'type': 'object'}})
    S['WorkflowRun']['required'] += ['workflow_version_id', 'inputs']
    add('TriggerCreate', {'project_id': ID, 'workflow_version_id': ID, 'kind': enum('schedule', 'event'), 'timezone': TEXT, 'expression': TEXT, 'connection_id': ID, 'event_type': TEXT, 'catch_up': enum('latest_only', 'skip'), 'enabled': BOOL}, ['project_id', 'workflow_version_id', 'kind', 'enabled'])
    S['TriggerCreate']['allOf'] = [
        {'if': {'properties': {'kind': {'const': 'schedule'}}}, 'then': {'required': ['timezone', 'expression', 'catch_up']}},
        {'if': {'properties': {'kind': {'const': 'event'}}}, 'then': {'required': ['connection_id', 'event_type']}}]
    add('DeviceRefresh', {'refresh_token': TEXT, 'device_id': ID, 'key_proof': TEXT})
    add('SupportGrantRevoke', {'reason': TEXT})

PATHS = {}

def endpoint(path, method, operation, request, response, reqs, stage='M1', permission='project.read', status=None, tenant=True, auth=True, device=False, query=None):
    parameters = [{'name': part[1:-1], 'in': 'path', 'required': True, 'schema': ID} for part in path.split('/') if part.startswith('{')]
    if tenant:
        parameters.append({'$ref': '#/components/parameters/TenantHeader'})
    if method in ['post', 'patch', 'delete']:
        parameters.append({'$ref': '#/components/parameters/IdempotencyKey'})
        if auth and not device:
            parameters.append({'$ref': '#/components/parameters/CsrfHeader'})
    for name, schema, required in query or []:
        parameters.append({'name': name, 'in': 'query', 'required': required, 'schema': schema})
    if method == 'get' and operation.startswith('list'):
        existing = {p.get('name') for p in parameters}
        for name, schema in [('cursor', TEXT), ('limit', {'type': 'integer', 'minimum': 1, 'maximum': 100})]:
            if name not in existing:
                parameters.append({'name': name, 'in': 'query', 'required': False, 'schema': schema})
        if tenant and '{tenant_id}' not in path:
            parameters.append({'name': 'project_id', 'in': 'query', 'required': False, 'schema': ID})
    code = str(status or (201 if method == 'post' else 200))
    responses = {code: {'description': 'Accepted persistently; query resource for completion.' if code == '202' else 'Successful result.', 'content': {'application/json': {'schema': ref(response)}}}, '400': {'$ref': '#/components/responses/ErrorResponse'}, '401': {'$ref': '#/components/responses/ErrorResponse'}, '403': {'$ref': '#/components/responses/ErrorResponse'}, '404': {'$ref': '#/components/responses/ErrorResponse'}, '409': {'$ref': '#/components/responses/ErrorResponse'}, '422': {'$ref': '#/components/responses/ErrorResponse'}, '429': {'$ref': '#/components/responses/ErrorResponse'}, '503': {'$ref': '#/components/responses/ErrorResponse'}}
    data = {'operationId': operation, 'summary': operation, 'tags': [permission.split('.')[0]], 'x-requirements': [f'REQ-{n:03d}' for n in reqs], 'x-stage': stage, 'x-permission': permission, 'parameters': parameters, 'responses': responses}
    if not auth:
        data['security'] = []
    elif device:
        data['security'] = [{'DeviceBearer': []}]
    if request:
        data['requestBody'] = {'required': True, 'content': {'application/json': {'schema': ref(request)}}}
    PATHS.setdefault(path, {})[method] = data
    return data

def list_schema(name):
    key = name + 'List'
    S[key] = obj({'items': arr(ref(name)), 'next_cursor': {'type': ['string', 'null']} })
    return key

def define_endpoints():
    e = endpoint
    e('/v1/auth/challenges', 'post', 'createAuthChallenge', 'AuthChallengeCreate', 'AuthChallenge', [3], tenant=False, auth=False, status=202)
    e('/v1/auth/sessions', 'post', 'createSession', 'SessionCreate', 'UserSession', [3], tenant=False, auth=False)
    e('/v1/auth/session', 'delete', 'logout', None, 'Ack', [3], tenant=False)
    a = e('/v1/auth/authorize', 'get', 'authorizeNativeClient', None, 'Ack', [3,38,39], stage='M3', tenant=False, query=[('client_id',TEXT,True),('redirect_uri',{'type':'string','format':'uri'},True),('code_challenge',TEXT,True),('code_challenge_method',{'const':'S256'},True),('state',TEXT,True)])
    a['responses']['302'] = {'description': 'Redirect only to a registered client URI with a one-time authorization code and original state.', 'headers': {'Location': {'required': True, 'schema': {'type': 'string', 'format': 'uri'}}}}
    del a['responses']['200']
    e('/v1/auth/token', 'post', 'exchangeNativeToken', 'TokenExchange', 'Tokens', [3,38,39], stage='M3', tenant=False, auth=False)
    e('/v1/me', 'get', 'getMe', None, 'User', [3], tenant=False)
    e('/v1/tenants', 'get', 'listTenants', None, list_schema('Tenant'), [1,35], tenant=False)
    e('/v1/tenants', 'post', 'createTenant', 'TenantCreate', 'Tenant', [1], tenant=False, permission='tenant.create')
    e('/v1/tenants/{tenant_id}/projects', 'get', 'listProjects', None, list_schema('Project'), [1,2,35])
    e('/v1/tenants/{tenant_id}/projects', 'post', 'createProject', 'ProjectCreate', 'Project', [2], permission='project.manage')
    e('/v1/tenants/{tenant_id}/members', 'get', 'listMembers', None, list_schema('Member'), [1,2], permission='tenant.members')
    e('/v1/tenants/{tenant_id}/invites', 'post', 'createInvite', 'InviteCreate', 'Invite', [2,3], permission='tenant.members')
    e('/v1/invites/accept', 'post', 'acceptInvite', 'InviteAccept', 'Member', [3], tenant=False)
    e('/v1/members/{member_id}', 'delete', 'removeMember', None, 'Ack', [2,3], permission='tenant.members')
    e('/v1/agents', 'get', 'listAgents', None, list_schema('Agent'), [5,35])
    e('/v1/agents', 'post', 'createAgent', 'AgentCreate', 'Agent', [5,7], permission='agent.manage')
    e('/v1/agents/{agent_id}', 'patch', 'updateAgent', 'AgentUpdate', 'Agent', [5,45], permission='agent.manage')
    e('/v1/agents/{agent_id}', 'get', 'getAgent', None, 'Agent', [5,7])
    e('/v1/memories', 'get', 'listMemories', None, list_schema('Memory'), [6])
    e('/v1/memories', 'post', 'createMemory', 'MemoryCreate', 'Memory', [6], permission='memory.write')
    e('/v1/memories/{memory_id}', 'delete', 'deleteMemory', None, 'Ack', [6,49], permission='memory.write')
    e('/v1/memories/{memory_id}', 'patch', 'updateMemory', 'MemoryUpdate', 'Memory', [6], permission='memory.write')
    e('/v1/conversations', 'post', 'createConversation', 'ConversationCreate', 'Conversation', [5,7,35,41], permission='task.create')
    e('/v1/conversations', 'get', 'listConversations', None, list_schema('Conversation'), [5,7,35,41])
    e('/v1/conversations/{conversation_id}/messages', 'get', 'listMessages', None, list_schema('Message'), [7,11,41])
    e('/v1/conversations/{conversation_id}/messages', 'post', 'createMessage', 'MessageCreate', 'Message', [7,36,41], permission='task.create')
    e('/v1/tasks', 'get', 'listTasks', None, list_schema('Task'), [8,35,41], query=[('cursor',TEXT,False),('limit',{'type':'integer','minimum':1,'maximum':100},False)])
    e('/v1/tasks', 'post', 'createTask', 'TaskCreate', 'TaskAccepted', [7,8,15,16,17,18,29,30,32,37,40,43,44,57,58,59], permission='task.create', status=202)
    e('/v1/tasks/{task_id}', 'get', 'getTask', None, 'Task', [8,9,11,41,55])
    e('/v1/tasks/{task_id}/inputs', 'post', 'provideTaskInput', 'TaskInput', 'Task', [7,8,9], permission='task.control', status=202)
    e('/v1/tasks/{task_id}/controls', 'post', 'controlTask', 'TaskControl', 'Task', [9,34,41], permission='task.control', status=202)
    events = e('/v1/tasks/{task_id}/events', 'get', 'streamTaskEvents', None, 'Task', [8,11,41])
    events['parameters'].append({'name':'Last-Event-ID','in':'header','schema':{'type':'string','pattern':'^[0-9]+$'}})
    events['responses']['200'] = {'description':'SSE: persistent id=seq, event=type, data=TaskEvent JSON; comments are transient heartbeats.', 'content': {'text/event-stream': {'schema': {'type':'string'}}}}
    events['responses']['410'] = {'$ref':'#/components/responses/ErrorResponse'}
    e('/v1/tasks/{task_id}/reviews', 'post', 'reviewArtifacts', 'ReviewCreate', 'Review', [12,22,56], permission='artifact.review')
    e('/v1/tasks/{task_id}/comments', 'post', 'createComment', 'CommentCreate', 'Comment', [12,22], permission='artifact.review')
    e('/v1/tasks/{task_id}/comments', 'get', 'listComments', None, list_schema('Comment'), [12,22])
    e('/v1/tasks/{task_id}/approvals', 'get', 'listApprovals', None, list_schema('Approval'), [10])
    e('/v1/approvals/{approval_id}/decision', 'post', 'decideApproval', 'ApprovalDecision', 'Approval', [10,34], permission='action.approve')
    e('/v1/uploads', 'post', 'createUpload', 'UploadCreate', 'UploadSession', [14,37], permission='asset.write')
    e('/v1/uploads/{upload_id}/complete', 'post', 'completeUpload', 'UploadComplete', 'Asset', [14], permission='asset.write')
    e('/v1/assets', 'get', 'listAssets', None, list_schema('Asset'), [12,13,35])
    e('/v1/assets/{asset_id}', 'delete', 'deleteAsset', None, 'Deletion', [49], permission='asset.delete', status=202)
    e('/v1/assets/{asset_id}/download', 'post', 'createAssetDownload', None, 'Download', [12,14,50], permission='asset.read')
    e('/v1/asset-versions/{asset_version_id}', 'get', 'getAssetVersion', None, 'Asset', [12,14])
    e('/v1/asset-versions/{asset_version_id}/download', 'post', 'createVersionDownload', None, 'Download', [12,14,22,50], permission='asset.read')
    e('/v1/artifacts/{artifact_id}', 'get', 'getArtifact', None, 'Artifact', [12,22])
    e('/v1/artifacts/{artifact_id}/edits', 'post', 'editArtifact', 'ArtifactEdit', 'TaskAccepted', [12,16,17,22], permission='asset.write', status=202)
    e('/v1/brand-versions', 'post', 'createBrandVersion', 'BrandCreate', 'BrandVersion', [13,16,17,51], permission='brand.manage')
    e('/v1/brand-versions', 'get', 'listBrandVersions', None, list_schema('BrandVersion'), [13])
    e('/v1/tasks/{task_id}/exports', 'post', 'createExport', 'ExportCreate', 'ExportJob', [12,22,51], permission='artifact.export', status=202)
    e('/v1/exports/{export_id}', 'get', 'getExport', None, 'ExportJob', [22])
    e('/v1/media-jobs', 'post', 'createMediaJob', 'MediaCreate', 'MediaJob', [15,18,19,20,21,43,46,58], permission='media.create', status=202)
    e('/v1/media-jobs/{media_job_id}', 'get', 'getMediaJob', None, 'MediaJob', [19,20,21])
    e('/v1/media-jobs/{media_job_id}/cancel', 'post', 'cancelMediaJob', None, 'MediaJob', [9,19,46], permission='media.control', status=202)
    e('/v1/effects', 'get', 'listEffects', None, list_schema('Effect'), [20], stage='M4')
    e('/v1/dataset-imports', 'post', 'createDatasetImport', 'ImportCreate', 'Snapshot', [23,24], permission='analysis.create', status=202)
    e('/v1/snapshots/{snapshot_id}', 'get', 'getSnapshot', None, 'Snapshot', [23,24,27,28])
    e('/v1/reports', 'post', 'createReport', 'ReportCreate', 'Report', [24,25,26,27,28,31], permission='analysis.create', status=202)
    e('/v1/reports/{report_id}', 'get', 'getReport', None, 'Report', [24,31])
    e('/v1/evidence/{evidence_id}', 'get', 'getEvidence', None, 'Evidence', [24,29,30])
    e('/v1/creative-mappings', 'post', 'createCreativeMapping', 'CreativeMappingCreate', 'CreativeMapping', [31], stage='M4', permission='analysis.create')
    e('/v1/creative-mappings', 'get', 'listCreativeMappings', None, list_schema('CreativeMapping'), [31], stage='M4')
    e('/v1/geo-experiments', 'post', 'createGeoExperiment', 'GeoExperimentCreate', 'GeoExperiment', [30], stage='M4', permission='analysis.create')
    e('/v1/connections', 'get', 'listConnections', None, list_schema('Connection'), [4,25,26,27,28], stage='M2')
    e('/v1/connections', 'post', 'createConnection', 'ConnectionCreate', 'Connection', [4,25,26,27,28], stage='M2', permission='connection.manage')
    callback = e('/v1/connections/callback', 'get', 'completeConnectionAuth', None, 'Connection', [4,25,26,27,28], stage='M2', tenant=False, auth=False, query=[('state',TEXT,True),('code',TEXT,True)])
    callback['description'] = 'One-time state binds authenticated initiator, tenant, provider and registered redirect URI; never infer authorization from query tenant.'
    e('/v1/connections/{connection_id}', 'patch', 'updateConnectionResources', 'ConnectionUpdate', 'Connection', [4], stage='M2', permission='connection.manage')
    e('/v1/connections/{connection_id}', 'delete', 'revokeConnection', None, 'Ack', [4,50], stage='M2', permission='connection.manage')
    e('/v1/connections/{connection_id}/syncs', 'post', 'createSync', 'SyncCreate', 'Sync', [25,26,27,28], stage='M2', permission='connection.sync', status=202)
    e('/v1/syncs/{sync_id}', 'get', 'getSync', None, 'Sync', [25,26,27,28], stage='M2')
    e('/v1/workflows', 'get', 'listWorkflows', None, list_schema('Workflow'), [32], stage='M4')
    e('/v1/workflows', 'post', 'createWorkflowVersion', 'WorkflowCreate', 'Workflow', [32], stage='M4', permission='workflow.manage')
    e('/v1/workflow-versions/{workflow_version_id}', 'get', 'getWorkflowVersion', None, 'WorkflowVersion', [32], stage='M4')
    e('/v1/workflows/{workflow_id}/runs', 'post', 'runWorkflow', 'WorkflowRun', 'TaskAccepted', [32,34], stage='M4', permission='task.create', status=202)
    e('/v1/triggers', 'get', 'listTriggers', None, list_schema('Trigger'), [33], stage='M4')
    e('/v1/triggers', 'post', 'createTrigger', 'TriggerCreate', 'Trigger', [33], stage='M4', permission='workflow.manage')
    e('/v1/triggers/{trigger_id}', 'patch', 'updateTrigger', 'TriggerUpdate', 'Trigger', [33], stage='M4', permission='workflow.manage')
    e('/v1/devices', 'get', 'listDevices', None, list_schema('Device'), [38,39,41], stage='M3')
    e('/v1/device-pairings', 'post', 'createPairing', 'PairingCreate', 'Pairing', [38,39], stage='M3', permission='device.manage')
    e('/v1/device-pairings/{pairing_id}/complete', 'post', 'completePairing', 'PairingComplete', 'DeviceCredentials', [38,39], stage='M3', tenant=False, auth=False)
    e('/v1/device-tokens/refresh', 'post', 'refreshDeviceToken', 'DeviceRefresh', 'DeviceCredentials', [38,39,50], stage='M3', tenant=False, auth=False)
    e('/v1/devices/{device_id}', 'delete', 'revokeDevice', None, 'Ack', [38,39,40,41], stage='M3', permission='device.manage')
    e('/v1/devices/{device_id}/grants', 'post', 'createDeviceGrant', 'GrantCreate', 'Grant', [37,38,40,50], stage='M3', permission='device.manage')
    e('/v1/device-grants/{grant_id}', 'delete', 'revokeDeviceGrant', None, 'Ack', [37,40], stage='M3', permission='device.manage')
    channel = e('/v1/devices/{device_id}/channel', 'get', 'openDeviceChannel', None, 'Ack', [38,40,41,42,57], stage='M3', tenant=False, device=True)
    channel['responses'] = {'101': {'description':'Authenticated WebSocket upgrade. Signed command envelope and command results follow device protocol.'}, '401': {'$ref':'#/components/responses/ErrorResponse'}, '403': {'$ref':'#/components/responses/ErrorResponse'}}
    channel['x-protocol'] = 'WebSocket control; durable command ledger survives connection loss.'
    e('/v1/devices/{device_id}/commands/{command_id}/result', 'post', 'submitCommandResult', 'CommandResult', 'Ack', [38,40,41,42], stage='M3', tenant=False, device=True)
    e('/v1/capabilities', 'get', 'listCapabilities', None, list_schema('Capability'), [43,44,45,58])
    e('/v1/usage', 'get', 'getUsage', None, 'UsageSummary', [46,47])
    e('/v1/budget', 'get', 'getBudget', None, 'Budget', [46])
    e('/v1/budget', 'patch', 'updateBudget', 'BudgetUpdate', 'Budget', [46], permission='billing.manage')
    e('/v1/plans', 'get', 'listPlans', None, list_schema('Plan'), [47], stage='M4')
    e('/v1/subscription', 'patch', 'updateSubscription', 'SubscriptionUpdate', 'Subscription', [47], stage='M4', permission='billing.manage')
    e('/v1/invoices', 'get', 'listInvoices', None, list_schema('Invoice'), [47], stage='M4', permission='billing.read')
    e('/v1/deletions', 'post', 'createDeletion', 'DeletionCreate', 'Deletion', [6,49], permission='data.delete', status=202)
    e('/v1/deletions/{deletion_id}', 'get', 'getDeletion', None, 'Deletion', [49])
    e('/v1/support-grants', 'post', 'createSupportGrant', 'SupportGrantCreate', 'SupportGrant', [48,50], permission='tenant.manage')
    e('/v1/support-grants/{support_grant_id}/revoke', 'post', 'revokeSupportGrant', 'SupportGrantRevoke', 'SupportGrant', [48,50], permission='tenant.manage')
    e('/v1/admin/health', 'get', 'getAdminHealth', None, 'Health', [48,52,53,54,56,60], permission='support.metadata')

def extend_web_workbench():
    """Proposed Web 1.1 resources; none of these endpoints are implemented."""
    mode = enum('execute', 'plan', 'ask')
    target = {'oneOf': [
        {'required': ['agent_id'], 'not': {'required': ['agent_group_id']}},
        {'required': ['agent_group_id'], 'not': {'required': ['agent_id']}}]}
    add('ConversationUpdate', {'expected_version': INT, 'title': TEXT, 'pinned': BOOL, 'archived': BOOL, 'mode': mode}, ['expected_version'])
    for name in ['ConversationCreate', 'Conversation', 'TaskCreate', 'Task']:
        S[name]['properties'].update({'agent_group_id': ID, 'workspace_id': ID, 'mode': mode})
        S[name]['required'] = [x for x in S[name]['required'] if x != 'agent_id']
        S[name].update(target)
    S['Conversation']['properties'].update({'pinned': BOOL, 'archived': BOOL, 'last_activity_at': TIME})
    S['MessageCreate']['properties'].update({'intent': enum('discussion', 'delegate', 'supplement'), 'budget': ref('Money'), 'recipient_agent_id': ID})
    S['MessageCreate']['allOf'] = [
        {'if': {'properties': {'intent': {'const': 'delegate'}}, 'required': ['intent']}, 'then': {'required': ['budget']}},
        {'if': {'properties': {'intent': {'const': 'supplement'}}, 'required': ['intent']}, 'then': {'required': ['task_id', 'expected_task_version']}}]
    S['Task']['properties'].update({'parent_task_id': ID, 'group_run_id': ID, 'initial_mode': mode, 'confirmed_plan_id': ID, 'project_config_version_id': ID})
    S['TaskCreate']['properties'].update({'confirmed_plan_id': ID, 'project_config_version_id': ID})
    S['MemoryCreate']['properties']['scope'] = enum('enterprise', 'project', 'brand', 'personal', 'conversation', 'agent')
    S['DeletionCreate']['properties']['target_type'] = enum('project', 'asset', 'memory', 'tenant', 'conversation', 'workspace_node', 'agent')
    add('AgentTemplate', {'id': ID, 'version': INT, 'name': TEXT, 'role_description': TEXT, 'examples': arr(TEXT), 'skill_version_ids': arr(ID), 'required_connectors': arr(TEXT), 'state': enum('draft', 'published', 'disabled')})
    add('AgentTemplateUse', {'project_id': ID, 'name': TEXT}, ['project_id'])
    for name in ['AgentCreate', 'AgentUpdate', 'Agent']:
        S[name]['properties'].update({'template_version_id': ID, 'skill_installation_ids': arr(ID), 'role_description': TEXT})
    add('SkillVersionCreate', {'project_id': ID, 'name': TEXT, 'instructions': TEXT, 'package_asset_version_id': ID, 'input_schema': {'type': 'object'}, 'output_schema': {'type': 'object'}, 'tool_ids': arr(TEXT), 'required_connectors': arr(TEXT)}, ['project_id', 'name', 'instructions', 'input_schema', 'output_schema', 'tool_ids', 'required_connectors'])
    add('SkillVersion', {'id': ID, 'name': TEXT, 'version': INT, 'source': TEXT, 'content_hash': HASH, 'tool_ids': arr(TEXT), 'required_connectors': arr(TEXT), 'state': enum('draft', 'verified', 'disabled')})
    S['SkillVersion']['properties'].update({'skill_key': TEXT, 'package_version': TEXT, 'name_en': TEXT})
    add('SkillVerification', {'expected_version': INT, 'validation_task_ids': arr(ID, 1)})
    add('SkillInstall', {'project_id': ID, 'skill_version_id': ID, 'enabled': BOOL})
    add('SkillInstallation', {'id': ID, 'project_id': ID, 'skill_version_id': ID, 'enabled': BOOL, 'version': INT, 'state': enum('installed', 'uninstalled', 'revoked')})
    add('SkillInstallationUpdate', {'expected_version': INT, 'enabled': BOOL, 'security_revoke': BOOL}, ['expected_version'])
    add('EffectiveCapabilities', {'agent_id': ID, 'project_id': ID, 'skill_version_ids': arr(ID), 'tool_ids': arr(TEXT), 'missing_dependencies': arr(TEXT), 'policy_version': INT})
    add('CloudWorkspace', {'id': ID, 'project_id': ID, 'conversation_id': ID, 'kind': enum('project', 'conversation'), 'version': INT}, ['id', 'project_id', 'kind', 'version'])
    add('WorkspaceNodeCreate', {'parent_id': ID, 'name': TEXT, 'kind': enum('directory', 'file'), 'asset_version_id': ID}, ['name', 'kind'])
    S['WorkspaceNodeCreate']['properties']['name'] = {**TEXT,'maxLength':180}
    S['WorkspaceNodeCreate']['allOf'] = [{'if': {'properties': {'kind': {'const': 'file'}}}, 'then': {'required': ['asset_version_id']}, 'else': {'not': {'required': ['asset_version_id']}}}]
    add('WorkspaceNode', {'id': ID, 'workspace_id': ID, 'project_id': ID, 'parent_id': ID, 'name': TEXT, 'kind': enum('directory', 'file'), 'asset_version_id': ID, 'version': INT, 'updated_at': TIME}, ['id', 'workspace_id', 'project_id', 'name', 'kind', 'version', 'updated_at'])
    S['WorkspaceNode']['properties'].update({'root_kind':enum('attachments','working_files','project_materials','deliverables'), 'reference_state':enum('ready','unavailable','deleted')})
    add('WorkspaceNodeUpdate', {'expected_version': INT, 'name': TEXT, 'parent_id': ID, 'asset_version_id': ID}, ['expected_version'])
    S['WorkspaceNodeUpdate']['properties']['parent_id'] = {'type':['string','null'],'format':'uuid'}
    add('CloudFilePreviewImage', {'content_type':enum('image/png','image/jpeg','image/webp','image/gif'),'base64':TEXT})
    add('WorkspaceNodeReference', {'node':ref('WorkspaceNode'),'asset_id':ID,'asset_version_id':ID,'source_version':INT,'content_type':TEXT,'size_bytes':INT,'sha256':HASH,'text':{'type':'string'},'preview_image':ref('CloudFilePreviewImage')}, ['node','asset_id','asset_version_id','source_version','content_type','size_bytes','sha256'])
    add('ArtifactPromotion', {'workspace_id': ID, 'parent_id': ID, 'base_asset_version_id': ID, 'sharing_scope': enum('project')}, ['workspace_id', 'base_asset_version_id', 'sharing_scope'])
    add('ArtifactSelection', {'kind': enum('text', 'image_region', 'video_range', 'evidence'), 'anchor': TEXT, 'base_asset_version_id': ID})
    S['MessageCreate']['properties']['artifact_selections'] = arr(ref('ArtifactSelection'))
    add('ProjectConfigCreate', {'expected_project_version': INT, 'instructions': TEXT, 'asset_version_ids': arr(ID), 'agent_ids': arr(ID), 'skill_installation_ids': arr(ID), 'connection_ids': arr(ID)})
    add('ProjectConfigVersion', {'id': ID, 'project_id': ID, 'version': INT, 'definition': ref('ProjectConfigCreate'), 'published_at': TIME})
    add('GroupMember', {'agent_id': ID, 'role_description': TEXT})
    add('AgentGroupCreate', {'project_id': ID, 'name': TEXT, 'coordinator_agent_id': ID, 'members': arr(ref('GroupMember')), 'workspace_id': ID}, ['project_id', 'name', 'coordinator_agent_id', 'members'])
    add('AgentGroup', {'id': ID, 'project_id': ID, 'name': TEXT, 'coordinator_agent_id': ID, 'members': arr(ref('GroupMember')), 'workspace_id': ID, 'version': INT, 'state': enum('active', 'archived')})
    add('AgentGroupUpdate', {'expected_version': INT, 'name': TEXT, 'coordinator_agent_id': ID, 'members': arr(ref('GroupMember')), 'state': enum('active', 'archived')}, ['expected_version'])
    add('ExecutionPlanCreate', {'expected_task_version': INT, 'input_hash': HASH, 'summary': TEXT, 'steps': arr(TEXT, 1), 'deliverables': arr(TEXT, 1), 'estimated_cost': ref('Money')})
    add('ExecutionPlanVersion', {'id': ID, 'task_id': ID, 'version': INT, 'input_hash': HASH, 'summary': TEXT, 'steps': arr(TEXT, 1), 'deliverables': arr(TEXT, 1), 'estimated_cost': ref('Money'), 'state': enum('proposed', 'approved', 'superseded', 'rejected')})
    add('ExecutionPlanDecision', {'expected_task_version': INT, 'plan_version': INT, 'input_hash': HASH, 'decision': enum('execute', 'revise', 'reject')})
    add('DependencyRequest', {'id': ID, 'task_id': ID, 'step_key': TEXT, 'kind': enum('file', 'connection', 'capability', 'device'), 'description': TEXT, 'required_scope': TEXT, 'state': enum('pending', 'resolved', 'dismissed'), 'version': INT})
    add('DependencyResolution', {'expected_version': INT, 'resource_ids': arr(ID, 1)})
    S['DependencyResolution']['properties']['expected_version'] = {'type':'integer','minimum':1}
    S['DependencyResolution']['properties']['resource_ids'].update({'maxItems':20,'uniqueItems':True})
    add('PreExecutionInput', {'kind':enum('file','connection'),'description':{'type':'string','minLength':1,'maxLength':2000},'provider':enum('google_ads','ga4','search_console','meta'),'resource_ids':{'type':'array','items':ID,'minItems':1,'maxItems':20,'uniqueItems':True}}, ['kind','description'])
    S['PreExecutionInput']['allOf'] = [{'if':{'properties':{'kind':{'const':'connection'}}},'then':{'required':['provider'],'properties':{'resource_ids':{'maxItems':1}}},'else':{'not':{'required':['provider']}}}]
    S['TaskCreate']['properties']['dependencies'] = {'type':'array','items':ref('PreExecutionInput'),'maxItems':8,'description':'Explicit prerequisites before the first model turn; file/connection only. Does not resume paid model steps.'}
    add('DependencyFileResource', {'id':ID,'asset_id':ID,'name':TEXT,'version':{'type':'integer','minimum':1},'content_type':TEXT})
    add('DependencyConnectionResource', {'id':ID,'name':TEXT,'provider':enum('google_ads','ga4','search_console','meta')})
    S['DependencyResource'] = {'oneOf':[ref('DependencyFileResource'),ref('DependencyConnectionResource')]}
    add('SolutionCreate', {'project_id': ID, 'name': TEXT, 'instructions': TEXT, 'agent_template_ids': arr(ID), 'skill_version_ids': arr(ID), 'required_assets': arr(TEXT), 'required_connectors': arr(TEXT)})
    add('SolutionVersion', {'id': ID, 'project_id': ID, 'version': INT, 'definition': ref('SolutionCreate'), 'state': enum('draft', 'published', 'disabled')})
    add('SolutionPublish', {'expected_version': INT, 'validation_task_id': ID})
    add('SolutionInstall', {'project_id': ID, 'name': TEXT}, ['project_id'])
    add('SolutionInstallation', {'id': ID, 'project_id': ID, 'solution_version_id': ID, 'missing_requirements': arr(TEXT), 'state': enum('needs_configuration', 'ready')})
    add('RoutineDraftCreate', {'project_id': ID, 'agent_id': ID, 'agent_group_id': ID, 'conversation_id': ID, 'instruction': TEXT, 'source_task_id': ID, 'asset_version_ids': arr(ID), 'connection_ids': arr(ID), 'output_workspace_id': ID, 'timezone': TEXT, 'expression': TEXT, 'budget': ref('Money')}, ['project_id', 'instruction', 'timezone', 'expression', 'budget'])
    S['RoutineDraftCreate'].update(target)
    add('RoutineDraft', {'id': ID, 'version': INT, 'configuration': ref('RoutineDraftCreate'), 'state': enum('draft', 'activated', 'discarded')})
    add('RoutineDraftUpdate', {'expected_version': INT, 'configuration': ref('RoutineDraftCreate')})
    for name in ['WorkflowCreate', 'WorkflowRun']:
        S[name]['properties'].update({'agent_group_id': ID, 'agent_id': ID})
    S['WorkflowRun']['required'] = [x for x in S['WorkflowRun']['required'] if x != 'agent_id']
    S['WorkflowRun'].update(target)
    add('RoutineActivation', {'expected_version': INT})
    add('Routine', {'id': ID, 'project_id': ID, 'workflow_version_id': ID, 'trigger_id': ID, 'conversation_id': ID, 'state': enum('active', 'paused')}, ['id', 'project_id', 'workflow_version_id', 'trigger_id', 'state'])
    add('Notification', {'id': ID, 'project_id': ID, 'conversation_id': ID, 'task_id': ID, 'kind': enum('running', 'needs_input', 'waiting_approval', 'succeeded', 'partially_succeeded', 'failed', 'cancelled', 'reconciling'), 'read': BOOL, 'created_at': TIME}, ['id','project_id','task_id','kind','read','created_at'])
    add('NotificationUpdate', {'read': BOOL})
    S['Notification']['properties']['task_title'] = TEXT
    e = endpoint
    e('/v1/conversations/{conversation_id}', 'get', 'getConversation', None, 'Conversation', [61,72])
    e('/v1/conversations/{conversation_id}', 'patch', 'updateConversation', 'ConversationUpdate', 'Conversation', [61,67], permission='task.create')
    e('/v1/conversations/{conversation_id}', 'delete', 'deleteConversation', None, 'Deletion', [49,61], permission='task.control', status=202)
    PATHS['/v1/conversations']['get']['parameters'] += [{'name': 'q', 'in': 'query', 'schema': TEXT}, {'name': 'archived', 'in': 'query', 'schema': BOOL}]
    e('/v1/agent-templates', 'get', 'listAgentTemplates', None, list_schema('AgentTemplate'), [62])
    e('/v1/agent-templates/{template_id}/instances', 'post', 'instantiateAgentTemplate', 'AgentTemplateUse', 'Agent', [62,72], permission='agent.manage')
    e('/v1/agents/{agent_id}', 'delete', 'deleteAgent', None, 'Deletion', [49,62], permission='agent.manage', status=202)
    e('/v1/skill-versions', 'get', 'listSkillVersions', None, list_schema('SkillVersion'), [64])
    e('/v1/skill-versions', 'post', 'createSkillVersion', 'SkillVersionCreate', 'SkillVersion', [64,70], permission='skill.manage')
    e('/v1/skill-versions/{skill_version_id}/verifications', 'post', 'verifySkillVersion', 'SkillVerification', 'SkillVersion', [64,70], permission='project.manage')
    e('/v1/skill-installations', 'get', 'listSkillInstallations', None, list_schema('SkillInstallation'), [64])
    e('/v1/skill-installations', 'post', 'installSkill', 'SkillInstall', 'SkillInstallation', [64], permission='skill.manage')
    e('/v1/skill-installations/{installation_id}', 'patch', 'updateSkillInstallation', 'SkillInstallationUpdate', 'SkillInstallation', [64], permission='skill.manage')
    e('/v1/skill-installations/{installation_id}', 'delete', 'uninstallSkill', None, 'Ack', [64], permission='skill.manage')
    e('/v1/agents/{agent_id}/effective-capabilities', 'get', 'getEffectiveCapabilities', None, 'EffectiveCapabilities', [64,69])
    e('/v1/workspaces', 'get', 'listCloudWorkspaces', None, list_schema('CloudWorkspace'), [63], query=[('conversation_id',ID,False)])
    e('/v1/workspaces/{workspace_id}/nodes', 'get', 'listWorkspaceNodes', None, list_schema('WorkspaceNode'), [63], query=[('parent_id', ID, False), ('q', TEXT, False), ('kind', enum('directory','file'), False)])
    e('/v1/workspaces/{workspace_id}/nodes', 'post', 'createWorkspaceNode', 'WorkspaceNodeCreate', 'WorkspaceNode', [63], permission='asset.write')
    e('/v1/workspace-nodes/{node_id}', 'patch', 'updateWorkspaceNode', 'WorkspaceNodeUpdate', 'WorkspaceNode', [63,68], permission='asset.write')
    e('/v1/workspace-nodes/{node_id}/reference', 'get', 'readWorkspaceNodeReference', None, 'WorkspaceNodeReference', [63,68])
    e('/v1/workspace-nodes/{node_id}', 'delete', 'deleteWorkspaceNode', None, 'Deletion', [49,63], permission='asset.write', status=202)
    e('/v1/artifacts/{artifact_id}/promotions', 'post', 'promoteArtifact', 'ArtifactPromotion', 'WorkspaceNode', [63,68], permission='asset.share')
    e('/v1/projects/{project_id}/configuration-versions', 'get', 'listProjectConfigVersions', None, list_schema('ProjectConfigVersion'), [65], stage='M2')
    e('/v1/projects/{project_id}/configuration-versions', 'post', 'publishProjectConfig', 'ProjectConfigCreate', 'ProjectConfigVersion', [65], stage='M2', permission='project.manage')
    e('/v1/agent-groups', 'get', 'listAgentGroups', None, list_schema('AgentGroup'), [66], stage='M2')
    e('/v1/agent-groups', 'post', 'createAgentGroup', 'AgentGroupCreate', 'AgentGroup', [66], stage='M2', permission='agent.manage')
    e('/v1/agent-groups/{group_id}', 'get', 'getAgentGroup', None, 'AgentGroup', [66], stage='M2')
    e('/v1/agent-groups/{group_id}', 'patch', 'updateAgentGroup', 'AgentGroupUpdate', 'AgentGroup', [66], stage='M2', permission='agent.manage')
    e('/v1/tasks/{task_id}/plans', 'get', 'listExecutionPlans', None, list_schema('ExecutionPlanVersion'), [67])
    e('/v1/tasks/{task_id}/plans', 'post', 'createExecutionPlan', 'ExecutionPlanCreate', 'ExecutionPlanVersion', [67], permission='task.control')
    e('/v1/execution-plans/{plan_id}/decisions', 'post', 'decideExecutionPlan', 'ExecutionPlanDecision', 'Task', [67], permission='task.control', status=202)
    e('/v1/tasks/{task_id}/dependencies', 'get', 'listTaskDependencies', None, list_schema('DependencyRequest'), [69])
    e('/v1/task-dependencies/{dependency_id}/resources', 'get', 'listTaskDependencyResources', None, list_schema('DependencyResource'), [69], query=[('q',{'type':'string','maxLength':160},False),('cursor',ID,False),('limit',{'type':'integer','minimum':1,'maximum':100},False)])
    e('/v1/task-dependencies/{dependency_id}/resolutions', 'post', 'resolveTaskDependency', 'DependencyResolution', 'Task', [69], permission='task.control', status=202)
    e('/v1/solution-versions', 'get', 'listSolutionVersions', None, list_schema('SolutionVersion'), [70], stage='M2')
    e('/v1/solution-versions', 'post', 'createSolutionVersion', 'SolutionCreate', 'SolutionVersion', [70], stage='M2', permission='skill.manage')
    e('/v1/solution-versions/{solution_id}/publications', 'post', 'publishSolution', 'SolutionPublish', 'SolutionVersion', [70], stage='M2', permission='project.manage')
    e('/v1/solution-versions/{solution_id}/installations', 'post', 'installSolution', 'SolutionInstall', 'SolutionInstallation', [65,70], stage='M2', permission='project.manage')
    e('/v1/routine-drafts', 'post', 'createRoutineDraft', 'RoutineDraftCreate', 'RoutineDraft', [71], stage='M2', permission='workflow.manage')
    e('/v1/routine-drafts/{draft_id}', 'get', 'getRoutineDraft', None, 'RoutineDraft', [71], stage='M2')
    e('/v1/routine-drafts/{draft_id}', 'patch', 'updateRoutineDraft', 'RoutineDraftUpdate', 'RoutineDraft', [71], stage='M2', permission='workflow.manage')
    e('/v1/routine-drafts/{draft_id}/activations', 'post', 'activateRoutine', 'RoutineActivation', 'Routine', [33,71], stage='M2', permission='workflow.manage')
    e('/v1/notifications', 'get', 'listNotifications', None, list_schema('Notification'), [72])
    e('/v1/notifications/{notification_id}', 'patch', 'updateNotification', 'NotificationUpdate', 'Notification', [72], permission='project.read')
    # Shared endpoint stages are their earliest availability, not every variant's.
    additions = {'createConversation': [61,66,72], 'listConversations': [61], 'createMessage': [61,66,67,68,69,72],
                 'createTask': [61,66,67,69,72], 'getTask': [66], 'updateAgent': [62,64], 'createAgent': [62,64],
                 'listAssets': [63], 'getArtifact': [68], 'editArtifact': [68], 'createComment': [68]}
    for item in PATHS.values():
        for operation in item.values():
            for n in additions.get(operation['operationId'], []):
                req = f'REQ-{n:03d}'
                if req not in operation['x-requirements']:
                    operation['x-requirements'].append(req)
            if operation['operationId'] in ['createWorkflowVersion', 'listWorkflows', 'getWorkflowVersion', 'runWorkflow', 'createTrigger', 'listTriggers', 'updateTrigger']:
                operation['x-stage'] = 'M2'


def extend_role_presets():
    """Versioned role presets, dependencies and publication are proposed APIs."""
    add('RoleSkillBinding', {'skill_key':TEXT, 'skill_version_id':ID, 'version':TEXT,
                            'content_hash':HASH, 'required':BOOL})
    add('RoleModelBinding', {'profile_key':TEXT, 'required':BOOL, 'capability_version_id':ID},
        ['profile_key','required'])
    add('RoleDeliverable', {'name':TEXT, 'format':TEXT, 'editable_scope':TEXT})
    add('RolePresetDefinition', {'role_key':TEXT, 'category':enum('engineering','design','marketing','operations'),
        'runtime_profile_id':{**ID,'description':'Must resolve to an enabled, version-pinned Codex runtime profile. Kernel overrides and automatic kernel fallback are prohibited.'}, 'skill_bindings':arr(ref('RoleSkillBinding'),2),
        'model_bindings':arr(ref('RoleModelBinding'),1), 'tool_ids':arr(TEXT,1),
        'input_schema':{'type':'object'}, 'steps':arr(TEXT,1), 'deliverables':arr(ref('RoleDeliverable'),1),
        'acceptance_checks':arr(TEXT,3), 'ai_gateway_policy':{'const':'company_internal_only'}})
    add('RolePresetOverrides', {'name':TEXT,'role_description':TEXT,'brand_version_id':ID,
                              'locale':enum('zh-HK','en-HK'),'delivery_preferences':arr(TEXT)}, [])
    S['AgentTemplate']['properties'].update({'kind':enum('default_helper','role_preset'),
        'preset_definition':ref('RolePresetDefinition'), 'qualification_state':enum('unverified','qualified','revoked')})
    S['AgentTemplate']['required'].append('kind')
    S['AgentTemplate']['allOf'] = [{'if':{'properties':{'kind':{'const':'role_preset'}},'required':['kind']},
                                  'then':{'required':['preset_definition','qualification_state']}}]
    S['AgentTemplateUse']['properties'].update({'template_version':INT,'overrides':ref('RolePresetOverrides')})
    S['AgentTemplateUse']['required'].append('template_version')
    add('RoleTemplateDraftCreate', {'name':TEXT,'role_description':TEXT,'examples':arr(TEXT,1),
                                    'preset_definition':ref('RolePresetDefinition')})
    add('RoleTemplatePublication', {'expected_version':INT,'validation_task_ids':{**arr(ID,3),'uniqueItems':True}})
    add('RoleTemplatePreflight', {'id':ID,'template_id':ID,'template_version':INT,'project_id':ID,
        'state':enum('ready','needs_configuration','unavailable'), 'missing_required_dependencies':arr(TEXT),
        'optional_unavailable_dependencies':arr(TEXT), 'resolved_skill_version_ids':arr(ID),
        'resolved_capability_version_ids':arr(ID), 'policy_version':INT,'expires_at':TIME})
    for name in ['Agent','AgentVersion']:
        if name in S:
            S[name]['properties'].update({'role_key':TEXT,'preset_definition_hash':HASH})
    e = endpoint
    e('/v1/agent-templates','post','createRoleTemplateDraft','RoleTemplateDraftCreate','AgentTemplate',[74,78,79],permission='template.publish')
    e('/v1/agent-templates/{template_id}','get','getAgentTemplate',None,'AgentTemplate',[73,74,76,78])
    e('/v1/agent-templates/{template_id}/preflights','post','preflightRoleTemplate','AgentTemplateUse','RoleTemplatePreflight',[74,75,76,77,78],permission='agent.manage')
    e('/v1/agent-templates/{template_id}/publications','post','publishRoleTemplate','RoleTemplatePublication','AgentTemplate',[73,74,77,79,80],permission='template.publish')
    PATHS['/v1/agent-templates']['get']['parameters'] += [
        {'name':'category','in':'query','schema':enum('engineering','design','marketing','operations')},
        {'name':'q','in':'query','schema':TEXT}]
    additions = {'listAgentTemplates':[73,76,80], 'instantiateAgentTemplate':[73,74,75,76,77,78,79],
                 'updateAgent':[79], 'verifySkillVersion':[74,75,80], 'getEffectiveCapabilities':[74,75,77,78]}
    for item in PATHS.values():
        for operation in item.values():
            for n in additions.get(operation['operationId'],[]):
                req = f'REQ-{n:03d}'
                if req not in operation['x-requirements']:
                    operation['x-requirements'].append(req)


def generate_protocols():
    defs = {'id': ID, 'hash': HASH, 'time': TIME, 'status': enum(*STATES)}
    event_variants = {
        'task.state_changed': obj({'previous': {'type':['string','null'], 'enum': STATES + [None]}, 'status': {'$ref':'#/$defs/status'}, 'reason': TEXT}, ['previous','status']),
        'task.progress': obj({'step_key':TEXT, 'completed':INT, 'total':INT}, ['step_key','completed']),
        'message.appended': obj({'message_id':ID,'text':TEXT}),
        'artifact.ready': obj({'artifact_id':ID,'asset_version_id':ID}),
        'approval.requested': obj({'approval_id':ID,'action_hash':HASH,'expires_at':TIME}),
        'usage.updated': obj({'currency':enum('HKD'),'amount_micros':{'type':'string','pattern':'^[0-9]+$'},'cost_state':enum('estimated','confirmed','reconciling')}),
        'task.warning': obj({'code':TEXT,'message':TEXT})}
    event = obj({'event_id':ID,'tenant_id':ID,'task_id':ID,'attempt_id':ID,'seq':{'type':'integer','minimum':1},'type':enum(*event_variants),'occurred_at':TIME,'payload':{'type':'object'}})
    event.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://contracts.example.invalid/task-event.schema.json','$defs':defs,'allOf':[{'if':{'properties':{'type':{'const':k}},'required':['type']},'then':{'properties':{'payload':v}}} for k,v in event_variants.items()]})
    relative = {'type':'string','minLength':1,'maxLength':1024,'pattern':r'^(?!/)(?!.*(?:^|/)\.\.(?:/|$))(?!.*[\\:\x00-\x1f]).+$', 'description':'Forward-slash relative path only; runtime must also validate root identity, reparse points and file handles.'}
    args = {
        'file.read': obj({'relative_path':relative,'max_bytes':{'type':'integer','minimum':1,'maximum':104857600}}),
        'file.write': obj({'relative_path':relative,'source_asset_version_id':ID,'expected_source_hash':HASH,'overwrite':BOOL}, ['relative_path','source_asset_version_id','overwrite']),
        'directory.scan': obj({'relative_path':relative,'recursive':BOOL,'max_files':{'type':'integer','minimum':1,'maximum':10000}}),
        'program.run': obj({'executable_id':TEXT,'argv':arr({'type':'string'}),'timeout_seconds':{'type':'integer','minimum':1,'maximum':3600}}),
        'browser.open': obj({'url':{'type':'string','format':'uri','pattern':'^https://'},'context_id':ID}),
        'browser.close': obj({'tab_id':TEXT,'context_id':ID})}
    command = obj({'protocol_version':{'const':'1.0'},'command_id':ID,'operation_id':ID,'tenant_id':ID,'task_id':ID,'attempt_id':ID,'device_id':ID,'grant_id':ID,'auth_version':{'type':'integer','minimum':1},'fencing_token':{'type':'integer','minimum':1,'maximum':9007199254740991},'action':enum(*args),'args':{'type':'object'},'input_hash':HASH,'issued_at':TIME,'expires_at':TIME,'nonce':ID,'signature':obj({'algorithm':{'const':'Ed25519'},'key_id':TEXT,'value':{'type':'string','pattern':'^[A-Za-z0-9_-]{86}$'}})})
    command.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://contracts.example.invalid/device-command.schema.json','allOf':[{'if':{'properties':{'action':{'const':k}},'required':['action']},'then':{'properties':{'args':v}}} for k,v in args.items()]})
    write(OUT/'task-event.schema.json',event)
    write(OUT/'device-command.schema.json',command)
    return event, command

def generate_examples():
    task = {'project_id':uid('project'),'agent_id':uid('agent'),'type':'creative_image','input':{'prompt':'Create an approved product campaign','locales':['zh-HK','en-HK'],'sizes':[{'width':1080,'height':1350}]},'budget':{'currency':'HKD','amount_micros':'10000000'}}
    write(OUT/'examples/task-create.json',task)
    write(OUT/'examples/task-event.json',{'event_id':uid('event'),'tenant_id':uid('tenant'),'task_id':uid('task'),'attempt_id':uid('attempt'),'seq':1,'type':'task.state_changed','occurred_at':'2026-10-18T04:00:00Z','payload':{'previous':'queued','status':'running'}})
    command = {'protocol_version':'1.0','command_id':uid('command'),'operation_id':uid('operation'),'tenant_id':uid('tenant'),'task_id':uid('task'),'attempt_id':uid('attempt'),'device_id':uid('device'),'grant_id':uid('grant'),'auth_version':1,'fencing_token':1,'action':'file.read','args':{'relative_path':'input/brief.txt','max_bytes':1048576},'issued_at':'2026-10-18T04:00:00Z','expires_at':'2026-10-18T04:05:00Z','nonce':uid('nonce')}
    canonical = lambda value: json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode('utf-8')
    command['input_hash'] = hashlib.sha256(canonical({'action':command['action'],'args':command['args']})).hexdigest()
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
    from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
    # Public deterministic test seed only. Never use this key for a real device.
    key = Ed25519PrivateKey.from_private_bytes(hashlib.sha256(b'PUBLIC DOCUMENTATION TEST KEY - NEVER PRODUCTION').digest())
    b64 = lambda value: base64.urlsafe_b64encode(value).decode('ascii').rstrip('=')
    command['signature'] = {'algorithm':'Ed25519','key_id':'documentation-test-key','value':b64(key.sign(canonical(command)))}
    write(OUT/'examples/device-command.json',command)
    write(OUT/'examples/device-public-key.json',{'key_id':'documentation-test-key','algorithm':'Ed25519','public_key':b64(key.public_key().public_bytes(Encoding.Raw,PublicFormat.Raw)),'purpose':'PUBLIC documentation fixture only; not a production credential.','canonicalization_note':'Fixture uses ASCII object keys and integral numbers; full RFC 8785 conformance needs production cross-language tests.'})
    vectors = {'formula_version':'1.0','precision':8,'cases':[
        {'id':'weighted-ratios','rows':[{'currency':'HKD','impressions':1000,'clicks':100,'spend':'100','conversions':'4','conversion_value':'400'},{'currency':'HKD','impressions':9000,'clicks':90,'spend':'180','conversions':'6','conversion_value':'300'}],'expected':{'HKD':{'impressions':10000,'clicks':190,'spend':'280','conversions':'10','conversion_value':'700','ctr':'0.01900000','cpc':'1.47368421','cpm':'28.00000000','cvr':'0.05263158','cpa':'28.00000000','roas':'2.50000000'}}},
        {'id':'zero-denominators','rows':[{'currency':'HKD','impressions':0,'clicks':0,'spend':'0','conversions':'0','conversion_value':'0'}],'expected':{'HKD':{'ctr':None,'cpc':None,'cpm':None,'cvr':None,'cpa':None,'roas':None}}},
        {'id':'unknown-conversions','rows':[{'currency':'HKD','impressions':100,'clicks':10,'spend':'20','conversions':None,'conversion_value':None}],'expected':{'HKD':{'ctr':'0.10000000','cpc':'2.00000000','cpa':None,'cvr':None,'roas':None}}},
        {'id':'currency-separation','rows':[{'currency':'HKD','impressions':100,'clicks':10,'spend':'20','conversions':'2','conversion_value':'40'},{'currency':'USD','impressions':100,'clicks':20,'spend':'10','conversions':'1','conversion_value':'30'}],'expected':{'HKD':{'spend':'20','roas':'2.00000000'},'USD':{'spend':'10','roas':'3.00000000'}}}
    ]}
    write(OUT/'analytics-metric-vectors.json',vectors)

def generate_authoring_contracts():
    """Minimal portable editing formats; third-party professional formats need adapters."""
    color = {'type':'string','pattern':'^#[0-9a-fA-F]{6}$'}
    number = {'type':'number'}
    positive = {'type':'number','exclusiveMinimum':0}
    relative = {'type':'string','minLength':1,'pattern':r'^(?!/)(?!.*(?:^|/)\.\.(?:/|$))(?!.*[\\:\x00-\x1f]).+$'}
    rect = {'id':TEXT,'x':number,'y':number,'width':positive,'height':positive,'rotation_degrees':number,'z_index':{'type':'integer'},'opacity':{'type':'number','minimum':0,'maximum':1}}
    text_layer = obj({**rect,'type':{'const':'text'},'text':{'type':'string'},'font_asset_version_id':ID,'font_size':positive,'line_height':positive,'color':color,'align':enum('left','center','right')})
    image_layer = obj({**rect,'type':{'const':'image'},'asset_version_id':ID,'fit':enum('contain','cover')})
    shape_layer = obj({**rect,'type':{'const':'shape'},'shape':enum('rectangle','ellipse'),'fill':color})
    text_layer['properties'].update({'font_weight':{'type':'integer','minimum':100,'maximum':900},'letter_spacing':number,'max_lines':{'type':'integer','minimum':1},'border':obj({'width':{'type':'number','minimum':0},'color':color})})
    creative = obj({'format_version':{'const':'1.0'},'kind':{'const':'creative_layout'},'project_id':ID,'task_id':ID,'brand_version_id':ID,'locale':enum('zh-HK','en-HK'),'canvas':obj({'width':{'type':'integer','minimum':1,'maximum':16384},'height':{'type':'integer','minimum':1,'maximum':16384},'background':color}),'layers':arr({'oneOf':[text_layer,image_layer,shape_layer]},1),'renderer_version':TEXT})
    creative.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://contracts.example.invalid/creative-project.schema.json'})
    write(OUT/'creative-project.schema.json',creative)
    frames = {'type':'integer','minimum':0}
    clip = obj({'id':TEXT,'track_id':TEXT,'kind':enum('image','video','audio','text'),'start_frame':frames,'duration_frames':{'type':'integer','minimum':1},'source_in_frame':frames,'asset_version_id':ID,'text':{'type':'string'},'font_asset_version_id':ID,'effect_ids':arr(TEXT)},['id','track_id','kind','start_frame','duration_frames','source_in_frame','effect_ids'])
    clip['allOf'] = [
        {'if':{'properties':{'kind':{'enum':['image','video','audio']}}},'then':{'required':['asset_version_id']}},
        {'if':{'properties':{'kind':{'const':'text'}}},'then':{'required':['text','font_asset_version_id']}}]
    clip['properties'].update({'gain_db':{'type':'number','minimum':-60,'maximum':12},'text_style':obj({'font_size':positive,'color':color,'align':enum('left','center','right')})})
    video = obj({'format_version':{'const':'1.0'},'kind':{'const':'video_timeline'},'project_id':ID,'task_id':ID,'brand_version_id':ID,'locale':TEXT,'width':{'type':'integer','minimum':1},'height':{'type':'integer','minimum':1},'fps_num':{'type':'integer','minimum':1},'fps_den':{'type':'integer','minimum':1},'duration_frames':{'type':'integer','minimum':1},'template_version_id':ID,'tracks':arr(obj({'id':TEXT,'kind':enum('visual','audio','caption'),'z_index':{'type':'integer'}}),1),'clips':arr(clip,1),'renderer_version':TEXT},['format_version','kind','project_id','task_id','brand_version_id','locale','width','height','fps_num','fps_den','duration_frames','tracks','clips','renderer_version'])
    video.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://contracts.example.invalid/video-project.schema.json'})
    write(OUT/'video-project.schema.json',video)
    item = obj({'relative_path':relative,'sha256':HASH,'asset_version_id':ID,'content_type':TEXT,'locale':TEXT,'role':enum('deliverable','editing_project','source','font','license'),'usage_scope':TEXT},['relative_path','sha256','asset_version_id','content_type','role','usage_scope'])
    manifest = obj({'package_version':{'const':'1.0'},'task_id':ID,'brand_version_id':ID,'created_at':TIME,'files':arr(item,1),'missing_specification_ids':arr(TEXT),'editable_scope':TEXT})
    manifest.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://contracts.example.invalid/delivery-manifest.schema.json'})
    write(OUT/'delivery-manifest.schema.json',manifest)
    layout = {'format_version':'1.0','kind':'creative_layout','project_id':uid('project'),'task_id':uid('task'),'brand_version_id':uid('brand'),'locale':'zh-HK','canvas':{'width':1080,'height':1350,'background':'#FFFFFF'},'layers':[{'id':'headline','x':80,'y':90,'width':920,'height':200,'rotation_degrees':0,'z_index':1,'opacity':1,'type':'text','text':'Brand campaign','font_asset_version_id':uid('font'),'font_size':64,'line_height':1.2,'color':'#111827','align':'left'}],'renderer_version':'fixture-1'}
    write(OUT/'examples/creative-project.json',layout)
    video_sample = {'format_version':'1.0','kind':'video_timeline','project_id':uid('project'),'task_id':uid('task'),'brand_version_id':uid('brand'),'locale':'zh-HK','width':1080,'height':1920,'fps_num':30,'fps_den':1,'duration_frames':450,'tracks':[{'id':'main','kind':'visual','z_index':0}],'clips':[{'id':'background','track_id':'main','kind':'image','start_frame':0,'duration_frames':450,'source_in_frame':0,'asset_version_id':uid('image'),'effect_ids':[]}],'renderer_version':'fixture-1'}
    write(OUT/'examples/video-project.json',video_sample)
    # Fictional manifest entries reference fictional media, not files that were rendered.
    write(OUT/'examples/delivery-manifest.json',{'package_version':'1.0','task_id':uid('task'),'brand_version_id':uid('brand'),'created_at':'2026-10-18T04:00:00Z','files':[{'relative_path':'deliverables/poster.png','sha256':'0'*64,'asset_version_id':uid('poster'),'content_type':'image/png','locale':'zh-HK','role':'deliverable','usage_scope':'Fictional documentation example'}],'missing_specification_ids':[],'editable_scope':'Product layout/timeline only; no third-party project compatibility claim.'})

def generate_device_channel():
    result = obj({'command_id':ID,'fencing_token':{'type':'integer','minimum':1},'state':enum('accepted','running','succeeded','failed','cancelled','unknown'),'artifact_ids':arr(ID),'error_code':TEXT},['command_id','fencing_token','state','artifact_ids'])
    bodies = {
        'hello':obj({'device_id':ID,'supported_versions':arr(TEXT,1),'last_server_seq':INT,'last_result_seq':INT}),
        'sync':obj({'session_id':ID,'server_seq':INT,'auth_version':{'type':'integer','minimum':1},'revoked_grant_ids':arr(ID),'cancel_command_ids':arr(ID)}),
        'sync_ack':obj({'session_id':ID,'server_seq':INT}),
        'command':obj({'server_seq':{'type':'integer','minimum':1},'command':{'$ref':'./device-command.schema.json'}}),
        'result':obj({'result_seq':{'type':'integer','minimum':1},'result':result}),
        'result_ack':obj({'result_seq':{'type':'integer','minimum':1}}),
        'ping':obj({'session_id':ID,'sent_at':TIME}),
        'pong':obj({'session_id':ID,'sent_at':TIME})}
    channel = obj({'protocol_version':{'const':'1.0'},'message_id':ID,'type':enum(*bodies),'body':{'type':'object'}})
    channel.update({'$schema':'https://json-schema.org/draft/2020-12/schema','$id':'https://contracts.example.invalid/device-channel.schema.json','allOf':[{'if':{'properties':{'type':{'const':key}}},'then':{'properties':{'body':body}}} for key,body in bodies.items()]})
    write(OUT/'device-channel.schema.json',channel)
    write(OUT/'examples/device-channel.json',{'protocol_version':'1.0','message_id':uid('hello-message'),'type':'hello','body':{'device_id':uid('device'),'supported_versions':['1.0'],'last_server_seq':0,'last_result_seq':0}})

def main():
    define_schemas()
    extend_schemas()
    define_endpoints()
    extend_web_workbench()
    extend_role_presets()
    from build_admin_contracts import extend as extend_admin, configure_security as configure_admin_security
    extend_admin(sys.modules[__name__])
    from build_role_presets import generate as generate_role_presets
    generate_role_presets()
    generate_protocols()
    generate_authoring_contracts()
    generate_device_channel()
    S['TaskEvent'] = {'$ref':'./task-event.schema.json'}
    S['DeviceCommand'] = {'$ref':'./device-command.schema.json'}
    spec = {'openapi':'3.1.0','info':{'title':'CopyPaste Enterprise Agent Product API','version':'1.4.0','description':'Proposed product contract. Fictional server, not a deployed service. AI provider protocols remain internal.'},'servers':[{'url':'https://agent.example.invalid'}],'security':[{'UserBearer':[]},{'WebSession':[]}],'paths':PATHS,'components':{'securitySchemes':{'UserBearer':{'type':'http','scheme':'bearer','description':'Product user token scoped by server-side membership.'},'DeviceBearer':{'type':'http','scheme':'bearer','description':'Device-only token; not interchangeable with user credentials.'},'WebSession':{'type':'apiKey','in':'cookie','name':'cp_session'}},'parameters':{'TenantHeader':{'name':'X-Tenant-ID','in':'header','required':True,'schema':ID,'description':'Selected tenant; server must validate membership and resource ownership.'},'IdempotencyKey':{'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','minLength':8,'maxLength':128}},'CsrfHeader':{'name':'X-CSRF-Token','in':'header','required':False,'schema':TEXT,'description':'Required for cookie-authenticated mutations; bearer clients use token/origin policy.'}},'responses':{'ErrorResponse':{'description':'Structured error; status-specific semantics are documented in API guide.','content':{'application/json':{'schema':ref('Error')}}}},'schemas':S}}
    spec['x-runtime-policy'] = {'origin_id':'CORE01','kernel':'codex','integration':'app-server',
                                'default_transport':'stdio','automatic_kernel_fallback':False}
    configure_admin_security(spec)
    write(OUT/'openapi.json',spec)
    generate_examples()
    print(f'Generated {len(PATHS)} API paths, {sum(len(v) for v in PATHS.values())} operations, {len(S)} component schemas and protocol fixtures.')

if __name__ == '__main__':
    main()
