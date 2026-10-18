"""Record public-source HTTP metadata; no browser, login, or product execution."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from html import unescape
from pathlib import Path
import hashlib
import json
import re
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'research/01-web-benchmark-workbuddy-accio.md'
DEST = ROOT / 'research/02-source-checks.json'
PATTERN = r'^\| ((?:WB|AC)\d{2}) / ([HD]) \| \[([^\]]+)\]\((https://[^)]+)\) \|'


def fetch(row):
    source_id, basis, label, url = row
    result = {'id': source_id, 'label': label, 'url': url,
              'basis': 'public_app_html' if basis == 'H' else 'official_documentation',
              'checked_at': datetime.now(timezone.utc).isoformat(),
              'interactive_verified': False}
    try:
        request = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read()
            # Exclude comments so a commented <title> example is not captured.
            html = re.sub(r'<!--.*?-->', '', body.decode('utf-8', 'replace'), flags=re.S)
            title = re.search(r'<title\b[^>]*>(.*?)</title>', html, re.S | re.I)
            result.update(http_status=response.status, final_url=response.url,
                          title=unescape(re.sub(r'\s+', ' ', title.group(1))).strip() if title else None,
                          byte_count=len(body), sha256=hashlib.sha256(body).hexdigest(),
                          content_type=response.headers.get('Content-Type'),
                          last_modified=response.headers.get('Last-Modified'),
                          fetch_status='retrieved')
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        result.update(fetch_status='unavailable_on_recheck', error=str(error))
    return result


def main():
    rows = re.findall(PATTERN, SOURCE.read_text(encoding='utf-8'), re.M)
    assert rows and len({r[0] for r in rows}) == len(rows)
    with ThreadPoolExecutor(max_workers=4) as pool:
        records = list(pool.map(fetch, rows))
    payload = {'version': '1.1', 'review_date': '2026-10-18', 'review_timezone': 'Asia/Taipei',
               'method': 'Public official pages read with web retrieval and native HTTP; metadata recheck by this script.',
               'limitations': ['No interactive browser session or authenticated task execution.',
                               'HTTP success and content digest do not verify product functionality.',
                               'Cloud, desktop and generic documentation scopes are distinguished in the report.'],
               'sources': records}
    DEST.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'sources': len(records), 'retrieved': sum(r['fetch_status'] == 'retrieved' for r in records),
                      'unavailable_ids': [r['id'] for r in records if r['fetch_status'] != 'retrieved']}, ensure_ascii=False))


if __name__ == '__main__':
    main()
