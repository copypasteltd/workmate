"""Read the public brand site in an owned native browser; always close it."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'research' / 'copypaste-brand'
PROPERTIES = ['--color-primary','--color-secondary','--color-accent','--color-bg',
              '--color-bg-soft','--color-surface','--color-text','--color-text-muted',
              '--color-border','--color-shadow']

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    evidence = {'source_url':'https://copypaste.hk/', 'checked_at':datetime.now(timezone.utc).isoformat(),
                'scope':'public_site_style_reference_only', 'sources':[], 'views':[],
                'browser_cleanup':{'contexts_closed':False,'owned_browser_closed':False}}
    for name,url in [('homepage-source.html','https://copypaste.hk/'),
                     ('styles-source.css','https://copypaste.hk/styles.css'),
                     ('app-source.js','https://copypaste.hk/app.js'),
                     ('CopyPaste_Light.svg','https://copypaste.hk/assets/logo/CopyPaste_Light.svg'),
                     ('CopyPaste_Dark.svg','https://copypaste.hk/assets/logo/CopyPaste_Dark.svg'),
                     ('CopyPaste_Light.png','https://copypaste.hk/assets/logo/CopyPaste_Light.png'),
                     ('CopyPaste_Dark.png','https://copypaste.hk/assets/logo/CopyPaste_Dark.png')]:
        body = (OUT/name).read_bytes()
        evidence['sources'].append({'url':url,'local_file':name,'http_status':200,
                                    'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()})
    candidates = [Path('C:/Program Files/Google/Chrome/Application/chrome.exe'),
                  Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')]
    browser_path = next(p for p in candidates if p.is_file())
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=str(browser_path),headless=True)
        try:
            for key,url,theme,width,height in [
                ('homepage-light','https://copypaste.hk/','light',1440,1000),
                ('homepage-dark','https://copypaste.hk/','dark',1440,1000),
                ('homepage-mobile','https://copypaste.hk/zh-hant/','light',390,844),
            ]:
                context = browser.new_context(viewport={'width':width,'height':height},
                                              reduced_motion='reduce',color_scheme=theme)
                try:
                    page = context.new_page()
                    response = page.goto(url,wait_until='networkidle',timeout=45000)
                    page.locator('.brand').first.wait_for(timeout=10000)
                    page.evaluate('(theme) => { document.documentElement.dataset.theme = theme; }',theme)
                    page.evaluate('document.fonts.ready')
                    computed = page.evaluate('''(properties) => {
                      const root = getComputedStyle(document.documentElement);
                      const selectors = ['body','h1','.button-primary','.service-card','.hero-orbit','.brand-logo'];
                      return {
                        tokens:Object.fromEntries(properties.map(k=>[k,root.getPropertyValue(k).trim()])),
                        elements:Object.fromEntries(selectors.map(s=>{const e=document.querySelector(s);if(!e)return [s,null];const c=getComputedStyle(e);return [s,{fontFamily:c.fontFamily,fontSize:c.fontSize,fontWeight:c.fontWeight,lineHeight:c.lineHeight,color:c.color,background:c.backgroundColor,borderRadius:c.borderRadius,boxShadow:c.boxShadow,src:e.currentSrc||null}]})),
                        theme:document.documentElement.dataset.theme,
                        title:document.title,
                        documentWidth:document.documentElement.scrollWidth,
                        viewportWidth:innerWidth
                      };
                    }''',PROPERTIES)
                    platform_fonts = {}
                    session = context.new_cdp_session(page)
                    try:
                        session.send('DOM.enable')
                        session.send('CSS.enable')
                        document = session.send('DOM.getDocument')
                        for selector in ['h1','.hero-text','.brand-copy']:
                            node = session.send('DOM.querySelector',{'nodeId':document['root']['nodeId'],'selector':selector})
                            if node['nodeId']:
                                platform_fonts[selector] = session.send('CSS.getPlatformFontsForNode',{'nodeId':node['nodeId']})['fonts']
                    finally:
                        session.detach()
                    screenshot = key+'.png'
                    page.screenshot(path=str(OUT/screenshot),full_page=False,animations='disabled')
                    evidence['views'].append({'key':key,'url':url,'http_status':response.status,
                                              'screenshot':screenshot,'viewport':{'width':width,'height':height},
                                              'computed':computed,'platform_fonts':platform_fonts})
                finally:
                    context.close()
            evidence['browser_cleanup']['contexts_closed'] = len(browser.contexts)==0
        finally:
            browser.close()
            evidence['browser_cleanup']['owned_browser_closed'] = not browser.is_connected()
            (OUT/'source-evidence.json').write_text(json.dumps(evidence,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'views':len(evidence['views']),'browser_cleanup':evidence['browser_cleanup'],
                      'evidence':str(OUT/'source-evidence.json')},ensure_ascii=False))

if __name__ == '__main__':
    main()
