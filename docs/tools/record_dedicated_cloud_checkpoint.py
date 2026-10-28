"""Record the bounded current delivery and replace chronological README front pages."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import contextlib
import io
import json
import re

import archive_dedicated_cloud_evidence_v3 as evidence
from audit_workmate_publication import readme_target_file

ROOT = evidence.ROOT
DEV = evidence.DEV
Q = ROOT / 'docs/quality'
CP = Q / 'dedicated-cloud-checkpoint.json'
SCOPE = ('Optional dedicated cloud resource control plane, private lease-bound Codex tools, '
         'customer-local frameless Desktop boundary, native Chrome Side Panel explicit private uploads, '
         'versioned administrator infrastructure control, exact original-payer settlement and recovery fencing. '
         'Actual native Windows PostgreSQL/Codex/Chromium/Electron; explicit synthetic provider and node responses. '
         'Actual physical Linux operation, live provider quality and full original product acceptance remain unproven.')


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def ref(file):
    return {'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)}


def save(file, body):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open('xb') as stream:
        stream.write(body)


def json_save(file, value):
    save(file, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))


def archived_bytes(index, original):
    item = index['entries'][original]
    file = ROOT / item['blob']
    body = file.read_bytes()
    assert sha256(body).hexdigest() == item['sha256'] and len(body) == item['bytes']
    return body


def archived(index, original):
    return json.loads(archived_bytes(index, original).decode('utf-8-sig'))


def delivered_backend(index, bindings):
    original = 'copypaste-delivery/.data/dedicated-delivered-121/backend-01.json'
    value = archived(index, original)
    assert value['status'] == 'passed' and value['source_unchanged']
    assert value['owned_database_shutdown'] and value['owned_database_port_closed'] and value['test_exit'] == 0
    assert value['test_files'] == ['tests/dedicated-cloud.test.ts']
    raw = archived_bytes(index, 'copypaste-delivery/' + value['raw_report']['path'])
    assert sha256(raw).hexdigest() == value['raw_report']['sha256']
    counts = evidence.parse_tap(raw.decode('utf-8-sig'), original)
    assert counts == value['counts'] == {'tests': 24, 'pass': 24, 'fail': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    markers = re.findall(r'^# owned_fixture_cleanup (.+)\r?$', raw.decode('utf-8-sig'), re.M)
    assert len(markers) == 1
    marker = json.loads(markers[0])
    assert marker['exit_code'] == value['fixture_cleanup']['exit_code'] == 0
    assert marker['sha256'] == value['fixture_cleanup']['sha256']
    cleanup_body = archived_bytes(index, 'copypaste-delivery/' + value['fixture_cleanup']['path'])
    assert sha256(cleanup_body).hexdigest() == marker['sha256']
    cleanup = json.loads(cleanup_body)
    assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(row['reclaimed'] for row in cleanup['results'])
    verifier = archived_bytes(index, original.removesuffix('.json') + '-verifier.mjs')
    assert sha256(verifier).hexdigest() == value['verifier_sha256']
    for name, expected in value['source_files'].items():
        assert name.startswith('copypaste-platform/')
        canonical = 'dev/' + name
        assert canonical not in bindings or bindings[canonical] == expected, canonical
        snapshot = original.removesuffix('.json') + '-sources/' + name
        assert sha256(archived_bytes(index, snapshot)).hexdigest() == expected
        assert digest(ROOT / canonical) == expected
        bindings[canonical] = expected
    return original


def overview(english, counts, media, source_count):
    title = '# Workmate · CopyPaste Enterprise Agent\n\n'
    intro = ("Workmate gives businesses in Hong Kong a company-hosted Codex agent through a Web workspace, a native Chrome right Side Panel and a customer-local Desktop application. AI requests use the company OpenAI-compatible gateway. Brand styling follows CopyPaste’s existing website.\n\n"
             if english else
             "Workmate 面向在港企业，提供 Web 云端工作台、Chrome 原生右侧栏和客户本机 Desktop 三种入口。Agent 内核统一为 Codex，所有 AI 请求经公司 OpenAI 兼容网关；视觉规范沿用 CopyPaste 现有网站的风格与色系。\n\n")
    links = ('[中文](README.md) · [English](README.en.md) · [CopyPaste](https://copypaste.hk/)\n\n')
    common = '''| Component / 组件 | Execution and use / 执行与使用 | Source and bilingual guide / 源码与双语说明 |
|---|---|---|
| Backend / 后端 | Identity, company gateway, cloud Codex, private files, tasks, billing and authority / 身份、云端执行、文件、费用和权限 | [backend](https://github.com/copypasteltd/workmate/blob/backend/README.md) · [English](https://github.com/copypasteltd/workmate/blob/backend/README.en.md) |
| Web | Hosted workspace; roles, projects, conversations, deliverables and optional resources / 云端工作台、角色、项目、对话与成果 | [web](https://github.com/copypasteltd/workmate/blob/web/README.md) · [English](https://github.com/copypasteltd/workmate/blob/web/README.en.md) |
| Admin | Separate MFA identity; scoped customer, content, credit, VIP and infrastructure administration / 独立 MFA 与用户、内容、费用、VIP、资源管理 | [admin](https://github.com/copypasteltd/workmate/blob/admin/README.md) · [English](https://github.com/copypasteltd/workmate/blob/admin/README.en.md) |
| Desktop | Local Codex and revocable local authority; frameless native window / 本机 Codex、可撤销本机权限与无边框窗口 | [desktop](https://github.com/copypasteltd/workmate/blob/desktop/README.md) · [English](https://github.com/copypasteltd/workmate/blob/desktop/README.en.md) |
| Extension | Native right Side Panel; review and confirm private uploads before cloud execution / 原生右侧栏、文件审核确认后交云端执行 | [extension](https://github.com/copypasteltd/workmate/blob/extension/README.md) · [English](https://github.com/copypasteltd/workmate/blob/extension/README.en.md) |
| Delivery / 交付 | Native qualification, recovery, release tooling and physical-node source / 原生验收、恢复、发布工具与物理节点源码 | [delivery](https://github.com/copypasteltd/workmate/blob/delivery/README.md) · [English](https://github.com/copypasteltd/workmate/blob/delivery/README.en.md) |

```mermaid
flowchart TD
  Visit[Customer visits Web or opens client] --> Identity[OTP identity and workspace authority]
  Identity --> Role[Choose a pinned professional skill preset]
  Role --> Web[Web: cloud Codex]
  Role --> Extension[Extension: review and confirm private file upload]
  Extension --> Web
  Role --> Desktop[Desktop: customer-local Codex and local consent]
  Web --> Gateway[Company OpenAI-compatible AI gateway]
  Desktop --> Gateway
  Gateway --> Result[Bounded usage, private deliverables and audit]
  Admin[Independent MFA administrator] --> Control[Scoped users, content, credit and VIP control]
  Control --> Identity
```

'''
    if english:
        details = ("The priority workflows are marketing images, video, effects and typography; Google Ads, GA4, SEO/GEO and Meta analysis; and repeatable internal workflows. The catalog contains 18 professional definitions from software development to design, with pinned skill versions, model/tool permissions, budgets and output contracts. A definition is not a completed professional qualification.\n\n"
                   "A customer signs in, creates or joins a company and project, chooses a role and supplies an instruction and approved sources. The server checks identity, current access, limits and funds before creating work. Progress, approvals, private deliverables and consumption remain attached to the same task. Exact request identities protect response-loss retries. Cancellation, revocation and erasure are enforced again at execution and result-access boundaries.\n\n"
                   "Desktop executes Codex on the customer’s machine. The customer can grant and revoke full local authority; the frameless renderer has custom window controls and no native Electron menu. The extension uses Chrome’s native right Side Panel, separately confirms selected uploads and separately submits the message. Optional dedicated cloud computers require an expiring, fixed-duration resource quote and explicit scope/cost confirmation; Codex control and its AI budget require separate consent.\n\n"
                   "Administrators use separate MFA authentication and scoped, deny-aware permissions. Users, usage, credits, VIP grants, roles, content, plans and resources have independent controls. Sensitive changes require reasons, current versions, idempotency and audit. Admin resource metadata does not expose private customer pixels or file contents. Uncertain usage or physical cleanup retains the original funding reservation until supported reconciliation.\n\n")
        status = (f"Current bounded qualification: {counts['pass']} backend tests in 112 complete files, 338 integrated client checks, 24 actual UI checks, {len(media['screenshots'])} PNGs and {len(media['movies'])} GIF/MP4 pairs; {source_count} source bindings were rehashed. Provider decisions and physical-node protocol responses are explicit fixtures. No actual Linux host or live provider quality is claimed. All 102 original requirement records still need full acceptance; the earlier numbered audit is retained as a dated snapshot.\n\n")
    else:
        details = ("优先业务是 marketing 生图、视频、特效与字体，Google Ads／GA4／SEO／GEO／Meta 数据分析，以及企业内部重复流程优化。目录提供 18 个专业角色定义，覆盖软件开发至完整设计流程；各角色约束精确 Skill 版本、模型／工具、费用和成果格式。角色定义数量不代表已完成专业效果验收。\n\n"
                   "客户从登录开始，创建或加入企业和专案，选择角色、填写指令并提供获准资料。服务端检查身份、当前权限、额度和资金后创建任务。进度、审批、私有成果和消耗关联同一任务；响应丢失后沿用原请求身份。撤销权限、取消任务及删除资料均在实际执行、工具读取和成果访问时再次检查。\n\n"
                   "Desktop 的 Codex 在客户本机执行，客户可主动授予并撤销完整本机权限；无边框窗口采用自定义窗口控制，不显示 Electron 自带菜单。Extension 使用 Chrome 原生右侧栏，上传文件与发送对话分别确认。可选专属云端电脑采用有期限的固定时长报价，资源范围／费用须明确确认；允许 Codex 操作及 AI 费用上限另行确认。\n\n"
                   "管理员采用独立 MFA 登录、范围权限与显式拒绝。用户、消耗、费用赠送、VIP 授权、角色、内容、方案和资源分别控制。敏感变更要求操作理由、当前版本、幂等身份和审计；资源管理列表不泄露客户私有画面与文件内容。运行消耗或物理清理尚未确认时，保留原付款来源的资金预留，不伪造零消耗或清理完成。\n\n")
        status = (f"当前限定验证：112 个完整后端文件共 {counts['pass']} 项测试通过，整合后客户端 338 项、实际 UI 24 项通过；{len(media['screenshots'])} 张 PNG、{len(media['movies'])} 组 GIF／MP4，以及 {source_count} 个重新核对的源码绑定。模型决策和物理节点协议响应使用明确假数据，未声称真实 Linux 节点或正式供应商质量已验收。原始 102 项需求仍保留完整验收待办；此前编号检查表作为带日期的快照保留。\n\n")
    navigation = '''[Current technical design / 当前技术方案](technical/121-dedicated-cloud-and-client-execution.md) · [Current qualification / 当前限定验收](quality/dedicated-cloud-checkpoint.json) · [Raw evidence index / 原始证据](quality/dedicated-cloud-evidence-121/index.json)

[All numbered open requirements / 全部编号待办快照](quality/remaining-work-2026-10-29.md) · [Structured requirements / 结构化清单](quality/remaining-work-2026-10-29.json) · [This change / 本轮更新](changes/121-dedicated-cloud-delivery.md)

[Client execution contract / 客户端执行约束](requirements/03-client-execution-amendment.md) · [Workspace rules / 工作区规则](governance/03-workspace-and-path-policy.md) · [Git publication rules / 分支发布规则](governance/04-git-branches-and-publication.md)

[Resource OpenAPI / 资源接口](contracts/dedicated-cloud.openapi.json) · [Route additions / 路由增量](contracts/dedicated-cloud-route-additions.json) · [Previous published checkpoint / 上一版验收](quality/integrated-recovery-checkpoint.json)

All development uses `D:\\dev\\copypasted\\自有agent\\dev\\`; central documents use `D:\\dev\\copypasted\\自有agent\\docs\\`. Each component is an independent Git repository. Docker, WSL and virtualization are prohibited. Native verification closes only browsers, pages, services and database processes it owns. Local `.env` values, credentials, dependency folders and generated installers are excluded from Git.

实际开发位于上述唯一 D 盘路径；各端独立仓库，中央文档统一位于 `docs/`。禁止 Docker、WSL 与虚拟化。原生验证只关闭自身创建的浏览器、页面、服务和数据库进程。密钥、`.env`、依赖目录与生成的安装程序不提交到 Git。

Run each component using its own bilingual guide. Use the backend demo configuration for local fake-data development, then connect Web/Admin and pair the native clients through their documented OTP/PKCE flow. Native node installation is operator-managed and requires an actual qualified physical Linux host; the supplied source and protocol tests do not establish that host’s readiness.

请按各端 README 的安装／启动说明运行：后端使用 demo 配置与假数据，Web／Admin 连接该服务；原生客户端通过各自文档中的 OTP／PKCE 接入。物理节点安装由运营人员管理，需要另行验证真实 Linux 主机，源码和协议测试本身不代表该主机已可交付。
'''
    gallery = ''
    for suffix, label in [('session-en.png', 'Web resource session / Web 资源会话'),
                          ('plan-editor-en.png', 'Admin versioned plan / 后台版本方案'),
                          ('layout-800-en.png', 'Customer-local Desktop / 客户本机 Desktop'),
                          ('review-zh.png', 'Native Chrome Side Panel / 原生 Chrome 右侧栏')]:
        matches = [item for item in media['screenshots'] if item['path'].endswith(suffix)]
        assert len(matches) == 1, (suffix, len(matches))
        name = Path(matches[0]['path'])
        branch = name.parts[0].removeprefix('copypaste-').removesuffix('-cloud-121')
        url = 'https://github.com/copypasteltd/workmate/blob/' + branch + '/' + Path(*name.parts[1:]).as_posix()
        gallery += f'![{label}]({url}?raw=true)\n\n'
    shown = set()
    for movie in media['movies']:
        gif = next(item for item in movie['files'] if item['path'].endswith('.gif'))
        mp4 = next(item for item in movie['files'] if item['path'].endswith('.mp4'))
        name = Path(gif['path'])
        branch = name.parts[0].removeprefix('copypaste-').removesuffix('-cloud-121')
        if branch not in ['desktop', 'web', 'extension'] or branch in shown:
            continue
        shown.add(branch)
        base = 'https://github.com/copypasteltd/workmate/blob/' + branch + '/'
        gallery += f'![Actual {branch} interaction / 实际交互]({base}{Path(*name.parts[1:]).as_posix()}?raw=true)\n\n'
        gallery += f'[MP4 · {branch}]({base}{Path(*Path(mp4["path"]).parts[1:]).as_posix()}?raw=true)\n\n'
    assert shown == {'desktop', 'web', 'extension'}
    reliability = ("An earlier native Codex initialization exceeded the unchanged 60-second RPC deadline. Three fresh initialization/thread-start diagnostics passed, but the original cause remains unproven. The failed run and cleanup evidence remain available; a successful later run does not establish production startup reliability.\n\n"
                   if english else
                   "此前一次原生 Codex 初始化超过既定 60 秒 RPC 上限；三个独立新目录的初始化／线程建立诊断通过，但原超时根因尚未确定。失败执行及清理证据原样保留，后续通过不能代替生产启动稳定性验收。\n\n")
    return title + links + intro + common + details + status + reliability + gallery + navigation


def main():
    assert not CP.exists(), 'Use a new checkpoint instead of replacing an executed record'
    with contextlib.redirect_stdout(io.StringIO()):
        evidence.verify(True)
    index = read(evidence.INDEX)
    reports = {key: archived(index, original) for key, original in index['selected'].items()}
    backend = reports['backend']
    assert len(backend['test_files']) == 112
    native_failure = 'copypaste-delivery-cloud-121/.data/dedicated-cloud-121/full-05-runs/files/seo-change-tasks--01.json'
    failure = archived(index, native_failure)
    assert failure['status'] == 'failed' and failure['exit_code'] == 1
    assert failure['counts'] == {'tests': 18, 'pass': 17, 'fail': 1, 'cancelled': 0, 'skipped': 0, 'todo': 0}
    failed_tap = archived_bytes(index, 'copypaste-delivery-cloud-121/' + failure['raw_report']['path'])
    assert sha256(failed_tap).hexdigest() == failure['raw_report']['sha256']
    failed_text = failed_tap.decode('utf-8-sig')
    assert 'not ok 18 - ' in failed_text and 'CODEX_RPC_TIMEOUT' in failed_text
    for counter, count in failure['counts'].items():
        assert re.findall(r'^# ' + counter + r' (\d+)\r?$', failed_text, re.M) == [str(count)]
    failed_cleanup = native_failure.removesuffix('.json') + '-failed-cleanup-preserved.json'
    cleanup_bytes = archived_bytes(index, failed_cleanup)
    cleanup_markers = re.findall(r'^# owned_fixture_cleanup (.+)\r?$', failed_text, re.M)
    assert len(cleanup_markers) == 1
    cleanup_marker = json.loads(cleanup_markers[0])
    assert cleanup_marker['exit_code'] == 0 and cleanup_marker['sha256'] == sha256(cleanup_bytes).hexdigest()
    cleanup = json.loads(cleanup_bytes)
    assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(row['reclaimed'] for row in cleanup['results'])
    startup_diagnostic = 'copypaste-delivery-cloud-121/.data/dedicated-cloud-121/codex-initialize-diagnostic-01.json'
    diagnostic = archived(index, startup_diagnostic)
    assert diagnostic['status'] == 'passed' and len(diagnostic['rows']) == 3
    assert diagnostic['verifier_sha256'] == sha256(archived_bytes(index, startup_diagnostic.removesuffix('.json') + '.mjs')).hexdigest()
    assert all(row['initialized'] and row['thread_started'] and row['process_closed'] and row['code'] == 0 and not row['model_turn_started'] for row in diagnostic['rows'])
    reader_original = 'copypaste-delivery/.data/dedicated-delivered-121/evidence-reader-03.json'
    reader = archived(index, reader_original)
    assert reader['status'] == 'passed' and reader['tests'] == 7 and reader['actual_exit_code'] == 0
    for key in ['verifier', 'reader']:
        assert reader[key]['sha256'] == digest(ROOT / reader[key]['path'])
    reader_raw = index['entries']['copypaste-delivery/' + reader['raw_report']['path']]
    assert reader_raw['sha256'] == reader['raw_report']['sha256']
    integrated = DEV / 'copypaste-delivery/.data/dedicated-cloud-integration-121'
    for name in ['clients-applied.json', 'backend-applied-v6.json', 'media-applied-v2.json', 'attributes-preserved.json']:
        assert read(integrated / name)['status'] in ['copied_and_verified', 'published_rules_preserved']
    composed = read(Q / 'dedicated-cloud-readmes.json')
    for name, expected in {**composed['previous_readmes'], **composed['readmes']}.items():
        assert digest(ROOT / name) == expected, name
    assert composed['professional_definitions'] == 18
    media = {'screenshots': [], 'movies': []}
    layouts = []
    for key in ['desktop_ui', 'web_admin_ui', 'extension_ui']:
        value = archived(index, 'copypaste-delivery-cloud-121/' + reports[key]['journey']['path'])
        assert len(value['checks']) == 8 and not value['errors']
        media['screenshots'].extend(value['screenshots'])
        media['movies'].extend([value['media']] if value.get('media') else value['recordings'])
        layouts.extend(value.get('layouts', []))
    assert len(media['screenshots']) == 29 and len(media['movies']) == 5
    assert all(movie['skipped_capture_errors'] == 0 and movie['distinct_frames'] > 1 for movie in media['movies'])
    delivered_media = read(integrated / 'media-applied-v2.json')['files']
    assert len(delivered_media) == 39
    for item in delivered_media:
        assert digest(DEV / item['target']) == item['sha256']
    source = dict(index['current_source_files'])
    integrated_backend = delivered_backend(index, source)
    for item in delivered_media:
        source['dev/' + item['target']] = item['sha256']
    contracts = {}
    for old, new in [('dedicated-cloud-openapi.json', 'dedicated-cloud.openapi.json'),
                     ('dedicated-cloud-route-additions.json', 'dedicated-cloud-route-additions.json')]:
        src = DEV / 'copypaste-platform/contracts' / old
        dst = ROOT / 'docs/contracts' / new
        save(dst, src.read_bytes())
        source[dst.relative_to(ROOT).as_posix()] = digest(dst)
        contracts[new] = ref(dst)
    api = read(ROOT / 'docs/contracts/dedicated-cloud.openapi.json')
    operations = sum(k in ['get', 'post', 'patch', 'delete', 'put'] for item in api['paths'].values() for k in item)
    assert len(api['paths']) == 20 and operations == 24 and len(api['components']['schemas']) == 11
    previous = Q / 'history/stage121-previous-publication.json'
    save(previous, (Q / 'workmate-publication.json').read_bytes())
    for name in ['README.md', 'README.en.md']:
        file = ROOT / 'docs' / name
        save(Q / 'history/stage121-readmes-before/docs' / name, file.read_bytes())
        file.write_text(overview(name == 'README.en.md', backend['counts'], media, len(source)), encoding='utf-8', newline='\n')
    for name, expected in composed['readmes'].items():
        source[name] = expected
    for name in ['docs/README.md', 'docs/README.en.md',
                 'docs/technical/121-dedicated-cloud-and-client-execution.md',
                 'docs/tools/archive_dedicated_cloud_evidence_v3.py',
                 'docs/tools/test_dedicated_cloud_evidence_v3.py',
                 'docs/tools/record_dedicated_cloud_checkpoint.py',
                 'docs/tools/integrate_dedicated_cloud_sources_v5.py',
                 'docs/tools/integrate_dedicated_cloud_sources_v6.py']:
        source[name] = digest(ROOT / name)
    value = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'verified_bounded_dedicated_cloud_delivery',
             'scope': SCOPE, 'source_files': dict(sorted(source.items())), 'selected': index['selected'],
             'evidence_index': ref(evidence.INDEX), 'previous_publication': ref(previous),
             'backend_counts': backend['counts'], 'backend_files': backend['test_files'],
             'integrated_client_tests': 338, 'adversarial_evidence_reader_tests': 7,
             'integrated_backend_tests': 24, 'integrated_backend_receipt': integrated_backend,
             'adversarial_evidence_reader_receipt': reader_original,
             'actual_ui_checks': 24, 'media': media, 'layouts': layouts,
             'delivered_media': delivered_media,
             'contracts': contracts, 'readme_composition': ref(Q / 'dedicated-cloud-readmes.json'),
             'professional_definitions': 18, 'formal_professionally_qualified_roles': 0,
             'original_requirements': 102, 'original_full_acceptance_open': 102,
             'live_provider_qualified': False, 'actual_linux_host_qualified': False,
             'native_startup_reliability': {
                 'status': 'original_initialization_timeout_cause_unproven',
                 'failed_file_receipt': native_failure, 'failed_cleanup_receipt': failed_cleanup,
                 'fresh_initialization_diagnostics': startup_diagnostic,
                 'diagnostic_rounds_passed': 3, 'rpc_deadline_unchanged_ms': 60000,
                 'production_reliability_qualified': False},
             'full_product_acceptance': 'not_proven', 'verifier_sha256': digest(Path(__file__))}
    json_save(CP, value)
    change = ROOT / 'docs/changes/121-dedicated-cloud-delivery.md'
    save(change, (f'# 专属云端与客户端边界交付 / Dedicated cloud and client boundary delivery\n\n{SCOPE}\n\n'
                  f'后端 SQL001–129；112 个文件、{backend["counts"]["pass"]} 项测试；整合后客户端 338 项；实际 UI 24 项；29 张 PNG、5 组 GIF／MP4。模型与节点响应为假数据。\n\n'
                  '修正同步测试节点在长迁移后缺少心跳的问题，增加过期容量／错误凭证／正确心跳／原确认重试的事务回归。恢复准备失败与客户删除后，均通过正确的所有者清理边界结束资源。生产 30 秒离线限制保持原值。旧失败、原始 TAP、执行器、源码快照和截图按原字节保留。\n\n'
                  '此前一次原生 Codex 初始化超过既定 60 秒 RPC 上限；三个独立新目录的初始化／线程建立诊断均通过，但原超时根因尚未确定。失败原文和实际清理回执均保留；后续续跑不修改源码或上限，不将该现象标为已修复。\n\n'
                  '六仓库中英双语 README 改为当前使用方案、独立启动说明、逻辑图、当前页面和真实交互录制；旧 README 原文留档。Web 云端 Codex、客户本机 Desktop 与原生右侧栏 Extension 的执行边界明确分开。\n\n'
                  '[当前限定验收](../quality/dedicated-cloud-checkpoint.json) · [全部原始证据](../quality/dedicated-cloud-evidence-121/index.json) · [编号待办快照](../quality/remaining-work-2026-10-29.md)\n\n'
                  '尚未完成：原始 102 项需求的整项验收、至少 12 个角色的专业效果验收、真实供应商及物理 Linux 节点验证、签名生产发行与正式客户试点。代码／协议测试和角色定义数量不能代替这些结果。\n').encode('utf-8'))
    links = 0
    for repo in [ROOT, *[DEV / ('copypaste-' + x) for x in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]]:
        folder = ROOT / 'docs' if repo == ROOT else repo
        for name in ['README.md', 'README.en.md']:
            file = folder / name
            body = file.read_text(encoding='utf-8')
            assert len(body) > 2500 and '```mermaid' in body, file
            for match in re.finditer(r'!?\[[^\]]*\]\(([^)]+)\)', body):
                target = match.group(1).strip().strip('<>')
                local = readme_target_file(repo, file, target)
                assert local is None or local.exists(), (file, target)
                links += 1
    json_save(Q / 'dedicated-cloud-docs-audit-01.json', {
        'status': 'passed', 'at': datetime.now(timezone.utc).isoformat(), 'checkpoint': ref(CP),
        'readmes': 14, 'links': links, 'previous_readme_bytes_preserved': True,
        'qualified_sources_rehashed': len(source), 'verifier_sha256': digest(Path(__file__))})
    print(json.dumps({'status': value['status'], 'sources': len(source), 'readmes': 14, 'links': links,
                      'backend_tests': backend['counts']['pass'], 'integrated_clients': 338, 'actual_ui_checks': 24}))


if __name__ == '__main__':
    main()
