from pathlib import Path

tests = Path(__file__).resolve().parents[3] / 'dev/copypaste-platform/tests'
fixture = (tests / 'provider-termination-fixture-189-v2.ts').read_text(encoding='utf8')
needle = '  reviewer = await admin();\n});'
assert fixture.count(needle) == 1
fixture = fixture.replace(needle, '  reviewer = await admin();\n  await publish();\n});')
with (tests / 'provider-termination-fixture-189-v3.ts').open('x', encoding='utf8', newline='\n') as output:
    output.write(fixture)

test = (tests / 'provider-termination-189-v4.test.ts').read_text(encoding='utf8')
test = test.replace("import test,{before} from 'node:test';", "import test from 'node:test';")
test = test.replace('provider-termination-fixture-189-v2.js', 'provider-termination-fixture-189-v3.js')
needle = '// The source suite established this explicit paid counting policy in an earlier\n// test. Establish it independently here through its actual audited publication.\nbefore(async()=>{await publish();});\n'
assert test.count(needle) == 1
test = test.replace(needle, '// The owned fixture publishes its explicit paid counting policy after login.\n')
with (tests / 'provider-termination-189-v5.test.ts').open('x', encoding='utf8', newline='\n') as output:
    output.write(test)
