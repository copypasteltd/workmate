from pathlib import Path
from hashlib import sha256
import json

DEV = Path(__file__).resolve().parents[2]
P = DEV / 'copypaste-platform/tests'
rows = []


def change(text, old, new):
    assert text.count(old) == 1, (old, text.count(old))
    return text.replace(old, new)


for base, thread, turn in [('canonical-tasks', 'canonical-fixture', 'turn-1'),
                           ('task-control', 'fixture-thread', 'fixture-turn')]:
    source = P / (base + '-189-v1.test.ts')
    raw = source.read_bytes()
    text = raw.decode()
    text = change(text, '  calls = 0;\n', '  calls = 0;\n  native = false;\n')
    if base == 'task-control':
        text = change(text, 'start(_ctx: RuntimeContext)', 'start(ctx: RuntimeContext)')
    text = change(text, '    this.calls++;\n',
                  '    this.calls++;\n    if (this.native) {\n'
                  f'      await ctx.onEvent("runtime.thread", {{thread_id: "{thread}"}});\n'
                  f'      await ctx.onEvent("runtime.turn", {{thread_id: "{thread}", turn_id: "{turn}"}});\n'
                  '    }\n')
    marker = 'test("canonical measured-boundary' if base == 'canonical-tasks' else 'test("a running pause'
    start = text.index(marker)
    end = text.index('\ntest(', start + 1)
    block = change(text[start:end], '  let release!', '  runtime.native = true;\n  let release!')
    if base == 'canonical-tasks':
        block = change(block, 'assert.equal((await task(f, a.task_id)).status, "succeeded");', '''const paused = await task(f, a.task_id);
  assert.equal(paused.status, "paused");
  assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [a.task_id])).rows[0].status, "reserved");
  const cancelled = await call(f.owner, f.tenant, "POST", a.location + "/controls",
    {action: "cancel", expected_version: paused.version});
  assert.equal(cancelled.status, 202, JSON.stringify(cancelled.data));
  assert.equal((await task(f, a.task_id)).status, "cancelled");''')
    else:
        block = change(block, '  const done = await row(t);', '''  const paused = await row(t);
  assert.equal(paused.status, "paused");
  const cancelled = await call(f.owner, "POST", url(f, t), {action: "cancel", expected_version: paused.version});
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  const done = await row(t);
  assert.equal(done.status, "cancelled");''')
    text = text[:start] + block + text[end:]
    target = P / (base + '-189-v2.test.ts')
    with target.open('xb') as f:
        f.write(text.encode())
    rows.append({'old': source.name, 'new': target.name,
                 'historical_sha256': sha256(raw).hexdigest(),
                 'current_sha256': sha256(target.read_bytes()).hexdigest(),
                 'reason': 'The running-pause fixture now emits the measured native thread and turn events required by the actual checkpoint protocol; assert a paused hold, one execution, explicit cancellation and terminal control rejection.'})

with (DEV / 'copypaste-delivery/.data/acceptance-189/fixture-updates-v2.json').open('x', encoding='utf8', newline='\n') as f:
    f.write(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'measured_fixture_suites': len(rows)}))
