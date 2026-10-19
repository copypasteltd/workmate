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
    ('invitations_and_membership_authority', [1,2,3,35,36,39,51,55,60],
     '原始 Invite/Member/MemberList/Ack、独立成员 ID、企业头及分页、角色/项目守卫、锁内当前权限、最后所有者、接受与移除幂等、旧待用邀请撤销、加密投递重试和重发版本；当前 HTTP 五组及十三组隔离平台检查。当前 Web 最终页面复核、完整原生旅程、生产邮件与规范后台成员入口仍待完成。',
     ['platform_regression','membership_wire','runtime_schemas'], ['technical/35-invitations-and-membership-authority.md']),
    ('canonical_user_and_private_context', [1,2,3,35,36,39,51,55,60,100],
     '原始 GET /v1/me 严格 User 与受认证工作区上下文分离；三端实际消费者与测试调用同步迁移；不同账号混合 Cookie/Bearer 只返回选用身份的工作区，原生不得取得浏览器 CSRF。真实 PostgreSQL、实际 HTTP User schema 和 Web 初始化证据独立记录，完整原生/系统旅程未计通过。',
     ['platform_regression','auth_navigation','runtime_schemas'], ['technical/34-user-profile-context-and-orphan-scan-races.md']),
    ('canonical_authentication_and_retry_recovery', [1,2,3,35,36,39,51,55,60,100],
     '原规范五个用户认证接口及 Web/源码 Desktop/MV3 消费者、HTTP-only 验证码 flow、S256/顶层授权与 CSRF、原子加密回执、不可复活及剩余有效期；该阶段 Web 真实导航三组和平台 203 项通过，最新资料契约增量另列。原生刷新/双面板曾完成局部实测，新增首次交换短重试有单元与服务端证据；当前扩展十二组原生重跑受启动阻塞，未计完整通过。原始 User 及工作区聚合由后续增量对齐；邀请/后台契约及完整身份/系统矩阵仍待完成。',
     ['platform_regression','auth_navigation','runtime_schemas'], ['technical/33-canonical-authentication-and-retry-recovery.md']),
    ('cross_client_session_lifecycle', [1,2,3,35,36,39,51,55,60,100],
     '三端实际登录/PKCE、无凭证设备目录/当前装置、过期访问仍可撤销、刷新整族与真实并发竞争、迟到回执隔离、离线退出反馈、本地文件授权清理、成员撤销后旧入口及跨标签清理；五个规范用户认证接口由后续独立增量记录，完整 SSO/系统矩阵及 TC 全部条件仍未完成。',
     ['platform_regression','sessions'], ['technical/32-cross-client-sessions-and-revocation.md']),
    ('initial_pause_and_native_continuation', [1,2,8,9,11,35,36,39,44,46,51,60,69,92],
     'Web/源码无边框 Desktop/MV3 排队暂停与同任务单预留恢复、领取竞争/权限与来源复查、Admin 共用领域守卫；真实 Codex 跨进程原历史/工具续聊、增量用量、中断和回执 I/O 故障保留消耗。适配器原语未接已付费步骤恢复，不构成完整暂停/检查点验收。',
     ['platform_regression','task_controls'], ['technical/31-task-controls-and-native-continuation.md']),
    ('native_window_and_sidepanel', [36,39,51,55,60,81,82],
     'Desktop 无原生边框/默认菜单、自绘双语主题标题栏、实际原生窗口按钮与指针/键盘有界缩放、跨窗口 IPC 拒绝、真实打包登录及弹窗；Chrome action 实际创建右侧 SIDE_PANEL、跨页保留/收起及重启配置。完整系统/DPI、签名更新与全产品可访问性仍待验收。',
     ['native_surfaces','native_artifacts','extension'], ['technical/30-native-window-and-browser-sidepanel.md']),
    ('file_imports_and_corrections', [1,2,12,14,23,24,35,39,43,44,46,49,51,55,60,90,91],
     '固定来源文件版本的 CSV/XLSX 导入、规范 ImportCreate/Snapshot、显式工作表/标题列、十进制/公式拒绝/单元格错误、跨旧接口去重、更正祖先链及汇总排斥、来源治理与删除/未领取预留释放、Web/原生 IPC 字节下载；不含完整官方导出矩阵或专业分析资格。',
     ['platform_regression','file_imports','workbook_interop','marketing_analytics','runtime_schemas'], ['technical/29-file-imports-and-correction-lineage.md']),
    ('analysis_report_tasks', [1,2,12,23,24,35,39,43,44,46,49,51,55,60,74,75,79,90,91],
     'AnalysisSpec 多来源独立计算与比较、原子私人 Codex 报告任务/单预留、分页冻结事实工具、规范 Snapshot/Evidence 查询、数字字面量与引用校验、固定 HTML/JSON 产物及 Web/源码 Desktop 下载、来源生命周期和撤权；不含完整语义质量、正式广告连接和专业角色资格。',
     ['platform_regression','analysis_reports','analysis_index','runtime_schemas'], ['technical/28-analysis-report-tasks-and-evidence.md']),
    ('marketing_import_metrics', [1,2,12,23,24,35,39,44,49,51,55,60,90],
     'CSV 映射预览、单项目原子去重、原文摘要、精确小数和未知原因、冻结指标/证据、真实 JSON/SVG/CSV 下载、隔离删除与权限守卫、Web/源码 Desktop；该阶段尚未涵盖 XLSX、完整来源/维度模型、规范分析任务和正式广告授权，后续修复另列。',
     ['platform_regression','marketing_analytics'], ['technical/27-marketing-import-metrics-and-evidence.md']),
    ('design_pdf_review', [1,2,12,14,16,22,39,43,44,51,55,60,68,74,75,76,77,78,79],
     '实际单页 PDF 审阅稿、源工程与格式权限、旧版本拒绝/原请求重放、私人文件、Web 下载和原生 Desktop 摘要保存；独立解析/渲染，不含完整审阅包、印刷或真实设计角色资格。',
     ['platform_regression','design_pdf'], ['technical/26-design-pdf-review-delivery.md']),
    ('persistent_role_templates', [1,2,44,51,62,73,74,75,76,78,79,81,82,99,102],
     '持久模板目录、项目预检、幂等实例化、真实 Codex/能力版本、提交前与执行中撤销复查，以及 Web/源码 Desktop 选择流程；不含完整专业交付资格、受控模板发布与品牌覆盖。',
     ['platform_regression','agent_templates','runtime_schemas'], ['technical/25-role-template-registry-and-runtime-binding.md']),
    ('admin_record_pages', [49,90,94,98,100],
     '清理记录组合筛选、可见总数与分页、只读重试拒绝、慢请求失败清空、授权到期和后台默认 50 条；不含百万记录压测或全部运营筛选。',
     ['platform_regression','admin_records','runtime_schemas'], ['technical/24-admin-record-pages-and-test-isolation.md']),
    ('execution_capacity', [1,2,8,9,35,44,46,52,57,58,61,89,102],
     '数据库原子执行容量、当前用户/企业/能力交集、原生多 handler、企业交错派发、单预留延迟重派和未知执行保留槽位；不含完整 NFR 压测。',
     ['platform_regression','execution_capacity','desktop','extension'], ['technical/23-execution-capacity-and-fair-dispatch.md']),
    ('pre_execution_input_checkpoint', [1,2,7,9,35,39,44,46,61,67,69,72],
     '明确提交运行前文件/连接需求、同任务单预留与单次入队、私人上传、跨端选择、资源撤销和计划输入守卫；不含已付费步骤续做。',
     ['platform_regression','task_dependencies','admin_task_inputs','desktop','extension','runtime_schemas'], ['technical/22-pre-execution-input-checkpoint.md']),
    ('durable_erasure', [1,2,6,12,49,57,61,68,90,91],
     '持久删除账本、不可逆墓碑、物理对象/缓存清理、子作业依赖、隔离与后台受控重试；逐项孤儿扫描处理其他工作者刚删除的对象，同时保留 EACCES/EBUSY 等真实 I/O 错误。',
     ['platform_regression', 'web_admin'], ['technical/17-erasure-transfer-retention-events.md','technical/34-user-profile-context-and-orphan-scan-races.md']),
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
 3:'三端登录/PKCE、五个规范用户认证接口、本人目录/整族撤销、刷新退出竞争等已有局部证据；当前新增首次交换短重试的完整原生重跑受启动阻塞。原始用户资料、邀请及成员契约已有增量证据；完整后台规范与企业身份/客户端故障矩阵仍待完成，不能据此关闭 TC-003。',
 36:'原生全局侧栏的真实 action/右侧出现、跨页保留与重启配置已验证；网页选择/站点授权和全部业务上下文的完整矩阵仍待验收。',
 89:'方案未完成工作上限和实际企业/能力执行容量已区分；席位、存储、信用、完整历史版本与正式权益全部路径仍待验收。',
 7:'明确提交的文件/连接需求已能在原任务补齐；自动发现阻塞字段与全业务输入引导仍待完成。',
 69:'已实现首次模型调用前的显式文件/连接检查点；已付费步骤恢复、自动识别、capability/device 和离线等待仍未完成。',
 1:'需对其余连接器、团队、媒体、批量/导出和所有规范接口继续进行跨企业负向验证。',
 2:'其余业务动作、品牌/项目角色矩阵、解除授权后的全部下载与异步路径仍需完整验收。',
 5:'默认助手与持续专家已有局部证据；完整品牌/工具继承及全部版本/跨端用例尚未完成。',
 6:'在线删除及缓存已修复；全部历史引用、索引与备份恢复后的删除重放仍待完成。',
 8:'云执行与事件已验证局部流程；完整真实步骤/部分产物状态及全部故障仍待验收。',
 9:'首次模型调用前的排队暂停、原任务/原预算恢复与领取竞争已有验证；运行中安全暂停、已付费步骤检查点/同任务累计费用和未知外部动作闭环仍未完成。',
 11:'事件身份和可读状态已有修复；全业务 step/trace/工具链与规范字段仍需核对。',
 12:'云版本引用、实际源码 ZIP 和单页 PDF 源快照已验证；全类型预览、局部成功/修改/审阅及全部可恢复工程未齐。',
 14:'需验证所有端完整 1 GiB 实传、生产对象存储及旧 multipart/扩展桥接大文件迁移。',
 15:'模拟接口下功能继续验证；真实内部 Image 2 生成/编辑和业务质量尚未验收。',
 16:'真实分层图文可生成 PDF 审阅稿并独立渲染；完整换行/溢出检查、字体来源/授权与所有专业排版仍待验收。',
 22:'PDF 实际下载、源快照、版本冲突及原生保存已有局部验证；评论/接受/修改闭环、完整 ZIP 版本清单及全部业务编辑描述未齐。',
 23:'CSV/XLSX 固定文件版本、映射/口径、并发去重、实际单元格定位、跨端确认、显式更正链与规范导入/快照已有局部证据；完整官方导出/语言数字矩阵、多维事实模型和规范资产上传 API 尚未完成。',
 24:'精确小数、未知/零原因、多来源 AnalysisSpec/比较、原子报告任务、固定资产、分页事实工具、规范证据查询与数字引用校验已有局部证据；完整语义/统计质量、正式连接数据、全部币种/归因矩阵和专业交付仍未完成。',
 35:'文件/技能、默认助手、通知和首次运行前补齐已有证据；团队、自动缺口发现、步骤续做与全业务整合仍待完成。',
 37:'Web 与 Desktop 传输有新证据；兼容降级、扩展及所有撤销场景仍未完整验收。',
 38:'Desktop 新传输不等同扩展 Native Host 全量大文件验收；协议矩阵仍待完成。',
 39:'源码原生登录/传输及本次独立无边框预览包通过局部验证；历史完整离线包保留，更新/签名/卸载与系统/DPI 矩阵待完成。',
 41:'身份与云文件接续有局部证据；任务内本地步骤、离线等待/重连续做仍待完成。',
 43:'当前新增方法/上传/云文件仍走受控工具；新增媒体/后台/所有出站路径尚需验收。',
 44:'锁定真实 Codex 的跨进程原线程/工具续聊、配置回执、增量用量、中断与 I/O 故障已有原语验证；Worker 已付费步骤续做、全故障/多节点与完整恢复仍待完成。',
 46:'保留整数预留/结算和对账；新增并行/媒体/本地全路径竞争及所有未知费用仍需验收。',
 47:'模拟 gift 不代表真实收款或正式权益全量验收；席位/存储/额度执行仍待齐。',
 49:'在线永久删除/保留规则/进度已修复；项目/企业整删、导出、备份轮换与删除重放未完成。',
 50:'需完成全端传输/媒体分支、正式 OAuth 和区域流向的全部证明。',
 51:'新增流程已有双语与微额费用修复；全产品动态文案、时区及指标口径待齐。',
 52:'数据库企业/用户/能力容量、多 Worker 与交错派发已有证据；供应商逐调用限流、独立媒体队列和完整 NFR 负载仍待验收。',
 53:'队列恢复不代替备份；实际备份/恢复演练、RPO/RTO 及删除账本恢复重放未完成。',
 54:'迁移摘要与前向修复已有实现；灰度、回滚、旧设备兼容及签名更新待完成。',
 55:'新增页宽度与表单流程有局部证据；所有关键路径的键盘、缩放、对比和错误定位未完整验证。',
 57:'新增文件树/源码/安装/传输有执行端守卫；其余网络/进程/不可信内容路径仍需逐项验证。',
 58:'模拟模式明确展示与隔离；全部离线设备、未授权账户、异步媒体和缺口补齐仍待完成。',
 60:'本轮全部源码/文档维持 D 盘原生工具与自建浏览器清理；最终独立仓库完整交付仍待更新。',
 61:'会话私有云目录与删除边界已有局部验证；全部多任务消息补充/定位及生命周期仍待齐。',
 62:'默认助手、共享固定配置、私人原子委派和模板预检/建立已有验证；完整专业输入引导与模板发布/升级仍未完成。',
 67:'默认助手和专业任务遵守问答/计划/执行；完整规范计划版本与所有关键输入变化/恢复分支仍待验收。',
 72:'示例不自动提交、默认私人委派、站内通知和原任务定位已验证；附图及完整业务阻塞项恢复仍待完成。',
 63:'树/搜索/版本/移动/权限/持久源码已验证；Office/PDF 分页、选择器大目录检索及完整 TC 仍待齐。',
 64:'随附方法项目生命周期已实现；自定义包、试运行审核/组织发布与全部动态资源交集未完成。',
 68:'固定版本源码修改和独立共享有证据；图片选区、视频时段、文本锚点、完整审阅仍待齐。',
 73:'18 个候选仍需≥12 个真实服务合格角色；模拟链路不计入正式数量。',
 74:'有精确包/安装/绑定；逐角色完整输入输出、流程/产物与异常验收未完成。',
 75:'实际 Codex 加载和安全撤销有局部证据；所有角色、团队、后台与恢复分支未全覆盖。',
 76:'持久目录筛选、无费用预检和再次校验的幂等实例化已验证；专业业务输入及所有依赖在原会话补齐仍未完成。',
 77:'模拟设计逻辑不代表真实 Image 2 资格；分层工程、限定编辑与实际业务完整验收待齐。',
 78:'名称/职责/语言覆盖与非法内核/API/技能覆盖拒绝已有模板证据；品牌版本、企业模板包和受控发布仍未完成。',
 79:'模板、Codex 配置、能力与技能的真实版本绑定及撤销已验证；企业模板覆盖、新版比较/显式升级和安全复制仍待完成。',
 80:'真实服务合格角色数仍为零；至少 12 个任务/修改/异常的实际资格证据未完成。',
 81:'新增页面延续官网 token；全部端的组件单源与全量品牌一致性仍待核查。',
 82:'局部两主题/语言/四尺寸通过；全组件状态、100/200% 缩放、键盘/对比/reduced-motion 验收待完成。',
 86:'模拟数据单列且微额费用可读；正式多维消费归属和未知成本全量钻取仍待验收。',
 87:'模拟额度走可追踪 gift；正式费用全部动作/收款关联/退款与限时额度仍需完整验收。',
 90:'内容目录新增云节点；专业团队、方案、自定义方法及所有正文修订治理未完成。',
 91:'在线隔离/永久删除/进度已补强；所有下载/索引/链接与备份恢复场景仍待完整验收。',
 92:'独立 MFA/企业范围的 Admin 排队暂停、共用领域守卫、原受益用户撤权与费用待核对拒绝已有验证；运行中检查点、全工作流/Routine 控制和未知外部动作人工核对仍待齐。',
 94:'项目方法及清理记录已有权限子流程证据，包含企业/项目 deny、只读与到期；全动作/字段/范围/导出及异步执行完整矩阵待完成。',
 98:'清理记录已验证组合筛选/URL/分页、有界滚动、四宽度、主题/语言、请求拒绝清空和失效重试对话框；全后台筛选、列配置、异常及完整键盘/缩放仍待验证。',
 99:'可信方法版本/撤销已补强；模型/费率的受控验证发布、兼容版本与后台全闭环待完成。',
 102:'当前方案能力及领取时用户并发已复查，企业/能力槽位按数据库统一约束；全部媒体、团队、调度、席位和存储交集未齐。',
}


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def fingerprint(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    # Mirror the exact client build receipt into the documentation tree; source
    # repositories retain the original evidence and all actual artifacts.
    artifact_receipt = DEV/'copypaste-delivery/evidence/native-surfaces-artifacts.json'
    (DOCS/'quality/native-surfaces-artifacts.json').write_bytes(artifact_receipt.read_bytes())
    baseline_path = DOCS/'quality/requirements-alignment-baseline.json'
    baseline = load(baseline_path)
    assert len(baseline['requirements']) == 102
    amendment_path = DOCS/'quality/requirements-amendments.json'
    amendment = load(amendment_path)
    assert amendment['baseline_raw_sha256'] == baseline['requirements_sha256']
    assert amendment['original_102_acceptance_conditions_preserved'] is True
    current_srs = (DOCS/'requirements/01-srs.md').read_text(encoding='utf-8').replace('\r\n','\n')
    assert hashlib.sha256(current_srs.encode()).hexdigest() == amendment['amended_lf_sha256'], 'Review changed SRS before carrying evidence forward'
    assert {c['requirement_id'] for c in amendment['changes']} == {'REQ-036','REQ-039'}
    restored_srs = current_srs
    for change in amendment['changes']:
        assert restored_srs.count(change['amended_line']) == 1
        restored_srs = restored_srs.replace(change['amended_line'],change['original_line'],1)
    assert hashlib.sha256(restored_srs.encode()).hexdigest() == amendment['baseline_lf_sha256']
    assert hashlib.sha256(restored_srs.replace('\n','\r\n').encode()).hexdigest() == baseline['requirements_sha256']
    files = {
        'platform_regression': DEV/'copypaste-delivery/evidence/alignment-platform.json',
        'membership_wire': DEV/'copypaste-delivery/evidence/membership-wire.json',
        'auth_navigation': DEV/'copypaste-delivery/evidence/auth-navigation.json',
        'sessions': DEV/'copypaste-delivery/evidence/sessions.json',
        'task_controls': DEV/'copypaste-delivery/evidence/task-controls.json',
        'web_admin': DEV/'copypaste-delivery/evidence/alignment.json',
        'cloud_files': DEV/'copypaste-delivery/evidence/cloud-files.json',
        'desktop': DEV/'copypaste-delivery/evidence/alignment-desktop.json',
        'extension': DEV/'copypaste-delivery/evidence/extension.json',
        'skills': DEV/'copypaste-delivery/evidence/skills.json',
        'notifications': DEV/'copypaste-delivery/evidence/notifications.json',
        'default_assistant': DEV/'copypaste-delivery/evidence/default-assistant.json',
        'task_dependencies': DEV/'copypaste-delivery/evidence/task-dependencies.json',
        'execution_capacity': DEV/'copypaste-delivery/evidence/execution-capacity.json',
        'admin_task_inputs': DEV/'copypaste-delivery/evidence/admin-task-inputs.json',
        'admin_records': DEV/'copypaste-delivery/evidence/admin-records.json',
        'agent_templates': DEV/'copypaste-delivery/evidence/agent-templates.json',
        'design_pdf': DEV/'copypaste-delivery/evidence/design-pdf.json',
        'marketing_analytics': DEV/'copypaste-delivery/evidence/marketing-analytics.json',
        'analysis_reports': DEV/'copypaste-delivery/evidence/analysis-reports.json',
        'file_imports': DEV/'copypaste-delivery/evidence/file-imports.json',
        'workbook_interop': DEV/'copypaste-delivery/evidence/workbook-interop.json',
        'native_surfaces': DEV/'copypaste-delivery/evidence/native-surfaces.json',
        'native_artifacts': DEV/'copypaste-delivery/evidence/native-surfaces-artifacts.json',
        'analysis_index': DEV/'copypaste-delivery/evidence/analysis-index-backfill.json',
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
        assert not report.get('errors') and not report.get('failures'), f'{key}: report contains failures'
        if 'browser_closed' in report:
            assert report['browser_closed'] is True
        if 'desktop_closed' in report:
            assert report['desktop_closed'] is True
        if 'extension_closed' in report:
            assert report['extension_closed'] is True
        if key == 'native_artifacts':
            assert report['signed'] is False and report['installed_or_published'] is False
            assert len(report['artifacts']) == 3
            for artifact in report['artifacts']:
                actual_file = (DEV/artifact['path']).resolve()
                assert actual_file.is_relative_to(DEV.resolve())
                assert actual_file.stat().st_size == artifact['bytes']
                assert fingerprint(actual_file) == artifact['sha256']
            native_report = DEV/'copypaste-delivery'/report['validation']['path']
            assert fingerprint(native_report) == report['validation']['sha256']
        evidence[key] = {'path': path.relative_to(ROOT).as_posix(), 'sha256': fingerprint(path),
                         'at': report.get('at', report.get('checked_at')), 'checks': checks,
                         'scope': report.get('scope', 'Only the explicitly named subflows in this report')}
        if key == 'membership_wire':
            assert report['owned_sessions_closed'] is True
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
            'requirements_amendments':{'path':amendment_path.relative_to(ROOT).as_posix(),'sha256':fingerprint(amendment_path),'changes':amendment['changes'],'original_acceptance_baseline_preserved':True},
            'summary':dict(Counter(r['assessment'] for r in rows)), 'fully_accepted_requirements':0,
            'qualified_live_roles':0, 'release_artifacts':'Original 0.5.0 offline bundles remain historical; separate frameless Desktop and native Side Panel preview artifacts are recorded in dev/copypaste-delivery/evidence/native-surfaces-artifacts.json, using localhost origins and no signing or production publication',
            'repositories':repositories,'evidence':evidence,
            'unresolved_runtime_evidence':[{
                'path':'dev/copypaste-delivery/evidence/auth-recovery-open-issue.json',
                'sha256':fingerprint(DEV/'copypaste-delivery/evidence/auth-recovery-open-issue.json'),
                'status':'not_completed',
                'scope':'Expanded current-source native first-exchange journey is not proven; startup comparison and failed attempts are preserved separately, never counted as passing evidence.'}, {
                'path':'dev/copypaste-delivery/evidence/membership-current-issue.json',
                'sha256':fingerprint(DEV/'copypaste-delivery/evidence/membership-current-issue.json'),
                'status':'not_completed',
                'scope':'Current source Web membership reruns timed out at browser page/locator creation; all owned instances closed. Earlier browser success bytes were overwritten and are not accepted evidence; five current HTTP checks remain separate from final UI acceptance.'}],
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
