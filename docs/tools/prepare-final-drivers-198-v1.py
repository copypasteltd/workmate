"""Retain original executed drivers; correct safe GET and viewport evidence."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
scripts=root/'dev/copypaste-delivery/scripts'
for stem in ['smoke-integrated','qualify-work-directory']:
    source=scripts/(stem+'-198-v2.mjs')
    target=scripts/(stem+'-198-v3.mjs')
    assert not target.exists()
    s=source.read_text(encoding='utf8')
    old="import {authenticateOwner197,navigate} from './live-owner-197-v2.mjs';"
    assert s.count(old)==1
    s=s.replace(old,"import {existingOwner,navigate} from './live-read-only-owner-198-v1.mjs';")
    assert s.count('authenticateOwner197(browser)')==1
    s=s.replace('authenticateOwner197(browser)','existingOwner(browser)').replace('198-v2','198-v3')
    if stem=='smoke-integrated':
        s=s.replace('Fresh sign-in uses the retained test mailbox.','Web reuses a still-authorized owned QA session, verified against live session identity; fresh Admin sign-in uses the retained test mailbox and TOTP. No credentials or responses are replaced.')
    else:
        old="await p.setViewportSize({width,height:950});const size=await p.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));assert.ok(size.content<=size.width+1);"
        new="await p.setViewportSize({width,height:950});await p.waitForFunction(w=>innerWidth===w,width);await p.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));const size=await p.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));assert.equal(size.width,width);assert.ok(size.content<=size.width+1);"
        assert s.count(old)==1
        s=s.replace(old,new)
    target.write_text(s,encoding='utf8',newline='\n')
print('prepared two immutable final drivers; original attempts retained')
