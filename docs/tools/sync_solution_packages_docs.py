"""Update independent bilingual delivery with current method evidence and preserve prior bytes."""
from datetime import datetime, timezone
from pathlib import Path
import json
import shutil

from record_folder_work import ROOT, DEV, digest, read, ref


def main():
    output = ROOT / 'docs/quality/solution-packages-documentation-refresh.json'
    archive = ROOT / 'docs/quality/history/stage96-current-documents'
    assert not output.exists() and not archive.exists()
    checkpoint = ROOT / 'docs/quality/solution-packages-checkpoint.json'
    cp = read(checkpoint)
    assert cp['status'] == 'verified_scoped_solution_packages'
    review = read(ROOT / 'docs/quality/solution-packages-media-review-01.json')
    assert review['status'] == 'passed' and review['checkpoint']['sha256'] == digest(checkpoint)
    archive.mkdir(parents=True)
    changes, copies = [], []

    def write(file, text):
        target = archive / (file.relative_to(ROOT).as_posix().replace('/', '__') + '.snapshot')
        with target.open('xb') as stream:
            stream.write(file.read_bytes())
        file.write_text(text, encoding='utf-8', newline='\n')
        changes.append({'path': file.relative_to(ROOT).as_posix(), 'archive': target.relative_to(ROOT).as_posix(),
                        'before_sha256': digest(target), 'after_sha256': digest(file)})

    media = cp['screenshots'] + [v for r in cp['recordings'] for v in r['files']]
    suffixes = ['preview-en.png', 'published-en.png', 'installed-missing.png', 'responsive-375.png',
                'admin-metadata.png', 'admin-body-audited.png', 'method-review-and-publish.gif',
                'method-review-and-publish.mp4', 'copy-rebind-and-trial.gif', 'copy-rebind-and-trial.mp4']
    chosen = [next(v for v in media if v['path'].endswith(suffix)) for suffix in suffixes]
    name = lambda suffix: next(Path(v['path']).name for v in chosen if v['path'].endswith(suffix))
    folders = [('docs', ROOT / 'docs')] + [(v, DEV / ('copypaste-' + v)) for v in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]
    cn = f"阶段 96 补齐业务方案的不可变版本、免费依赖预览、私有付费试运行、逐项验收、发布和跨项目安装重绑定。{cp['core_tests']['tests']} 项相关集成检查、45 项 Desktop 单元检查、2 项真实本机 Codex 检查及 8 项实际浏览器检查通过。模型与账号数据按当前要求使用假数据；文件、进程、授权、费用和审计走实际流程。"
    en = f"Stage 96 implements immutable business-method versions, free dependency previews, private paid trials, exact-delivery acceptance, publication and fresh cross-project rebinding. {cp['core_tests']['tests']} related integration checks, 45 Desktop unit checks, two actual local Codex checks and eight actual browser checks pass. Model/account data remain explicitly synthetic; files, processes, authorization, accounting and audit execute normally."
    steps_cn = ('1. 登录并选择项目，打开业务方案。创建可分享的方法说明，选择预设角色、资料标签和报表连接。保存会固定模板、角色、Codex profile 和 Skill 版本，新版本须重新试运行及验收。\n'
        '2. 选择当前项目获准的固定文件和报表账号，免费预览资料缺口、快照、来源摘要与工作额度。明确确认本次私有简报和总预算后，整批建立各角色独立任务；并发额度不足会整批拒绝。\n'
        '3. 检查每项实际交付再验收和发布。浏览文件或快照目录不能充当内容读取；必需版本及摘要须有独立的实际读取凭证。未完成任务、旧交付摘要、无关试运行或失效账号不能发布。结果未知时刷新并重试原提交，保留同一正文和幂等键。\n'
        '4. 安装仅复制已发布方法参照；原客户文件、私人简报、结果、记忆、连接账号和密钥都不自动复制。为目标项目上传自己的资料并按修订保存绑定，再单独确认付费使用。\n'
        '5. Admin 的元数据、正文读取和停用分别检查范围与权限；正文访问记审计，停用需要近期 MFA 及原因。停用方法、撤回原资料或撤销账号会阻断依赖内容。\n')
    steps_en = ('1. Sign in, select a project and open Business methods. Save reusable instructions, preset roles, input labels and reporting requirements. This pins template, role, Codex profile and Skill versions; revisions require new trials and acceptance.\n'
        '2. Select currently approved fixed files and reporting accounts. Preview missing requirements, snapshots, source hashes and task capacity free. Explicitly approve a private brief and total budget; each role gets an independent task in one atomic batch. Insufficient capacity rejects the complete batch.\n'
        '3. Inspect every actual delivery before acceptance and publication. Browsing file or snapshot metadata cannot qualify required content; exact versions and hashes need separate actual content-read facts. Incomplete or unrelated trials, stale delivery hashes and revoked accounts cannot qualify a version. Unknown responses retain the same body and idempotency key across reload.\n'
        '4. Installation copies a published method reference only. Source customer files, private briefs, results, memories, accounts and keys are not automatically copied. Upload target-project inputs, save revision-safe bindings and separately approve paid reuse.\n'
        '5. Admin metadata, body reads and disablement use separate scoped permissions. Body access is audited; disablement requires recent MFA and a reason. Withdrawn methods, inputs and account authority fence dependent content.\n')
    diagram = '```mermaid\nflowchart LR\n A[Login and current project] --> B[Pinned method and role versions]\n B --> C[Fresh inputs and free preview]\n C --> D[Approve private brief and total budget]\n D --> E[Actual Codex tasks and measured usage]\n E --> F[Accept exact deliveries then publish]\n F --> G[Install reference in target project]\n G --> C\n```\n'
    for component, folder in folders:
        for item in chosen:
            src, target = DEV / item['path'], folder / 'assets/screenshots' / Path(item['path']).name
            target.parent.mkdir(parents=True, exist_ok=True)
            if src.resolve() != target.resolve():
                assert not target.exists()
                shutil.copyfile(src, target)
                copies.append({'source': src.relative_to(ROOT).as_posix(), 'target': target.relative_to(ROOT).as_posix(), 'sha256': digest(target)})
        for filename in ['README.md', 'README.en.md']:
            file, english = folder / filename, filename.endswith('.en.md')
            text = file.read_text(encoding='utf-8')
            assert '<!-- solution-packages-stage96 -->' not in text
            section = '\n<!-- solution-packages-stage96 -->\n\n## ' + ('Versioned business methods' if english else '可试运行和复制的业务方案') + '\n\n' + (en if english else cn) + '\n\n' + (steps_en if english else steps_cn) + '\n' + diagram + '\n'
            section += ('Desktop keeps local Codex with explicit local folder, permission and budget approval. Its generic bridge rejects cloud method-trial admission; exact installed methods are read-only company tools available only to compatible pinned native roles. The cloud default assistant is not a local role. Extension keeps a cloud agent, approved attachment upload and a native right side panel. These new captures show actual Web/Admin; new packaged Desktop method-library visuals are not qualified here. Earlier Desktop screenshots keep their historical scope.\n\n' if english else
                'Desktop 保持本机 Codex，仍需客户确认本机目录、权限和预算；通用桥接拒绝创建云端方案试运行。已安装方法通过只读公司工具提供给相容的固定本机角色，默认云端助手不是本机角色。Extension 保持云端 Agent、获准附件上传与原生右侧栏。本次新截图来自实际 Web/Admin；尚未以安装包验收新的 Desktop 方案库视觉，旧 Desktop 截图保留历史范围。\n\n')
            section += '[方案与使用 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/technical/96-versioned-business-solutions.md) · [Exact-source evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/solution-packages-checkpoint.json)\n\n'
            for suffix, label in [('preview-en.png', 'Actual Web source and dependency preview / 实际 Web 资料预览'), ('admin-metadata.png', 'Actual scoped Admin method control / 实际 Admin 方案管理'), ('method-review-and-publish.gif', 'Actual review, original request retry and acceptance / 实际审阅、原提交重试和验收')]:
                section += f'![{label}](assets/screenshots/{name(suffix)})\n\n'
            section += ' · '.join(f'[{label}](assets/screenshots/{name(suffix)})' for suffix, label in [('responsive-375.png','375px'),('published-en.png','Published method'),('installed-missing.png','Fresh target requirements'),('admin-body-audited.png','Audited body read'),('method-review-and-publish.mp4','Review MP4'),('copy-rebind-and-trial.gif','Copy & rebind GIF'),('copy-rebind-and-trial.mp4','Copy & rebind MP4')]) + '\n'
            text = text.replace('## 经审阅的原生媒体特效', '## 历史实现：原生媒体特效（阶段 95）').replace('## Reviewed native media effects','## Earlier reviewed native media effects (stage 95)')
            first = text.index('\n') + 1
            write(file, text[:first] + section + text[first:])
    file = ROOT / 'docs/quality/requirements-alignment-progress.json'
    progress = read(file)
    progress['at'] = datetime.now(timezone.utc).isoformat()
    progress['current_source_qualification'] = {'stage': 96, 'checkpoint': 'solution-packages-checkpoint.json', 'note': en + ' Earlier whole-product snapshots retain their historical scope.'}
    progress['solution_packages'] = {'stage': 96, 'checkpoint': 'solution-packages-checkpoint.json', 'core_tests': cp['core_tests']['tests'], 'ui_checks': 8, 'desktop_unit_tests': 45, 'native_tests': 2, 'full_acceptance': 'not_proven', 'synthetic_model': True}
    write(file, json.dumps(progress, ensure_ascii=False, indent=2) + '\n')
    for path in ['docs/requirements/01-srs.md','docs/modules/02-agents-tasks-memory.md','docs/quality/01-test-and-acceptance-plan.md','docs/governance/04-git-branches-and-publication.md']:
        file = ROOT / path
        link = '../technical/96-versioned-business-solutions.md'
        addition = '\n\n## 阶段 96 方案实现补充 / Stage 96 method implementation\n\n' + cn + '\n\n' + en + '\n\n[方案及约束 / Implementation](' + link + ') · [专项证据 / Scoped evidence](../quality/solution-packages-checkpoint.json)\n\nSQL112 新增严格版本、实际试运行与来源控制，既有 OpenAPI、迁移、Skill 及原始需求、验收用例和 G01–G10 判定保持历史依据。发布使用 `finalize_solution_packages_manifest.py` 绑定各仓库实际提交，再运行现有 Delivery 发布器，普通推送并核对八个远端引用；既有授权持续有效。\n'
        old_text = file.read_text(encoding='utf-8')
        split = old_text.index('\n') + 1
        history_note = '\n以下保留原始规格与此前阶段的实现记录；最新源码范围以上方阶段 96 补充及检查点为准。原始完整验收判定未因本次增量改变。\n\nOriginal specifications and earlier implementation records follow. The stage 96 supplement and checkpoint above define this increment; original complete acceptance is unchanged.\n'
        write(file, old_text[:split] + addition + history_note + old_text[split:])
    for english in [False, True]:
        file = ROOT / ('docs/changes/2026-10-26-solution-packages' + ('.en' if english else '') + '.md')
        with file.open('x', encoding='utf-8', newline='\n') as stream:
            stream.write('# ' + ('Versioned business methods' if english else '可试运行和复制的业务方案') + '\n\n' + (en if english else cn) + '\n\n' + (steps_en if english else steps_cn) + '\n[Implementation / 方案](../technical/96-versioned-business-solutions.md) · [Evidence / 验证](../quality/solution-packages-checkpoint.json)\n')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'checkpoint': ref(checkpoint), 'changes': changes, 'media_copies': copies, 'original_media_modified': False, 'verifier_sha256': digest(Path(__file__))}
    (archive / 'receipt.json').write_text(json.dumps({'files':changes}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status':'passed','bilingual_readmes_updated':14,'changes':len(changes),'copied_media':len(copies)}))


if __name__ == '__main__':
    main()
