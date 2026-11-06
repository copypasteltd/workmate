from pathlib import Path
root=Path(__file__).resolve().parents[2];s=root/'dev/copypaste-delivery/scripts'
text=(s/'qualify-web-review-197-v4.mjs').read_text(encoding='utf8')
text=text.replace("await p.locator('.software-checks').waitFor()", "await p.locator('.software-checks .software-check').first().waitFor()")
text=text.replace("'197-v4'","'197-v5'").replace('197-v4-task-review.png','197-v5-task-review.png')
text=text.replace("pass('the software execution checks", "assert.match(await p.locator('.software-check').first().innerText(),/\\d+\\.\\d+s/);pass('the software execution checks")
(s/'qualify-web-review-197-v5.mjs').write_text(text,encoding='utf8',newline='\n')
print('Completed loaded-record Web review driver: wait for actual execution rows before duration assertions and capture. Earlier shell-only receipt retained.')
