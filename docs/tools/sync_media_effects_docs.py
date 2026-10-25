"""Publish bilingual usage and current media-effect captures, preserving earlier document bytes."""
from datetime import datetime, timezone
from pathlib import Path
import json
import shutil

from record_folder_work import ROOT, DEV, digest, read, ref


def main():
    output = ROOT / 'docs/quality/media-effects-documentation-refresh.json'
    archive = ROOT / 'docs/quality/history/stage95-current-documents'
    assert not output.exists() and not archive.exists()
    checkpoint = ROOT / 'docs/quality/media-effects-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_media_effects' and cp['ui_checks'] == 8
    review = read(ROOT / 'docs/quality/media-effects-media-review-01.json')
    assert review['status'] == 'passed' and review['checkpoint']['sha256'] == digest(checkpoint)
    archive.mkdir(parents=True)
    changes, copies = [], []

    def write(file, text):
        target = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.snapshot')
        with target.open('xb') as stream: stream.write(file.read_bytes())
        file.write_text(text, encoding='utf-8', newline='\n')
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': target.relative_to(ROOT).as_posix(),
                        'before_sha256': digest(target), 'after_sha256': digest(file)})

    suffixes = ['directory-en.png', 'reviewed-en.png', 'first-delivery.png', 'revision-delivery.png', 'responsive-375.png']
    selected = [row for row in cp['screenshots'] if row['path'].endswith(tuple(suffixes))]
    selected += [item for row in cp['recordings'] for item in row['files']]
    assert len(selected) == 9
    for folder in [ROOT / 'docs/design/implementation'] + [DEV / ('copypaste-' + v) / 'assets/screenshots' for v in ['platform', 'admin', 'delivery']]:
        folder.mkdir(parents=True, exist_ok=True)
        for row in selected:
            original, target = DEV / row['path'], folder / Path(row['path']).name
            assert not target.exists() and digest(original) == row['sha256']
            shutil.copyfile(original, target)
            assert digest(target) == row['sha256']
            copies.append({'source': original.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': row['sha256']})
    count = cp['core_tests']['tests']
    cn = f'阶段 95 接通十种版本化媒体特效：转场、中文动效字、抠像与画面清理。客户审阅固定素材版本、参数和费用上限后，Codex 调用原生 FFmpeg，交付真实无声 MP4、PNG、源 JSON 和 ZIP。{count} 项相关回归与 8 项实际浏览器检查通过；两次原生 Codex、八个私有文件及真实结算完成。模型和账户容量按要求为假数据。'
    en = f'Stage 95 connects ten versioned native effects: transitions, Chinese animated text, chroma key and cleanup. After reviewing exact source versions, parameters and budget, customers approve Codex to invoke native FFmpeg and deliver actual silent MP4, PNG, source JSON and ZIP. All {count} related regression cases and eight real browser checks pass, including two native Codex processes, eight private downloads and real accounting. Model responses and account capacity are explicitly synthetic.'
    diagram = '```mermaid\nflowchart LR\n  A[Login and project] --> B[Approved fixed source versions]\n  B --> C[Choose preset and review parameters and budget]\n  C --> D[Free preflight and immutable approval]\n  D --> E[One task and reservation]\n  E --> F[Codex and bounded native FFmpeg]\n  F --> G[Four actual private files]\n  G --> H[Preview or separately approve revision]\n```\n'
    plan = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/95-reviewed-media-effects.md'
    proof = 'https://github.com/copypasteltd/workmate/blob/docs/docs/quality/media-effects-checkpoint.json'
    name_for = lambda suffix: next(Path(row['path']).name for row in selected if row['path'].endswith(suffix))
    folders = [('docs', ROOT / 'docs')] + [(v, DEV / ('copypaste-' + v)) for v in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]
    for component, folder in folders:
        for name in ['README.md', 'README.en.md']:
            file = folder / name
            text = file.read_text(encoding='utf-8')
            assert '<!-- media-effects-stage95 -->' not in text
            english = name.endswith('.en.md')
            section = '\n<!-- media-effects-stage95 -->\n\n## ' + ('Reviewed native media effects' if english else '经审阅的原生媒体特效') + '\n\n' + (en if english else cn) + '\n\n'
            section += ('1. Sign in, select a project and open Motion studio. Inspect ten actual procedural examples and upload authorized PNG/H.264 MP4 inputs through Assets. Choose fixed source versions and hashes.\n'
                '2. Review output size, duration, text/filter settings and budget, then explicitly consent. Preflight checks actual media, licensed font layout and encoder availability before reserving funds. A lost network acknowledgement can replay the exact saved request and idempotency key after reload.\n'
                '3. Preview and download the actual silent MP4, PNG, immutable source JSON and ZIP. A revision needs a new approval; completed repeats retain original files. Source withdrawal or output quarantine fences access and prevents automatic regeneration. Normal Codex usage is charged; native rendering adds no extra AI call or fee.\n'
                '4. Role video-motion@1.5.0 loads media-effects@1.0.0; formal approval exposes only catalog and render tools. SQL110 freezes inputs and source lineage; SQL111 adds the receipt type. Published old migrations, contracts and Skills keep exact bytes. Admin can publish the effects navigation entry; disabled role/Skill admission is rejected before media inspection or budget holds. Existing asset controls apply.\n\n' if english else
                '1. 登录并选择项目，进入 Motion studio；浏览十种实际示例，在文件中心上传获准的 PNG/H.264 MP4，选择固定素材版本及摘要。\n'
                '2. 审阅尺寸、时长、文字或滤镜参数与预算后主动确认。免费预检查会在预留费用前核验实际媒体、授权字体排版和编码器。网络回执未知时，刷新后按原请求与幂等键重放。\n'
                '3. 预览并下载真实无声 MP4、PNG、不可变源 JSON 和 ZIP。修改需要重新审阅，已完成的重复调用复用原文件；撤回素材或隔离输出会阻断访问和自动重新生成。Codex 按实际记录用量收费，原生特效没有额外 AI 调用和费用。\n'
                '4. video-motion@1.5.0 加载 media-effects@1.0.0，正式审批仅开放目录和渲染工具。SQL110 固定输入与来源，SQL111 扩展回执；旧迁移、契约和 Skill 保留原字节。Admin 可发布特效菜单；角色或 Skill 停用会在素材探测和费用预留前拒绝新任务，既有资产权限适用。\n\n')
            section += diagram + '\n'
            section += ('Desktop remains local Codex with customer-controlled permission; Extension remains a cloud-agent native side panel. These captures show Web effects. The native Desktop disables this cloud-only review form; company effect tools remain versioned. Earlier source-wide qualification retains its original stage; this scoped regression is not a full product or live professional-quality acceptance.\n\n' if english else
                'Desktop 保持本机 Codex 及客户主动权限，Extension 保持云端 Agent 与原生右侧栏。此处素材展示 Web 特效；原生 Desktop 禁用这张云端专用审批表，版本化公司特效工具仍可使用。旧阶段的整套源码核查保留历史范围，本次专项回归不代表完整产品或真实专业质量验收。\n\n')
            section += f'[{"Implementation and usage" if english else "具体方案与使用"}]({plan}) · [{"Exact-source evidence" if english else "精确源码证据"}]({proof})\n\n'
            media = 'design/implementation/' if component == 'docs' else 'assets/screenshots/'
            if component in ['desktop', 'extension']:
                media = 'https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/'
            for suffix, label in [('directory-en.png', 'Actual ten-preset directory / 实际十种特效目录'),
                                  ('first-delivery.png', 'Actual private delivery / 实际私有交付'),
                                  ('effect-review-retry.gif', 'Actual review and original request retry / 实际审阅与原请求重放')]:
                section += f'![{label}]({media}{name_for(suffix)})\n\n'
            section += f'[375px]({media}{name_for("responsive-375.png")}) · [Reviewed input]({media}{name_for("reviewed-en.png")}) · [Review MP4]({media}{name_for("effect-review-retry.mp4")}) · [Actual revision GIF]({media}{name_for("effect-delivery-revision.gif")}) · [Revision MP4]({media}{name_for("effect-delivery-revision.mp4")})\n'
            text = text.replace('## 团队历史与完整翻页', '## 历史实现：团队历史与翻页（阶段 94）').replace('## Team history and complete pagination', '## Earlier team history and pagination (stage 94)')
            first = text.index('\n') + 1
            write(file, text[:first] + section + text[first:])
    file = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = read(file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 95, 'checkpoint': 'media-effects-checkpoint.json',
        'note': en + ' Earlier whole-source and full-platform qualifications retain historical scope.'}
    progress['media_effects'] = {'stage': 95, 'checkpoint': 'media-effects-checkpoint.json',
        'core_tests': count, 'ui_checks': 8, 'native_codex_exercised_here': True,
        'synthetic_model': True, 'scope': cp['scope'], 'full_acceptance': 'not_proven'}
    write(file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    file = ROOT / 'docs/governance/04-git-branches-and-publication.md'
    write(file, file.read_text(encoding='utf-8') + '\n\n## 阶段 95 当前发布 / Current stage 95 publication\n\n'
        '先完成本次精确源码相关模块回归、实际特效交付及原生 Codex 检查、媒体完整解码、双语文档和七仓库暂存核查，再提交各组件。使用 `finalize_media_effects_manifest.py` 绑定实际提交、检查点与证据，提交主文档后在 Delivery 执行 `node scripts/publish-workmate.mjs --push`，核对八个远端 SHA。SQL110/111 增加审阅特效约束与回执；既有用户授权持续有效，禁止强推。\n\n'
        'Stage 95 binds actual committed components with `finalize_media_effects_manifest.py` after current media-effect regression, real browser/native Codex, full media decoding, bilingual documentation and staged review. Commit documentation and run the Delivery publisher to verify all eight remote refs. SQL110/111 add reviewed effects and receipts. Existing ordinary publication authorization persists; no force push. Earlier receipts retain historical scope.\n')
    for english in [False, True]:
        file = ROOT / ('docs/changes/2026-10-26-media-effects' + ('.en' if english else '') + '.md')
        with file.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write('# ' + ('Reviewed native media effects' if english else '经审阅的原生媒体特效') + '\n\n' + (en if english else cn) + '\n\n[Implementation / 方案](../technical/95-reviewed-media-effects.md) · [Evidence / 验证](../quality/media-effects-checkpoint.json)\n')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint),
        'changes': changes, 'media_copies': copies, 'original_media_modified': False, 'verifier_sha256': digest(Path(__file__))}
    with (archive / 'receipt.json').open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps({'files': changes}, ensure_ascii=False, indent=2) + '\n')
    with output.open('x', encoding='utf-8', newline='\n') as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': 'passed', 'bilingual_readmes_updated': 14, 'copied_media': len(copies)}))


if __name__ == '__main__':
    main()
