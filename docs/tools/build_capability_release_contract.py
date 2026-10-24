"""Build the additive capability API contract; never rewrite the normative API."""
from copy import deepcopy
from hashlib import sha256
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CANONICAL = ROOT / 'docs/contracts/openapi.json'
EXPECTED = '51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4'


def obj(properties, required=None):
    return {'type': 'object', 'properties': properties,
            'required': list(properties) if required is None else required,
            'additionalProperties': False}


def ref(name):
    return {'$ref': '#/components/schemas/' + name}


def nullable(schema):
    return {'anyOf': [schema, {'type': 'null'}]}


def main():
    original = CANONICAL.read_bytes()
    assert sha256(original).hexdigest() == EXPECTED
    normative = json.loads(original)
    uuid = {'type': 'string', 'format': 'uuid'}
    date = {'type': 'string', 'format': 'date-time'}
    digest = {'type': 'string', 'pattern': '^[a-f0-9]{64}$'}
    integer = {'type': 'integer', 'minimum': 0, 'maximum': 9007199254740991}
    positive = {'type': 'integer', 'minimum': 1, 'maximum': 2147483647}
    mode = {'type': 'string', 'enum': ['simulated', 'configured_services']}
    profile = {'type': 'string', 'enum': ['internal-text-v1', 'internal-image2-v1', 'internal-video-v1']}
    reason = {'type': 'string', 'minLength': 3, 'maxLength': 1000}
    rate = {'type': 'integer', 'minimum': 0, 'maximum': 1000000000000}
    common = {'kernel': {'const': 'codex'}, 'gateway_policy': {'const': 'company_internal_only'},
              'model_alias': {'type': 'string', 'minLength': 1, 'maxLength': 200}}
    schemas = {name: deepcopy(normative['components']['schemas'][name])
               for name in ['AdminOperation', 'Capability', 'CapabilityList', 'Error']}
    schemas['TextCapabilityDocument'] = obj({**common,
        'profile_key': {'const': 'internal-text-v1'},
        'reasoning_effort': {'type': 'string', 'enum': ['low', 'medium', 'high', 'xhigh', 'max']},
        'rates': {'type': 'array', 'prefixItems': [rate, rate], 'minItems': 2, 'maxItems': 2}})
    schemas['ImageCapabilityDocument'] = obj({**common,
        'profile_key': {'const': 'internal-image2-v1'}, 'reasoning_effort': {'type': 'null'},
        'rates': {'type': 'array', 'prefixItems': [{**rate, 'minimum': 1}], 'minItems': 1, 'maxItems': 1}})
    schemas['VideoCapabilityDocument'] = obj({**common,
        'profile_key': {'const': 'internal-video-v1'}, 'reasoning_effort': {'type': 'null'},
        'rates': {'type': 'array', 'prefixItems': [{**rate, 'minimum': 1}], 'minItems': 1, 'maxItems': 1}})
    schemas['CapabilityDocument'] = {'oneOf': [ref('TextCapabilityDocument'), ref('ImageCapabilityDocument'), ref('VideoCapabilityDocument')]}
    schemas['CapabilityDraftCommand'] = obj({'document': ref('CapabilityDocument'), 'reason': reason})
    schemas['CapabilityVersionCommand'] = obj({'expected_version': positive, 'reason': reason})
    schemas['CapabilityRelease'] = obj({
        'id': uuid, 'kind': {'const': 'model_capability'}, 'profile_key': profile,
        'data_mode': mode, 'version': positive, 'document': ref('CapabilityDocument'),
        'definition_hash': digest, 'runtime_profile_id': uuid, 'created_at': date,
        'state': {'enum': ['draft', 'validated', 'rejected', 'published', 'superseded']},
        'validation_id': nullable(uuid), 'validation_state': nullable({'enum': ['running', 'passed', 'failed', 'reconciling', 'cancelled']}),
        'validation_expires_at': nullable(date), 'validation_error_codes': {'type': 'array', 'items': {'type': 'string'}},
        'head_revision': integer, 'current_publication_id': nullable(uuid)})
    schemas['CapabilityReleaseList'] = obj({'items': {'type': 'array', 'items': ref('CapabilityRelease')},
                                          'next_cursor': {'type': ['string', 'null']}})
    evidence = {
        'definition_hash': digest, 'gateway_fingerprint': digest, 'data_mode': mode,
        'codex_version': {'type': 'string'}, 'codex_binary_sha256': digest,
        'model_alias': {'type': 'string'}, 'reasoning_effort': nullable({'type': 'string'}),
        'supported_operations': {'type': 'array', 'items': {'type': 'string'}},
        'input_tokens': integer, 'output_tokens': integer,
        'known_cost_micros': {'type': 'string', 'pattern': '^[0-9]+$'},
        'accepted': {'type': 'boolean'}, 'usage_known': {'type': 'boolean'},
        'checks': {'type': 'array', 'items': {'type': 'string'}}, 'error_code': {'type': 'string'},
        'workspace_cleanup_completed': {'type': 'boolean'}, 'workspace_cleanup_error_code': {'type': 'string'},
    }
    schemas['CapabilityVerificationEvidence'] = obj(evidence, [])
    schemas['CapabilityWorkspacePurge'] = obj({
        'validation_id': uuid, 'state': {'enum': ['queued', 'completed', 'failed']},
        'version': positive, 'attempts': {'type': 'integer', 'minimum': 0, 'maximum': 8},
        'next_attempt_at': date, 'completed_at': nullable(date), 'error_code': nullable({'type': 'string'})})
    money = {'type': 'string', 'pattern': '^[0-9]+$'}
    schemas['VideoVerificationMedia'] = obj({'container': {'const': 'mp4'}, 'video_codec': {'const': 'h264'},
        'width': positive, 'height': positive, 'duration_seconds': {'type': 'number', 'exclusiveMinimum': 0},
        'decoded_video_frames': positive, 'audio_codec': nullable({'const': 'aac'}),
        'sha256': digest, 'bytes': positive, 'fully_decoded': {'const': True}})
    schemas['VideoVerificationCase'] = obj({'id': uuid, 'ordinal': {'type': 'integer', 'minimum': 0, 'maximum': 15},
        'operation_id': uuid, 'state': {'enum': ['prepared', 'submitting', 'queued', 'in_progress', 'completed', 'failed', 'cancelled', 'unknown']},
        'size': {'enum': ['720x1280', '1280x720', '1024x1024']}, 'seconds': {'enum': [4, 8, 12, 16, 20]},
        'progress': nullable({'type': 'integer', 'minimum': 0, 'maximum': 100}), 'usage_known': {'type': 'boolean'},
        'actual_micros': nullable(money), 'verified': {'type': 'boolean'}, 'error_code': nullable({'type': 'string'}),
        'operations': {'type': 'array', 'items': {'enum': ['videos.create', 'videos.retrieve', 'videos.lookup', 'videos.cancel', 'videos.content']}},
        'media': nullable(ref('VideoVerificationMedia'))})
    schemas['VideoVerificationSuite'] = obj({'plan_hash': digest, 'total_cases': {'const': 16},
        'verified_cases': {'type': 'integer', 'minimum': 0, 'maximum': 16}, 'quoted_micros': money,
        'known_cost_micros': money, 'usage_known': {'type': 'boolean'}, 'cancel_requested': {'type': 'boolean'},
        'deadline_at': date, 'error_code': nullable({'type': 'string'}),
        'cases': {'type': 'array', 'items': ref('VideoVerificationCase'), 'maxItems': 16}})
    schemas['CapabilityValidation'] = obj({
        'id': uuid, 'release_id': uuid, 'state': {'enum': ['running', 'passed', 'failed', 'reconciling', 'cancelled']},
        'capability_version_id': nullable(uuid), 'created_at': date, 'finished_at': nullable(date),
        'expires_at': nullable(date), 'result': ref('CapabilityVerificationEvidence'),
        'workspace_cleanup': nullable(ref('CapabilityWorkspacePurge')), 'video_suite': nullable(ref('VideoVerificationSuite'))})
    schemas['CapabilityValidation']['required'].remove('video_suite')
    compared = {'release_id': uuid, 'version': positive, 'document': ref('CapabilityDocument')}
    schemas['CapabilityComparison'] = obj({
        'profile_key': profile, 'data_mode': mode, 'head_revision': integer, 'publication_id': nullable(uuid),
        'current': nullable(obj(compared)),
        'proposed': obj({**compared, 'validation_id': uuid, 'capability_version_id': uuid})})
    schemas['CapabilityPublicationPreview'] = obj({
        'preview_id': uuid, 'payload_hash': digest, 'before': ref('CapabilityComparison'), 'expires_at': date,
        'decision': {'const': 'independent_approval'}, 'creates_business_effect': {'const': False}})
    details = deepcopy(schemas['Capability'])
    details['properties'].update({'data_mode': mode, 'rates': {'type': 'array', 'items': integer},
        'publication_id': nullable(uuid), 'release_id': nullable(uuid), 'head_revision': integer})
    details['required'] += ['data_mode', 'rates', 'publication_id', 'release_id', 'head_revision']
    schemas['CapabilityDetails'] = details
    schemas['CapabilityDetailsList'] = obj({'items': {'type': 'array', 'items': ref('CapabilityDetails')},
                                          'next_cursor': {'type': ['string', 'null']}})
    while True:
        referenced = set(re.findall(r'#/components/schemas/([A-Za-z0-9_]+)', json.dumps(schemas)))
        missing = referenced - schemas.keys()
        if not missing:
            break
        for name in missing:
            schemas[name] = deepcopy(normative['components']['schemas'][name])
    paths = {}
    page = [{'name': 'cursor', 'in': 'query', 'schema': {'type': 'string', 'minLength': 1, 'maxLength': 4096}},
            {'name': 'limit', 'in': 'query', 'schema': {'type': 'integer', 'minimum': 1, 'maximum': 100, 'default': 50}}]

    def operation(path, method, name, response, permission, body=None, status='200', parameters=None, user=False, preview=False):
        parameters = deepcopy(parameters or [])
        for param in ['id', 'validation']:
            if '{' + param + '}' in path:
                parameters.append({'name': param, 'in': 'path', 'required': True, 'schema': uuid})
        if body:
            parameters += [{'$ref': '#/components/parameters/IdempotencyKey'},
                           {'$ref': '#/components/parameters/AdminCsrfHeader'}]
        if preview:
            parameters.append({'name': 'x-admin-preview-id', 'in': 'header', 'required': True, 'schema': uuid})
        value = {'operationId': name, 'summary': name, 'tags': ['capability-releases'],
                 'security': [{'UserBearer': []}, {'WebSession': []}] if user else [{'AdminSession': []}],
                 'x-requirements': ['REQ-045', 'REQ-093', 'REQ-099'], 'x-permission': permission,
                 'x-scope': 'tenant/project read' if user else 'global; any applicable explicit deny wins',
                 'x-recent-mfa': bool(body), 'parameters': parameters,
                 'responses': {status: {'description': 'Persisted result. 202 does not mean published.' if status == '202' else 'Current persisted data.',
                     'content': {'application/json': {'schema': ref(response)}}},
                     'default': {'$ref': '#/components/responses/ErrorResponse'}}}
        if body:
            value['requestBody'] = {'required': True, 'content': {'application/json': {'schema': ref(body)}}}
            value['x-idempotency'] = 'Replay the same key and body after an uncertain result; never silently repeat a model call.'
        paths.setdefault(path, {})[method] = value

    root = '/v1/admin/capability-releases'
    operation(root, 'get', 'listCapabilityReleases', 'CapabilityReleaseList', 'admin.catalog.read', parameters=page)
    operation(root + '/drafts', 'post', 'createCapabilityReleaseDraft', 'AdminOperation', 'admin.catalog.draft', 'CapabilityDraftCommand', '202')
    operation(root + '/{id}', 'get', 'getCapabilityRelease', 'CapabilityRelease', 'admin.catalog.read')
    operation(root + '/{id}/validations', 'post', 'validateCapabilityRelease', 'CapabilityValidation', 'admin.catalog.publish', 'CapabilityVersionCommand', '202')
    operation(root + '/validations/{validation}', 'get', 'getCapabilityReleaseValidation', 'CapabilityValidation', 'admin.catalog.read')
    operation(root + '/validations/{validation}/workspace-purge-retries', 'post', 'retryCapabilityWorkspacePurge', 'CapabilityWorkspacePurge', 'admin.catalog.publish', 'CapabilityVersionCommand', '202')
    for action, name in [('video-cancellations', 'cancelVideoCapabilityValidation'), ('video-rechecks', 'recheckVideoCapabilityValidation')]:
        operation(root + '/validations/{validation}/' + action, 'post', name, 'CapabilityValidation', 'admin.catalog.publish', 'CapabilityVersionCommand', '202')
    for suffix, title, permission in [('publications', 'Publication', 'admin.catalog.publish'), ('rollbacks', 'Rollback', 'admin.catalog.rollback')]:
        operation(root + '/{id}/' + suffix + '-previews', 'post', 'previewCapability' + title, 'CapabilityPublicationPreview', permission, 'CapabilityVersionCommand')
        operation(root + '/{id}/' + suffix, 'post', 'requestCapability' + title, 'AdminOperation', permission, 'CapabilityVersionCommand', '202', preview=True)
    operation('/v1/capabilities/details', 'get', 'listCapabilityDetails', 'CapabilityDetailsList', 'tenant/project membership',
              parameters=page + [{'$ref': '#/components/parameters/TenantHeader'},
                {'name': 'project_id', 'in': 'query', 'schema': uuid}], user=True)
    contract = {'openapi': '3.1.0', 'info': {'title': 'CopyPaste additive controlled capability API', 'version': '0.2.0',
        'description': 'Implementation contract for stages 53 and 81, including durable video verification. Supplements the immutable normative API; it does not amend the six generic catalog kinds or qualify production capabilities.'},
        'servers': [{'url': 'http://localhost:4310', 'description': 'Local simulated acceptance environment'}],
        'paths': paths, 'components': {'schemas': schemas,
            'securitySchemes': deepcopy(normative['components']['securitySchemes']),
            'parameters': deepcopy(normative['components']['parameters']),
            'responses': deepcopy(normative['components']['responses'])},
        'x-normative-source': {'path': './openapi.json', 'sha256': EXPECTED},
        'x-validation-policy': {'execution_lease_seconds': 240, 'publish_eligibility_seconds': 86400,
            'video_execution_grant_seconds': 7200, 'video_processor_lease_seconds': 45,
            'video_cases': 16, 'video_quoted_seconds': 184,
            'preview_seconds': 300, 'independent_approval': True, 'unknown_accepted_calls': 'reconciling; no automatic replay',
            'workspace_cleanup': 'Separate durable queue, up to 8 attempts; actual deletion required for completed state.'}}
    target = ROOT / 'docs/contracts/capability-releases.openapi.json'
    target.write_text(json.dumps(contract, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    assert CANONICAL.read_bytes() == original
    print(json.dumps({'status': 'built', 'operations': len(paths), 'schemas': len(schemas), 'normative_unchanged': True}))


if __name__ == '__main__':
    main()
