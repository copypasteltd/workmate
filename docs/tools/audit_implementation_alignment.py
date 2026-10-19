"""Inventory requirement gaps without equating file/route presence with acceptance."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs'
DEV = ROOT / 'dev'

# Initial findings are deliberately preserved until requirement-level execution
# evidence replaces them. A passing build never closes a business requirement.
FINDINGS = {
 1: '已有企业 RLS；事件、对象、副本及新增模块仍需逐路径跨企业验证。',
 2: '已有项目动作权限；需按规范角色矩阵补齐逐动作、撤销和下载验证。',
 3: '邮箱、邀请、原生登录和 OIDC 已有局部证据；须执行完整跨端撤销用例。',
 4: '连接器已有 OAuth/撤销；账户选择、项目绑定、旧队列和正式同步仍须验证。',
 5: '已有持久专家及版本；品牌/工具范围、跨端新旧版本与原生运行映射需完整核查。',
 6: '已有五域记忆；删除后的物理缓存、提取内容和全部历史引用清理不足。',
 7: '已有委派输入；阻塞字段补齐与同一任务继续工作缺少完整实现。',
 8: '任务已持久化；事件契约、步骤、部分结果和客户端流式重放不完整。',
 9: '缺少规范的暂停检查点、未完成步骤重试及自动恢复；租约到期主要进入对账。',
10: '已有批准和摘要机制；外部动作意图、参数授权与恢复还需贯通。',
11: '已有工具/任务事件；attempt、step、trace 和用户可读失败定位与契约不一致。',
12: '已有不可变素材版本；部分成功、统一修改与下载包状态尚不完整。',
13: '已有品牌记录；字体、范围、固定资料版本的完整生产链需验证。',
14: '现有 multipart 限 25MiB；不满足 100MiB/1GiB、分片/恢复及完整校验。',
15: '已有内部 Image 2 调用实现；当前无公司配置，按用户最新指令使用模拟接口验证。',
16: '已有原生字体/PNG 渲染；混排、缺字、自动换行和溢出检查需补齐。',
17: '缺少 60 单元批量矩阵、局部重排/修改和独立重试。',
18: '已有海报模板 MP4；脚本、分镜、字幕、音轨及可恢复工程不完整。',
19: '缺少生成式视频异步作业的完整提交/查询/取消/对账链路。',
20: '缺少可独立调用、版本化且有输入规格的特效目录。',
21: '缺少内部配音/转写的业务实现、授权音源与字幕版本管理。',
22: '缺少统一评论、接受/修改审阅和可恢复交付包。',
23: '已有 CSV 指标导入；官方导出映射、逐行错误、多格式和幂等计数需核查补齐。',
24: '已有确定性指标；归因、多币种、缺失转化及报告快照引用需完整验收。',
25: 'Google Ads 已有接入骨架；分页、限流、同步作业及新鲜度不足。',
26: 'Meta 已有接入骨架；分页、失效、账户范围和正式同步需补齐。',
27: 'GA4 已有固定查询；reporting identity、属性时区及限制记录不足。',
28: 'GSC 已有查询；范围、返回限制和分页/新鲜度记录不足。',
29: '现有 SEO 主要分析提交 HTML；缺少受限站点诊断、URL 证据及复查。',
30: '缺少固定问句集、观测配置和可复核 GEO 观察记录。',
31: '缺少素材、活动、creative ID 与分析反馈的显式确认关联。',
32: '已有版本化工作流；失败策略、输入输出契约及跨模块复用仍需完整验收。',
33: '已有每日/每周云端日历；需验证规范全部去重、错过执行、停用与失败边界。',
34: '现有未知费用不盲重试；完整外部写入意图和对账领域尚需补齐。',
35: '已有工作台；会话/成果/文件主路径、团队和能力中心仍有缺口。',
36: '已有主动网页提取；选择片段、站点权限与异常边界需完整验收。',
37: '已有上传下载及原生目录 grant；撤销、兼容降级和全部端需完整验收。',
38: '已有真实 Native Host；大文件授权传输及协议兼容仍不足。',
39: '已有 Windows 安装包与登录；签名更新、卸载/保留数据策略及兼容矩阵不足。',
40: '缺少目录监听、防抖去重、批量调度和批准程序调用。',
41: '云端身份基本一致；缺少任务内本地步骤及离线等待/重连恢复的完整贯通。',
42: 'QA 已释放自建浏览器；产品任务浏览器归属、资源上限及异常清理需专项验证。',
43: '已有公司网关约束；所有新媒体/技能/后台分支及出站隔离需持续验证。',
44: '已有真实 Codex 工具回合；会话继续、检查点、事件恢复尚不完整。',
45: '模型映射主要为环境配置；缺少受控能力版本、限额、推理参数及发布验证闭环。',
46: '已有整数账本、预留与对账；需覆盖新增并行/媒体/本地路径的竞争与未知费用。',
47: '已有人工费用/VIP；席位、额度及权益的全部执行点仍需核查。',
48: '已有后台；完整用户端内容、正文编辑和受控协助仍未覆盖所有资源。',
49: '逻辑删除未完成物理对象/运行缓存 GC，缺完整可查询删除作业与备份删除账本。',
50: '主密钥未下发；还需完整处理流向说明及新增传输/媒体分支检查。',
51: '有中英切换；动态状态翻译、日期/币种与时区覆盖不完整。',
52: '缺少完整企业/能力公平并发与负载证明；上传/批次限制与 NFR 不一致。',
53: '已有正常 checkpoint 重启；缺少实际备份/恢复演练、RPO/RTO 和删除账本重放。',
54: '已有版本/迁移/打包；灰度/回滚、前一次版本设备兼容及签名更新不足。',
55: '有可访问控件基础；缺少全部核心流程的键盘/缩放/窄屏专项证明。',
56: '缺少业务接受、返工、人工时间、成本和复用率的独立记录/统计。',
57: '已有受限工具及路径校验；新网络、进程、本地与不可信内容边界需逐项验收。',
58: '现有缺能力会拒绝；模拟模式必须显式标识，且不能混入生产资格。',
59: '独占云环境仍未实现；启用前成本/范围确认是条件门槛，不能默认采购。',
60: '路径、原生执行与浏览器清理已有局部证据；本轮全部操作继续受同一约束。',
61: '已有私密会话；多任务补充/新委派、定位引用与删除边界仍有缺口。',
62: '已有预设与定制专家；默认助手、模板复制和专业输入/依赖仍需贯通。',
63: '缺少持久云文件树、目录、移动/搜索、选区引用与精确分类。',
64: '已有安装包/启停检查；缺少完整项目安装/绑定/卸载及普通停用与安全撤销区分。',
65: '缺少项目共享配置版本、继承摘要与固定资源/方法快照。',
66: '缺少持久专业团队、协调者、依赖图、受控并行和统一预算/交付。',
67: '已有 ask/plan/execute；计划编辑、范围改变与所有写工具边界须完整验收。',
68: '已有版本产物与发布；选区/时间段/文本锚点引用、修改摘要及继续工作不完整。',
69: '缺少持久 DependencyRequest、原任务检查点续做及重复回调去重。',
70: '缺少解决方案预览/试运行/发布/复制和目标项目重新绑定。',
71: '已有界面创建云端日历；自然语言或既有成果到确认、依赖快照的链路不足。',
72: '首项工作可渐进开户；缺少可直达任务/会话的完整站内通知。',
73: '18 个目录条目已安装，但当前 0 个真实服务合格角色；需用显式模拟模式验证可选用链路。',
74: '有 28 个精确 Skill 包；逐角色完整流程、产物及异常验收仍缺少证据。',
75: '已有 Codex 实际加载与摘要；所有角色/恢复/团队分支需完整验证。',
76: '目录共用程度和示例/缺口展示不完整；实例化幂等及原会话补齐需补齐。',
77: '已有设计工具与 Image 2 适配；无真实配置，需完整模拟生成/编辑/分层工程与修改链。',
78: '角色实际交付不齐，视频/语音等尚不可执行；跨端规格与异常行为需完整实现。',
79: '已有实例版本；模板企业覆盖、新版比较/采用、技能与私有内容安全复制不足。',
80: '缺少至少 12 个角色的任务/修改/依赖/越权证据；模拟资格须与生产资格分开。',
81: '已采用官网品牌；三端 token/组件仍有重复来源，完整一致性需复核。',
82: '已有静态样板与局部截图；完整两主题/语言/四尺寸/缩放/键盘/对比证据缺失。',
83: '已有独立 MFA 与后台会话；旧异步作业、全部设备令牌与撤销需完整验收。',
84: '已有用户去重/详情；完整筛选、注册/登录及所有关联入口需核查。',
85: '已有冻结/恢复与会话撤销；企业/成员/在途工作/公开链接范围需完整验证。',
86: '已有用量/账本；多维钻取、能力/任务/来源去重与未知成本展示仍不足。',
87: '已有人工财务预览/提交；限时额度、扣回、来源退款和全场景幂等需完整验收。',
88: '已有个人/企业 VIP；延期/换方案/重叠及到期竞争需完整验收。',
89: '已有套餐版本；席位/存储/角色/额度执行完整性需补齐。',
90: '内容注册表尚不覆盖全部资源；缺少统一正文修订、新版本及团队/方案治理。',
91: '已有逻辑隔离/删除；解除下架的语义、下载/索引/物理 GC 与删除进度不足。',
92: '已有取消任务/流程和日历控制；暂停检查点、失败重试及不确定操作闭环不足。',
93: '公开配置发布较粗；公告/帮助/菜单、灰度、预览及回滚闭环不完整。',
94: '已有细粒度权限/deny/委派；全动作、字段、列表、下载和异步执行须逐项覆盖。',
95: '当前支持主要为元数据；缺少限时只读用户视图、提示条与授权范围。',
96: '已有审计/MFA/独立审批；新增敏感路径和任务审批不可变性需完整验收。',
97: '已有最多 500 行导出；异步批量冻结对象/版本、部分成功与安全重试不完整。',
98: '已有 16 页；列配置、分页筛选、异常与可访问表单的全流程仍需复核。',
99: '模型/能力主要为环境配置；验证发布、精确别名/费率、技能及兼容版本控制不足。',
100: '已有请求/worker 重查；缺少统一撤销事件、客户端重连同步与站内通知。',
101: '已有付款引用与退款约束；实际财务对账 UI、补偿分录及累计可退需全面验收。',
102: '已有服务端方案/预算检查；所有新增工具、调度、席位和存储需统一真实执行。',
}

GROUPS = [
 ('identity', {1,2,3,4,37,41,50,57,83,84,85,94,100}, ['src/auth.ts','src/access.ts','src/workspaces.ts','src/federation.ts']),
 ('persistent_work', {5,6,7,61,62,64,65,67,69,70,72,76,79}, ['src/persistent-work.ts','src/catalog.ts']),
 ('execution', {8,9,10,11,32,33,34,43,44,45,46,52,66,71,75,92,99,102}, ['src/worker.ts','src/runtime.ts','src/tasks.ts','src/task-service.ts','src/schedules.ts','src/business.ts','src/billing.ts']),
 ('files_media', {12,13,14,15,16,17,18,19,20,21,22,49,63,68,77,78,90,91}, ['src/assets.ts','src/storage.ts','src/render.ts','src/admin-content.ts']),
 ('analytics', {23,24,25,26,27,28,29,30,31}, ['src/analytics.ts','src/business.ts']),
 ('commercial_admin', {47,48,56,86,87,88,89,93,95,96,97,98,101}, ['src/admin.ts','src/admin-operations.ts','src/admin-access.ts','src/admin-jobs.ts','src/plans.ts']),
 ('clients_operations', {35,36,38,39,40,42,51,53,54,55,58,59,60,73,74,80,81,82}, ['../copypaste-web/src/main.tsx','../copypaste-web/src/persistent-work.tsx','../copypaste-desktop/src/main.ts','../copypaste-extension/src/background.ts','../copypaste-delivery/README.md']),
]

def load(p):
    return json.loads(p.read_text(encoding='utf-8'))

def normalize(path):
    return re.sub(r'\{[^}]+\}|:[A-Za-z_][A-Za-z_0-9]*', '{}', path).rstrip('/')

def main():
    srs = DOCS/'requirements/01-srs.md'
    requirements = re.findall(r'^\| (REQ-(\d{3})) \| (P\d) \| (.+) \|$', srs.read_text(encoding='utf-8'), re.M)
    cases = {x['id']:x for x in load(DOCS/'quality/test-cases.json')['cases']}
    assert len(requirements) == len(FINDINGS) == len(cases) == 102
    actual = load(DEV/'copypaste-platform/contracts/implemented-routes.json')
    implemented = {(x['method'].upper(),normalize(x['path'])) for x in actual['routes']}
    contract = load(DOCS/'contracts/openapi.json')
    routes = []
    for path,methods in contract['paths'].items():
        for method,operation in methods.items():
            if method.upper() not in {'GET','POST','PUT','PATCH','DELETE'}:
                continue
            routes.append({'method':method.upper(),'path':path,'operation_id':operation.get('operationId'),
                           'method_path_matches':(method.upper(),normalize(path)) in implemented,
                           'request_response_conformance':'not_proven'})
    sources = {}
    rows = []
    for rid,number,priority,text in requirements:
        n=int(number)
        refs=[]
        for group,numbers,files in GROUPS:
            if n not in numbers:
                continue
            for name in files:
                p=(DEV/'copypaste-platform'/name).resolve()
                relative=p.relative_to(ROOT).as_posix()
                if p.is_file():
                    sources[relative]=hashlib.sha256(p.read_bytes()).hexdigest()
                    refs.append(relative)
        case=cases[f'TC-{number}']
        rows.append({'requirement_id':rid,'priority':priority,'requirement':text,
                     'acceptance_case':case['id'],'acceptance_conditions':case['expected_and_evidence'],
                     'assessment':'completion_not_proven','finding':FINDINGS[n],
                     'source_inspection_candidates':refs,'acceptance_evidence':[],
                     'note':'文件存在、路由匹配与既有局部测试不证明该条完整验收通过。'})
    repositories=[]
    for name in ['platform','web','admin','extension','desktop','delivery']:
        p=DEV/f'copypaste-{name}'
        repositories.append({'name':p.name,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=p,text=True).strip(),
                             'dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=p).strip())})
    result={'schema_version':'1.0','at':datetime.now(timezone.utc).isoformat(),
            'scope':'Full 102-requirement baseline; inventory is not an acceptance pass',
            'user_test_data_instruction':'2026-10-19: 暂时先用假数据。Simulated validation is authorized; production qualification remains separate.',
            'requirements_sha256':hashlib.sha256(srs.read_bytes()).hexdigest(),
            'repositories':repositories,'inspected_source_hashes':sources,
            'contract_alignment':{'contract_operations':len(routes),'implemented_operations':len(actual['routes']),
                                  'unmatched_contract_method_paths':sum(not x['method_path_matches'] for x in routes),
                                  'routes':routes,'limit':'Path matching only; differing nesting may implement related behavior. Matching paths do not prove payload/status/event conformity.'},
            'requirements':rows}
    out=DOCS/'quality/requirements-alignment-baseline.json'
    # Preserve this first baseline; later evidence belongs in separate resolution records.
    if out.exists():
        raise SystemExit('Baseline already exists. Preserve it and record requirement-level resolutions separately.')
    out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(f'Inventoried {len(rows)} requirements and {len(routes)} contract operations; {result["contract_alignment"]["unmatched_contract_method_paths"]} method/path mismatches, no complete acceptance inferred.')

if __name__=='__main__':
    main()
