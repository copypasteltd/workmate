"""Record bounded repair evidence while preserving every original acceptance case."""
from pathlib import Path
from datetime import datetime, timezone
from collections import Counter
import hashlib
import json
import re
import subprocess
from verify_resource_evidence import history as resource_repair_history

ROOT = Path(__file__).resolve().parents[2]
DOCS, DEV = ROOT / 'docs', ROOT / 'dev'

# Entries describe verified subflows, never a whole-requirement acceptance pass.
CLUSTERS = [
    ('enterprise_seats_and_storage_admission', [47,83,84,88,89,94,96,98,100,102],
     '企业有效固定方案决定共用容量，个人VIP不扩容；锁内所有启用成员与全部保留版本、独立副本、私人内容和有效上传承诺统计。邀请/恢复/Admin审批和对象写入前、数据库写入/提交共用守卫；并发幂等、长事务真实时钟、降级不删旧数据、既有预留不重复计费、实际清理后释放。当前Web/Admin八组页面、三端读取和375项全量为局部证据；058/059两库各23类旧行前后完全一致，首次374项中1项私人删除冲突及定位歧义原回执保留，前向修复不改已应用SQL。完整商业/生产/安装/角色与102项综合验收继续保留。',
     ['platform_regression','resource_ui','resource_migrations','resource_erasure_migrations','native_vip'], ['technical/48-enterprise-seat-and-storage-enforcement.md']),
    ('canonical_vip_lifecycle_and_live_entitlements', [47,83,84,88,89,94,96,98,100,102],
     '原始 VIP 授予/修订命令、签名游标与实际 Admin 冻结表单；个人/企业及模式主体版本、固定方案和原操作者来源、显式重叠/预约替换、真实同版本续期、暂停/恢复/撤销/实时到期，当前 MFA/整体范围/重叠拒绝、付费财务读取、独立审批及原会话/策略/前态复查，并发幂等和审计事务回滚。用户原始 PlanList/EffectiveEntitlements、合并功能和最大配额、独立资源/预算、持久个人通知/outbox与真实页面为局部证据。057 已实际应用，两库 001–056 原文件不变；测试库有完整前后行比较，主库首次自动启动先执行 057，缺少主库升级前行快照，失败与限制保留。席位/存储的后续局部执行另列；VIP加赠额原子操作、旧授权规范迁移、完整安装/SSO/系统和全部综合验收继续保留。',
     ['platform_regression','admin_vip','native_vip','vip_migrations','runtime_schemas'], ['technical/47-canonical-vip-lifecycle-and-effective-entitlements.md']),
    ('immutable_plan_definitions_and_legacy_bindings', [47,88,89,94,96,98,100,102],
     '原始 AdminPlanDraft/版本列表/202 发佈命令与实际结构化 Admin 页面：不可变家族版本、冻结比较、全域当前权限与重叠 deny、近期 MFA、独立审批及原会话/策略/前态复查、并发版本/发佈幂等和审计回滚。056 保留真实旧行，原快照与现在计算的空快照绑定分开标源，自定义快照不补造原 UUID，新发佈不重绑旧授权。24 项聚焦及当前完整回归、六组页面为局部证据；规范 VIP、个人企业合并及用户读取的后续有界修复另列，席位/存储的后续局部执行另列，生产及全部综合验收继续保留。',
     ['platform_regression','admin_plans','plan_migrations','runtime_schemas'], ['technical/46-immutable-plans-and-legacy-grant-bindings.md']),
    ('source_bound_refunds_and_cash_reconciliation', [11,46,83,84,87,94,96,98,100,101],
     '原始 AdminFeeRefund 与实际统一表单：消费补偿按不可变结算/偿还来源返还原赠额、付费及授信，原到期时间保留；现金退款绑定已核实原付款，只预留未用资金，再由另一实际管理员逐次核实真实付款/剩余未付，未知及差额保留预留。两库053–055固定真实期初债务，拒绝旧流水绕过；权限/MFA/版本/并发/累计及审计回滚受测。50项聚焦、当前全量及8组浏览器是局部证据；历史授信来源人工对账、真实支付机构、通知/outbox、完整VIP/财务/权限与所有综合验收继续保留。',
     ['platform_regression','admin_fees','refund_migrations','refund_schemas','runtime_schemas'], ['technical/45-source-bound-refunds-and-cash-reconciliation.md']),
    ('manual_payment_evidence_and_posting', [87,94,96,98,100,101],
     '原始付款列表、登记与独立核实、精确付款充值及真正流水关联；原凭据/模式/主体检查，双人核实与当前 MFA/权限，来源与金额完全一致，香港日界及审批仍走共用费用控制器，同笔付款并发只入账一次、实际授信还款、历史外部编号防重与事务审计回滚。付款事实和操作意图只追加/不可变；051/052按原字节保留失败迁移并追加修复。完整退款、支付机构/VIP与综合验收仍保留。',
     ['platform_regression','admin_fees','runtime_schemas'], ['technical/44-manual-payment-evidence-and-exact-posting.md']),
    ('shared_admin_approvals', [83,84,85,87,94,96,98,100],
     '现有费用、成员、账户与旧后台待审批操作共用真实请求；原始严格游标列表和四字段/202决定、当前整体范围/模式/重叠拒绝、本人自批防护与双业务权限/MFA、原会话/策略/前态复查、事务审计回滚及并发幂等。SQL 048 保留原费用身份，登记已冻结成员/账户，缺失事实的旧操作取消并记录；后台实际过期无伪造人工决定。十一组共享专项和旧047带数据升级，以及当前六组成员/五组费用页面为局部证据。完整支付/凭证/退款/VIP、通知/outbox、全业务权限/导出/原生及全部综合验收继续保留。',
     ['platform_regression','admin_membership_ui','admin_fees','runtime_schemas'], ['technical/43-shared-admin-approval-requests.md']),
    ('canonical_fees_and_independent_approvals', [83,84,87,94,96,98],
     '三项原始规范赠送/原账项扣减/授信命令及真实 Admin 表单；精确 HKD 字符串、只读预览、冻结版本/来源/策略、当前 MFA 和整体账户范围、单笔及每日限额、同键回执恢复、独立审批请求与不可变决策记录、审批前原操作者会话和当前授权重检、账务与审计原子回滚。十四组新增数据库专项、四组浏览器/HTTP 和十份规范响应是局部证据；完整付款/凭证/退款/VIP、完整业务审批与财务通知/outbox、原生和综合验收仍未完成。',
     ['platform_regression','admin_fees','runtime_schemas'], ['technical/41-canonical-fee-commands-and-independent-approvals.md']),
    ('billing_subjects_and_events', [11,46,86,87,101],
     '真实个人/企业账户和模拟/正式模式分离；直接任务付款快照与幂等、共用 BigInt 资金内核；原操作者/操作/账项来源及预留/消费/释放/信用事件持久且不可变，历史未知事实不补造；三处原始规范账户/账本读取、整体财务范围与重叠项目拒绝、签名游标、旧企业账本排除个人消费。带旧数据的升级、隔离专项与当前 HTTP 读取是局部证据；全部工作流及用户端付款选择、完整费用/凭证/退款/VIP写入和所有综合验收仍未完成。',
     ['platform_regression','billing_accounts_migration','admin_billing_wire','runtime_schemas'], ['technical/40-billing-subjects-and-financial-event-provenance.md']),
    ('billing_settlement_sources', [11,46,86,87,101],
     '授信预留后的后续充值/赠送按真实可用批次结算，保留其他任务冻结；BigInt 累计余额、实际债务偿还和信用下限；新扣费来源与还款事实不可变、企业隔离并在数据库提交时校验来源合计；仅账务内核专项，不含完整规范付款/费用/VIP流程或历史来源补造。',
     ['platform_regression','billing_migration','native_runtime_alias'], ['technical/39-billing-credit-and-settlement-provenance.md']),
    ('admin_canonical_directories', [3,35,51,55,83,84,85,86,94,98,100],
     '原始 AdminUserList/AdminUserDetail/AdminTenantList 的三处规范读取及当前页面消费者；严格查询、真实登录时间和独立账务账户 ID、绑定当前权限与筛选的签名游标、微秒时间戳并列排序、企业/项目/字段交集、账本确认扣费及半开结算时段、有效 VIP 与无权字段/筛选防推断。目录与导出专项及七组实际 Admin 页面/HTTP 为局部证据；完整消耗钻取、费用/VIP 写规范、批量导出、旧成员页面、原生和发布仍待验收。',
     ['platform_regression','admin_directory_ui','runtime_schemas'], ['technical/38-admin-canonical-directories-and-scoped-usage.md']),
    ('admin_account_lifecycle', [3,35,51,55,83,84,85,94,96,100],
     '四个规范账户写入口、严格 202 AdminOperation、前向版本与标签/关闭标记、锁内当前 MFA/权限/显式拒绝及幂等、全局用户与单企业状态边界、全部会话/未交换代码撤销、关闭与重开独立审批、冻结策略/前态重检、批量守卫以及共享取消/待核费用预留。十二组专项、六组真实 HTTP 及五组新账户表单实测是局部证据；页面直接定位待审批/普通操作，三宽度的英文浅色及繁中深色已测。旧成员页面、完整列表/详情业务、费用写规范及原生综合验收仍待完成；本轮规范读取与页面增量另列。',
     ['platform_regression','admin_account_wire','admin_account_ui','runtime_schemas'], ['technical/37-admin-account-lifecycle-and-inflight-control.md']),
    ('admin_membership_control', [3,35,51,55,85,94,100],
     '规范 AdminMembershipChange / 202 AdminOperation 与当前操作查询；企业范围和显式项目 deny、近期 MFA、共用成员锁/最后 owner、管理暂停绕过拦截、持久幂等、不可变策略快照、冻结预览及独立审批重检。隔离数据库、真实 HTTP 及当前六组 Admin 页面验证，包括实际双人邮件/TOTP、暂停/恢复和用户端提示、精确操作跳转、自批拒绝、独立审批及繁中深色窄屏；四份实际规范响应通过。共享审批目录与决定另列增量，全部 Admin/原生契约仍待验收。',
     ['platform_regression','admin_membership_wire','admin_membership_ui','runtime_schemas'], ['technical/36-admin-membership-control-and-policy-snapshots.md']),
    ('invitations_and_membership_authority', [1,2,3,35,36,39,51,55,60],
     '原始 Invite/Member/MemberList/Ack、独立成员 ID、企业头及分页、角色/项目守卫、锁内当前权限、最后所有者、接受与移除幂等、旧待用邀请撤销、加密投递重试和重发版本；HTTP 五组及十三组隔离平台检查，新增当前 Web 六组实际页面验证与四份规范响应，覆盖投递/重发、真实邮箱加入/工作区选择、只读权限、即时移除/撤销和退出后的迟到上下文。完整原生成员旅程、生产邮件与完整后台规范仍待完成。',
     ['platform_regression','membership_wire','membership_ui','runtime_schemas'], ['technical/35-invitations-and-membership-authority.md']),
    ('canonical_user_and_private_context', [1,2,3,35,36,39,51,55,60,100],
     '原始 GET /v1/me 严格 User 与受认证工作区上下文分离；三端实际消费者同步迁移，不同账号混合 Cookie/Bearer 只返回选用身份的工作区，原生不得取得浏览器 CSRF。真实 PostgreSQL、HTTP User schema、Web 初始化及当前十二组 Web/源码 Electron/MV3 认证和会话恢复独立记录；安装包、完整身份/系统及原生成员旅程仍待验收。',
     ['platform_regression','auth_navigation','native_auth_recovery','runtime_schemas'], ['technical/34-user-profile-context-and-orphan-scan-races.md']),
    ('canonical_authentication_and_retry_recovery', [1,2,3,35,36,39,51,55,60,100],
     '原规范五个用户认证接口及三端消费者、HTTP-only 验证码 flow、S256/顶层授权与 CSRF、原子加密回执及剩余有效期。当前十二组 Web/源码 Electron/MV3 实测覆盖首次交换与刷新已提交回执丢失的同键恢复、单个凭证族、双面板账号隔离、远程撤销、过期/离线退出及迟到响应。旧启动失败和诊断原字节保留；新证据前后 775 份源码/运行文件一致且拥有的三端实例和凭证已清理。完整 SSO/安装包/系统矩阵仍待验收。',
     ['platform_regression','auth_navigation','native_auth_recovery','runtime_schemas'], ['technical/33-canonical-authentication-and-retry-recovery.md','technical/34-user-profile-context-and-orphan-scan-races.md']),
    ('cross_client_session_lifecycle', [1,2,3,35,36,39,51,55,60,100],
     '三端实际登录/PKCE、无凭证设备目录/当前装置、过期访问仍可撤销、刷新整族与并发竞争、迟到回执隔离、离线退出反馈、本地文件授权清理、成员撤销后旧入口及跨标签清理；当前规范认证/上下文上的十二组真实源码原生会话检查另列，含 1440px 浅色/375px 深色与双面板换账号。完整 SSO、安装/系统矩阵和 TC 全部条件仍未完成。',
     ['platform_regression','sessions','native_auth_recovery'], ['technical/32-cross-client-sessions-and-revocation.md','technical/34-user-profile-context-and-orphan-scan-races.md']),
    ('initial_pause_and_native_continuation', [1,2,8,9,11,35,36,39,44,46,51,60,69,92],
     'Web/源码无边框 Desktop/MV3 排队暂停与同任务单预留恢复、领取竞争/权限与来源复查、Admin 共用领域守卫；真实 Codex 跨进程原历史/工具续聊、增量用量、中断和回执 I/O 故障保留消耗。适配器原语未接已付费步骤恢复，不构成完整暂停/检查点验收。',
     ['platform_regression','task_controls'], ['technical/31-task-controls-and-native-continuation.md']),
    ('native_window_and_sidepanel', [36,39,51,55,60,81,82],
     '当前源码重新构建的 Desktop 无原生边框/默认菜单、自绘双语主题标题栏、实际窗口按钮与指针/键盘有界缩放、跨窗口 IPC 拒绝、真实打包登录及弹窗；Chrome action 实际创建右侧 SIDE_PANEL、跨页保留/收起及重启配置。验证绑定测试前后相同的客户端、安装器、扩展及源码字节，历史预览独立保留。后续源码认证十二组另列；完整安装包认证、系统/DPI、安装/卸载、签名更新与全产品可访问性仍待验收。',
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
 3:'三端登录/PKCE、五个规范用户认证接口、本人目录/整族撤销、刷新退出竞争和当前十二组源码原生回执恢复已有局部证据；当前 Web 邀请及 Admin 成员页面各六组通过。完整后台规范、企业身份/安装包/系统及全部客户端故障矩阵仍待完成，不能据此关闭 TC-003。',
 36:'原生全局侧栏的真实 action/右侧出现、跨页保留与重启配置已验证；网页选择/站点授权和全部业务上下文的完整矩阵仍待验收。',
 88:'固定方案、来源及规范VIP生命周期、实时个人/企业合并已有局部证据；本轮增加独立企业席位/存储执行及后台容量权限。旧授予规范迁移、VIP加赠额原子组合、全状态和生产矩阵仍待验收。',
 89:'功能集合、同类配额最大值、实际服务器时刻和资源/预算交集已有局部证据；企业席位、保留版本和上传预留现有实际准入/释放守卫。物理磁盘运维、媒体/团队/调度及全部业务配额和综合验收仍待齐。',
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
 47:'固定方案与个人/企业权益已有局部证据；企业席位和逻辑资产存储新增并发准入、上传承诺及清理释放证明。模拟数据不代表真实收款，完整商业额度、生产服务及综合验收仍待齐。',
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
 85:'规范成员变更/操作查询、管理暂停/恢复及账号与企业状态分离已有隔离数据库和当前 HTTP 证据；完整用户/企业字段、责任转移、跨端页面和全部后台矩阵继续待验收。',
 86:'模拟数据单列且微额费用可读；正式多维消费归属和未知成本全量钻取仍待验收。',
 87:'赠送/原额扣回/授信/核实付款、消费原来源补偿及现金承诺/独立分次核实已有规范命令、实际页面、日限、独立审批和回执证据；未知/差额保留预留。方案及 VIP 的有界增量另列；历史授信来源人工对账、正式支付机构、VIP 加赠额原子组合、金融 outbox 和全部费用验收仍待完成。',
 90:'内容目录新增云节点；专业团队、方案、自定义方法及所有正文修订治理未完成。',
 91:'在线隔离/永久删除/进度已补强；所有下载/索引/链接与备份恢复场景仍待完整验收。',
 92:'独立 MFA/企业范围的 Admin 排队暂停、共用领域守卫、原受益用户撤权与费用待核对拒绝已有验证；运行中检查点、全工作流/Routine 控制和未知外部动作人工核对仍待齐。',
 94:'项目方法、清理记录和规范 Admin 成员管理已有权限子流程证据，包含当前企业范围、重叠项目 deny、近期 MFA 与撤权；全动作/字段/范围/导出及异步执行完整矩阵待完成。',
 98:'清理记录已验证组合筛选/URL/分页、有界滚动、四宽度、主题/语言、请求拒绝清空和失效重试对话框；全后台筛选、列配置、异常及完整键盘/缩放仍待验证。',
 99:'可信方法版本/撤销已补强；模型/费率的受控验证发布、兼容版本与后台全闭环待完成。',
 100:'规范成员操作的原因/前后差异审计、不可变有效策略、冻结预览及独立审批的原权限/版本/期限重查已有证据；全部资金/内容/权限策略、批次与生产审计留存仍待完成。',
 101:'人工付款及原交易累计退款、原结算/还款资金桶补偿、过期赠额不复活、现金申请与独立实际分次付款、剩余未付/未知/差额对账、不可变事实及实际后台页面已有局部证据。历史授信来源人工对账、正式支付机构/回调、完整财务通知/用户费用消费者和全部退款矩阵仍待实现及验收。',
 102:'当前方案能力及领取时用户并发已复查，企业/能力槽位按数据库统一约束；全部媒体、团队、调度、席位和存储交集未齐。',
}


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def fingerprint(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify_file_manifest(root, entries, exact_directory=False):
    root = root.resolve()
    paths = set()
    for entry in entries:
        actual = (root/entry['path']).resolve()
        assert actual.is_relative_to(root) and actual not in paths
        assert fingerprint(actual) == entry['sha256'], str(actual)
        paths.add(actual)
    if exact_directory:
        assert paths == {p.resolve() for p in root.rglob('*') if p.is_file()}


def approval_repair_history():
    delivery = DEV/'copypaste-delivery'
    evidence = delivery/'evidence'
    runs = []
    for name, expected in [
        ('unified-approvals-focused-initial.tap', (48,32,16)),
        ('unified-approvals-focused-second.tap', (48,43,5)),
        ('unified-approvals-migration-first.tap', (3,2,1)),
        ('unified-approvals-focused-third.tap', (53,53,0)),
    ]:
        path = evidence/name
        raw = path.read_text(encoding='utf-8')
        counts = {key:int(re.search(r'^# '+key+r' (\d+)$',raw,re.M)[1])
                  for key in ['tests','pass','fail','cancelled','skipped','todo']}
        assert tuple(counts[key] for key in ['tests','pass','fail']) == expected
        assert all(counts[key] == 0 for key in ['cancelled','skipped','todo'])
        runs.append({'path':path.relative_to(ROOT).as_posix(), 'sha256':fingerprint(path),
                     'counts':counts, 'status':'passed' if not counts['fail'] else 'failed_original_retained'})
    archives = []
    for name in [
        'stage42-before-unified-approvals/archive-map.json',
        'stage42-before-unified-approvals/additional-account/archive-map.json',
        'unified-approvals-fees-initial/archive-map.json',
        'unified-approvals-fees-initial/raw-text-archive-map.json',
        'unified-approvals-before-lf-normalization/archive-map.json',
    ]:
        manifest = evidence/name
        rows = load(manifest)['files']
        assert rows
        for row in rows:
            archived = Path(row['archive'])
            path = ((delivery/archived) if archived.parts[0] == 'evidence' else (manifest.parent/archived)).resolve()
            assert path.is_relative_to(delivery.resolve())
            assert fingerprint(path) == row['sha256'], f'Changed approval history: {path}'
        archives.append({'path':manifest.relative_to(ROOT).as_posix(), 'sha256':fingerprint(manifest),
                         'verified_files':len(rows)})
    live = evidence/'unified-approvals-live-migration.log'
    raw = live.read_text(encoding='utf-8')
    assert 'copypaste: applied migration 48' in raw and 'copypaste_test: applied migration 48' in raw
    return {'scope':'Bounded shared approval repairs only; initial failures and prior success bytes preserved',
            'focused_runs':runs, 'archives':archives,
            'native_migration_log':{'path':live.relative_to(ROOT).as_posix(), 'sha256':fingerprint(live)},
            'migration_048_sha256':fingerprint(DEV/'copypaste-platform/migrations/048-unified-admin-approvals.sql')}


def payment_record_repair_history():
    evidence = DEV/'copypaste-delivery/evidence'
    runs = []
    for name, expected in [
        ('payment-records-focused-initial.tap',(18,17,1)),
        ('payment-records-focused-second.tap',(19,18,1)),
        ('payment-records-focused-third.tap',(19,19,0)),
        ('payment-records-focused-final.tap',(20,2,18)),
        ('payment-records-focused-fifth.tap',(20,14,6)),
        ('payment-records-focused-sixth.tap',(21,21,0)),
        ('payment-records-updated-journeys.tap',(4,4,0)),
    ]:
        path = evidence/name
        raw = path.read_text(encoding='utf-8')
        counts = {k:int(re.search(r'^# '+k+r' (\d+)$',raw,re.M)[1]) for k in ['tests','pass','fail','cancelled','skipped','todo']}
        assert tuple(counts[k] for k in ['tests','pass','fail']) == expected
        assert all(counts[k] == 0 for k in ['cancelled','skipped','todo'])
        runs.append({'path':path.relative_to(ROOT).as_posix(),'sha256':fingerprint(path),'counts':counts,'status':'failed_original_retained' if counts['fail'] else 'passed'})
    archives = []
    for name in ['stage43-before-payment-records','payment-records-trigger-failure','payment-records-upload-qa-failure','payment-records-before-list-refresh','payment-records-before-scope-description','payment-records-before-detail-layout','payment-records-full-regression-failure']:
        manifest = evidence/name/'archive-map.json'
        entries = load(manifest)['files']
        assert entries
        for entry in entries:
            path = (ROOT/entry['archived']).resolve()
            assert path.is_relative_to(evidence.resolve())
            assert fingerprint(path) == entry['sha256'], f'Changed payment history: {path}'
        archives.append({'path':manifest.relative_to(ROOT).as_posix(),'sha256':fingerprint(manifest),'verified_files':len(entries)})
    failed = load(evidence/'payment-records-full-regression-failure/alignment-platform.json')
    assert failed['status'] == 'failed' and failed['counts'] == {'tests':310,'pass':306,'fail':4,'cancelled':0,'skipped':0,'todo':0}
    assert fingerprint(evidence/'payment-records-full-regression-failure/alignment-platform.tap') == failed['sha256']
    migrations = []
    for version, suffix in [(49,'live'),(50,'immutable'),(51,'preview-repair'),(52,'reference-repair')]:
        path = evidence/f'payment-records-{suffix}-migration.log'
        raw = path.read_text(encoding='utf-8')
        assert f'copypaste: applied migration {version}' in raw and f'copypaste_test: applied migration {version}' in raw
        migrations.append({'path':path.relative_to(ROOT).as_posix(),'sha256':fingerprint(path),'migration':version})
    screenshots = []
    for name in ['current-ui-screenshot-provenance.json','payment-screenshot-provenance.json']:
        path = DOCS/'quality'/name
        entries = load(path)['files']
        for entry in entries:
            if 'source' in entry:
                assert fingerprint(ROOT/entry['source']) == entry['sha256']
                assert fingerprint(ROOT/entry['documentation']) == entry['sha256']
            else:
                assert fingerprint(ROOT/entry['original']) == entry['original_sha256']
                assert fingerprint(ROOT/entry['viewport']) == entry['viewport_sha256']
                assert fingerprint(DEV/'copypaste-admin/assets/screenshots'/Path(entry['viewport']).name) == entry['viewport_sha256']
        screenshots.append({'path':path.relative_to(ROOT).as_posix(),'sha256':fingerprint(path),'verified_images':len(entries)})
    return {'scope':'Bounded manual evidence and exact posting repair; original failures retained, full refunds/VIP/payment-provider acceptance not established','runs':runs,'archives':archives,'native_migrations':migrations,'screenshots':screenshots}


def refund_repair_history():
    evidence = DEV/'copypaste-delivery/evidence'
    runs = []
    for name, expected in [('refunds-core-initial.tap',(25,25,0)),('refunds-cash-initial.tap',(41,39,2)),('refunds-focused-second.tap',(48,48,0)),('refunds-focused-final.tap',(50,50,0))]:
        path = evidence/name
        raw = path.read_text(encoding='utf-8')
        counts = {k:int(re.search(r'^# '+k+r' (\d+)$',raw,re.M)[1]) for k in ['tests','pass','fail','cancelled','skipped','todo']}
        assert tuple(counts[k] for k in ['tests','pass','fail']) == expected
        assert all(counts[k] == 0 for k in ['cancelled','skipped','todo'])
        runs.append({'path':path.relative_to(ROOT).as_posix(),'sha256':fingerprint(path),'counts':counts,'status':'failed_original_retained' if counts['fail'] else 'passed_at_recorded_source_stage'})
    archives = []
    for name, count in [('stage44-before-refunds',160),('refunds-before-capture-reset',19),('refunds-ui-locator-failure',23),('refunds-auth-startup-failure',3)]:
        manifest = evidence/name/'archive-map.json'
        entries = load(manifest)['files']
        assert len(entries) == count
        for entry in entries:
            path = (ROOT/entry['archived']).resolve()
            assert path.is_relative_to(evidence.resolve())
            assert fingerprint(path) == entry['sha256'], f'Changed refund history: {path}'
        archives.append({'path':manifest.relative_to(ROOT).as_posix(),'sha256':fingerprint(manifest),'verified_files':count})
    old = load(evidence/'stage44-before-refunds/dev/copypaste-delivery/evidence/alignment-platform.json')
    assert old['counts'] == {'tests':310,'pass':310,'fail':0,'cancelled':0,'skipped':0,'todo':0}
    assert fingerprint(evidence/'stage44-before-refunds/dev/copypaste-delivery/evidence/alignment-platform.tap') == old['sha256']
    failed = load(evidence/'refunds-ui-locator-failure/dev/copypaste-delivery/evidence/admin-fees.json')
    assert failed['status'] == 'failed' and len(failed['checks']) == 7 and failed['browser_closed'] is True
    assert len(failed['errors']) == 1 and 'strict mode violation' in failed['errors'][0]
    auth_failure = load(evidence/'refunds-auth-startup-failure/dev/copypaste-delivery/evidence/auth-recovery-current.json')
    assert auth_failure['status'] == 'failed' and not auth_failure['checks']
    assert 'electron.launch: Timeout 60000ms exceeded' in auth_failure['errors'][0]
    processes = load(evidence/'refunds-auth-startup-processes.json')
    assert processes['owned_startup_pid_present'] is False and processes['electron_process_count'] == 0
    for version in [53,54,55]:
        assert f'copypaste: applied migration {version}' in (evidence/'refunds-primary-native-database-start.log').read_text(encoding='utf-8')
        assert f'copypaste_test: applied migration {version}' in (evidence/'refunds-live-migrations-053-055.log').read_text(encoding='utf-8')
    image_receipt = DOCS/'quality/refund-screenshot-provenance.json'
    for image in load(image_receipt)['files']:
        assert fingerprint(ROOT/image['original']) == image['original_sha256']
        assert fingerprint(ROOT/image['viewport']) == image['viewport_sha256']
        assert fingerprint(DEV/'copypaste-admin/assets/screenshots'/Path(image['viewport']).name) == image['viewport_sha256']
    return {'scope':'Source-bound consumption compensation and manually reviewed cash refund subflows only; history, true provider acceptance and full financial scope remain distinct', 'runs':runs,'archives':archives,'screenshots':{'path':image_receipt.relative_to(ROOT).as_posix(),'sha256':fingerprint(image_receipt),'verified_images':len(load(image_receipt)['files'])}}


def plan_repair_history():
    evidence = DEV/'copypaste-delivery/evidence'
    runs = []
    for name, expected in [('plan-versions-initial.tap',(12,0,12)),('plan-versions-second.tap',(12,0,12)),('plan-versions-third.tap',(12,5,7)),('plan-versions-fourth.tap',(12,12,0)),('plan-versions-focused-initial.tap',(24,23,1)),('plan-versions-focused-second.tap',(24,24,0))]:
        path = evidence/name
        raw = path.read_text(encoding='utf-8')
        counts = {k:int(re.search(r'^# '+k+r' (\d+)$',raw,re.M)[1]) for k in ['tests','pass','fail','cancelled','skipped','todo']}
        assert tuple(counts[k] for k in ['tests','pass','fail']) == expected
        assert all(counts[k] == 0 for k in ['cancelled','skipped','todo'])
        runs.append({'path':path.relative_to(ROOT).as_posix(),'sha256':fingerprint(path),'counts':counts,'status':'failed_original_retained' if counts['fail'] else 'passed_at_recorded_source_stage'})
    archives = []
    for name, count in [('stage45-before-plan-versions',209),('plan-ui-browser-path-failure',3),('plan-ui-layout-before-fix',14),('plan-before-route-refresh',14)]:
        manifest = evidence/name/'archive-map.json'
        entries = load(manifest)['files']
        assert len(entries) == count
        for entry in entries:
            relative = Path(entry['archived'])
            path = (ROOT/relative if relative.parts[0] == 'dev' else DEV/'copypaste-delivery'/relative).resolve()
            assert path.is_relative_to(evidence.resolve())
            assert fingerprint(path) == entry['sha256'], f'Changed plan history: {path}'
        archives.append({'path':manifest.relative_to(ROOT).as_posix(),'sha256':fingerprint(manifest),'verified_files':count})
    prior = evidence/'plan-before-route-refresh'
    recorded = load(prior/'12-alignment-platform.json')
    assert recorded['status'] == 'passed' and recorded['source_unchanged'] is True
    assert recorded['counts'] == {'tests':340,'pass':340,'fail':0,'cancelled':0,'skipped':0,'todo':0}
    assert fingerprint(prior/'13-alignment-platform.tap') == recorded['sha256']
    raw_images = evidence/'admin-plan-screenshots.json'
    image_receipt = DOCS/'quality/plan-screenshot-provenance.json'
    images = load(image_receipt)['files']
    assert len(images) == 8 and len(load(raw_images)['screenshots']) == 8
    for image in images:
        assert fingerprint(ROOT/image['source']) == image['sha256']
        assert fingerprint(ROOT/image['documentation']) == image['sha256']
    assert f'copypaste: applied migration 56' in (evidence/'plan-versions-live-migration-056.log').read_text(encoding='utf-8')
    assert f'copypaste_test: applied migration 56' in (evidence/'plan-versions-live-migration-056.log').read_text(encoding='utf-8')
    return {'scope':'Immutable definitions/publications and honest legacy binding foundation only; complete VIP, quota, customer endpoints and all acceptance cases remain in scope', 'runs':runs,'archives':archives,'screenshots':{'path':image_receipt.relative_to(ROOT).as_posix(),'sha256':fingerprint(image_receipt),'verified_images':8,'raw_receipt_sha256':fingerprint(raw_images)}}


def vip_repair_history():
    evidence = DEV/'copypaste-delivery/evidence'
    tracked = set(subprocess.check_output(['git','ls-files','-z'],cwd=evidence.parent,text=True).split('\0'))
    runs = []
    for number, expected in enumerate([(14,0,14),(14,5,9),(14,14,0),(44,43,1),(50,50,0),(14,14,0)],1):
        tap = evidence/f'platform-vip-candidate-{number:02d}.tap'
        sql = evidence/f'vip-candidate-{number:02d}-migration-057.sql'
        raw = tap.read_text(encoding='utf-8')
        counts = {k:int(re.search(r'^# '+k+r' (\d+)$',raw,re.M)[1]) for k in ['tests','pass','fail','cancelled','skipped','todo']}
        assert tuple(counts[k] for k in ['tests','pass','fail']) == expected
        assert all(counts[k] == 0 for k in ['cancelled','skipped','todo'])
        runs.append({'path':tap.relative_to(ROOT).as_posix(),'sha256':fingerprint(tap),'counts':counts,
                     'migration_candidate':{'path':sql.relative_to(ROOT).as_posix(),'sha256':fingerprint(sql)},
                     'status':'failed_original_retained' if counts['fail'] else 'passed_at_recorded_source_stage'})
    current_sql = DEV/'copypaste-platform/migrations/057-canonical-vip-grant-lifecycle.sql'
    assert fingerprint(evidence/'vip-candidate-06-migration-057.sql') == fingerprint(current_sql)
    archives = []
    names = [('stage46-before-canonical-vip',316),('vip-ui-initial',9),('vip-ui-result-reset',13),
             ('vip-ui-mobile-overflow',20),('vip-ui-before-settled-screenshots',14),('vip-admin-membership-close-timeout',8),
             ('vip-before-live-plan-coherence',18),('vip-layout-before-lf-checkout',6)]
    names += [(p.parent.name,None) for p in sorted(evidence.glob('vip-native-*/archive-map.json'))]
    for name, expected_count in names:
        manifest = evidence/name/'archive-map.json'
        entries = load(manifest)['files']
        if expected_count is not None:
            assert len(entries) == expected_count
        else:
            assert len(entries) >= 4
        for entry in entries:
            path = (ROOT/entry['archived']).resolve()
            assert path.is_relative_to(evidence.resolve())
            assert fingerprint(path) == entry['sha256'], f'Changed VIP history: {path}'
            assert path.relative_to(evidence.parent).as_posix() in tracked, f'Uncommitted VIP history: {path}'
        archives.append({'path':manifest.relative_to(ROOT).as_posix(),'sha256':fingerprint(manifest),'verified_files':len(entries)})
    image_receipt = DOCS/'quality/vip-screenshot-provenance.json'
    images = load(image_receipt)
    assert len(images['files']) == 15 and len(images['receipts']) == 2
    for receipt in images['receipts']:
        assert fingerprint(ROOT/receipt['report']) == receipt['report_sha256']
        assert fingerprint(ROOT/receipt['screenshots']) == receipt['screenshots_sha256']
    for image in images['files']:
        assert fingerprint(ROOT/image['source']) == image['sha256']
        assert fingerprint(ROOT/image['documentation']) == image['sha256']
    initial = load(evidence/'vip-upgrade-initial-failure.json')
    second = load(evidence/'vip-upgrade-second-failure.json')
    assert initial['status'] == second['status'] == 'failed_original_retained'
    assert initial['pre_upgrade_row_snapshot_available_for_primary'] is False
    assert initial['migration_057_immutable_after_this_attempt'] is True
    assert initial['database_child_closed'] is second['database_child_closed'] is True
    for source, digest in initial['verifier_candidates'].items():
        assert fingerprint(DEV/'copypaste-delivery'/source) == digest
    assert fingerprint(evidence/'vip-second-qa-vip-migrations.mjs') == second['verifier_candidate_sha256']
    return {'scope':'Canonical VIP and effective-rights subflows only; primary pre-upgrade row snapshot missing, complete product acceptance remains open',
            'runs':runs,'archives':archives,'screenshots':{'path':image_receipt.relative_to(ROOT).as_posix(),
            'sha256':fingerprint(image_receipt),'verified_images':15}}


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
        'resource_ui': DEV/'copypaste-delivery/evidence/resource-ui.json',
        'resource_migrations': DEV/'copypaste-delivery/evidence/resource-migrations.json',
        'resource_erasure_migrations': DEV/'copypaste-delivery/evidence/resource-erasure-migrations.json',
        'billing_migration': DEV/'copypaste-delivery/evidence/billing-live-migration.json',
        'billing_accounts_migration': DEV/'copypaste-delivery/evidence/billing-accounts-live-migration.json',
        'admin_billing_wire': DEV/'copypaste-delivery/evidence/admin-billing-wire.json',
        'admin_fees': DEV/'copypaste-delivery/evidence/admin-fees.json',
        'admin_plans': DEV/'copypaste-delivery/evidence/admin-plans.json',
        'admin_vip': DEV/'copypaste-delivery/evidence/admin-vip.json',
        'native_vip': DEV/'copypaste-delivery/evidence/native-vip.json',
        'vip_migrations': DEV/'copypaste-delivery/evidence/vip-migrations.json',
        'plan_migrations': DEV/'copypaste-delivery/evidence/plan-migrations.json',
        'refund_migrations': DEV/'copypaste-delivery/evidence/refund-migrations.json',
        'refund_schemas': DOCS/'quality/refund-contract-samples.json',
        'native_runtime_alias': DEV/'copypaste-delivery/evidence/billing-runtime-stable-alias.json',
        'membership_wire': DEV/'copypaste-delivery/evidence/membership-wire.json',
        'membership_ui': DEV/'copypaste-delivery/evidence/membership-ui-recovery.json',
        'admin_directory_ui': DEV/'copypaste-delivery/evidence/admin-directory-ui.json',
        'admin_account_ui': DEV/'copypaste-delivery/evidence/admin-account-ui.json',
        'admin_account_wire': DEV/'copypaste-delivery/evidence/admin-account-wire.json',
        'admin_membership_wire': DEV/'copypaste-delivery/evidence/admin-membership-wire.json',
        'admin_membership_ui': DEV/'copypaste-delivery/evidence/admin-membership-ui.json',
        'auth_navigation': DEV/'copypaste-delivery/evidence/auth-navigation.json',
        'native_auth_recovery': DEV/'copypaste-delivery/evidence/auth-recovery-current.json',
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
        if key in {'membership_ui', 'admin_membership_ui', 'native_auth_recovery'}:
            expected_checks, expected_sources = {
                'membership_ui': (6, 182),
                'admin_membership_ui': (6, 212),
                'native_auth_recovery': (12, 792),
            }[key]
            assert len(checks) == expected_checks and report['model_calls'] == 0
            assert report['browser_closed'] is True and report['user_browser_tabs_touched'] is False
            assert report['source_unchanged'] is True and len(report['source_files']) == expected_sources
            if key == 'native_auth_recovery':
                assert report['desktop_closed'] is True and report['extension_closed'] is True
                assert report['owned_credentials_cleared'] is True
            else:
                assert report['owned_sessions_closed'] is True
            if key == 'admin_membership_ui':
                assert report['owned_admin_principals_disabled'] is True
                assert len(set(report['owned_admin_principal_ids'])) == 2
            for source, expected_digest in report['source_files'].items():
                actual_source = (DEV/source).resolve()
                assert actual_source.is_relative_to(DEV.resolve())
                assert fingerprint(actual_source) == expected_digest, f'Stale {key} evidence: {source}'
        if key == 'resource_ui':
            assert len(checks) == 8 and len(report['screenshots']) == 8
            assert report['source_unchanged'] is True and len(report['source_files']) == 794
            assert report['model_calls'] == 0 and report['external_payments'] == 0
            assert report['browser_closed'] is True and report['user_browser_tabs_touched'] is False
            assert report['owned_sessions_closed'] is True and report['owned_admin_principals_disabled'] is True
            for source, digest in report['source_files'].items():
                actual = (DEV/source).resolve()
                assert actual.is_relative_to(DEV.resolve()) and fingerprint(actual) == digest
            for capture in report['screenshots']:
                assert fingerprint(ROOT/capture['file']) == capture['sha256']
        if key == 'admin_fees':
            assert len(checks) == 8 and report['model_calls'] == 0 and report['external_payments'] == 0
            assert report['browser_closed'] is True and report['user_browser_tabs_touched'] is False
            assert report['source_unchanged'] is True and len(report['source_files']) == 53
            for source, expected_digest in report['source_files'].items():
                actual_source = (DEV/source).resolve()
                assert actual_source.is_relative_to(DEV.resolve())
                assert fingerprint(actual_source) == expected_digest, f'Stale fee UI evidence: {source}'
        if key == 'admin_plans':
            assert len(checks) == 6 and len(report['source_files']) == 645
            assert report['source_unchanged'] is True and report['model_calls'] == 0 and report['external_payments'] == 0
            assert report['browser_closed'] is True and report['user_browser_tabs_touched'] is False
            assert report['owned_sessions_closed'] is True and report['owned_admin_principals_disabled'] is True
            for source, expected_digest in report['source_files'].items():
                assert fingerprint(DEV/source) == expected_digest, f'Stale plan UI evidence: {source}'
        if key in {'admin_vip','native_vip'}:
            assert len(checks) == 6 and report['model_calls'] == 0 and report['external_payments'] == 0
            assert report['browser_closed'] is True and report['user_browser_tabs_touched'] is False
            assert report['owned_sessions_closed'] is True and report['owned_admin_principals_disabled'] is True
            assert report['source_unchanged'] is True
            assert len(report['source_files']) == (794 if key == 'admin_vip' else 797)
            for source, expected_digest in report['source_files'].items():
                actual = (DEV/source).resolve()
                assert actual.is_relative_to(DEV.resolve())
                assert fingerprint(actual) == expected_digest, f'Stale VIP evidence: {source}'
            if key == 'native_vip':
                assert report['desktop_closed'] is True and report['extension_closed'] is True
                assert report['owned_native_credentials_cleared'] is True
                assert report['artifacts_unchanged_after_run'] is True
                assert report['tested_artifacts'] == load(files['native_surfaces'])['tested_artifacts']
        if key == 'vip_migrations':
            assert report['verifier_sha256'] == fingerprint(DEV/'copypaste-delivery/scripts/qa-vip-migrations.mjs')
            before = DEV/'copypaste-delivery/evidence/vip-migrations-before.json'
            assert fingerprint(before) == report['before_sha256']
            assert {d['database'] for d in report['databases']} == {'copypaste','copypaste_test'}
            for database in report['databases']:
                old = next(d for d in load(before)['databases'] if d['database'] == database['database'])
                assert database['migrations'][:56] == old['migrations'][:56]
                assert len(database['migrations']) == 57 and database['migrations'][-1]['version'] == 57
                assert database['original'] == old['original'] and len(database['original']) == 7
                assert database['read_only'] is True and database['applied_checksums_unchanged'] is True
                assert database['original_facts_unchanged_since_observed_baseline'] is True
                complete = database['database'] == 'copypaste_test'
                assert database['complete_pre_upgrade_row_snapshot'] is complete
                assert database['original_facts_unchanged_across_057'] is (True if complete else None)
                assert database['original_row_baseline_phase'] == ('before_057' if complete else 'after_initial_057_startup')
                assert database['security_invoker_view'] is True
                assert len(database['tables']) == 6 and all(t['relrowsecurity'] and t['relforcerowsecurity'] for t in database['tables'])
                assert len(database['new_table_rows_at_upgrade']) == 6 and set(database['new_table_rows_at_upgrade'].values()) == {0}
                assert database['legacy_migrations_without_stored_checksum'] == list(range(1,16))
                assert len(database['original_migration_bytes']) == 56
                for name, expected_digest in database['original_migration_bytes'].items():
                    assert fingerprint(DEV/'copypaste-platform/migrations'/name) == expected_digest
                    original_bytes = subprocess.check_output(['git','show',database['original_migration_source_commit']+':migrations/'+name],cwd=DEV/'copypaste-platform')
                    assert hashlib.sha256(original_bytes).hexdigest() == expected_digest
                for migration in database['migrations']:
                    if migration['version'] <= 15:
                        assert migration['source_sha256'] is None
                    else:
                        source = next((DEV/'copypaste-platform/migrations').glob(f"{migration['version']:03d}-*.sql"))
                        assert migration['source_sha256'] == fingerprint(source)
            for source, expected_digest in report['source_files'].items():
                assert fingerprint(DEV/source) == expected_digest
            for log in report['logs']:
                assert fingerprint(DEV/'copypaste-delivery'/log['path']) == log['sha256']
        if key == 'plan_migrations':
            assert report['verifier_sha256'] == fingerprint(DEV/'copypaste-delivery/scripts/qa-plan-migrations.mjs')
            assert {d['database'] for d in report['databases']} == {'copypaste','copypaste_test'}
            before = DEV/'copypaste-delivery/evidence/plan-migrations-before.json'
            assert fingerprint(before) == report['before_sha256']
            for database in report['databases']:
                old = next(d for d in load(before)['databases'] if d['database'] == database['database'])
                assert database['migrations'][:55] == old['migrations'] and database['migrations'][-1]['version'] == 56
                assert database['original'] == old['original']
                assert database['original_facts_unchanged'] is True and database['applied_checksums_unchanged'] is True
                assert database['invalid_bindings'] == 0 and database['missing_bindings'] == 0
                assert len(database['tables']) == 5 and all(t['relrowsecurity'] and t['relforcerowsecurity'] for t in database['tables'])
            for source, expected_digest in report['source_files'].items():
                assert fingerprint(DEV/source) == expected_digest
            for log in report['logs']:
                assert fingerprint(DEV/'copypaste-delivery'/log['path']) == log['sha256']
        if key == 'refund_migrations':
            assert report['verifier_sha256'] == fingerprint(DEV/'copypaste-delivery/scripts/qa-refund-migrations.mjs')
            assert {d['database'] for d in report['databases']} == {'copypaste','copypaste_test'}
            for database in report['databases']:
                assert database['checksums_match'] is True and database['read_only'] is True
                assert [m['version'] for m in database['migrations']] == [53,54,55]
                assert len(database['tables']) == 8 and all(t['relrowsecurity'] for t in database['tables'])
            for source, expected_digest in report['source_files'].items():
                assert fingerprint(DEV/source) == expected_digest
            for log in report['logs']:
                assert fingerprint(DEV/'copypaste-delivery'/log['path']) == log['sha256']
        if key == 'refund_schemas':
            assert len(checks) == 14
            assert report['verifier_sha256'] == fingerprint(DOCS/'tools/validate_refund_contract_samples.py')
            for source, expected_digest in report['source_files'].items():
                assert fingerprint(ROOT/source) == expected_digest
        if key == 'native_runtime_alias':
            assert report['launcher_sha256'] == fingerprint(DEV/'copypaste-platform/scripts/native-db-launch.mjs')
            assert report['real_executable_present'] is True and report['prior_temp_alias_removed'] is True
            assert report['api_status'] == 200 and len(report['databases']) == 2
            assert all(d['migration'] == 41 for d in report['databases'])
        if key == 'billing_migration':
            expected_digest = fingerprint(DEV/'copypaste-platform/migrations/041-billing-settlement-sources.sql')
            assert {d['database'] for d in report['databases']} == {'copypaste','copypaste_test'}
            for database in report['databases']:
                assert database['migration'] == 41 and database['migration_sha256'] == expected_digest
                assert database['checksum_matches'] is True and database['unchanged_wallet_aggregates'] is True
                assert database['missing_source_count'] == '0' and database['debt_above_credit_limit_count'] == '0'
        if key == 'billing_accounts_migration':
            before = load(DEV/'copypaste-delivery/evidence/billing-accounts-before-migration.json')
            assert {d['database'] for d in report['databases']} == {'copypaste','copypaste_test'}
            for database in report['databases']:
                prior = next(d for d in before['databases'] if d['database'] == database['database'])
                assert prior['migration'] == 41 and database['migration'] == 44
                assert database['history'] == prior['history']
                assert database['checksums_match'] is True and database['original_enterprise_facts_unchanged'] is True
                assert database['personal_accounts_initially_unfunded'] is True
                assert int(database['counts']['personal_accounts']) == 2 * int(database['counts']['users'])
        if key == 'admin_billing_wire':
            assert len(checks) == 5 and report['model_calls'] == 0 and report['external_payments'] == 0
            assert report['owned_sessions_closed'] is True and report['owned_admin_principals_disabled'] is True
        if key == 'checkout_integrity':
            assert len(checks) == 5 and report['owned_temporary_clones_removed'] is True
            assert set(report['heads']) == {'copypaste-platform','copypaste-admin','copypaste-desktop','copypaste-delivery'}
            for repository, tested_head in report['heads'].items():
                checkout = DEV/repository
                current_head = subprocess.check_output(['git','rev-parse','HEAD'], cwd=checkout, text=True).strip()
                if repository == 'copypaste-delivery':
                    subprocess.run(['git','merge-base','--is-ancestor',tested_head,current_head], cwd=checkout, check=True)
                    changed = subprocess.check_output(['git','diff','--name-only',tested_head,current_head], cwd=checkout, text=True).splitlines()
                    assert set(changed) <= {'evidence/byte-integrity.json'}, 'Only the clone receipt may follow its tested Delivery commit'
                else:
                    assert current_head == tested_head, f'Stale clone evidence: {repository}'
        if 'browser_closed' in report:
            assert report['browser_closed'] is True
        if 'desktop_closed' in report:
            assert report['desktop_closed'] is True
        if 'extension_closed' in report:
            assert report['extension_closed'] is True
        if key == 'native_surfaces':
            assert report['artifacts_unchanged_after_run'] is True
            tested = report['tested_artifacts']
            assert tested['schema_version'] == 1
            assert tested['desktop']['executable_kind'] == 'packaged'
            desktop_root = DEV/'copypaste-desktop'
            extension_root = DEV/'copypaste-extension'
            runtime_root = desktop_root/'release/frameless/win-unpacked'
            verify_file_manifest(runtime_root, tested['desktop']['runtime_files'], True)
            assert fingerprint(runtime_root/'CopyPaste.exe') == tested['desktop']['executable_sha256']
            verify_file_manifest(desktop_root, tested['desktop']['source_files'])
            verify_file_manifest(runtime_root.parent, tested['desktop']['installer_files'])
            verify_file_manifest(extension_root, tested['extension']['source_files'])
            verify_file_manifest(extension_root/'dist', tested['extension']['dist_files'], True)
            verifier_root = DEV/'copypaste-delivery/scripts'
            assert fingerprint(verifier_root/'qa-native-surfaces.ts') == tested['verifier_sha256']
            assert fingerprint(verifier_root/'native-surface-integrity.mjs') == tested['integrity_checker_sha256']
        if key == 'native_artifacts':
            assert report['signed'] is False and report['installed_or_published'] is False
            assert report['validation']['tested_artifacts_match'] is True
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
        if key in {'admin_account_ui','admin_directory_ui'}:
            assert report['closed'] is True and report['user_browser_tabs_touched'] is False
        if key in {'membership_wire', 'admin_membership_wire', 'admin_account_wire'}:
            assert report['owned_sessions_closed'] is True
        if key in {'admin_membership_wire','admin_account_wire'}:
            assert report['owned_admin_principals_disabled'] is True
        if key == 'platform_regression':
            assert report['counts']['tests'] == 375 and len(report['source_files']) == 699
            assert report['counts']['tests'] == report['counts']['pass'] and report['counts']['fail'] == 0
            assert report['source_unchanged'] is True and report['source_files']
            assert report['verifier_sha256'] == fingerprint(DEV/'copypaste-delivery/scripts/qa-platform-regression.mjs')
            for source, expected_digest in report['source_files'].items():
                actual_source = (DEV/'copypaste-platform'/source).resolve()
                assert actual_source.is_relative_to((DEV/'copypaste-platform').resolve())
                assert fingerprint(actual_source) == expected_digest, f'Stale platform regression: {source}'
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
        repository_files=subprocess.check_output(['git','ls-files','--cached','--others','--exclude-standard'],cwd=repo,text=True).splitlines()
        hashes={name:fingerprint(repo/name) for name in sorted(set(repository_files)) if (repo/name).is_file() and (repo/name).suffix in ['.ts','.tsx','.mjs','.json','.sql','.css','.html','.md','.svg','.png','.ico']}
        repositories.append({'name':repo.name,'head':subprocess.check_output(['git','rev-parse','HEAD'],cwd=repo,text=True).strip(),
                             'dirty':bool(subprocess.check_output(['git','status','--porcelain'],cwd=repo).strip()),'source_hashes':hashes})
    resolved_runtime_evidence = []
    for name, expected_digest, resolution_key, scope in [
        ('auth-recovery-open-issue.json', '0477456f3bb51e711c65040971db88151872096efa35b963cf1bc79a49ea9bce',
         'native_auth_recovery', 'Twelve current-source Web/Electron/MV3 authentication/session subflows pass with unchanged source/runtime bytes and owned credential/process cleanup. Original startup failures and diagnostic bytes remain historical; packaged, SSO and full system acceptance are not established.'),
        ('membership-current-issue.json', 'a913efc238f7f5de29bb35cae1fc8eba7e1d3a0a2325eff81e9a5e759e0002e7',
         'membership_ui', 'Six current-source Web invitation/member subflows and four strict HTTP samples now pass. The earlier overwritten success is still excluded; original page/locator timeout receipts remain unchanged. Production mail and complete native membership acceptance remain separate.'),
        ('admin-membership-ui-open-issue.json', '66fd84e61413f6f21de7c9914bf97853c2ea97027d5451c5b1dc864e10e7acba',
         'admin_membership_ui', 'Six actual Admin UI subflows verify suspension/restoration, Web owner feedback, exact operation navigation, frozen independent review and a narrow dark preview. Six strict operation/list captures pass. Original unverified-page receipt remains unchanged; shared normative approvals are a bounded increment and complete Admin acceptance remains unfinished.'),
    ]:
        original = DEV/'copypaste-delivery/evidence'/name
        assert fingerprint(original) == expected_digest, f'Historical issue receipt changed: {name}'
        resolved_runtime_evidence.append({
            'path': original.relative_to(ROOT).as_posix(), 'sha256': expected_digest,
            'status': 'resolved_for_bounded_current_subflows', 'original_receipt_preserved': True,
            'resolution_evidence': resolution_key,
            'resolution_path': files[resolution_key].relative_to(ROOT).as_posix(),
            'resolution_sha256': fingerprint(files[resolution_key]), 'scope': scope,
        })
    result={'schema_version':'1.0','at':datetime.now(timezone.utc).isoformat(),
            'shared_approval_verification':approval_repair_history(),
             'payment_record_verification':payment_record_repair_history(),
             'refund_verification':refund_repair_history(),
             'plan_verification':plan_repair_history(),
             'vip_verification':vip_repair_history(),
             'resource_verification':resource_repair_history(),
            'scope':'All 102 requirements remain in scope; bounded repair progress, not a complete acceptance report',
            'baseline_sha256':fingerprint(baseline_path),'user_test_data_instruction':baseline['user_test_data_instruction'],
            'requirements_amendments':{'path':amendment_path.relative_to(ROOT).as_posix(),'sha256':fingerprint(amendment_path),'changes':amendment['changes'],'original_acceptance_baseline_preserved':True},
            'summary':dict(Counter(r['assessment'] for r in rows)), 'fully_accepted_requirements':0,
            'qualified_live_roles':0, 'release_artifacts':'Original 0.5.0 offline bundles remain historical. Rebuilt frameless Desktop and native Side Panel previews have ten byte-bound appearance checks and six actual packaged Desktop/native Side Panel VIP/authentication subflows, including coherent live plan/rights refresh, own notification reads and sign-out. See dev/copypaste-delivery/evidence/native-surfaces-artifacts.json. Twelve current-source Web/Electron/MV3 session subflows remain a separate report. Setup/Portable have byte provenance and were not installed by these checks. Localhost origins; no signing or production publication. Full packaged authentication, SSO, installation and system acceptance remain outstanding.',
            'repositories':repositories,'evidence':evidence,
            'unresolved_runtime_evidence':[],
            'resolved_runtime_evidence':resolved_runtime_evidence,
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
