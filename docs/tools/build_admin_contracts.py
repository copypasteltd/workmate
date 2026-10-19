"""Authored Admin documentation contracts. No service, account or payment is changed."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Every role resolves to explicit registered keys. There is no wildcard grant.
PERMISSIONS = {
    'overview': ['read'],
    'users': ['read', 'contact.read', 'profile.write', 'status.write', 'sessions.revoke'],
    'tenants': ['read', 'status.write', 'members.write', 'sso.write'],
    'usage': ['read', 'internal_cost.read'],
    'billing': ['read', 'top_up', 'gift', 'debit', 'credit_limit.write', 'refund', 'reconcile'],
    'entitlements': ['read', 'grant', 'extend', 'revoke'],
    'plans': ['read', 'draft', 'publish'],
    'content': ['read', 'body.read', 'download', 'metadata.write', 'version.create', 'quarantine', 'restore', 'delete'],
    'sharing': ['revoke'],
    'execution': ['read', 'cancel', 'retry', 'pause', 'resume'],
    'catalog': ['read', 'draft', 'publish', 'rollback'],
    'connections': ['read', 'revoke'],
    'devices': ['read', 'revoke'],
    'access': ['read', 'principals.write', 'sessions.revoke', 'roles.write', 'bindings.write', 'bindings.revoke'],
    'support': ['read', 'start', 'revoke'],
    'audit': ['read'],
    'approvals': ['read', 'decide'],
    'jobs': ['read', 'create'],
    'exports': ['create', 'download', 'sensitive'],
    'policy': ['read', 'draft', 'publish'],
}
KEYS = [f'admin.{domain}.{action}' for domain, actions in PERMISSIONS.items() for action in actions]
RESOURCE_KINDS = ['tenant', 'project', 'brand', 'conversation', 'message', 'agent', 'agent_group',
                  'memory', 'file', 'artifact', 'report', 'workflow', 'routine', 'solution', 'comment', 'connection']


def generate_catalog(m):
    def domain(*names):
        return [key for key in KEYS if key.split('.')[1] in names]
    common = ['admin.overview.read', 'admin.jobs.read']
    roles = {
        'super_admin': KEYS,
        'user_operator': common + [key for key in domain('users', 'tenants') if key != 'admin.tenants.sso.write'] + ['admin.usage.read', 'admin.entitlements.read', 'admin.support.read', 'admin.exports.create', 'admin.exports.download'],
        'finance_admin': common + domain('billing', 'entitlements', 'plans', 'usage') + ['admin.users.read', 'admin.tenants.read', 'admin.approvals.read', 'admin.exports.create', 'admin.exports.download'],
        'content_admin': common + domain('content', 'sharing', 'execution', 'connections', 'devices') + ['admin.users.read', 'admin.tenants.read', 'admin.exports.create', 'admin.exports.download'],
        'catalog_manager': common + domain('catalog') + ['admin.plans.read', 'admin.plans.draft', 'admin.execution.read'],
        'support_agent': common + domain('support') + ['admin.users.read', 'admin.tenants.read', 'admin.usage.read', 'admin.execution.read', 'admin.content.read'],
        'security_admin': common + domain('access', 'policy', 'approvals', 'audit') + ['admin.users.read', 'admin.users.sessions.revoke', 'admin.tenants.read', 'admin.tenants.sso.write', 'admin.support.read', 'admin.support.revoke'],
        'auditor': common + ['admin.audit.read', 'admin.approvals.read', 'admin.billing.read', 'admin.entitlements.read', 'admin.usage.read', 'admin.access.read', 'admin.policy.read', 'admin.exports.create', 'admin.exports.download'],
    }
    sensitive = {'admin.users.contact.read', 'admin.usage.internal_cost.read', 'admin.content.body.read',
                 'admin.content.download', 'admin.exports.sensitive'}
    def scope_kinds(key):
        if key.split('.')[1] in ['access', 'policy', 'catalog', 'plans'] or key in ['admin.users.profile.write','admin.users.status.write','admin.users.sessions.revoke','admin.tenants.sso.write']:
            return ['global']
        if key.split('.')[1] in ['billing', 'entitlements'] or key == 'admin.tenants.status.write':
            return ['global', 'tenant']
        return ['global', 'tenant', 'project']
    catalog = {
        'version': '1.0', 'origin_id': 'ADMIN01', 'status': 'design_only',
        'default_effect': 'deny', 'explicit_deny_wins': True,
        'scope_kinds': ['global', 'tenant', 'project'],
        'protected_data': ['password_hash', 'session_token', 'oauth_token', 'provider_api_key', 'local_device_secret'],
        'permissions': [{'key': key, 'sensitive_field_access': key in sensitive,
                         'scope_kinds': scope_kinds(key),
                         'audit_required': True} for key in KEYS],
        'roles': [{'id': role, 'permissions': sorted(set(keys)), 'status': 'proposed',
                   'grant_requires_explicit_scope': True} for role, keys in roles.items()],
        'enforcement': {'independent_admin_session': True, 'mfa_required': True,
                        'recheck_on_worker_and_download': True, 'ordinary_authorized_action_requires_customer_approval': False,
                        'high_impact_policy_version_required': True, 'role_grant_cannot_exceed_delegation_ceiling': True},
    }
    permission = m.obj({'key': m.enum(*KEYS), 'sensitive_field_access': m.BOOL,
                        'scope_kinds': {**m.arr(m.enum('global', 'tenant', 'project'), 1), 'uniqueItems': True},
                        'audit_required': {'const': True}})
    role_schema = m.obj({'id': m.enum(*roles), 'permissions': {**m.arr(m.enum(*KEYS), 1), 'uniqueItems': True},
                         'status': {'const': 'proposed'}, 'grant_requires_explicit_scope': {'const': True}})
    schema = m.obj({'version': {'const': '1.0'}, 'origin_id': {'const': 'ADMIN01'}, 'status': {'const': 'design_only'},
                    'default_effect': {'const': 'deny'}, 'explicit_deny_wins': {'const': True},
                    'scope_kinds': {**m.arr(m.enum('global', 'tenant', 'project'), 3), 'uniqueItems': True, 'maxItems': 3},
                    'protected_data': m.arr(m.TEXT, 1), 'permissions': m.arr(permission, 1), 'roles': m.arr(role_schema, 8),
                    'enforcement': m.obj({key: {'const': value} for key, value in catalog['enforcement'].items()})})
    schema.update({'$schema': 'https://json-schema.org/draft/2020-12/schema', '$id': 'https://contracts.example.invalid/admin-permission-catalog.schema.json'})
    m.write(m.OUT/'admin-permission-catalog.json', catalog)
    m.write(m.OUT/'admin-permission-catalog.schema.json', schema)


def extend(m):
    add, obj, ref, arr, enum = m.add, m.obj, m.ref, m.arr, m.enum
    ID, TIME, TEXT, BOOL, INT = m.ID, m.TIME, m.TEXT, m.BOOL, m.INT
    version = {'type': 'integer', 'minimum': 1}
    reason = {'type': 'string', 'minLength': 3, 'maxLength': 1000}
    keys = {**arr(enum(*KEYS), 1), 'uniqueItems': True}
    nullable_money = {'oneOf': [ref('Money'), {'type': 'null'}]}
    common = {'expected_version': version, 'reason': reason}
    subject = obj({'kind': enum('user', 'tenant'), 'id': ID})
    S = m.S
    S['AdminScope'] = {'oneOf': [obj({'kind': {'const': 'global'}}),
        obj({'kind': {'const': 'tenant'}, 'tenant_ids': {**arr(ID, 1), 'uniqueItems': True}}),
        obj({'kind': {'const': 'project'}, 'tenant_id': ID, 'project_ids': {**arr(ID, 1), 'uniqueItems': True}})]}
    add('AdminSessionExchange', {'authorization_code': TEXT, 'pkce_verifier': {'type': 'string', 'minLength': 43, 'maxLength': 128}})
    add('AdminContext', {'principal_id': ID, 'role_version_ids': arr(ID), 'scopes': arr(ref('AdminScope'), 1),
        'permission_keys': keys, 'auth_version': version, 'mfa_verified_at': TIME, 'expires_at': TIME, 'csrf_admin': TEXT})
    add('AdminOperation', {'id': ID, 'action': TEXT, 'target_ids': arr(ID), 'actor_id': ID,
        'state': enum('pending_approval', 'queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled', 'reconciling'),
        'payload_hash': m.HASH, 'policy_version_id': ID, 'version': version, 'created_at': TIME,
        'result_ids': arr(ID), 'error_code': TEXT}, ['id', 'action', 'target_ids', 'actor_id', 'state', 'payload_hash', 'policy_version_id', 'version', 'created_at', 'result_ids'])
    add('AdminOverview', {'as_of': TIME, 'unique_users': INT, 'active_tenants': INT, 'running_tasks': INT,
        'confirmed_customer_charges': ref('Money'), 'reserved': ref('Money'), 'reconciling_count': INT})
    add('AdminUser', {'id': ID, 'display_name': TEXT, 'masked_contact': TEXT, 'contact': TEXT,
        'state': enum('active', 'frozen', 'closed'), 'registered_at': TIME,
        'last_login_at': {'oneOf': [TIME, {'type': 'null'}]}, 'tenant_ids': arr(ID), 'version': version,
        'confirmed_customer_charges': nullable_money, 'vip_summary': TEXT, 'auth_version': version},
        ['id', 'display_name', 'masked_contact', 'state', 'registered_at', 'last_login_at', 'tenant_ids', 'version', 'auth_version'])
    add('AdminUserDetail', {'user': ref('AdminUser'), 'memberships': arr(obj({'tenant_id': ID, 'project_ids': arr(ID), 'role': ref('Role'), 'state': enum('active', 'removed', 'suspended')})),
        'billing_account_ids': arr(ID), 'effective_entitlements': arr(TEXT)})
    add('AdminAccountStatusChange', {**common, 'state': enum('active', 'frozen', 'closed'),
        'inflight_policy': enum('stop_new', 'request_cancel')})
    add('AdminMembershipChange', {**common, 'user_id': ID, 'state': enum('active', 'removed', 'suspended'), 'role': ref('Role'), 'project_ids': arr(ID)})
    add('AdminReason', {'reason': reason})
    add('AdminVersionReason', common)
    add('AdminUserProfileChange', {**common, 'display_name': TEXT, 'labels': arr(TEXT)}, ['expected_version', 'reason'])
    S['AdminUserProfileChange']['anyOf'] = [{'required': ['display_name']}, {'required': ['labels']}]
    add('AdminPrincipalCreate', {'identity_subject': TEXT, 'reason': reason})
    add('AdminPrincipal', {'id': ID, 'identity_subject': TEXT, 'state': enum('active', 'suspended'), 'version': version, 'auth_version': version, 'mfa_enrolled': BOOL})
    add('AdminPrincipalStateChange', {**common, 'state': enum('active', 'suspended')})
    add('AdminDevice', {'id': ID, 'user_id': ID, 'tenant_id': ID, 'state': enum('online', 'offline', 'revoked'), 'client_version': TEXT, 'auth_version': version})
    add('AdminTenant', {'id': ID, 'name': TEXT, 'state': enum('active', 'suspended', 'closed'), 'version': version, 'billing_account_id': ID})
    add('AdminTenantStatusChange', {**common, 'state': enum('active', 'suspended', 'closed'), 'inflight_policy': enum('stop_new', 'request_cancel')})
    add('AdminUsageSummary', {'period_from': TIME, 'period_to': TIME, 'timezone': TEXT, 'as_of': TIME,
        'confirmed_customer_charges': ref('Money'), 'reserved': ref('Money'), 'reconciling_count': INT,
        'reconciling_estimate': nullable_money, 'internal_cost': nullable_money, 'unique_initiating_users': INT},
        ['period_from', 'period_to', 'timezone', 'as_of', 'confirmed_customer_charges', 'reserved', 'reconciling_count', 'reconciling_estimate', 'unique_initiating_users'])
    add('AdminUsageEntry', {'id': ID, 'user_id': ID, 'tenant_id': ID, 'project_id': ID, 'billing_account_id': ID,
        'task_id': ID, 'operation_id': ID, 'capability_id': TEXT, 'rate_version_id': ID,
        'customer_charge': nullable_money, 'internal_cost': nullable_money, 'state': enum('reserved', 'confirmed', 'released', 'reconciling'), 'occurred_at': TIME},
        ['id', 'user_id', 'tenant_id', 'project_id', 'billing_account_id', 'task_id', 'operation_id', 'capability_id', 'rate_version_id', 'customer_charge', 'state', 'occurred_at'])
    S['AdminUsageEntry']['properties'].update({'meter_unit': enum('input_tokens','output_tokens','images','video_seconds','audio_seconds','storage_bytes','tool_calls'),
        'quantity': {'type':'string','pattern':r'^(0|[1-9][0-9]*)(\.[0-9]+)?$'},
        'role_key': TEXT, 'skill_version_ids': arr(ID), 'source_client': enum('web','extension','desktop','routine','api')})
    S['AdminUsageEntry']['required'] += ['meter_unit','quantity','source_client']
    add('AdminBillingAccount', {'id': ID, 'subject': subject, 'version': version, 'paid_balance': ref('Money'),
        'promotional_balance': ref('Money'), 'reserved': ref('Money'), 'credit_limit': ref('Money'), 'debt': ref('Money'), 'as_of': TIME})
    add('AdminPositiveMoney', {'currency': {'const': 'HKD'}, 'amount_micros': {'type': 'string', 'pattern': '^[1-9][0-9]*$'}})
    # Distinct commands prevent a gift being represented as a received payment.
    fee_variants = {
        'top_up': {'amount': ref('AdminPositiveMoney'), 'payment_record_id': ID},
        'gift': {'amount': ref('AdminPositiveMoney'), 'expires_at': TIME},
        'debit': {'amount': ref('AdminPositiveMoney'), 'original_entry_id': ID},
        'refund': {'amount': ref('AdminPositiveMoney'), 'original_entry_id': ID, 'destination': enum('payment_method', 'paid_balance')},
        'credit_limit': {'new_limit': ref('Money')},
    }
    for action, props in fee_variants.items():
        S['AdminFee'+action.title().replace('_', '')] = obj({**common, 'action': {'const': action}, **props})
    S['AdminFeePreview'] = {'oneOf': [ref('AdminFee'+action.title().replace('_','')) for action in fee_variants]}
    add('AdminPreview', {'preview_id': ID, 'payload_hash': m.HASH, 'target_ids': arr(ID,1),
        'policy_version_id': ID, 'decision': enum('direct','recent_mfa','independent_approval','denied'),
        'missing_permission_keys': arr(enum(*KEYS)), 'impact_summary': TEXT, 'expires_at': TIME,
        'creates_business_effect': {'const': False}, 'expected_target_versions': arr(obj({'id':ID,'version':version}),1)})
    add('AdminLedgerEntry', {'id': ID, 'billing_account_id': ID, 'operation_id': ID, 'actor_id': ID, 'kind': enum('reserve', 'consume', 'release', 'top_up', 'gift', 'gift_expiry', 'debit', 'refund', 'compensation', 'credit_limit'),
        'direction': enum('credit', 'debit', 'neutral'), 'amount': ref('Money'), 'bucket': enum('paid', 'promotional', 'reserved', 'credit_limit'),
        'source_entry_id': ID, 'payment_record_id': ID, 'created_at': TIME, 'reason': TEXT},
        ['id', 'billing_account_id', 'operation_id', 'actor_id', 'kind', 'direction', 'amount', 'bucket', 'created_at', 'reason'])
    add('AdminPaymentRecord', {'id': ID, 'billing_account_id': ID, 'external_reference': TEXT, 'amount': ref('Money'),
        'state': enum('recorded', 'confirmed', 'refunding', 'refunded', 'reconciling'), 'version': version, 'received_at': TIME})
    add('AdminPaymentRecordCreate', {'billing_account_id': ID, 'external_reference': TEXT, 'amount': ref('AdminPositiveMoney'),
        'received_at': TIME, 'evidence_asset_version_id': ID, 'reason': reason})
    add('AdminPaymentConfirm', {**common, 'verified_reference': TEXT})
    allowances = obj({'feature_ids': arr(TEXT), 'allowed_role_ids': arr(TEXT), 'seat_limit': version,
        'task_concurrency': version, 'storage_bytes': INT, 'included_credit': ref('Money'),
        'credit_policy': enum('no_automatic_credit', 'separate_idempotent_grant')})
    add('AdminPlanDraft', {'plan_id': ID, 'name': TEXT, 'allowances': allowances, 'reason': reason})
    add('AdminPlanVersion', {'id': ID, 'plan_id': ID, 'version': version, 'name': TEXT, 'allowances': allowances, 'state': enum('draft', 'published', 'retired')})
    add('AdminVipGrantCreate', {'subject': subject, 'plan_version_id': ID, 'starts_at': TIME, 'ends_at': TIME,
        'overlap_policy': enum('reject', 'replace', 'extend_same_plan'), 'source': enum('manual', 'paid', 'trial', 'promotion', 'compensation', 'contract'),
        'payment_record_id': ID, 'auto_renew': {'const': False}, 'expected_subject_version': version, 'reason': reason},
        ['subject','plan_version_id','starts_at','ends_at','overlap_policy','source','auto_renew','expected_subject_version','reason'])
    S['AdminVipGrantCreate']['allOf'] = [{'if': {'properties': {'source': {'const': 'paid'}}}, 'then': {'required': ['payment_record_id']}}]
    add('AdminVipGrant', {'id': ID, 'subject': subject, 'plan_version_id': ID, 'starts_at': TIME, 'ends_at': TIME,
        'state': enum('scheduled', 'active', 'suspended', 'expired', 'revoked', 'replaced'), 'source': TEXT, 'auto_renew': {'const': False},
        'actor_id': ID, 'version': version, 'operation_id': ID})
    add('AdminVipExtend', {**common, 'ends_at': TIME})
    add('EffectiveEntitlements', {'subject': subject, 'as_of': TIME, 'entitlement_version': version,
        'auth_version': version, 'feature_ids': arr(TEXT), 'plan_version_ids': arr(ID), 'expires_at': {'oneOf': [TIME, {'type': 'null'}]},
        'restriction_codes': arr(TEXT), 'requires_resource_authorization': {'const': True}, 'requires_budget_check': {'const': True}})
    add('AdminContent', {'id': ID, 'kind': enum(*RESOURCE_KINDS), 'tenant_id': ID, 'project_id': ID,
        'owner_user_id': ID, 'title': TEXT, 'version': version, 'state': enum('active', 'archived', 'quarantined', 'deletion_pending', 'deleted'),
        'body_available': BOOL, 'updated_at': TIME}, ['id', 'kind', 'tenant_id', 'title', 'version', 'state', 'body_available', 'updated_at'])
    add('AdminContentBody', {'resource': ref('AdminContent'), 'representation': enum('text', 'structured', 'file_preview'),
        'sanitized_content': {'type': 'string'}, 'redacted_field_names': arr(TEXT), 'source_version_id': ID})
    add('AdminContentMetadata', {**common, 'title': TEXT, 'labels': arr(TEXT)}, ['expected_version', 'reason'])
    S['AdminContentMetadata']['anyOf'] = [{'required': ['title']}, {'required': ['labels']}]
    add('AdminContentVersionCreate', {**common, 'base_version_id': ID, 'uploaded_asset_version_id': ID})
    add('AdminContentControl', {**common, 'action': enum('quarantine', 'restore', 'revoke_share', 'request_delete')})
    add('AdminExecutionControl', {**common, 'action': enum('cancel', 'retry', 'pause_future', 'resume_future')})
    add('AdminExecution', {'id': ID, 'kind': enum('task', 'workflow', 'routine'), 'tenant_id': ID, 'project_id': ID,
        'state': TEXT, 'version': version, 'initiating_user_id': ID, 'billing_account_id': ID})
    add('AdminCatalogDraft', {'kind': enum('roles', 'skills', 'announcements', 'help', 'navigation', 'feature_flags'),
        'document_asset_version_id': ID, 'target_scope': ref('AdminScope'), 'target_clients': arr(enum('web', 'extension', 'desktop'), 1),
        'reason': reason})
    add('AdminRelease', {'id': ID, 'kind': TEXT, 'version': version, 'state': enum('draft', 'validated', 'published', 'superseded', 'rejected'),
        'document_asset_version_id': ID, 'validation_error_codes': arr(TEXT)})
    add('AdminPolicyDraft', {'base_policy_version_id': ID, 'kernel': {'const': 'codex'}, 'provider_profile_id': ID,
        'verified_capability_ids': arr(TEXT), 'rate_version_ids': arr(ID), 'risk_rule_document_version_id': ID, 'reason': reason})
    add('AdminRoleDraft', {'name': TEXT, 'allow_permissions': keys, 'deny_permissions': {**arr(enum(*KEYS)), 'uniqueItems': True},
        'delegation_ceiling': arr(enum(*KEYS)), 'reason': reason})
    add('AdminRoleVersion', {'id': ID, 'name': TEXT, 'version': version, 'allow_permissions': keys, 'deny_permissions': arr(enum(*KEYS))})
    add('AdminBindingCreate', {'principal_id': ID, 'role_version_id': ID, 'scope': ref('AdminScope'), 'expires_at': TIME,
        'constraints': obj({'max_single_amount': ref('Money'), 'max_daily_amount': ref('Money'), 'max_batch_items': {'type': 'integer', 'minimum': 1},
            'allowed_fields': {**arr(enum('masked_contact','contact','content_body','download','customer_charge','internal_cost','account_balance','metadata')), 'uniqueItems': True}}),
        'reason': reason})
    add('AdminBinding', {'id': ID, 'principal_id': ID, 'role_version_id': ID, 'scope': ref('AdminScope'),
        'expires_at': TIME, 'state': enum('active', 'revoked', 'expired'), 'version': version})
    add('AdminSupportCreate', {'user_id': ID, 'tenant_id': ID, 'project_ids': arr(ID), 'support_grant_id': ID,
        'mode': {'const': 'read_only'}, 'expires_at': TIME, 'reason': reason}, ['user_id', 'tenant_id', 'project_ids', 'mode', 'expires_at', 'reason'])
    add('AdminSupportSession', {'id': ID, 'actor_id': ID, 'user_id': ID, 'tenant_id': ID,
        'mode': {'const': 'read_only'}, 'state': enum('active', 'revoked', 'expired'), 'expires_at': TIME})
    add('AdminAuditEntry', {'id': ID, 'actor_id': ID, 'action': TEXT, 'target_ids': arr(ID), 'operation_id': ID,
        'result': enum('allowed', 'denied', 'succeeded', 'failed'), 'reason': TEXT, 'occurred_at': TIME,
        'policy_version_id': ID, 'before_hash': m.HASH, 'after_hash': m.HASH},
        ['id', 'actor_id', 'action', 'target_ids', 'result', 'reason', 'occurred_at', 'policy_version_id'])
    add('AdminApproval', {'id': ID, 'operation_id': ID, 'requester_id': ID, 'payload_hash': m.HASH,
        'state': enum('pending', 'approved', 'rejected', 'expired', 'revoked'), 'expires_at': TIME, 'version': version})
    add('AdminApprovalDecision', {**common, 'decision': enum('approve', 'reject'), 'payload_hash': m.HASH})
    target = obj({'id': ID, 'expected_version': version})
    add('AdminBatchCreate', {'action': enum('freeze_users', 'quarantine_content', 'revoke_vip'),
        'targets': {**arr(target, 1), 'maxItems': 100}, 'filter_snapshot_hash': m.HASH, 'reason': reason})
    add('AdminExportCreate', {'kind': enum('users', 'usage', 'ledger', 'content_metadata', 'audit'),
        'scope': ref('AdminScope'), 'columns': {**arr(enum('user_id', 'masked_contact', 'contact', 'tenant_id', 'project_id', 'occurred_at', 'customer_charge', 'internal_cost', 'state', 'title', 'action', 'actor_id', 'amount', 'entry_id'), 1), 'uniqueItems': True},
        'period_from': TIME, 'period_to': TIME, 'reason': reason})
    add('AdminJob', {'id': ID, 'kind': enum('batch', 'export'), 'state': enum('queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'),
        'snapshot_id': ID, 'completed_count': INT, 'failed_count': INT, 'result_expires_at': TIME})
    add('AdminJobResult', {'id': ID, 'target_id': ID, 'state': enum('succeeded', 'failed', 'skipped'), 'operation_id': ID, 'error_code': TEXT},
        ['id', 'target_id', 'state'])
    add('AdminDownload', {'download_path': {'type': 'string', 'pattern': '^/v1/admin/'}, 'expires_at': TIME,
        'recheck_authorization': {'const': True}, 'sha256': m.HASH})

    def endpoint(path, method, operation, request, response, reqs, permission, stage='M1', query=None, actions=None, preview=False):
        op = m.endpoint('/v1/admin'+path, method, operation, request, response, reqs, stage=stage,
                        permission=permission, tenant=False, query=query, status=202 if method != 'get' and not preview else 200)
        op['security'] = [{'AdminSession': []}]
        op['x-admin-policy'] = {'mfa_required': True, 'scope_recheck': True, 'audit_required': True}
        if actions:
            op['x-action-permissions'] = actions
        if preview:
            op['x-admin-read-only'] = True
        op['parameters'] = [p for p in op['parameters'] if p.get('$ref') != '#/components/parameters/CsrfHeader']
        if method != 'get':
            op['parameters'].append({'$ref': '#/components/parameters/AdminCsrfHeader'})
        return op

    e = endpoint
    listing = m.list_schema
    filters = [('user_id', ID, False), ('tenant_id', ID, False), ('project_id', ID, False),
               ('period_from', TIME, False), ('period_to', TIME, False)]
    cleanup_state = enum('queued', 'cleaning', 'completed', 'completed_with_exceptions', 'failed')
    cleanup_type = enum('assets', 'tasks', 'agents', 'conversations', 'memories', 'brand_profiles',
                        'analytics_datasets', 'workflows', 'workflow_runs', 'workflow_schedules',
                        'creative_projects', 'workspace_nodes')
    add('AdminCleanupFailure', {'id':ID, 'kind':enum('object','runtime'), 'attempts':INT,
        'error_code':{'oneOf':[TEXT,{'type':'null'}]}})
    add('AdminCleanupJob', {'id':ID, 'state':cleanup_state, 'exceptions':arr(TEXT),
        'tenant_id':ID, 'project_id':{'oneOf':[ID,{'type':'null'}]}, 'target_type':cleanup_type,
        'target_id':ID, 'attempts':INT, 'created_at':TIME, 'completed_at':{'oneOf':[TIME,{'type':'null'}]},
        'progress':obj({'total':INT,'completed':INT}), 'failures':arr(ref('AdminCleanupFailure'))})
    add('AdminCleanupPage', {'items':arr(ref('AdminCleanupJob')), 'page':{'type':'integer','minimum':1,'maximum':10000},
        'page_size':{'type':'integer','minimum':1,'maximum':100,'default':50}, 'total':INT})
    add('AdminCleanupRetry', {'reason':{'type':'string','minLength':3,'maxLength':2000}})
    add('AdminCleanupResult', {'id':ID, 'state':cleanup_state, 'exceptions':arr(TEXT)})
    cleanup = e('/deletions', 'get', 'listAdminCleanupJobs', None, 'AdminCleanupPage', [49,90,94,98,100], 'admin.content.read', query=[
        ('page',{'type':'integer','minimum':1,'maximum':10000,'default':1},False),
        ('page_size',{'type':'integer','minimum':1,'maximum':100,'default':50},False),
        ('tenant_id',ID,False),('project_id',ID,False),('state',cleanup_state,False),('target_type',cleanup_type,False),
        ('search',{'type':'string','maxLength':160,'description':'Literal case-insensitive substring of job ID or target ID.'},False)])
    # The implemented cleanup collection uses page/offset pagination. Other
    # proposed list contracts retain their own pending conformance work.
    cleanup['parameters'] = [p for p in cleanup['parameters'] if p.get('name') not in ['cursor','limit']]
    retry = e('/deletions/{deletion_id}/retry', 'post', 'retryAdminCleanupJob', 'AdminCleanupRetry', 'AdminCleanupResult', [49,90,94,96,100], 'admin.content.delete')
    retry['responses']['200'] = retry['responses'].pop('202')
    retry['responses']['200']['description'] = 'Retry queued durably, or original completed result; no immediate physical-cleanup claim.'
    e('/me', 'get', 'getAdminContext', None, 'AdminContext', [83,94,98], 'admin.overview.read')
    e('/overview', 'get', 'getAdminOverview', None, 'AdminOverview', [86,98], 'admin.overview.read')
    e('/users', 'get', 'listAdminUsers', None, listing('AdminUser'), [84,85,86,98], 'admin.users.read', query=filters+[('q', TEXT, False), ('state', enum('active', 'frozen', 'closed'), False), ('vip', BOOL, False)])
    e('/users/{user_id}', 'get', 'getAdminUser', None, 'AdminUserDetail', [84,86,88,94], 'admin.users.read')
    e('/users/{user_id}/profile', 'post', 'changeAdminUserProfile', 'AdminUserProfileChange', 'AdminOperation', [84,85,96], 'admin.users.profile.write')
    e('/users/{user_id}/status', 'post', 'changeAdminUserStatus', 'AdminAccountStatusChange', 'AdminOperation', [85,96,100], 'admin.users.status.write')
    e('/users/{user_id}/session-revocations', 'post', 'revokeAdminUserSessions', 'AdminReason', 'AdminOperation', [83,85,100], 'admin.users.sessions.revoke')
    e('/tenants', 'get', 'listAdminTenants', None, listing('AdminTenant'), [84,85,94], 'admin.tenants.read', query=[('q', TEXT, False)])
    e('/tenants/{tenant_id}/status', 'post', 'changeAdminTenantStatus', 'AdminTenantStatusChange', 'AdminOperation', [85,100], 'admin.tenants.status.write')
    e('/tenants/{tenant_id}/memberships', 'post', 'changeAdminMembership', 'AdminMembershipChange', 'AdminOperation', [85,94,100], 'admin.tenants.members.write')
    e('/usage/summary', 'get', 'getAdminUsageSummary', None, 'AdminUsageSummary', [86,101], 'admin.usage.read', query=filters)
    e('/usage/entries', 'get', 'listAdminUsageEntries', None, listing('AdminUsageEntry'), [86,94,101], 'admin.usage.read', query=filters+[('task_id', ID, False), ('capability_id', TEXT, False), ('billing_account_id', ID, False)])
    e('/billing/accounts', 'get', 'listAdminBillingAccounts', None, listing('AdminBillingAccount'), [84,87,101], 'admin.billing.read', query=[('subject_id', ID, False)])
    e('/billing/accounts/{account_id}', 'get', 'getAdminBillingAccount', None, 'AdminBillingAccount', [86,87,101], 'admin.billing.read')
    e('/billing/accounts/{account_id}/ledger', 'get', 'listAdminLedgerEntries', None, listing('AdminLedgerEntry'), [87,101], 'admin.billing.read')
    e('/billing/accounts/{account_id}/previews', 'post', 'previewAdminFee', 'AdminFeePreview', 'AdminPreview', [87,94,96,101], 'admin.billing.read', preview=True,
      actions={action: 'admin.billing.credit_limit.write' if action=='credit_limit' else 'admin.billing.'+action for action in fee_variants})
    for action in fee_variants:
        permission = 'admin.billing.credit_limit.write' if action == 'credit_limit' else 'admin.billing.'+action
        e('/billing/accounts/{account_id}/'+action.replace('_', '-'), 'post', 'createAdminFee'+action.title().replace('_', ''), 'AdminFee'+action.title().replace('_', ''), 'AdminOperation', [87,96,100,101], permission)
    e('/billing/payments', 'get', 'listAdminPaymentRecords', None, listing('AdminPaymentRecord'), [101], 'admin.billing.read')
    e('/billing/payments', 'post', 'createAdminPaymentRecord', 'AdminPaymentRecordCreate', 'AdminOperation', [87,101], 'admin.billing.reconcile')
    e('/billing/payments/{payment_id}/confirmations', 'post', 'confirmAdminPayment', 'AdminPaymentConfirm', 'AdminOperation', [96,101], 'admin.billing.reconcile')
    e('/entitlement-grants', 'get', 'listAdminVipGrants', None, listing('AdminVipGrant'), [88,89,102], 'admin.entitlements.read', query=[('subject_id', ID, False)])
    e('/entitlement-grants', 'post', 'createAdminVipGrant', 'AdminVipGrantCreate', 'AdminOperation', [88,89,96,100,102], 'admin.entitlements.grant')
    e('/entitlement-previews', 'post', 'previewAdminVipGrant', 'AdminVipGrantCreate', 'AdminPreview', [88,89,94,96,102], 'admin.entitlements.grant', preview=True)
    e('/entitlement-grants/{grant_id}/extensions', 'post', 'extendAdminVipGrant', 'AdminVipExtend', 'AdminOperation', [88,100,102], 'admin.entitlements.extend')
    e('/entitlement-grants/{grant_id}/revocations', 'post', 'revokeAdminVipGrant', 'AdminVersionReason', 'AdminOperation', [88,96,100,102], 'admin.entitlements.revoke')
    e('/entitlement-grants/{grant_id}/suspensions', 'post', 'suspendAdminVipGrant', 'AdminVersionReason', 'AdminOperation', [88,96,100,102], 'admin.entitlements.revoke')
    e('/entitlement-grants/{grant_id}/resumptions', 'post', 'resumeAdminVipGrant', 'AdminVersionReason', 'AdminOperation', [88,96,100,102], 'admin.entitlements.grant')
    e('/plans', 'get', 'listAdminPlanVersions', None, listing('AdminPlanVersion'), [89], 'admin.plans.read')
    e('/plans/drafts', 'post', 'createAdminPlanDraft', 'AdminPlanDraft', 'AdminOperation', [89], 'admin.plans.draft')
    e('/plans/{plan_version_id}/publications', 'post', 'publishAdminPlan', 'AdminVersionReason', 'AdminOperation', [89,93,96], 'admin.plans.publish')
    e('/content', 'get', 'listAdminContent', None, listing('AdminContent'), [90,91,94,98], 'admin.content.read', query=filters+[('kind', enum(*RESOURCE_KINDS), False), ('q', TEXT, False)])
    e('/content/{resource_id}', 'get', 'getAdminContent', None, 'AdminContent', [90,94], 'admin.content.read')
    e('/content/{resource_id}/body', 'get', 'getAdminContentBody', None, 'AdminContentBody', [90,94,96], 'admin.content.body.read', query=[('reason', reason, True)])
    e('/content/{resource_id}/download', 'get', 'getAdminContentDownload', None, 'AdminDownload', [90,91,94,96], 'admin.content.download', query=[('reason', reason, True)])
    e('/content/{resource_id}/metadata', 'post', 'changeAdminContentMetadata', 'AdminContentMetadata', 'AdminOperation', [90,96], 'admin.content.metadata.write')
    e('/content/{resource_id}/versions', 'post', 'createAdminContentVersion', 'AdminContentVersionCreate', 'AdminOperation', [90,91], 'admin.content.version.create')
    e('/content/{resource_id}/controls', 'post', 'controlAdminContent', 'AdminContentControl', 'AdminOperation', [90,91,96,100], 'admin.content.read', actions={
        'quarantine': 'admin.content.quarantine', 'restore': 'admin.content.restore', 'revoke_share': 'admin.sharing.revoke', 'request_delete': 'admin.content.delete'})
    e('/execution', 'get', 'listAdminExecutions', None, listing('AdminExecution'), [92,98], 'admin.execution.read', query=filters)
    e('/execution/{execution_id}/controls', 'post', 'controlAdminExecution', 'AdminExecutionControl', 'AdminOperation', [92,96,100], 'admin.execution.read', actions={
        'cancel': 'admin.execution.cancel', 'retry': 'admin.execution.retry', 'pause_future': 'admin.execution.pause', 'resume_future': 'admin.execution.resume'})
    e('/catalog/releases', 'get', 'listAdminCatalogReleases', None, listing('AdminRelease'), [93,99], 'admin.catalog.read', stage='M2')
    e('/catalog/releases/{release_id}', 'get', 'getAdminCatalogRelease', None, 'AdminRelease', [93,99], 'admin.catalog.read', stage='M2')
    e('/catalog/drafts', 'post', 'createAdminCatalogDraft', 'AdminCatalogDraft', 'AdminOperation', [93,99], 'admin.catalog.draft', stage='M2')
    for action, permission in [('publications', 'publish'), ('rollbacks', 'rollback')]:
        e('/catalog/releases/{release_id}/'+action, 'post', 'createAdminCatalog'+permission.title(), 'AdminVersionReason', 'AdminOperation', [93,96,99,100], 'admin.catalog.'+permission, stage='M2')
    e('/connections', 'get', 'listAdminConnections', None, listing('Connection'), [90,94], 'admin.connections.read', query=filters)
    e('/connections/{connection_id}/revocations', 'post', 'revokeAdminConnection', 'AdminReason', 'AdminOperation', [91,100], 'admin.connections.revoke')
    e('/devices', 'get', 'listAdminDevices', None, listing('AdminDevice'), [85,90,94], 'admin.devices.read', query=filters)
    e('/devices/{device_id}/revocations', 'post', 'revokeAdminDevice', 'AdminVersionReason', 'AdminOperation', [85,91,100], 'admin.devices.revoke')
    e('/access/principals', 'get', 'listAdminPrincipals', None, listing('AdminPrincipal'), [83,94], 'admin.access.read')
    e('/access/principals', 'post', 'createAdminPrincipal', 'AdminPrincipalCreate', 'AdminOperation', [83,94,96], 'admin.access.principals.write')
    e('/access/principals/{principal_id}/status', 'post', 'changeAdminPrincipalState', 'AdminPrincipalStateChange', 'AdminOperation', [83,94,96,100], 'admin.access.principals.write')
    e('/access/principals/{principal_id}/session-revocations', 'post', 'revokeAdminPrincipalSessions', 'AdminReason', 'AdminOperation', [83,94,96,100], 'admin.access.sessions.revoke')
    e('/access/roles', 'get', 'listAdminRoles', None, listing('AdminRoleVersion'), [83,94], 'admin.access.read')
    e('/access/roles', 'post', 'createAdminRoleVersion', 'AdminRoleDraft', 'AdminOperation', [94,96], 'admin.access.roles.write')
    e('/access/bindings', 'get', 'listAdminBindings', None, listing('AdminBinding'), [83,94], 'admin.access.read')
    e('/access/bindings', 'post', 'createAdminBinding', 'AdminBindingCreate', 'AdminOperation', [83,94,96], 'admin.access.bindings.write')
    e('/access/bindings/{binding_id}/revocations', 'post', 'revokeAdminBinding', 'AdminVersionReason', 'AdminOperation', [83,94,96,100], 'admin.access.bindings.revoke')
    e('/support/sessions', 'get', 'listAdminSupportSessions', None, listing('AdminSupportSession'), [95], 'admin.support.read')
    e('/support/sessions', 'post', 'createAdminSupportSession', 'AdminSupportCreate', 'AdminOperation', [94,95,96], 'admin.support.start')
    e('/support/sessions/{support_session_id}/revocations', 'post', 'revokeAdminSupportSession', 'AdminReason', 'AdminOperation', [95,100], 'admin.support.revoke')
    e('/audit', 'get', 'listAdminAuditEntries', None, listing('AdminAuditEntry'), [94,96], 'admin.audit.read', query=filters)
    e('/approvals', 'get', 'listAdminApprovals', None, listing('AdminApproval'), [96], 'admin.approvals.read')
    e('/approvals/{approval_id}/decisions', 'post', 'decideAdminApproval', 'AdminApprovalDecision', 'AdminOperation', [94,96], 'admin.approvals.decide')
    e('/operations/{operation_id}', 'get', 'getAdminOperation', None, 'AdminOperation', [87,88,91,96,100], 'admin.jobs.read')
    e('/jobs', 'get', 'listAdminJobs', None, listing('AdminJob'), [97], 'admin.jobs.read', stage='M2')
    e('/jobs/batches', 'post', 'createAdminBatch', 'AdminBatchCreate', 'AdminOperation', [94,96,97], 'admin.jobs.create', stage='M2', actions={
        'freeze_users': 'admin.users.status.write', 'quarantine_content': 'admin.content.quarantine', 'revoke_vip': 'admin.entitlements.revoke'})
    e('/jobs/batch-previews', 'post', 'previewAdminBatch', 'AdminBatchCreate', 'AdminPreview', [94,96,97], 'admin.jobs.create', stage='M2', preview=True, actions={
        'freeze_users': 'admin.users.status.write', 'quarantine_content': 'admin.content.quarantine', 'revoke_vip': 'admin.entitlements.revoke'})
    e('/jobs/{job_id}/results', 'get', 'listAdminJobResults', None, listing('AdminJobResult'), [97], 'admin.jobs.read', stage='M2')
    e('/exports', 'post', 'createAdminExport', 'AdminExportCreate', 'AdminOperation', [94,96,97], 'admin.exports.create', stage='M2')
    e('/exports/{job_id}/download', 'get', 'getAdminExportDownload', None, 'AdminDownload', [94,96,97], 'admin.exports.download', stage='M2')
    e('/policies', 'get', 'listAdminPolicyVersions', None, listing('AdminRelease'), [96,99], 'admin.policy.read')
    e('/policies/drafts', 'post', 'createAdminPolicyDraft', 'AdminPolicyDraft', 'AdminOperation', [94,96,99], 'admin.policy.draft')
    e('/policies/{policy_version_id}/publications', 'post', 'publishAdminPolicy', 'AdminVersionReason', 'AdminOperation', [96,99,100], 'admin.policy.publish')
    # Tighten the earlier health endpoint to the same Admin boundary, retaining its REQ links.
    health = m.PATHS['/v1/admin/health']['get']
    health.update(security=[{'AdminSession': []}], **{'x-permission': 'admin.execution.read',
        'x-admin-policy': {'mfa_required': True, 'scope_recheck': True, 'audit_required': True}})
    health['parameters'] = [p for p in health['parameters'] if p.get('$ref') != '#/components/parameters/TenantHeader']
    op = m.endpoint('/v1/auth/admin-sessions', 'post', 'exchangeAdminSession', 'AdminSessionExchange', 'AdminContext', [83], tenant=False, auth=False, permission='admin.identity.exchange')
    op['description'] = 'Single-use authorization code with PKCE, registered Admin principal and verified MFA; sets only the HttpOnly cp_admin_session cookie. Ordinary user authentication cannot produce an Admin session.'
    m.endpoint('/v1/effective-entitlements', 'get', 'getEffectiveEntitlements', None, 'EffectiveEntitlements', [88,89,100,102], permission='billing.read', query=[('subject_kind', enum('user','tenant'), False)])
    generate_catalog(m)
    m.write(m.OUT/'examples/admin-vip-grant.json', {'subject': {'kind': 'tenant', 'id': m.uid('tenant')},
        'plan_version_id': m.uid('plan-version'), 'starts_at': '2026-10-18T04:00:00Z', 'ends_at': '2026-11-17T04:00:00Z',
        'overlap_policy': 'reject', 'source': 'manual', 'auto_renew': False, 'expected_subject_version': 1,
        'reason': 'Fictional documentation example; no entitlement was granted.'})
    m.write(m.OUT/'examples/admin-fee-gift.json', {'action': 'gift', 'expected_version': 1,
        'amount': {'currency': 'HKD', 'amount_micros': '500000000'}, 'expires_at': '2026-11-17T04:00:00Z',
        'reason': 'Fictional HKD 500 promotional credit; no payment was received.'})


def configure_security(spec):
    spec['components']['securitySchemes']['AdminSession'] = {'type': 'apiKey', 'in': 'cookie', 'name': 'cp_admin_session',
        'description': 'Independent Admin-only audience, MFA and server-side authorization version. Never accepts cp_session or user/device bearer tokens.'}
    spec['components']['parameters']['AdminCsrfHeader'] = {'name': 'X-CSRF-Token', 'in': 'header', 'required': True,
        'schema': {'type': 'string', 'minLength': 1}, 'description': 'Admin-context csrf_admin plus strict Origin verification; normal user CSRF tokens are invalid.'}
    spec['x-admin-policy'] = {'origin_id': 'ADMIN01', 'default_effect': 'deny', 'permission_catalog': './admin-permission-catalog.json',
        'explicit_deny_wins': True, 'recheck_workers_and_downloads': True,
        'action_permissions_are_additional': True, 'status': 'design_only'}
