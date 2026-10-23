"""Record the bounded REQ-013 repair without changing its original acceptance."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / 'docs/quality/requirements-alignment-progress.json'
archive = ROOT / 'docs/quality/history/before-stage79-docs/docs/quality/requirements-alignment-progress.json'
assert not archive.exists(), 'Preserve the original progress bytes'
before = path.read_bytes()
progress = json.loads(before)
assert progress['summary'] == {'partial_verified': 81, 'completion_not_proven': 21}
archive.parent.mkdir(parents=True, exist_ok=True)
archive.write_bytes(before)
requirement = next(item for item in progress['requirements'] if item['requirement_id'] == 'REQ-013')
assert requirement['assessment'] == 'completion_not_proven'
requirement['assessment'] = 'partial_verified'
requirement['finding'] = '已验证不可变品牌版本、固定专家/云端设计任务、真实字体覆盖/使用声明与促销期限检查、来源治理，以及 Web/打包 Desktop 品牌表单；全设计业务与真实客户验收仍未证明。'
requirement['source_inspection_candidates'] += [
    'dev/copypaste-platform/src/brand-production.ts',
    'dev/copypaste-platform/src/brand-font.ts',
    'dev/copypaste-platform/migrations/096-versioned-brand-production.sql',
    'dev/copypaste-platform/tests/brand-production.test.ts',
    'dev/copypaste-web/src/brand-library.tsx',
    'dev/copypaste-desktop/renderer/src/brand-library.tsx',
]
requirement['acceptance_evidence'].append('brand_production_repair')
requirement['verified_repairs'].append({
    'cluster': 'fixed_brand_production',
    'verified_subflow': '不可变连续版本、并发/幂等、固定旧版专家与真实云端设计工具任务、TTF/OTF cmap4/12 与实际路径/PNG/PDF、价格/促销/渠道/语言/声明期限检查、跨租户/项目与 Admin 支持边界、源文件隔离删除传播、Web 与无可见滚动条打包 Desktop 表单。客户/模型内容为明确夹具。',
    'evidence': ['brand_production_repair'],
    'implementation_docs': ['technical/79-versioned-brand-production.md'],
})
requirement['remaining_complete_acceptance_conditions'] = '完整品牌历史分页/管理、其他设计及媒体格式逐项端到端接入、所有本机专业角色的品牌生产约束、自然语言语义事实遵循、全部字体排版及使用范围、真实客户任务接受尚未证明。字体权利记录仅为客户声明。'
assert requirement['acceptance_case_execution'] == 'not_completed'
progress['summary'] = dict(Counter(item['assessment'] for item in progress['requirements']))
assert progress['summary'] == {'partial_verified': 82, 'completion_not_proven': 20}
progress['at'] = datetime.now(timezone.utc).isoformat()
progress['current_source_qualification'] = {
    'stage': 79, 'checkpoint': 'brand-production-checkpoint.json',
    'note': 'Fixed brand production subflow with actual native Desktop/Web forms and explicit model/customer fixtures. Checkpoint identifies the reviewed later difference in one unrelated extension harness, fresh current extension execution and full platform23. Original complete acceptance remains unproven.',
}
progress['brand_production_repair'] = {
    'stage': 79, 'checkpoint': 'brand-production-checkpoint.json',
    'status': 'verified_fixed_brand_production_subflow', 'platform_tests': 874,
    'client_tests': 68, 'packaged_ui_checks': 30, 'brand_web_checks': 4,
    'web_admin_checks': 4, 'extension_checks': 8, 'original_full_acceptance': 'not_proven',
}
assert progress['fully_accepted_requirements'] == 0
assert all(item['full_acceptance'] == 'not_proven' for item in progress['gates'])
path.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'before_sha256': sha256(before).hexdigest(), 'after_sha256': sha256(path.read_bytes()).hexdigest(),
                  'summary': progress['summary'], 'fully_accepted': 0}))
