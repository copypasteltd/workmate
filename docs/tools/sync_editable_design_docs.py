"""Update bilingual usage and copy verified actual design media without altering originals."""
from datetime import datetime, timezone
from pathlib import Path
import json
import shutil
from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref


def main():
    output = ROOT / 'docs/quality/editable-design-documentation-refresh.json'
    archive = ROOT / 'docs/quality/history/stage92-current-documents'
    assert not output.exists() and not archive.exists()
    checkpoint = ROOT / 'docs/quality/editable-design-checkpoint.json'; cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_editable_design' and cp['core_tests']['pass'] == 93 and cp['ui_checks'] == 8
    review = read(ROOT / 'docs/quality/editable-design-media-review-01.json')
    assert review['status'] == 'passed' and review['checkpoint']['sha256'] == digest(checkpoint)
    archive.mkdir(parents=True); changes, copies = [], []

    def write(file, text):
        saved = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.snapshot')
        with saved.open('xb') as stream: stream.write(file.read_bytes())
        file.write_text(text, encoding='utf-8', newline='\n')
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': saved.relative_to(ROOT).as_posix(), 'before_sha256': digest(saved), 'after_sha256': digest(file)})

    selected = [row for row in cp['screenshots'] if row['path'].endswith(('vector-review.png', 'slide-review-2.png', 'review-375.png'))]
    selected += [file for row in cp['recordings'] for file in row['files']]
    assert len(selected) == 7
    for folder in [ROOT / 'docs/design/implementation', DEV / 'copypaste-platform/assets/screenshots', DEV / 'copypaste-desktop/assets/screenshots', DELIVERY / 'assets/screenshots']:
        folder.mkdir(parents=True, exist_ok=True)
        for item in selected:
            original = DEV / item['path']; target = folder / original.name
            assert not target.exists() and digest(original) == item['sha256']
            shutil.copyfile(original, target); assert digest(target) == item['sha256']
            copies.append({'source': original.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': item['sha256']})
    cn = '阶段 92 已接通品牌视觉与演示文稿的真实交付工具。品牌稿提供可编辑及转曲 SVG；演示文稿提供原生可编辑文字、形状、路径及图表条形的 PPTX，并提供逐页 SVG/PNG、PDF/HTML 核对、证据 CSV、固定源稿、清单和含授权字体的 ZIP。93 项相关后端测试与 8 项真实浏览器检查通过；Codex 进程、权限、实际文件和账本均真实运行，模型及示例内容为明确假数据。'
    en = 'Stage 92 connects actual brand-vector and presentation tools. Brand delivery includes editable and outlined SVG. Presentations include PPTX with native editable text, shapes, paths and evidence bars, plus per-page SVG/PNG, PDF/HTML reviews, exact evidence CSV, immutable source, manifest and a ZIP with the licensed font. Ninety-three relevant backend tests and eight actual browser checks pass. Codex, permissions, files and financial receipts are real; model/content are explicitly synthetic.'
    plan = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/92-editable-brand-and-presentation.md'
    evidence = 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/editable-design-checkpoint.json'
    by_tail = lambda suffix: next(Path(row['path']).name for row in selected if row['path'].endswith(suffix))
    diagram = '```mermaid\nflowchart LR\n  A[Customer brief and fixed role] --> B[Authorized source versions]\n  B --> C[Codex and design Skill]\n  C --> D[Structured scene and validated layout]\n  D --> E[Editable SVG or native-object PPTX]\n  E --> F[Private downloads and page review]\n  F --> G[Read source and create immutable revision]\n```\n'
    for folder in [ROOT / 'docs', DEV / 'copypaste-platform', DEV / 'copypaste-web', DEV / 'copypaste-desktop', DELIVERY]:
        for name in ['README.md', 'README.en.md']:
            file = folder / name; text = file.read_text(encoding='utf-8'); english = name.endswith('.en.md')
            assert '<!-- editable-design-stage92 -->' not in text
            media = 'design/implementation/' if folder == ROOT / 'docs' else 'assets/screenshots/'
            section = '\n<!-- editable-design-stage92 -->\n\n## ' + ('Editable brand and presentation delivery' if english else '可编辑品牌稿与演示文稿交付') + '\n\n' + (en if english else cn) + '\n\n'
            section += ('1. Create a brand/presentation specialist from the role directory, confirm the audience, exact copy, sources and brand, then explicitly select Execute and a budget. Ask/Plan cannot generate files.\n'
                        '2. Download actual editable files and the ZIP from Assets & deliverables. Presentations require slides_build followed by slides_render on the exact returned source version/hash; a prepared source is not delivered work.\n'
                        '3. Review all pages in the actual offline HTML or PDF. Request a correction against the saved source. New versions retain old files; retries reuse original tool receipts. Native rendering adds no AI charge.\n'
                        '4. Chart layers select actual deterministic evidence IDs, keeping currency/account/metric/attribution/date scopes separate. A brand-bound specialist must retain its exact brand version and authorized channel/locale; omission or replacement is rejected. Private source permissions and quarantine apply to every derivative.\n\n' if english else
                        '1. 在角色目录建立品牌或演示文稿专业助手，明确受众、原文、素材和品牌，主动选择 Execute 并确认预算。Ask/Plan 不生成文件。\n'
                        '2. 从 Assets & deliverables 下载实际可编辑文件和 ZIP。演示文稿必须先 slides_build，再以返回的实际源版本和散列 slides_render；保存源稿不等于完成交付。\n'
                        '3. 在实际离线 HTML 或 PDF 逐页核对，针对原源稿请求修改。新版本保留旧文件，重复工具请求复用回执，原生渲染不额外调用 AI 或收取 AI 费用。\n'
                        '4. 图表只能选择确定性分析的真实证据 ID，币种、账户、指标、归因和日期分别保留；已绑定品牌的角色必须使用固定版本及获准渠道和语言，遗漏或替换会被拒绝。私有权限与来源隔离约束所有衍生文件。\n\n')
            section += diagram + '\n'
            section += ('Desktop keeps Codex on the customer computer. The 1.1.0 specialists expose these company file tools through the authenticated native bridge; source revision access additionally requires the same device, native sign-in family, local session and workspace. Another local session cannot read its private source. Backend checks exercise actual native authorization, schema admission, tool delivery and source revisions; the new recordings below show the Web workflow and downloaded source-based reviews, not a new Desktop UI recording.\n\n' if english else
                        'Desktop 的 Codex 继续在客户本机运行。1.1.0 专员通过真实原生登录桥接使用这些公司文件工具；读取旧稿还要求同一设备、原生登录授权、会话及工作目录，其他本机会话不能读取该私有源稿。后台核查执行真实原生授权、协议准入、工具交付和源稿修改；下方新增录制展示 Web 流程及下载后的源稿核对，不作为新的 Desktop 界面录制。\n\n')
            section += ('Apply **SQL106** and **SQL107** after SQL001–105 and install the pinned dependencies. The second migration binds private design derivatives to exact sources without changing explicit publication authority. Brand/presentation roles and their production Skills are 1.1.0; the original 37 Skill packages remain byte-identical. The ZIP supplies checked CopyPaste Sans TC Regular/Bold static faces derived from Noto Sans TC under OFL, retaining the original variable font for provenance. Fonts are not embedded in PPTX. **PDF/PNG/HTML are fixed-source reviews, not PowerPoint renders**; inspect actual target-editor typography before publication. Charts are native editable bars/labels with exact CSV, not embedded Excel charts. Current brand-bound editable export requires Noto Sans TC; other licensed custom fonts use the existing brand layout renderer. Professional/customer role qualification remains unverified.\n\n' if english else
                        'SQL001–105 后依次应用 **SQL106**、**SQL107** 并安装固定依赖。后者将私有设计稿绑定至精确来源，保留明确发布操作的原有权限。两类角色及各自制作 Skill 为 1.1.0，保留原有 37 个 Skill 包字节。ZIP 附由 Noto Sans TC 固定来源派生的 CopyPaste Sans TC 常规/粗体静态字体及 OFL 许可，并保留原可变字体字节作为来源，PPTX 不嵌入字体。**PDF/PNG/HTML 是固定源稿核对，不是 PowerPoint 渲染**；发布前在目标编辑器核对实际字体排版。图表是可编辑原生条形和标签，附精确 CSV，不是内嵌 Excel 图表。当前品牌绑定的可编辑导出使用 Noto Sans TC；其他授权自定义字体使用既有品牌排版渲染器。角色专业质量及客户验收仍未证明完成。\n\n')
            section += f'[{"Implementation and use" if english else "方案与使用逻辑"}]({plan}) · [{"Source-bound checks" if english else "源码绑定检查"}]({evidence})\n\n'
            for suffix, label in [('vector-review.png', 'Actual vector review / 实际矢量稿'), ('slide-review-2.png', 'Actual slide review / 实际演示核对'), ('review-375.png', 'Actual 375px review / 实际窄屏核对'), ('editable-design-review.gif', 'Actual navigation and revision / 实际浏览与修改')]:
                section += f'![{label}]({media}{by_tail(suffix)})\n\n'
            section += f'[Work GIF]({media}{by_tail("editable-design-work.gif")}) · [Work MP4]({media}{by_tail("editable-design-work.mp4")}) · [Review MP4]({media}{by_tail("editable-design-review.mp4")})\n'
            text = text.replace('## 私有云端流程交付', '## 历史验证：私有云端流程（阶段 91）').replace('## Private cloud workflow delivery', '## Earlier private cloud workflow verification (stage 91)')
            first = text.index('\n') + 1; write(file, text[:first] + section + text[first:])
    snapshot = ROOT / 'docs/contracts/role-preset-catalog-editable-design-1.1.0.json'
    with snapshot.open('xb') as stream: stream.write((DEV / 'copypaste-platform/catalog/role-preset-catalog.json').read_bytes())
    file = ROOT / 'docs/quality/requirements-alignment-progress.json'; progress = read(file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 92, 'checkpoint': 'editable-design-checkpoint.json', 'note': en + ' Earlier complete platform/client snapshots retain historical scope; this is not a current complete regression.'}
    progress['editable_design_roles'] = {'stage': 92, 'checkpoint': 'editable-design-checkpoint.json', 'core_tests': 93, 'ui_checks': 8, 'roles': cp['roles'], 'native_codex_exercised_here': True, 'synthetic_model': True, 'full_acceptance': 'not_proven', 'scope': cp['scope'], 'source_files': len(cp['source_files'])}
    write(file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    for english in [False, True]:
        file = ROOT / ('docs/changes/2026-10-25-editable-design' + ('.en' if english else '') + '.md')
        with file.open('x', encoding='utf-8') as stream: stream.write('# ' + ('Editable design delivery' if english else '可编辑设计交付') + '\n\n' + (en if english else cn) + '\n\n[Implementation / 方案](../technical/92-editable-brand-and-presentation.md) · [Evidence / 验证](../quality/editable-design-checkpoint.json)\n')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint), 'changes': changes, 'media_copies': copies, 'original_media_modified': False, 'verifier_sha256': digest(Path(__file__))}
    with (archive / 'receipt.json').open('x', encoding='utf-8') as stream: stream.write(json.dumps({'files': changes}, ensure_ascii=False, indent=2) + '\n')
    with output.open('x', encoding='utf-8') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'bilingual_readmes_updated': 10, 'copied_media': len(copies)}))


if __name__ == '__main__': main()
