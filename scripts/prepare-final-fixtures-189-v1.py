from pathlib import Path
import hashlib
import json

root = Path(__file__).resolve().parents[2] / 'copypaste-platform'
mapping = []

def create(old, new, change, reason):
    original = (root / old).read_bytes()
    result = change(original.decode('utf-8').replace('\r\n', '\n')).encode()
    target = root / new
    with target.open('xb') as stream:
        stream.write(result)
    mapping.append(dict(original=old, replacement=new, reason=reason,
                        original_sha256=hashlib.sha256(original).hexdigest(),
                        replacement_sha256=hashlib.sha256(result).hexdigest()))

def pause(source):
    before = 'assert.equal(accepted.status, 200, JSON.stringify(accepted.data));'
    assert source.count(before) == 1
    return source.replace(before, 'assert.equal(accepted.status, 202, JSON.stringify(accepted.data));')

create('tests/task-control-189-v2.test.ts', 'tests/task-control-189-v3.test.ts', pause,
       'A running native turn accepts pause asynchronously with HTTP 202; paused cancellation and one execution remain asserted.')

def legacy_audio(source):
    source = source.replace('desktopRuntime, seedDesktopRuntime', 'desktopRuntime, desktopRuntimeId, seedDesktopRuntime')
    source = source.replace('freezeTaskCapabilities, taskCapabilities', 'taskCapabilities')
    before = '        await freezeTaskCapabilities(tx, system.db.config, system.catalog, value);'
    assert source.count(before) == 1
    after = '''        // SQL101 snapshots predate current model-admission tables. Seed only
        // the exact historical binding, retaining SQL locks, validators and RLS.
        const runtimeId = await desktopRuntimeId(tx);
        const capabilityIds = historical.model_bindings.map((binding: any) => {
          const capability = system.catalog.capabilityVersions.get(binding.profile_key);
          assert.ok(capability, "Missing explicitly seeded SQL101 capability");
          return capability.id;
        });
        await tx.query("SELECT lock_task_capability_versions($1,$2::uuid[])", [runtimeId, capabilityIds]);
        await tx.query("INSERT INTO task_runtime_bindings(task_id,tenant_id,runtime_profile_id,capability_version_ids) VALUES($1,$2,$3,$4)",
          [value.id, value.tenant_id, runtimeId, capabilityIds]);
        const bound = await taskCapabilities(tx, system.db.config, system.catalog, value);
        assert.deepEqual(new Set(bound.versionIds), new Set(capabilityIds));'''
    return source.replace(before, after)

create('tests/audio-authorization-upgrade.test.ts', 'tests/audio-authorization-upgrade-189-v1.test.ts', legacy_audio,
       'Seed the real SQL101 binding without invoking post-SQL158 model admission. Original migration, unknown-spend, consent and byte-preservation assertions remain.')

def discovery(source):
    source = source.replace('run-current-tests-owned-v12.mjs', 'run-current-tests-owned-v13.mjs')
    source = source.replace('current-test-discovery-188-v2.test.ts', 'current-test-discovery-189-v1.test.ts')
    return source

create('tests/current-test-discovery-188-v2.test.ts', 'tests/current-test-discovery-189-v1.test.ts', discovery,
       'Validate the new explicit current-suite selection while retaining historical attempts.')

report = Path(__file__).resolve().parents[1] / '.data/acceptance-189/fixture-updates-v3.json'
with report.open('x', encoding='utf-8') as stream:
    json.dump(mapping, stream, indent=2, ensure_ascii=False)
    stream.write('\n')
print(json.dumps({'created': [row['replacement'] for row in mapping]}))
