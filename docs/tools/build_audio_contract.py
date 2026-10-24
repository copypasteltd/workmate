"""Describe additive audio routes; preserve both published original OpenAPI files."""
from hashlib import sha256
import json
from pathlib import Path
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
uuid = {'type': 'string', 'format': 'uuid'}
timestamp = {'type': 'string', 'format': 'date-time'}
integer = {'type': 'integer', 'minimum': 0}
positive = {'type': 'integer', 'minimum': 1}
money = {'type': 'string', 'pattern': '^[0-9]+$'}
digest = {'type': 'string', 'pattern': '^[a-f0-9]{64}$'}
string = {'type': 'string'}
boolean = {'type': 'boolean'}
ref = lambda name: {'$ref': '#/components/schemas/' + name}
nullable = lambda schema: {'anyOf': [schema, {'type': 'null'}]}


def obj(fields, required=None):
    return {'type': 'object', 'properties': fields, 'required': list(fields) if required is None else required,
            'additionalProperties': False}


def array(schema, maximum=None):
    return {'type': 'array', 'items': schema, **({'maxItems': maximum} if maximum is not None else {})}


def build():
    kind = {'enum': ['speech', 'transcription']}
    schemas = {
        'Cue': obj({'start_ms': integer, 'end_ms': positive, 'text': {'type': 'string', 'minLength': 1, 'maxLength': 4000}}),
        'SubtitleEdit': obj({'expected_revision': positive, 'text': {'type': 'string', 'maxLength': 200000},
                             'cues': array(ref('Cue'), 2000), 'reason': {'type': 'string', 'minLength': 3, 'maxLength': 1000}}),
        'Cancel': obj({'expected_revision': positive}),
        'Asset': obj({'kind': {'enum': ['audio', 'transcript', 'raw_response', 'srt', 'vtt']}, 'revision': integer,
                      'id': uuid, 'name': string, 'asset_version_id': uuid, 'version': positive,
                      'mime_type': string, 'bytes': money, 'sha256': digest}),
        'Transcript': obj({'schema_version': {'const': 1}, 'text': string, 'cues': array(ref('Cue'), 2000),
                           'duration_ms': positive, 'timing_source': {'enum': ['none', 'provider_segments_rounded_to_millisecond', 'customer_manual_revision']},
                           'audio_job_id': uuid, 'revision': positive, 'previous_revision': positive},
                          ['schema_version', 'text', 'cues', 'duration_ms', 'timing_source', 'audio_job_id', 'revision']),
        'Preview': obj({'content_type': string, 'base64': {'type': 'string', 'contentEncoding': 'base64'},
                        'bytes': integer, 'sha256': digest, 'ai_generated': boolean, 'document': ref('Transcript')},
                       ['content_type', 'base64', 'bytes', 'sha256', 'ai_generated']),
    }
    mode = {'enum': ['configured_services', 'simulated']}
    state = {'enum': ['prepared', 'dispatched', 'completed', 'cancelled', 'unknown']}
    delivery = {'enum': ['pending', 'available', 'blocked']}
    pricing = {'enum': ['unicode_scalar', 'input_millisecond']}
    schemas['Job'] = obj({'id': uuid, 'task_id': uuid, 'operation_id': uuid, 'kind': kind, 'state': state, 'revision': positive,
                          'subtitle_revision': integer, 'model_alias': string, 'capability_version_id': uuid, 'data_mode': mode,
                          'quoted_micros': money, 'actual_micros': nullable(money), 'pricing_unit': pricing,
                          'quoted_units': money, 'billable_units': nullable(money),
                          'usage_state': {'enum': ['confirmed_company_tariff', 'awaiting_confirmation']}, 'supplier_cost_micros': {'type': 'null'},
                          'duration_ms': nullable(positive), 'decoded_media': nullable({'type': 'object'}), 'error_code': nullable(string),
                          'delivery_state': delivery, 'cancel_requested': boolean, 'assets': array(ref('Asset')),
                          'created_at': timestamp, 'finished_at': nullable(timestamp)})
    schemas['JobList'] = obj({'items': array(ref('Job'), 100), 'next_cursor': nullable(uuid)})
    cost = obj({'quoted_micros': money, 'actual_micros': nullable(money), 'quoted_units': money,
                'billable_units': nullable(money), 'pricing_unit': pricing, 'rate_micros': money, 'supplier_cost_micros': {'type': 'null'}})
    admin_fields = {key: uuid for key in ['id', 'tenant_id', 'project_id', 'task_id', 'actor_id', 'operation_id', 'capability_version_id', 'policy_version_id']}
    admin_fields.update({'data_mode': mode, 'kind': kind, 'state': state, 'model_alias': string, 'revision': positive, 'subtitle_revision': integer,
                         'delivery_state': delivery, 'usage_known': boolean, 'cancel_requested_at': nullable(timestamp), 'error_code': nullable(string),
                         'created_at': timestamp, 'dispatched_at': nullable(timestamp), 'finished_at': nullable(timestamp), 'cost': nullable(cost)})
    schemas['AdminJob'] = obj(admin_fields)
    schemas['AdminJobList'] = obj({'items': array(ref('AdminJob'), 100), 'next_cursor': nullable(uuid)})
    schemas['AdminBody'] = obj({'id': uuid, 'specification': {'type': 'object'}, 'specification_hash': digest,
                               'source': nullable(obj({'asset_id': uuid, 'version': positive, 'sha256': digest}))})
    paths = {}
    base = '/v1/tenants/{tenant}/projects/{project}/audio-jobs'

    def operation(route, method, name, response, body=None, admin=False, query=None):
        parameters = [{'name': key, 'in': 'path', 'required': True, 'schema': uuid} for key in ['tenant', 'project', 'job'] if '{' + key + '}' in route]
        parameters += [{'name': key, 'in': 'query', 'required': False, 'schema': value} for key, value in (query or {}).items()]
        if method == 'post':
            parameters.append({'name': 'Idempotency-Key', 'in': 'header', 'required': True, 'schema': {'type': 'string', 'minLength': 16, 'maxLength': 128}})
        result = {'operationId': name, 'security': [{'adminSession' if admin else 'customerSession': []}], 'parameters': parameters,
                  'responses': {'200': {'description': 'Currently authorized immutable view or original idempotent action receipt',
                                        'content': {'application/json': {'schema': ref(response)}}}}, 'x-requirements': ['REQ-021', 'REQ-043', 'REQ-046', 'REQ-058']}
        for status, description in {'400': 'Strict input or query invalid', '401': 'Current session required', '403': 'Current scoped authority unavailable',
                                    '404': 'Original job or source-bound artifact unavailable', '409': 'Revision, idempotency, task or capability conflict',
                                    '410': 'Cursor or body erased', '422': 'Invalid real timing or transcript content'}.items():
            result['responses'][status] = {'description': description}
        if method == 'get':
            result['responses']['200']['headers'] = {'Cache-Control': {'schema': {'const': 'no-store'}, 'description': 'Private result; do not cache'}}
        if body:
            result['requestBody'] = {'required': True, 'content': {'application/json': {'schema': ref(body)}}}
        if admin:
            result['x-permission'] = 'admin.ai.requests.read'
        paths.setdefault(route, {})[method] = result
        return result

    pagination = {'task_id': uuid, 'cursor': uuid, 'limit': {**positive, 'maximum': 100, 'default': 25}}
    operation(base, 'get', 'listAudioJobs', 'JobList', query=pagination)
    operation(base + '/{job}', 'get', 'readAudioJob', 'Job')
    preview = operation(base + '/{job}/preview', 'get', 'previewAudioArtifact', 'Preview', query={
        'kind': {'enum': ['audio', 'transcript', 'raw_response', 'srt', 'vtt']}, 'revision': integer})
    next(p for p in preview['parameters'] if p['name'] == 'kind')['required'] = True
    preview['description'] = 'Rechecks original actor/task/capability and transitive source access before and after storage read. Audio/raw response use revision 0; transcript/SRT/VTT default to the current subtitle revision. Decoded WAV is AI generated. Real byte length and SHA-256 accompany content; transcript adds document.'
    operation(base + '/{job}/subtitles', 'post', 'reviseAudioSubtitles', 'Job', 'SubtitleEdit')['description'] = 'No AI request. Compare-and-swap original job revision; preserve prior immutable artifacts. Cues must be ordered, non-overlapping and within decoded duration; full text equals cue texts joined by newline when cues exist. Manual timing remains explicitly customer sourced.'
    operation(base + '/{job}/cancel', 'post', 'cancelAudioJob', 'Job', 'Cancel')['description'] = 'Predispatch cancellation with evidence is zero usage. Possibly dispatched work remains unknown and retains the original hold. Does not replay a POST, cancel unrelated native processes or invent a provider cancellation protocol.'
    operation('/v1/admin/ai/audio-jobs', 'get', 'listAdminAudioJobs', 'AdminJobList', admin=True,
              query={**pagination, 'tenant_id': uuid, 'project_id': uuid})['description'] = 'Scoped metadata only. Independent admin.ai.cost.read controls cost. No original text, rights body or raw audio. Fixed server data mode, independent explicit denies and audited reads.'
    operation('/v1/admin/ai/audio-jobs/{job}/content', 'get', 'readAdminAudioBody', 'AdminBody', admin=True)['description'] = 'Requires independent current admin.content.body.read AND admin.ai.requests.read in the original tenant/project scope, plus recent MFA. Audits sensitive access; deleted/erased input is unavailable. No permission to alter the original request or fees.'
    return {'openapi': '3.1.0', 'info': {'title': 'Workmate internal speech, transcription and subtitle versions', 'version': '1.0.0',
                                       'description': 'Additive candidate runtime contract. Job creation is exclusively an authorized frozen Codex tool, not a customer direct generation API. All AI calls use company services. Unknown company usage is null and retains holds; supplier cost remains separately unconfirmed. Cookie writes require current CSRF; native bearer uses existing PKCE. Real voice/language quality, managed audio publication and unknown POST external-evidence reconciliation are not implied.'},
            'paths': paths, 'components': {'schemas': schemas, 'securitySchemes': {
                'customerSession': {'type': 'apiKey', 'in': 'cookie', 'name': 'cp_session'},
                'nativeBearer': {'type': 'http', 'scheme': 'bearer'},
                'adminSession': {'type': 'apiKey', 'in': 'cookie', 'name': 'cp_admin_session'}}}}


if __name__ == '__main__':
    baseline = json.loads((ROOT / 'docs/quality/history/stage84-before-audio/receipt.json').read_text(encoding='utf-8'))
    for name, expected in baseline['original_openapi'].items():
        assert sha256((ROOT / name).read_bytes()).hexdigest() == expected
    contract = build()
    assert sum(len(operations) for operations in contract['paths'].values()) == 7
    for schema in contract['components']['schemas'].values():
        Draft202012Validator.check_schema(schema)
    # Bearer is an alternative only on customer operations; Admin stays cookie/MFA.
    for route, operations in contract['paths'].items():
        if not route.startswith('/v1/admin/'):
            for value in operations.values():
                value['security'].append({'nativeBearer': []})
    raw = (json.dumps(contract, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    for name in ['docs/contracts/audio-production-openapi.json', 'dev/copypaste-platform/contracts/audio-production-openapi.json']:
        (ROOT / name).write_bytes(raw)
    print(json.dumps({'status': 'seven_additive_audio_operations_generated', 'original_openapi_preserved': True, 'actual_runtime_sample_validation': 'pending'}))
