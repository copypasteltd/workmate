"""Retain the failed download attempt and capture bounded response facts."""
from pathlib import Path
scripts=Path(__file__).resolve().parent
text=(scripts/'qualify-real-image-download-189-v1.mjs').read_text(encoding='utf8')
needle=" page=await c.newPage();video=page.video();page.on('pageerror',error=>report.javascript_errors.push(error.message));"
assert text.count(needle)==1
text=text.replace(needle,needle+"\n report.download_transport=[];page.on('requestfailed',request=>{report.download_transport.push({path:new URL(request.url()).pathname,failure:request.failure()?.errorText});});page.on('response',response=>{if(new URL(response.url()).pathname.endsWith('/download'))report.download_transport.push({path:new URL(response.url()).pathname,status:response.status(),mime:response.headers()['content-type'],bytes:response.headers()['content-length']});});")
needle="}catch(error){report.status='failed';report.error=String(error.stack??error.message);}"
assert text.count(needle)==1
text=text.replace(needle,"}catch(error){report.status='failed';report.error=String(error.stack??error.message);if(page){report.visible_alerts=await page.locator('.error-notice,[role=alert]').allTextContents().catch(()=>[]);await screenshot(page,path.join(run,'failure.private.png')).catch(()=>{});} }")
with (scripts/'qualify-real-image-download-189-v2.mjs').open('x',encoding='utf8',newline='\n') as f:f.write(text)
