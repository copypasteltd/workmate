from pathlib import Path
R=Path(__file__).resolve().parents[2];p=R/'dev/copypaste-delivery/scripts/qualify-live-marketing-review-203-v1.mjs';s=p.read_text('utf-8')
s=s.replace("import {assertReviewLayout} from './review-layout-203-v1.mjs';","import {assertReviewLayout} from './review-layout-203-v1.mjs';\nimport {reviewMatrix} from './review-matrix-203-v1.mjs';")
s=s.replace('report.web_layout=await assertReviewLayout(page,dialog,review);','report.web_layout=await assertReviewLayout(page,dialog,review);report.web_matrix=await reviewMatrix(page);')
s=s.replace('report.native_layout=await assertReviewLayout(page,native.dialog,native.review);','report.native_layout=await assertReviewLayout(page,native.dialog,native.review);report.native_matrix=await reviewMatrix(page,app);')
p.write_text(s,encoding='utf-8',newline='\n')
