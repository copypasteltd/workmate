"""Add current managed audio contracts without rewriting historical contracts."""
from pathlib import Path
from hashlib import sha256
from copy import deepcopy
import json

ROOT = Path(__file__).resolve().parents[3]
source = ROOT / 'docs/contracts/capability-releases.openapi.json'
result = json.loads(source.read_text(encoding='utf-8'))
assert result['openapi'] == '3.1.0'
result['info'] = {**result['info'], 'title': 'Workmate managed model and audio capabilities', 'version': '1.1.0'}
result['x-historical-contract'] = {'path': 'capability-releases.openapi.json', 'sha256': sha256(source.read_bytes()).hexdigest()}
schemas = result['components']['schemas']
ref = lambda name: {'$ref': '#/components/schemas/' + name}
nullable = lambda schema: {'anyOf': [schema, {'type': 'null'}]}
integer = lambda minimum=0, maximum=9007199254740991: {'type': 'integer', 'minimum': minimum, 'maximum': maximum}
obj = lambda properties, required=None: {'type': 'object', 'properties': properties,
    'required': list(properties) if required is None else required, 'additionalProperties': False}
digest = {'type': 'string', 'pattern': '^[a-f0-9]{64}$'}
money = {'type': 'string', 'pattern': '^[0-9]+$'}
stamp = {'type': 'string', 'format': 'date-time'}
uid = {'type': 'string', 'format': 'uuid'}
boolean = {'type': 'boolean'}
locales = {'type': 'array', 'minItems': 1, 'maxItems': 3, 'uniqueItems': True,
           'items': {'enum': ['en', 'zh-HK', 'yue-HK']}}
for name, key in [('SpeechCapabilityDocument', 'internal-speech-v1'), ('TranscriptionCapabilityDocument', 'internal-transcription-v1')]:
    document = deepcopy(schemas['ImageCapabilityDocument'])
    document['properties']['profile_key'] = {'const': key}
    document['properties']['rates']['prefixItems'][0]['maximum'] = 1000000000
    document['properties']['locales'] = deepcopy(locales)
    document['required'].append('locales')
    if name.startswith('Speech'):
        document['properties']['voices'] = {'type': 'array', 'minItems': 1, 'maxItems': 8, 'uniqueItems': True,
            'items': {'type': 'string', 'pattern': '^[a-zA-Z0-9_-]{1,80}$'}}
        document['required'].append('voices')
    else:
        document['properties']['timestamps'] = boolean
        document['required'].append('timestamps')
    schemas[name] = document
    schemas['CapabilityDocument']['oneOf'].append(ref(name))
for name in ['CapabilityRelease', 'CapabilityComparison']:
    schemas[name]['properties']['profile_key']['enum'].extend(['internal-speech-v1', 'internal-transcription-v1'])
schemas['AudioVerificationPlan'] = obj({'total_cases': integer(1, 72), 'plan_hash': digest,
    'quoted_micros': money, 'quality_scope': {'const': 'protocol_only'}})
schemas['CapabilityRelease']['properties']['audio_verification_plan'] = ref('AudioVerificationPlan')
schemas['AudioVerificationDecodedMedia'] = obj({'duration_ms': integer(1, 600000),
    'codec': {'type': 'string'}, 'sample_rate': integer(8000, 192000), 'channels': integer(1, 2),
    'bytes': integer(1, 25000000), 'sha256': digest, 'fully_decoded': {'const': True}})
schemas['AudioVerificationTranscriptMedia'] = obj({'input': ref('AudioVerificationDecodedMedia'), 'utf8_json': {'const': True},
    'text_sha256': digest, 'text_characters': integer(), 'segment_count': integer(0, 2000),
    'timing_source': {'enum': ['provider_segments_rounded_to_millisecond', 'none']}, 'quality_scope': {'const': 'protocol_only'}})
schemas['AudioVerificationCase'] = obj({'id': uid, 'ordinal': integer(0, 71), 'operation_id': uid,
    'state': {'enum': ['prepared', 'dispatched', 'completed', 'cancelled', 'unknown']},
    'kind': {'enum': ['speech', 'transcription']}, 'locale': {'enum': ['en', 'zh-HK', 'yue-HK']},
    'voice': nullable({'type': 'string'}), 'speed': nullable({'type': 'number', 'minimum': .25, 'maximum': 4}),
    'mime_type': nullable({'enum': ['audio/wav', 'audio/mpeg']}), 'timestamps': nullable(boolean),
    'quoted_micros': money, 'actual_micros': nullable(money), 'usage_known': boolean, 'verified': boolean,
    'error_code': nullable({'type': 'string'}), 'response_sha256': nullable(digest), 'source_sha256': nullable(digest),
    'media': {'anyOf': [ref('AudioVerificationDecodedMedia'), ref('AudioVerificationTranscriptMedia'), {'type': 'null'}]}})
schemas['AudioVerificationSuite'] = obj({'plan_hash': digest, 'total_cases': integer(1, 72), 'verified_cases': integer(0, 72),
    'quoted_micros': money, 'known_cost_micros': money, 'quality_scope': {'const': 'protocol_only'},
    'usage_known': boolean, 'cancel_requested': boolean, 'deadline_at': stamp, 'error_code': nullable({'type': 'string'}),
    'cases': {'type': 'array', 'maxItems': 72, 'items': ref('AudioVerificationCase')}})
schemas['CapabilityValidation']['properties']['audio_suite'] = nullable(ref('AudioVerificationSuite'))
schemas['CapabilityVerificationEvidence']['properties']['quality_scope'] = {'const': 'protocol_only'}
path = '/v1/admin/capability-releases/validations/{validation}/audio-cancellations'
result['paths'][path] = deepcopy(result['paths'][path.replace('audio-cancellations', 'video-cancellations')])
result['paths'][path]['post']['operationId'] = 'cancelAudioCapabilityValidation'
result['paths'][path]['post']['summary'] = 'Stop new audio verification cases without replaying a submitted POST'
output = ROOT / 'docs/contracts/managed-audio-capabilities.openapi.json'
output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
mirror = ROOT / 'dev/copypaste-platform/contracts/managed-audio-capability-schemas.json'
mirror.write_text(json.dumps({'normative_source_sha256': sha256(output.read_bytes()).hexdigest(), 'schemas': schemas},
    ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'schemas': len(schemas), 'paths': len(result['paths']), 'historical_contract_unchanged': True}))
