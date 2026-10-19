"""Record bounded repair evidence while preserving every original acceptance case."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DOCS, DEV = ROOT / 'docs', ROOT / 'dev'

# Entries describe verified subflows, never a whole-requirement acceptance pass.
CLUSTERS = [
    ('pre_execution_input_checkpoint', [1,2,7,9,35,39,44,46,61,67,69,72],
     '明确提交运行前文件/连接需求、同任务单预留与单次入队、私人上传、跨端选择、资源撤销和计划输入守卫；不含已付费步骤续做。',
     ['platform_regression','task_dependencies','admin_task_inputs','desktop','extension','runtime_schemas'], ['technical/22-pre-execution-input-checkpoint.md']),
    ('durable_erasure', [1,2,6,12,49,57,61,68,90,91],
     '持久删除账本、不可逆墓碑、物理对象/缓存清理、子作业依赖、隔离与后台受控重试。',
     ['platform_regression', 'web_admin'], ['technical/17-erasure-transfer-retention-events.md']),
    ('verified_transfer', [1,2,14,37,38,39,50,52,57],
     '4 MiB 分片、实际摘要/MIME、恢复/取消/并发完成、上传额度；Web 断线重选、Desktop 29 MiB 原生实传和拒绝覆盖。',
     ['platform_regression', 'web_admin', 'desktop'], ['technical/17-erasure-transfer-retention-events.md']),
    ('events_and_queue_recovery', [8,9,11,35,41,44,51,53,54],
     '持久事件序号/UUID、SSE 权限复查、游标裁剪与重连；只恢复尚未领取的排队任务，未知结果不盲重放。',
     ['platform_regression', 'web_admin'], ['technical/17-erasure-transfer-retention-events.md']),
    ('synthetic_dependencies', [15,43,44,46,47,58,60,73,75,77,80,86,87],
     '按用户授权使用明确标识的模拟网关/额度，真实 Codex 与真实持久业务流程继续执行，数据模式分开。',
     ['platform_regression', 'web_admin', 'cloud_files'], ['technical/17-erasure-transfer-retention-events.md']),
    ('persistent_cloud_files', [1,2,5,12,14,35,49,57,61,63,68,90,91],
     '项目/私人文件树、固定版本引用、目录搜索/移动/删除、授权预览、私人上传、独立共享副本；连续真实 Codex 任务读改源码并打包真实 ZIP。',
     ['platform_regression', 'cloud_files', 'desktop', 'runtime_schemas'], ['technical/18-persistent-cloud-files.md']),
    ('project_skills', [1,2,5,43,44,46,62,64,74,75,76,79,94,99,102],
     '项目安装、精确专家/任务绑定、启停/卸载/永久安全撤销、重装新身份与旧任务不可复活；当前方案在每次工具及落库复查。',
     ['platform_regression', 'skills', 'runtime_schemas'], ['technical/19-project-skill-lifecycle.md']),
    ('ui_and_document_alignment', [35,39,51,55,60,81,82,98],
     '新增流程的两主题/繁英/四宽度检查、后台清理页、文档契约校验及独立源码构建；不代替全产品可访问性验收。',
     ['web_admin', 'cloud_files', 'skills', 'desktop', 'documentation'], ['technical/17-erasure-transfer-retention-events.md','technical/18-persistent-cloud-files.md','technical/19-project-skill-lifecycle.md']),
    ('in_app_notifications', [1,2,11,35,39,51,55,61,72,81,82,90,91],
     '提交时最终任务状态生成接收者通知，去重/微秒游标/30天保留/当前授权，已读与跨项目定位；错误隐藏旧列表。',
     ['platform_regression','notifications','desktop','extension','runtime_schemas'], ['technical/20-in-app-notifications.md']),
    ('default_assistant', [1,2,5,43,44,46,61,62,67,72,75,79,102],
     '无需先自建专家的默认助手、同事务私人会话/消息/任务/预留，未知响应重试保持身份；固定共享配置和显式方法版本采纳。',
     ['platform_regression','default_assistant','desktop','extension'], ['technical/21-default-assistant-and-first-delegation.md']),
]

REMAINING = {
 7:'明确提交的文件/连接需求已能在原任务补齐；自动发现阻塞字段与全业务输入引导仍待完成。',
 69:'已实现首次模型调用前的显式文件/连接检查点；已付费步骤恢复、自动识别、capability/device 和离线等待仍未完成。',
 1:'需对其余连接器、团队、媒体、批量/导出和所有规范接口继续进行跨企业负向验证。',
 2:'其余业务动作、品牌/项目角色矩阵、解除授权后的全部下载与异步路径仍需完整验收。',
 5:'默认助手与持续专家已有局部证据；完整品牌/工具继承及全部版本/跨端用例尚未完成。',
 6:'在线删除及缓存已修复；全部历史引用、索引与备份恢复后的删除重放仍待完成。',
 8:'云执行与事件已验证局部流程；完整真实步骤/部分产物状态及全部故障仍待验收。',
 9:'仅安全恢复未领取队列；暂停、步骤检查点、原任务续做和未知外部操作闭环未完成。',
 11:'事件身份和可读状态已有修复；全业务 step/trace/工具链与规范字段仍需核对。',
 12:'云版本引用和实际源码 ZIP 已验证；全类型预览、局部成功/修改/审阅及可恢复工程未齐。',
 14:'需验证所有端完整 1 GiB 实传、生产对象存储及旧 multipart/扩展桥接大文件迁移。',
 15:'模拟接口下功能继续验证；真实内部 Image 2 生成/编辑和业务质量尚未验收。',
 35:'文件/技能、默认助手、通知和首次运行前补齐已有证据；团队、自动缺口发现、步骤续做与全业务整合仍待完成。',
 37:'Web 与 Desktop 传输有新证据；兼容降级、扩展及所有撤销场景仍未完整验收。',
 38:'Desktop 新传输不等同扩展 Native Host 全量大文件验收；协议矩阵仍待完成。',
 39:'当前源码原生登录/传输通过；历史安装包未重发，更新/签名/卸载与系统矩阵待完成。',
 41:'身份与云文件接续有局部证据；任务内本地步骤、离线等待/重连续做仍待完成。',
 43:'当前新增方法/上传/云文件仍走受控工具；新增媒体/后台/所有出站路径尚需验收。',
 44:'锁定真实 Codex 的工具回合及持久源码已验证；内核会话继续、完整检查点/恢复仍待完成。',
 46:'保留整数预留/结算和对账；新增并行/媒体/本地全路径竞争及所有未知费用仍需验收。',
 47:'模拟 gift 不代表真实收款或正式权益全量验收；席位/存储/额度执行仍待齐。',
 49:'在线永久删除/保留规则/进度已修复；项目/企业整删、导出、备份轮换与删除重放未完成。',
 50:'需完成全端传输/媒体分支、正式 OAuth 和区域流向的全部证明。',
 51:'新增流程已有双语与微额费用修复；全产品动态文案、时区及指标口径待齐。',
 52:'上传有跨用户额度守卫；公平企业/能力并发与规定负载验收仍待完成。',
 53:'队列恢复不代替备份；实际备份/恢复演练、RPO/RTO 及删除账本恢复重放未完成。',
 54:'迁移摘要与前向修复已有实现；灰度、回滚、旧设备兼容及签名更新待完成。',
 55:'新增页宽度与表单流程有局部证据；所有关键路径的键盘、缩放、对比和错误定位未完整验证。',
 57:'新增文件树/源码/安装/传输有执行端守卫；其余网络/进程/不可信内容路径仍需逐项验证。',
 58:'模拟模式明确展示与隔离；全部离线设备、未授权账户、异步媒体和缺口补齐仍待完成。',
 60:'本轮全部源码/文档维持 D 盘原生工具与自建浏览器清理；最终独立仓库完整交付仍待更新。',
 61:'会话私有云目录与删除边界已有局部验证；全部多任务消息补充/定位及生命周期仍待齐。',
 62:'默认助手、共享固定配置、私人原子委派和预设专家已有验证；完整专业输入/依赖引导、规范模板版本接口仍未完成。',
 67:'默认助手和专业任务遵守问答/计划/执行；完整规范计划版本与所有关键输入变化/恢复分支仍待验收。',
 72:'示例不自动提交、默认私人委派、站内通知和原任务定位已验证；附图及完整业务阻塞项恢复仍待完成。',
 63:'树/搜索/版本/移动/权限/持久源码已验证；Office/PDF 分页、选择器大目录检索及完整 TC 仍待齐。',
 64:'随附方法项目生命周期已实现；自定义包、试运行审核/组织发布与全部动态资源交集未完成。',
 68:'固定版本源码修改和独立共享有证据；图片选区、视频时段、文本锚点、完整审阅仍待齐。',
 73:'18 个候选仍需≥12 个真实服务合格角色；模拟链路不计入正式数量。',
 74:'有精确包/安装/绑定；逐角色完整输入输出、流程/产物与异常验收未完成。',
 75:'实际 Codex 加载和安全撤销有局部证据；所有角色、团队、后台与恢复分支未全覆盖。',
 76:'必需方法自动安装且不复活卸载/撤销；共享目录筛选、输入/依赖在原会话补齐未完成。',
 77:'模拟设计逻辑不代表真实 Image 2 资格；分层工程、限定编辑与实际业务完整验收待齐。',
 79:'精确绑定、重装显式采用与撤销已修复；企业模板覆盖/新版比较与安全复制仍待完成。',
 80:'真实服务合格角色数仍为零；至少 12 个任务/修改/异常的实际资格证据未完成。',
 81:'新增页面延续官网 token；全部端的组件单源与全量品牌一致性仍待核查。',
 82:'局部两主题/语言/四尺寸通过；全组件状态、100/200% 缩放、键盘/对比/reduced-motion 验收待完成。',
 86:'模拟数据单列且微额费用可读；正式多维消费归属和未知成本全量钻取仍待验收。',
 87:'模拟额度走可追踪 gift；正式费用全部动作/收款关联/退款与限时额度仍需完整验收。',
 90:'内容目录新增云节点；专业团队、方案、自定义方法及所有正文修订治理未完成。',
 91:'在线隔离/永久删除/进度已补强；所有下载/索引/链接与备份恢复场景仍待完整验收。',
 94:'项目方法新增权限检查；全动作/字段/范围/导出及异步执行完整矩阵待完成。',
 98:'新增表单与四宽度有局部证据；全后台筛选、列配置、异常和键盘仍待验证。',
 99:'可信方法版本/撤销已补强；模型/费率的受控验证发布、兼容版本与后台全闭环待完成。',
 102:'当前方案能力在工具/结果阶段复查；全部媒体、团队、调度、席位、存储的真实交集执行未齐。',
}


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    baseline_path = DOCS/'quality/requirements-alignment-baseline.json'
    baseline = load(baseline_path)
    assert len(baseline['requirements']) == 102
    assert baseline['requirements_sha256'] == fingerprint(DOCS/'requirements/01-srs.md'), 'Review changed SRS before carrying evidence forward'
    files = {
        'platform_regression': DEV/'copypaste-delivery/evidence/alignment-platform.json',
        'web_admin': DEV/'copypaste-delivery/evidence/alignment.json',
        'cloud_files': DEV/'copypaste-delivery/evidence/cloud-files.json',
        'desktop': DEV/'copypaste-delivery/evidence/alignment-desktop.json',
        'extension': DEV/'copypaste-delivery/evidence/extension.json',
        'skills': DEV/'copypaste-delivery/evidence/skills.json',
        'notifications': DEV/'copypaste-delivery/evidence/notifications.json',
        'default_assistant': DEV/'copypaste-delivery/evidence/default-assistant.json',
        'task_dependencies': DEV/'copypaste-delivery/evidence/task-dependencies.json',
        'admin_task_inputs': DEV/'copypaste-delivery/evidence/admin-task-inputs.json',
        'checkout_integrity': DEV/'copypaste-delivery/evidence/byte-integrity.json',
        'runtime_schemas': DOCS/'quality/runtime-contract-samples.json',
        'documentation': DOCS/'quality/validation-report.json',
    }
    evidence = {}
    for key, path in files.items():
        report = load(path)
        checks = report.get('checks', [])
        assert report.get('status', 'passed') == 'passed'
        assert all(c['status'] == 'passed' for c in checks)
        assert not report.get('errors') and not report.get('failures')
        if 'browser_closed' in report:
            assert report['browser_closed'] is True
        evidence[key] = {'path': path.relative_to(ROOT).as_posix(), 'sha256': fingerprint(path),
                         'at': report.get('at', report.get('checked_at')), 'checks': checks,
                         'scope': report.get('scope', 'Only the explicitly named subflows in this report')}
        if key == 'platform_regression':
            assert report['counts']['tests'] == report['counts']['pass'] and report['counts']['fail'] == 0
            raw = path.parent/report['raw_report']
            assert fingerprint(raw) == report['sha256']
            evidence[key]['counts'] = report['counts']
            evidence[key]['raw_report'] = {'path':raw.relative_to(ROOT).as_posix(),'sha256':fingerprint(raw)}
    rows = []
    for row in baseline['requirements']:
        number = int(row['requirement_id'][-3:])
        changes = [{'cluster':key,'verified_subflow':description,'evidence':refs,'implementation_docs':docs}
                   for key,numbers,description,refs,docs in CLUSTERS if number in numbers]
        rows.append({**row, 'assessment':'partial_verified' if changes else 'completion_not_proven',
                     'finding':REMAINING.get(number,row['finding']),
                     'original_finding':row['finding'], 'verified_repairs':changes,
                     'remaining_complete_acceptance_conditions':REMAINING.get(number,row['finding']),
                     'acceptance_case_execution':'not_completed',
                     'acceptance_evidence':sorted({ref for c in changes for ref in c['evidence']}),
                     'note':'局部证据不关闭同号 TC；原需求及完整验收条件原样保留。'})
    actual = load(DEV/'copypaste-platform/contracts/implemented-routes.json')
    api = load(DOCS/'contracts/openapi.json')
    normalize = lambda p: re.sub(r'\{[^}]+\}|:[A-Za-z_][A-Za-z_0-9]*','{}',p).rstrip('/')
    implemented={(r['method'].upper(),normalize(r['path'])) for r in actual['routes']}
    operations=[{'method':m.upper(),'path':p,'operation_id':o['operationId'],
                 'method_path_matches':(m.upper(),normalize(p)) in implemented,'full_conformance':'not_proven'}
                for p,methods in api['paths'].items() for m,o in methods.items() if m in ['get','post','patch','delete','put']]
    repositories=[]
    for name in ['platform','web','admin','extension','desktop','delivery']:
        repo=DEV/f'copypaste-{name}'
        files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=repo,text=True).splitlines()
        hashes={name:fingerprint(repo/name) for name in sorted(set(files)) if (repo/name).is_file() and (repo/name).suffix in ['.ts','.tsx','.mjs','.json','.sql','.css','.html','.md','.svg','.png','.ico']}
        repositories.append({'name':repo.name,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
                             'dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=repo).strip()),'source_hashes':hashes})
    result={'schema_version':'1.0','at':datetime.now(timezone.utc).isoformat(),
            'scope':'All 102 requirements remain in scope; bounded repair progress, not a complete acceptance report',
            'baseline_sha256':fingerprint(baseline_path),'user_test_data_instruction':baseline['user_test_data_instruction'],
            'summary':dict(Counter(r['assessment'] for r in rows)), 'fully_accepted_requirements':0,
            'qualified_live_roles':0, 'release_artifacts':'Existing 0.5.0 installers/offline bundles do not include current source repairs',
            'repositories':repositories,'evidence':evidence,
            'contract_alignment':{'contract_operations':len(operations),'implemented_operations':len(actual['routes']),
                                  'unmatched_contract_method_paths':sum(not x['method_path_matches'] for x in operations),
                                  'limit':'Method/path inventory only; mismatches can be nesting differences, matching routes still require full payload/status/authorization/event acceptance.',
                                  'operations':operations},
            'gates':[{'id':f'G{n:02d}','full_acceptance':'not_proven'} for n in range(1,11)],
            'nfr_full_acceptance':'not_proven','requirements':rows}
    (DOCS/'quality/requirements-alignment-progress.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'requirements':len(rows),**result['summary'],'fully_accepted':0,'contract_alignment':{k:v for k,v in result['contract_alignment'].items() if k!='operations'}},ensure_ascii=False,indent=2))


if __name__ == '__main__':
    main()
