"""Publish bilingual usage, actual media and current role definitions without rewriting history."""
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil

from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref


def main():
    output = ROOT / 'docs/quality/analysis-roles-documentation-refresh.json'
    archive = ROOT / 'docs/quality/history/stage90-current-documents'
    assert not output.exists() and not archive.exists()
    checkpoint_file = ROOT / 'docs/quality/analysis-roles-checkpoint.json'
    cp = read(checkpoint_file)
    assert cp['status'] == 'verified_scoped_analysis_role_delivery' and cp['core_tests']['tests'] == 68 and cp['ui_checks'] == 11
    review = read(ROOT / 'docs/quality/analysis-roles-media-review-01.json')
    assert review['status'] == 'passed' and review['checkpoint']['sha256'] == digest(checkpoint_file)
    archive.mkdir(parents=True)
    changes, copies = [], []

    def write(file, text):
        original = file.read_bytes()
        saved = archive / 'files' / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.snapshot')
        saved.parent.mkdir(parents=True, exist_ok=True)
        with saved.open('xb') as stream: stream.write(original)
        file.write_text(text, encoding='utf-8', newline='\n')
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(), 'before_sha256': digest(saved), 'after_sha256': digest(file)})

    selected = [row for row in cp['screenshots'] if row['path'].endswith(('report-en-desktop.png', 'report-zh-375.png'))]
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
    plan = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/90-analysis-role-delivery.md'
    evidence = 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/analysis-roles-checkpoint.json'
    cn = ('阶段 90 已接通营销分析师与信息图设计师的确定性计算和九种实际交付文件，角色及相关 Skill 使用 1.1.0 固定版本。'
          '68 项相关后端回归、11 项真实浏览器检查通过；两个角色均通过真实固定版 Codex 进程调用获准工具。'
          '模型回复与账号数据为已授权假数据，程序、数据库、PNG/ZIP、下载、私有隔离、来源阻断及账本流程实际运行。'
          '这不替代至少十二个专业角色及全产品的完整验收。')
    en = ('Stage 90 connects versioned marketing-analyst and information-design presets to deterministic calculation and nine real deliverable files. '
          'Sixty-eight relevant backend checks and eleven actual browser checks pass. Both roles use the real pinned Codex process and authorized company tools. '
          'Model replies and account data are explicitly synthetic; the program, database, PNG/ZIP bytes, downloads, private isolation, source fences and ledger operations are real. '
          'This does not replace the requirement for twelve professionally qualified roles or complete product acceptance.')
    diagram = '```mermaid\nflowchart LR\n  A[Role and authorized sources] --> B[Exact calculation and evidence]\n  B --> C[Codex and fixed Skills]\n  C --> D[Private files and task receipt]\n  D --> E[Read source and confirm revision]\n  E --> B\n```\n'
    for folder in [ROOT / 'docs', DEV / 'copypaste-platform', DEV / 'copypaste-web', DELIVERY]:
        for name in ['README.md', 'README.en.md']:
            file = folder / name; text = file.read_text(encoding='utf-8'); english = name.endswith('.en.md')
            assert '<!-- analysis-roles-stage90 -->' not in text
            media = 'design/implementation/' if folder == ROOT / 'docs' else 'assets/screenshots/'
            files = {Path(row['path']).name.rsplit('-04-', 1)[-1]: Path(row['path']).name for row in selected}
            section = '\n<!-- analysis-roles-stage90 -->\n\n## ' + ('Current analysis and infographic delivery' if english else '当前分析与信息图交付') + '\n\n' + (en if english else cn) + '\n\n'
            section += ('1. Create the marketing analyst or information designer from the specialist directory. Existing specialists keep their old role/Skill versions.\n'
                        '2. Confirm the dates, currency, account, attribution and conversion definition. Choose actual imported data or upload CSV/XLSX to this private conversation; inspect the real worksheet and headers.\n'
                        '3. Select **Execute**, confirm the budget and delegate the work. Ask/Plan cannot write files. Download SVG, PNG, interactive HTML, metrics/source CSV, creative brief, editable JSON, manifest and ZIP.\n'
                        '4. Request a correction using the original source version. Recalculation creates new immutable files; prior versions remain available while their sources are authorized. Identical render retries reuse the original files. Rendering makes no extra AI request; text inference follows the task ledger.\n\n'
                        if english else
                        '1. 从专业角色目录建立营销分析师或信息图设计师。既有专员保留原角色及 Skill 版本。\n'
                        '2. 明确日期、币种、账号、归因及转化定义，选择实际导入的数据，或在当前私有会话上传 CSV/XLSX 并核对真实工作表与表头。\n'
                        '3. 选择 **执行（Execute）**、确认预算并交付工作；Ask/Plan 不写文件。下载 SVG、PNG、交互 HTML、指标及源事实 CSV、创意简报、源 JSON、清单和 ZIP。\n'
                        '4. 修改时读取原源文件，再计算并生成新版本；来源仍获准时旧文件可继续下载。相同绘图请求重试复用原文件。绘图不额外调用 AI，文本推理消耗按原任务账本记录。\n\n')
            section += diagram + '\n'
            section += ('Apply **SQL104** before starting the updated backend; SQL001–103 and all old Skill bytes remain intact.\n\n' if english else '升级后端前应用 **SQL104**；SQL001–103 和原 Skill 字节保持不变。\n\n')
            section += f'[{"Design and implementation" if english else "方案与实现"}]({plan}) · [{"Exact evidence" if english else "精确检查记录"}]({evidence})\n\n'
            section += f'![{"Actual desktop report" if english else "实际桌面宽度报告"}]({media}{files["report-en-desktop.png"]})\n\n'
            section += f'![{"Actual Traditional Chinese mobile report" if english else "实际繁中移动报告"}]({media}{files["report-zh-375.png"]})\n\n'
            section += f'![{"Actual report interaction" if english else "实际报告交互"}]({media}{files["analysis-report-review.gif"]})\n\n'
            section += f'[{"Creation and download GIF" if english else "建立与下载 GIF"}]({media}{files["analysis-role-work.gif"]}) · [MP4]({media}{files["analysis-role-work.mp4"]}) · [{"Report MP4" if english else "报告 MP4"}]({media}{files["analysis-report-review.mp4"]})\n'
            first = text.index('\n') + 1
            text = text[:first] + section + text[first:]
            text = text.replace('## 当前首项工作流程', '## 历史验证：首次工作（阶段 89）').replace('## Current first-work flow', '## Earlier first-work verification (stage 89)')
            text = text.replace('升级客户端前应用 SQL103。', '升级后端前应用 SQL104。').replace('Apply SQL103 before upgrading clients.', 'Apply SQL104 before starting the updated backend.')
            write(file, text)
    current = ROOT / 'docs/contracts/role-preset-catalog-current.json'
    write(current, (DEV / 'copypaste-platform/catalog/role-preset-catalog.json').read_text(encoding='utf-8'))
    progress_file = ROOT / 'docs/quality/requirements-alignment-progress.json'; progress = read(progress_file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 90, 'checkpoint': 'analysis-roles-checkpoint.json', 'note': en + ' Unchanged client sources retain the precise historical evidence of their earlier stages; this is not a current full-platform regression.'}
    progress['analysis_role_delivery'] = {'stage': 90, 'checkpoint': 'analysis-roles-checkpoint.json', 'core_tests': 68, 'ui_checks': 11, 'roles': cp['roles'],
        'native_codex_exercised_here': True, 'synthetic_model': True, 'full_acceptance': 'not_proven', 'source_files': len(cp['source_files']), 'scope': cp['scope']}
    write(progress_file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    for english in [False, True]:
        file = ROOT / ('docs/changes/2026-10-25-analysis-role-delivery' + ('.en' if english else '') + '.md')
        assert not file.exists()
        file.write_text('# ' + ('Analysis and infographic delivery' if english else '分析与信息图交付') + '\n\n' + (en if english else cn) + '\n\n' +
            ('New company tools discover/inspect authorized CSV/XLSX and captured snapshots, calculate exact scoped evidence, read revision sources and publish nine actual files. The source-fence and immutable-receipt policies also cover retries. No public route or historical contract is removed.\n\n'
             if english else '新增公司工具发现与检查获准 CSV/XLSX 及已捕获快照、计算精确分组证据、读取修改源文件并发布九种实际文件。重试沿用来源检查和不可变回执，不删除既有公开接口与历史契约。\n\n') +
             '[方案 / Implementation](../technical/90-analysis-role-delivery.md) · [验证 / Evidence](../quality/analysis-roles-checkpoint.json)\n', encoding='utf-8')
    visual = ROOT / 'docs/design/implementation/analysis-roles-visual-review.md'
    assert not visual.exists()
    visual.write_text('# 分析报告实际页面复核\n\n已逐一查看阶段 90 的实际英文桌面图表、繁中 375 像素指标卡和实际会话页面。蓝色、浅灰白底及字阶对应现有 Workmate。图表分开呈现 HKD/USD，显示真实精确值；移动宽度不挤压 SVG，而是呈现可读指标卡。聚焦筛选器和修改后的日期/数值均在原始截图与录屏内。\n\n两对 GIF/MP4 共四个文件已完整解码，未编辑页面截图和响应帧。模型与账号数据是明确假数据，不据此认定专业设计质量已完整验收。\n', encoding='utf-8')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint_file), 'changes': changes, 'media_copies': copies, 'original_media_modified': False, 'verifier_sha256': digest(Path(__file__))}
    with output.open('x', encoding='utf-8') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'bilingual_readmes_updated': 8, 'copied_media': len(copies)}))


if __name__ == '__main__': main()
