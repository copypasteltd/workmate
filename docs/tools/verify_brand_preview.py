"""Review the offline documentation sample in an owned native browser, then close it."""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
DESIGN = ROOT / 'design'


def main():
    tokens = json.loads((DESIGN/'brand-tokens.json').read_text(encoding='utf-8'))
    report = {'scope':'documentation_visual_sample_only',
              'checked_at':datetime.now(timezone.utc).isoformat(),
              'checks':[], 'screenshots':[], 'browser_errors':[], 'network_requests':[],
              'inputs':{name:hashlib.sha256((DESIGN/name).read_bytes()).hexdigest()
                        for name in ['brand-preview.html','brand-tokens.css','brand-tokens.json']},
              'browser_cleanup':{'contexts_closed':False,'owned_browser_closed':False},
              'not_validated':['running_product','real_agent_or_media_generation',
                               'complete_accessibility_audit','real_browser_ui_200_percent_zoom',
                               'all_product_pages_and_operating_systems']}

    def check(value, name, detail=None):
        report['checks'].append({'name':name,'passed':bool(value), **({'detail':detail} if detail is not None else {})})

    candidates = [Path('C:/Program Files/Google/Chrome/Application/chrome.exe'),
                  Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')]
    executable = next(p for p in candidates if p.is_file())
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=str(executable),headless=True)
        context = browser.new_context(viewport={'width':1440,'height':1100},color_scheme='light',reduced_motion='reduce')
        try:
            page = context.new_page()
            page.on('pageerror',lambda error:report['browser_errors'].append(str(error)))
            page.on('console',lambda message:report['browser_errors'].append(message.text) if message.type=='error' else None)
            page.on('request',lambda request:report['network_requests'].append(request.url) if request.url.startswith(('https://','http://')) else None)
            page.goto((DESIGN/'brand-preview.html').as_uri(),wait_until='load')
            page.evaluate('document.fonts.ready')
            check(page.locator('.role-card').count()==6,'six-featured-role-examples')
            check(page.locator('html').get_attribute('lang')=='zh-HK','hong-kong-traditional-chinese-label')

            for theme in ['light','dark']:
                page.locator('#theme').select_option(theme)
                page.locator('#logo').evaluate('(image)=>image.decode()')
                actual = page.evaluate('''() => {
                    const css=getComputedStyle(document.documentElement);
                    return Object.fromEntries(['primary','secondary','accent','bg','bg-soft','surface','text','text-muted','border'].map(k=>[k,css.getPropertyValue('--cp-color-'+k).trim()]));
                }''')
                check(actual==tokens['themes'][theme]['base_colors'],theme+':all-official-colors',actual)
                check(page.locator('#logo').evaluate('(image)=>image.complete && image.naturalWidth>0'),theme+':original-logo-loaded')
                check(('Dark' if theme=='dark' else 'Light') in page.locator('#logo').get_attribute('src'),theme+':correct-logo-variant')
                action = page.locator('#start-demo').evaluate('''e=>{
                    const style=getComputedStyle(e),root=getComputedStyle(document.documentElement),probe=document.createElement('span');
                    probe.style.color=root.getPropertyValue('--cp-color-action-fill');document.body.append(probe);
                    const expected=getComputedStyle(probe).color;probe.remove();return style.backgroundColor===expected;
                }''')
                check(action,theme+':ink-filled-primary-action')
                image_name='preview-'+theme+'.png'
                page.screenshot(path=str(DESIGN/image_name),full_page=True,animations='disabled')
                report['screenshots'].append('design/'+image_name)
                for width in tokens['layout']['test_widths_px']:
                    page.set_viewport_size({'width':width,'height':1000})
                    dimensions=page.evaluate('''()=>({document:document.documentElement.scrollWidth,viewport:innerWidth})''')
                    check(dimensions['document']<=dimensions['viewport'],f'{theme}:{width}px:home-no-horizontal-overflow',dimensions)
                    check(page.locator('#goal').is_visible(),f'{theme}:{width}px:delegation-input-visible')
                    if theme=='light' and width==375:
                        page.locator('#menu-toggle').click()
                        check(page.locator('#menu-toggle').get_attribute('aria-expanded')=='true' and page.locator('#sidebar').is_visible(),'mobile-navigation-opens')
                        page.keyboard.press('Escape')
                        check(page.locator('#menu-toggle').get_attribute('aria-expanded')=='false' and not page.locator('#sidebar').is_visible(),'escape-closes-owned-navigation')
                        page.screenshot(path=str(DESIGN/'preview-mobile.png'),full_page=True,animations='disabled')
                        report['screenshots'].append('design/preview-mobile.png')
                    page.locator('#start-demo').click()
                    check(page.locator('#conversation-view').is_visible(),f'{theme}:{width}px:conversation-opens')
                    dimensions=page.evaluate('''()=>({document:document.documentElement.scrollWidth,viewport:innerWidth})''')
                    check(dimensions['document']<=dimensions['viewport'],f'{theme}:{width}px:conversation-no-horizontal-overflow',dimensions)
                    page.get_by_role('button',name='返回新工作',exact=True).click()
                page.set_viewport_size({'width':1440,'height':1100})

            page.locator('#theme').select_option('dark')
            page.reload(wait_until='load')
            check(page.locator('html').get_attribute('data-theme')=='dark' and page.locator('#theme').input_value()=='dark','theme-preference-persists-on-reload')
            page.locator('#theme').select_option('system')
            page.emulate_media(color_scheme='light')
            expect(page.locator('html')).to_have_attribute('data-theme','light')
            check(page.locator('html').get_attribute('data-theme')=='light','system-theme-light')
            page.emulate_media(color_scheme='dark')
            expect(page.locator('html')).to_have_attribute('data-theme','dark')
            check(page.locator('html').get_attribute('data-theme')=='dark','system-theme-reacts-to-dark')

            page.locator('.role-card[data-role="演示文稿設計師"]').click()
            check(page.locator('#selected-role').inner_text()=='演示文稿設計師' and page.locator('.role-card[aria-pressed="true"]').count()==1,'role-selection-and-pressed-state')
            page.locator('#theme').select_option('light')
            page.locator('#start-demo').click()
            artwork = page.locator('#customer-artwork')
            signature = lambda:artwork.evaluate('e=>({html:e.innerHTML,color:getComputedStyle(e).color,background:getComputedStyle(e).backgroundColor})')
            before=signature()
            page.locator('#theme').select_option('dark')
            check(signature()==before,'customer-artifact-unchanged-by-platform-theme')
            page.locator('#theme').select_option('light')
            page.locator('#edit-demo').click()
            check('新修改版本' in page.locator('#artifact-feedback').inner_text(),'revision-demo-announces-feedback')
            page.locator('#review-demo').click()
            check('示例審閱標記' in page.locator('#artifact-feedback').inner_text(),'review-demo-announces-feedback')
            page.screenshot(path=str(DESIGN/'preview-conversation.png'),full_page=True,animations='disabled')
            report['screenshots'].append('design/preview-conversation.png')
            page.get_by_role('button',name='返回新工作',exact=True).click()
            page.locator('#start-demo').focus()
            page.keyboard.press('Tab')
            focused=page.evaluate('''()=>{const e=document.activeElement,s=getComputedStyle(e);return {tag:e.tagName,visible:e.getBoundingClientRect().width>0,outline:s.outlineStyle,width:s.outlineWidth}}''')
            check(focused['tag']=='BUTTON' and focused['visible'] and focused['outline']!='none' and float(focused['width'].rstrip('px'))>=2,'keyboard-tab-visible-focus',focused)
            check(page.locator('#start-demo').evaluate("e=>getComputedStyle(e).transitionDuration==='0s'"),'reduced-motion-no-transition')
            check(not report['network_requests'],'offline-sample-makes-no-network-requests')
            check(not report['browser_errors'],'no-browser-script-or-console-errors',report['browser_errors'])
        except Exception as error:
            check(False,'review-completes-without-exception',str(error))
        finally:
            context.close()
            report['browser_cleanup']['contexts_closed']=len(browser.contexts)==0
            browser.close()
            report['browser_cleanup']['owned_browser_closed']=not browser.is_connected()
    report['checks_passed']=sum(c['passed'] for c in report['checks'])
    report['checks_failed']=sum(not c['passed'] for c in report['checks'])
    report['status']='passed' if not report['checks_failed'] and all(report['browser_cleanup'].values()) else 'failed'
    (ROOT/'quality/brand-preview-review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({key:report[key] for key in ['scope','status','checks_passed','checks_failed','browser_cleanup']},ensure_ascii=False,indent=2))
    for check_result in report['checks']:
        if not check_result['passed']:
            print(json.dumps(check_result,ensure_ascii=False))
    return 0 if report['status']=='passed' else 1


if __name__=='__main__':
    sys.exit(main())
