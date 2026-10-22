"""Update bilingual READMEs and retained media using actual passing receipts."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def main():
    parser = argparse.ArgumentParser()
    for name in ('regression', 'focused', 'clients', 'native', 'media'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--copy-media-only', action='store_true')
    args = parser.parse_args()
    for name in ('regression', 'focused', 'clients', 'native', 'media'):
        assert re.fullmatch(r'\d{2}', getattr(args, name))
    media = read(DELIVERY / f'evidence/workmate-media-{args.media}.json')
    assert media['status'] == 'passed' and len(media['recordings']) == 4 and len(media['screenshots']) == 11
    # Backend/Delivery explicitly attribute the actual client flow they show.
    for target, source in (('platform', 'web'), ('delivery', 'desktop')):
        for source_file in (DEV / ('copypaste-' + source) / 'assets/screenshots').glob(f'workmate-{args.media}-*'):
            output = DEV / ('copypaste-' + target) / 'assets/screenshots' / source_file.name
            if output.exists():
                assert digest(output) == digest(source_file)
            else:
                shutil.copyfile(source_file, output)
    capture_root = ROOT / 'docs/design/implementation/workmate'
    for component in ('platform', 'web', 'admin', 'desktop', 'extension', 'delivery'):
        for source_file in (DEV / ('copypaste-' + component) / 'assets/screenshots').glob(f'workmate-{args.media}-*'):
            output = capture_root / (component + '-' + source_file.name)
            if output.exists():
                assert digest(output) == digest(source_file)
            else:
                shutil.copyfile(source_file, output)
    if args.copy_media_only:
        print('Copied actual media bytes; no future test success claimed')
        return
    full = read(DELIVERY / f'evidence/canonical-task-regression-{args.regression}.json')
    focused = read(DELIVERY / f'evidence/canonical-task-integration-{args.focused}.json')
    clients = read(DELIVERY / f'evidence/paid-input-clients-{args.clients}.json')
    native = read(DELIVERY / f'evidence/paid-input-native-{args.native}.json')
    for report in (full, focused, clients, native):
        assert report['status'] == 'passed' and report['source_unchanged']
    count, target_count = full['counts']['pass'], focused['counts']['pass']
    assert full['counts']['tests'] == count >= 802 and focused['counts']['tests'] == target_count >= 52
    assert len(clients['checks']) == 13 and native['counts'] == {'checks': 32, 'errors': 0}
    zh_summary = f'平台完整 **{count}/{count}**、任务专项 **{target_count}/{target_count}**，六仓库 **13 项**类型/构建/既有客户端测试检查、真实打包程序和原生侧栏旅程 **32 项**通过。保留原 782 项命名回归测试。任务专项调用实际 PostgreSQL、身份、账本与 Worker；另有实际 Codex 子进程连接模拟内部网关的续接验证。UI 回合及业务数据按授权模拟。原 102 项需求仍为 81 项局部验证、21 项未证明完成、0 项完整验收。'
    en_summary = f'**{count}/{count}** full Platform tests and **{target_count}/{target_count}** focused task tests pass, with **13 checks** across six repositories and **32** actual packaged Desktop/native Side Panel checks. All prior 782 named regression cases remain. Task checks exercise actual PostgreSQL, identity, ledger and Worker; separate real Codex child processes use a synthetic internal gateway. UI turns/business data are synthetic as authorized. The original 102 requirements remain: 81 partially verified, 21 without proven completion and zero fully accepted.'
    doc_url = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/68-canonical-task-contracts-and-input-transactions.md'
    zh_note = f'本次同步补充统一任务接口和原任务输入事务。当前用户界面继续通过既有项目/会话接口使用同一执行域；下方重新录制的实际交互验证该流程的兼容性，并非声称界面已经切换到全部规范任务接口。接口边界、精确金额、幂等回执、来源撤销和未接入业务参数见 [方案细则]({doc_url})。'
    en_note = f'This revision adds canonical task APIs and atomic original-task inputs. Current UIs continue to use their existing project/conversation interfaces over the same execution domain. The refreshed actual recordings verify compatibility; they do not claim migration of every UI to canonical task APIs. See [the implementation and limits]({doc_url}) for exact money, idempotency, source revocation and unsupported business parameters.'
    backend_zh = '''## 统一任务 API 使用顺序

1. 登录并选择企业和项目，安装一个实际专家，取得 agent_id；Web 写请求使用当前 Cookie 和 CSRF，原生请求使用当前 PKCE 凭证。
2. 发送 POST /v1/tasks，携带 X-Tenant-ID 和独立 Idempotency-Key。budget 为 `{"currency":"HKD","amount_micros":"1000000"}`，表示 HKD 1；请求另含 project_id、agent_id、`type:"delegation"` 和 `input:{"prompt":"具体工作要求"}`。
3. 202 返回 task_id、status、version 和 Location。轮询 Location 得到白名单 Task，或订阅原持久 SSE；交付物从原资产接口读取。
4. 控制请求使用最新 expected_version 和独立请求键，action 为 cancel 或当前可用检查点的 pause / resume。请求重放返回当前资源，不复活旧状态。
5. needs_input 时读取 pending_input_fields，按任务依赖的候选资源选择版本；POST inputs 的 answers 为 `{"input-1":{"resource_ids":["实际版本 UUID"]}}`。整批验证通过后才修改状态，继续保留原任务、原线程及原预算。

专用创作/分析/SEO/流程/设备参数与 retry 尚未在此统一创建/控制入口全面接入，明确报错；使用已有专用业务入口。未保留专家身份的历史任务使用原项目接口，不补造执行身份。运行中的暂停和未知动作核对恢复仍待实现。

'''
    backend_en = '''## Canonical task API usage

1. Sign in, select a tenant/project and install an actual specialist to obtain agent_id. Web writes require the current Cookie and CSRF; native requests use PKCE credentials.
2. POST /v1/tasks with X-Tenant-ID and a distinct Idempotency-Key. Include project_id, agent_id, `type:"delegation"`, `input:{"prompt":"The actual request"}` and `budget:{"currency":"HKD","amount_micros":"1000000"}` for HKD 1.
3. The 202 acceptance contains task_id, status, version and Location. Read Location for a whitelisted Task or subscribe to persistent SSE. Retrieve deliverables through the existing asset APIs.
4. Controls require the latest expected_version and a distinct key. Use cancel or pause/resume at a currently supported checkpoint. A replay returns the current resource without reviving an obsolete state.
5. For needs_input, read pending_input_fields and explicitly select authorized dependency resources. POST inputs with answers such as `{"input-1":{"resource_ids":["actual version UUID"]}}`. The whole batch validates before mutation; task, thread and original budget remain bound.

Dedicated creative, analytics, SEO, workflow/device context and retry are not fully wired through these unified entry points and fail explicitly. Use their existing dedicated workflows. Historical tasks without retained specialist identity use their original project route. Arbitrary in-flight pause and reconciled unknown-operation recovery remain open.

'''
    for component in ('platform', 'web', 'admin', 'desktop', 'extension', 'delivery'):
        repo = DEV / ('copypaste-' + component)
        for language in ('zh', 'en'):
            path = repo / ('README.md' if language == 'zh' else 'README.en.md')
            text = path.read_text(encoding='utf-8')
            assert '## Canonical task API usage' not in text and '## 统一任务 API 使用顺序' not in text
            # Existing sections are retained; only the dated evidence paragraph is replaced.
            lines = text.splitlines()
            indexes = [i for i, line in enumerate(lines) if line.startswith('平台完整 **') or re.match(r'^\*\*782/782\*\* Platform', line)]
            assert len(indexes) == 1, (component, language)
            lines[indexes[0]] = zh_summary if language == 'zh' else en_summary
            text = '\n'.join(lines) + '\n'
            text = text.replace('workmate-06-', 'workmate-' + args.media + '-').replace('workmate-media-06.json', 'workmate-media-' + args.media + '.json')
            heading = '## 实际页面与交互' if language == 'zh' else '## Actual screens and interactions'
            text = text.replace(heading, (zh_note if language == 'zh' else en_note) + '\n\n' + heading)
            if component == 'platform':
                before = '## 初次检出与环境' if language == 'zh' else '## Checkout and prerequisites'
                text = text.replace(before, (backend_zh if language == 'zh' else backend_en) + before)
            if component == 'delivery':
                text += ('\n任务接口验证 / Canonical task verification:\n\n' if language == 'zh' else '\nCanonical task verification:\n\n') + '```powershell\nnode scripts/run-canonical-task-checks.mjs NN\nnode scripts/run-canonical-task-checks.mjs NN --full\n```\n\n'
                text += ('每次使用尚未存在的两位编号；保留原始失败，原生数据库及隔离资源均实际关闭后才通过。\n' if language == 'zh' else 'Use a new two-digit attempt ID every time. Retain failures; successful reports require actual native database shutdown and owned-fixture cleanup.\n')
            path.write_text(text, encoding='utf-8', newline='\n')
    print(json.dumps({'readmes': 12, 'full_tests': count, 'focused_tests': target_count, 'media': args.media}))

if __name__ == '__main__':
    main()
