"""Retain historical tests and migrate assertions to explicitly shipped contracts."""
from pathlib import Path
from hashlib import sha256
import json

DEV = Path(__file__).resolve().parents[2]
P = DEV / 'copypaste-platform'
OUT = Path(__file__).resolve().parents[1] / '.data/acceptance-189'
OUT.mkdir(exist_ok=True, parents=True)
rows = []


def save(old, new, transform, reason):
    raw = (P / 'tests' / old).read_bytes()
    text = transform(raw.decode())
    assert text != raw.decode(), old
    target = P / 'tests' / new
    with target.open('xb') as f:
        f.write(text.encode())
    rows.append({'old': old, 'new': new, 'reason': reason,
                 'historical_sha256': sha256(raw).hexdigest(),
                 'current_sha256': sha256(target.read_bytes()).hexdigest()})


def replace(text, old, new):
    assert text.count(old) == 1, (old, text.count(old))
    return text.replace(old, new)


def ordinary(text):
    return replace('import { delegatedAdminFixtureRole } from "./delegated-admin-fixture-188.js";\n' + text,
                   'let role = "super_admin";',
                   'let role = await delegatedAdminFixtureRole(s.db);')


for base in ['vip-lifecycle', 'vip-credit-combinations']:
    save(base + '.test.ts', base + '-189-v1.test.ts', ordinary,
         'Exercise ordinary delegated administrator review while the highest administrator direct path remains independently tested.')


def platform(text):
    start = text.index('test("VIP validity uses real timestamps')
    end = text.index('\ntest(', start + 1)
    block = replace(text[start:end], 'a = await admin(),',
                    'a = await admin(await delegatedAdminFixtureRole(system.db)),')
    return 'import { delegatedAdminFixtureRole } from "./delegated-admin-fixture-188.js";\n' + text[:start] + block + text[end:]


save('platform.test.ts', 'platform-189-v1.test.ts', platform,
     'Use a delegated requesting actor for the independent-review test; preserve all other highest administrator security tests.')
save('notifications.test.ts', 'notifications-189-v1.test.ts',
     lambda t: replace(t, 'n.task_title === "Private work"', 'n.task_title === f.task.title'),
     'Notifications reference the exact admitted task title; conversations can contain independent tasks with distinct titles.')


def persistent(text):
    text = replace(text, 'assert.equal(terminal.output, "");', 'assert.equal(terminal.output, null);')
    text = replace(text, '"CONVERSATION_BUSY",', '"PLAN_TASK_LIMIT",')
    return text


save('persistent-work.test.ts', 'persistent-work-189-v1.test.ts', persistent,
     'Erased outputs are SQL NULL. A new independent message is subject to the Starter task limit; same-message concurrent replay still creates exactly one task and hold.')


def migrations(text):
    text = replace(text, '      oldDecision,\n',
                   '      { ...oldDecision, execution_mode: "independent_review" },\n')
    text = replace(text, '        op,\n', '        { ...op, execution_mode: "legacy" },\n')
    return text


save('migrations.test.ts', 'migrations-189-v1.test.ts', migrations,
     'Forward schema160 adds explicit legacy/independent execution attribution; all original decision and operation facts remain equal.')


def canonical(text):
    text = replace(text, 'assert.equal(unavailable.status, 409);\n    assert.equal(unavailable.data.error.code, "CANNOT_PAUSE");',
                   'assert.equal(unavailable.status, 202, JSON.stringify(unavailable.data));\n'
                   '    assert.equal((await s.db.control.query("SELECT pause_requested FROM tasks WHERE id=$1", [a.task_id])).rows[0].pause_requested, true);')
    return replace(text, 'canonical pause cannot race a claimed turn into a second execution or release its pending budget',
                   'canonical measured-boundary pause accepts a running request without a second execution or released budget')


save('canonical-tasks.test.ts', 'canonical-tasks-189-v1.test.ts', canonical,
     'The shipped measured-boundary pause contract accepts a running request while retaining its original reservation and fencing token.')


def controls(text):
    start = text.index('test("a worker claim winning the race')
    a = text.index('    assert.equal(', text.index('"VERSION_CONFLICT",', start))
    b = text.index('\n  } finally {', a)
    text = text[:a] + '''    const accepted = await call(f.owner, "POST", url(f, t), {
      action: "pause", expected_version: running.version,
    });
    assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
    assert.equal((await row(t)).pause_requested, true);
    assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [t.id])).rows[0].status, "reserved");''' + text[b:]
    return replace(text, 'a worker claim winning the race prevents pause; completed and uncertain tasks never requeue',
                   'a running pause preserves the current measured turn; completed and uncertain tasks never requeue')


save('task-control.test.ts', 'task-control-189-v1.test.ts', controls,
     'Keep stale-version rejection and completed/uncertain resume rejection, and verify accepted running pause retains its hold.')


def demo(text):
    return replace(text, 'assert.equal(t.data.status, "succeeded", JSON.stringify(t.data));',
                   'assert.equal(t.data.status, "succeeded", JSON.stringify({task:t.data,events:(await system.db.control.query("SELECT kind,body FROM task_events WHERE task_id=$1 ORDER BY seq",[t.data.id])).rows}));')


save('demo.test.ts', 'demo-189-v1.test.ts', demo,
     'Preserve every existing real native/demo assertion and include task event diagnostics on failure; no result expectations are relaxed.')
with (OUT / 'fixture-updates-v1.json').open('x', encoding='utf8', newline='\n') as f:
    f.write(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'created_current_suites': len(rows), 'historical_files_modified': 0}))
