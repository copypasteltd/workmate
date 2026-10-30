"""Generate new publication sources against the actual Stage141 publication.

Original executed verifiers, raw failures and historical manifests are preserved.
Generated tools must be reviewed before use.
"""
from pathlib import Path
import ast

ROOT = Path(__file__).resolve().parents[3]
TOOLS = ROOT / 'docs/tools'

def write(name, text):
    ast.parse(text)
    with (TOOLS/name).open('x', encoding='utf-8', newline='\n') as stream: stream.write(text)

record = (TOOLS/'record_creative_packages_140_v1.py').read_text(encoding='utf-8')
record = record.replace('creative-packages-evidence-140','creative-brand-evidence-142').replace('creative-packages-checkpoint-140','creative-brand-checkpoint-142').replace('evidence/creative-packages-140','evidence/creative-brand-142')
record = record.replace('.data/native-teams-139/publication-92f1c0e2-b35c-4f8b-aa27-a0e2812325df','.data/test-discovery-141/publication-ebeb04ef-b9c1-44f9-b58c-a1d57a60875b')
record = record.replace('89f0bf1a3b847a85f976c7bdd631902f511d1a48','711ed878a55f6bfb4115630d5701892b5c340e83')
record = record.replace('qualify-creative-packages*.mjs','qualify-creative-brand*.mjs').replace('qa-creative-packages-140-v*.ts','qa-creative-brand-142-v*.ts')
record = record.replace('verified_portable_creative_project_slice','verified_brand_canvas_restoration_slice').replace('assert counts == [6, 23, 3], counts','assert counts == [8, 6, 13, 7, 2, 23, 3], counts')
record = record.replace('"new_backend_integration_cases": 6, "existing_video_regressions": 23, "extension_download_boundary_cases": 3,','"new_brand_integration_cases": 8, "portable_project_regressions": 6, "brand_production_regressions": 13, "editable_design_regressions": 7, "new_image_pixel_cases": 2, "existing_video_regressions": 23, "extension_download_boundary_cases": 3,')
record = record.replace('docs/quality/native-teams-release-checkpoint-139.json','docs/quality/test-discovery-checkpoint-141.json')
record = record.replace('Portable canvas/video project slice. Original passing and failing attempts keep their own scope and sources.','Brand canvas restoration and shared SVG/PPTX image preservation. Original passing and failing attempts keep their own scope and sources.')
record = record.replace('"scripts/record-workmate-media.ts", "package.json"','"scripts/record-workmate-media.ts", "scripts/build-brand-journey-142-v1.py", "scripts/build-brand-publication-tools-142-v1.py", "package.json"')
write('record_creative_brand_142_v1.py',record)

prepare = (TOOLS/'prepare_test_discovery_publication_141_v1.py').read_text(encoding='utf-8')
prepare = prepare.replace('record_test_discovery_141_v1','record_creative_brand_142_v1').replace('workmate-publication-141.json','workmate-publication-142.json')
prepare = prepare.replace('OLD = ROOT / "docs/quality/workmate-publication-140-v2.json"','OLD = ROOT / "docs/quality/workmate-publication-141.json"')
prepare = prepare.replace('docs/quality/test-discovery-checkpoint-141.json','docs/quality/creative-brand-checkpoint-142.json').replace('b4d7111da147a87ca9c241eeed057bf914e9296e','711ed878a55f6bfb4115630d5701892b5c340e83')
prepare = prepare.replace('result.append({"stage": 140','result.append({"stage": 141').replace('"proof_count": 1958,','"proof_count": 27,')
prepare = prepare.replace('140: 1958}', '140: 1958, 141: 27}').replace('stage141-previous-publication.json','stage142-previous-publication.json')
prepare = prepare.replace('write_shards(rows, ROOT, 141)','write_shards(rows, ROOT, 142)').replace('397376','397403')
prepare = prepare.replace('publish_test_discovery_publication_141_v1.py','publish_creative_brand_publication_142_v1.py').replace('audit_test_discovery_publication_141_v1.py','audit_creative_brand_publication_142_v1.py')
prepare = prepare.replace('Stage141 default test entry automatically selects the latest numeric attempt per suite, preserves historical failures, and propagates current failures. Six end-to-end selector checks, actual npm test inspection and compiler pass. Stage140 runtime sources and real three-client restoration remain unchanged; full-platform regression and product acceptance are not relabelled.','Stage142 implements explicitly reviewed destination-brand canvas restoration, retains source images and z-order in branded/vector/presentation outputs, and updates exact route declarations. Source-bound related regressions and actual three-client journeys retain original passing/failing attempts. Full-product acceptance stays open.')
write('prepare_creative_brand_publication_142_v1.py',prepare)

audit = (TOOLS/'audit_test_discovery_publication_141_v1.py').read_text(encoding='utf-8')
audit = audit.replace('prepare_test_discovery_publication_141_v1','prepare_creative_brand_publication_142_v1').replace('test-discovery-checkpoint-141','creative-brand-checkpoint-142').replace('test-discovery-evidence-141','creative-brand-evidence-142').replace('.data/test-discovery-141','.data/creative-brand-142').replace('Stage140','Stage141')
write('audit_creative_brand_publication_142_v1.py',audit)

publish = (TOOLS/'publish_test_discovery_publication_141_v1.py').read_text(encoding='utf-8')
publish = publish.replace('prepare_test_discovery_publication_141_v1','prepare_creative_brand_publication_142_v1').replace('audit_test_discovery_publication_141_v1','audit_creative_brand_publication_142_v1').replace('.data/test-discovery-141','.data/creative-brand-142').replace('Stage141','Stage142')
publish = publish.replace('six end-to-end test-entry checks and actual npm inspection verified; published Stage140 creative runtime sources are unchanged;', 'explicit destination-brand restore and image-preserving design rendering have related source-bound checks plus actual Web/Desktop/native-Side-Panel journeys;')
write('publish_creative_brand_publication_142_v1.py',publish)
print('Created four new Stage142 recorder/publication tools for read-only review.')
