"""Follow the actual existing import identity returned by source deduplication."""
from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts';s=(scripts/'qualify-live-marketing-review-202-v3.mjs').read_text('utf8')
s=s.replace('202-v3-marketing-review-live.png','202-v4-marketing-review-live.png').replace("'marketing-review-live','202-v3'","'marketing-review-live','202-v4'")
s=s.replace('report.dataset_id=dataset.id;','report.dataset_id=dataset.id;report.dataset_name=dataset.name;assert.equal(typeof dataset.name,"string");')
s=s.replace('openReview(page,name)','openReview(page,dataset.name)')
assert s.count('openReview(page,dataset.name)')==2
s=s.replace("const destination=path.join(out,'native-review.'+format);","await pass('Native actual '+format+' export starting');const destination=path.join(out,'native-review.'+format);")
(scripts/'qualify-live-marketing-review-202-v4.mjs').write_text(s,encoding='utf8',newline='\n')
print('QA follows returned deduplicated source ID/name; source bytes, application and validation remain unchanged.')
