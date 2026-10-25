"""Publish scoped private-workflow usage, actual media and immutable doc preimages."""
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref


def main():
    output = ROOT / 'docs/quality/cloud-workflows-documentation-refresh.json'
    archive = ROOT / 'docs/quality/history/stage91-current-documents'
    assert not output.exists() and not archive.exists()
    checkpoint_file = ROOT / 'docs/quality/cloud-workflows-checkpoint.json'
    cp = read(checkpoint_file)
    assert cp['status'] == 'verified_scoped_private_cloud_workflows' and cp['core_tests']['pass'] == 55 and cp['ui_checks'] == 8
    media_review = read(ROOT / 'docs/quality/cloud-workflows-media-review-01.json')
    assert media_review['status'] == 'passed' and media_review['checkpoint']['sha256'] == digest(checkpoint_file)
    archive.mkdir(parents=True)
    changes, copies = [], []

    def write(file, text):
        saved = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.snapshot')
        with saved.open('xb') as stream: stream.write(file.read_bytes())
        file.write_text(text, encoding='utf-8', newline='\n')
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(), 'before_sha256': digest(saved), 'after_sha256': digest(file)})

    selected = [row for row in cp['screenshots'] if row['path'].endswith(('pending-request.png', 'review-zh-375.png'))]
    selected += [file for row in cp['recordings'] for file in row['files']]
    assert len(selected) == 6
    for folder in [ROOT / 'docs/design/implementation', DEV / 'copypaste-platform/assets/screenshots', DELIVERY / 'assets/screenshots']:
        folder.mkdir(parents=True, exist_ok=True)
        for item in selected:
            original = DEV / item['path']; target = folder / original.name
            assert not target.exists() and digest(original) == item['sha256']
            shutil.copyfile(original, target)
            assert digest(target) == item['sha256']
            copies.append({'source': original.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': item['sha256']})
    cn = ('阶段 91 已接通流程顾问的私有云端执行：真实固定版 Codex 准备不可变流程，客户核对步骤、预算并主动确认后执行，遇人工审批再次暂停。'
          '55 项相关后端回归与 8 项真实浏览器检查通过，包含私有文件下载、子任务单次预留/结算、修改版本、取消、来源隔离和重复请求。'
          '模型回复与账户数据按要求使用假数据；工具、数据库、原生 Codex、文件及页面交互实际运行。')
    en = ('Stage 91 connects the workflow consultant to private cloud execution. Actual pinned Codex prepares an immutable procedure; '
          'the customer reviews its fixed steps and child budget before confirming execution, which pauses again at human approval steps. '
          'Fifty-five relevant backend cases and eight actual browser checks pass, including private downloads, single child reservations/settlements, '
          'versioned corrections, cancellation, source withdrawal and exact retries. Model replies/account data are synthetic; Codex, tools, database, files and UI interactions are real.')
    plan = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/91-private-cloud-workflows.md'
    evidence = 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/cloud-workflows-checkpoint.json'
    by_tail = lambda suffix: next(Path(row['path']).name for row in selected if row['path'].endswith(suffix))
    diagram = '```mermaid\nflowchart LR\n  A[Consultant and fixed Skills] --> B[Private version and pending request]\n  B --> C[Customer reviews steps and budget]\n  C --> D[Actual ordered execution]\n  D --> E[Human approval when required]\n  E --> F[Private files and original receipts]\n  F --> G[New revision preserves old version]\n```\n'
    for folder in [ROOT / 'docs', DEV / 'copypaste-platform', DEV / 'copypaste-web', DELIVERY]:
        for name in ['README.md', 'README.en.md']:
            file = folder / name; text = file.read_text(encoding='utf-8'); english = name.endswith('.en.md')
            assert '<!-- cloud-workflows-stage91 -->' not in text
            media = 'design/implementation/' if folder == ROOT / 'docs' else 'assets/screenshots/'
            section = '\n<!-- cloud-workflows-stage91 -->\n\n## ' + ('Private cloud workflow delivery' if english else '私有云端流程交付') + '\n\n' + (en if english else cn) + '\n\n'
            section += ('1. Select the workflow consultant and use Execute to prepare an authorized private procedure. Preparation has its own actual task bill.\n'
                        '2. Open Workflows, review the exact version, all steps and the separate total child budget, then explicitly check consent and confirm. No child task/reservation exists beforehand.\n'
                        '3. Download the calculated private summary, approve the next human review, and follow the actual child task, delivered file and cost receipt. Unknown usage blocks replacement execution.\n'
                        '4. Ask the same consultant for a correction. A new version/request keeps original versions and runs intact. Cancellation stops only this run; withdrawn sources block history/downloads.\n\n' if english else
                        '1. 选用流程顾问，以 Execute 准备获准的私有流程；准备任务按其自身实际用量计费。\n'
                        '2. 在 Workflows 核对固定版本、全部步骤及独立的子任务总预算，勾选同意并确认；此前不创建子任务或子任务预留。\n'
                        '3. 下载实际私有数据摘要，明确批准下一人工审批点，跟踪子任务、交付文件和实际费用。未知费用会阻断替代执行。\n'
                        '4. 向同一顾问提出修改，创建新版本和请求；旧版本及执行保留。取消仅影响该流程，来源撤权会阻断历史与下载。\n\n')
            section += diagram + '\n'
            section += ('Apply **SQL105** after SQL001–104. The consultant and its two fixed workflow Skills are 1.1.0. At most eight sequential authorized cloud-role, data-summary or human-review steps are supported; nested workflows, arbitrary cloud shell, external account writes and video child tasks are not enabled here. Desktop keeps its separate local Codex runtime.\n\n' if english else
                        'SQL001–104 后应用 **SQL105**。顾问及两个流程 Skill 固定为 1.1.0；支持最多八个顺序的获准云端角色、数据摘要或人工审批步骤。这条链路尚未开放嵌套流程、任意云端 shell、外部账号写入及视频子任务。Desktop 继续使用独立的本机 Codex。\n\n')
            section += f'[{"Implementation" if english else "方案与使用逻辑"}]({plan}) · [{"Source-bound evidence" if english else "源码绑定检查"}]({evidence})\n\n'
            section += f'![{"Actual pending workflow" if english else "实际待确认流程"}]({media}{by_tail("pending-request.png")})\n\n'
            section += f'![{"Actual narrow Traditional Chinese review" if english else "实际繁中窄屏核对"}]({media}{by_tail("review-zh-375.png")})\n\n'
            section += f'![{"Actual execution and revision" if english else "实际执行与修改交互"}]({media}{by_tail("cloud-workflow-review.gif")})\n\n'
            section += f'[Preparation GIF]({media}{by_tail("cloud-workflow-prepare.gif")}) · [Preparation MP4]({media}{by_tail("cloud-workflow-prepare.mp4")}) · [Review MP4]({media}{by_tail("cloud-workflow-review.mp4")})\n'
            text = text.replace('## 当前分析与信息图交付', '## 历史验证：分析与信息图交付（阶段 90）').replace('## Current analysis and infographic delivery', '## Earlier analysis and infographic verification (stage 90)')
            text = text.replace('升级后端前应用 SQL104。本增量不新增 HTTP 路由或迁移，SQL001–103 与 532 个已记录契约保持原字节。', '升级后端前应用 SQL105；新增私有流程读取和客户确认路由。SQL001–104 与 532 个已记录历史契约保持原字节。')
            text = text.replace('Apply SQL104 before starting the updated backend. This increment adds no public route or migration; SQL001–103 and all 532 historical contracts remain byte-identical.', 'Apply SQL105 before starting the updated backend. Private workflow listing and customer decisions are additive routes; SQL001–104 and all 532 historical contracts remain byte-identical.')
            text = text.replace('Apply SQL103 before client upgrades. This increment adds no HTTP route or migration; SQL001–103 and 532 recorded contracts remain byte-preserved.', 'Apply SQL105 before starting the updated backend. Private workflow listing and customer decisions are additive routes; SQL001–104 and 532 historical contracts remain byte-preserved.')
            first = text.index('\n') + 1
            write(file, text[:first] + section + text[first:])
    current = ROOT / 'docs/contracts/role-preset-catalog-workflow-1.1.0.json'
    with current.open('xb') as stream: stream.write((DEV / 'copypaste-platform/catalog/role-preset-catalog.json').read_bytes())
    progress_file = ROOT / 'docs/quality/requirements-alignment-progress.json'; progress = read(progress_file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 91, 'checkpoint': 'cloud-workflows-checkpoint.json', 'note': en + ' Earlier full client/platform snapshots retain their historical scope; this is not a current full-platform regression.'}
    progress['private_cloud_workflows'] = {'stage': 91, 'checkpoint': 'cloud-workflows-checkpoint.json', 'core_tests': 55, 'ui_checks': 8, 'roles': cp['roles'], 'native_codex_exercised_here': True, 'synthetic_model': True, 'full_acceptance': 'not_proven', 'source_files': len(cp['source_files']), 'scope': cp['scope']}
    write(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    for english in [False, True]:
        file = ROOT / ('docs/changes/2026-10-25-private-cloud-workflows' + ('.en' if english else '') + '.md')
        with file.open('x', encoding='utf-8') as stream:
            stream.write('# ' + ('Private cloud workflows' if english else '私有云端流程交付') + '\n\n' + (en if english else cn) + '\n\n[Implementation / 方案](../technical/91-private-cloud-workflows.md) · [Evidence / 验证](../quality/cloud-workflows-checkpoint.json)\n')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint_file), 'changes': changes, 'media_copies': copies, 'original_media_modified': False, 'verifier_sha256': digest(Path(__file__))}
    with (archive / 'receipt.json').open('x', encoding='utf-8') as stream: stream.write(json.dumps({'files': changes}, ensure_ascii=False, indent=2) + '\n')
    with output.open('x', encoding='utf-8') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'bilingual_readmes_updated': 8, 'copied_media': len(copies)}))


if __name__ == '__main__': main()
