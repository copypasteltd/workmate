"""Consolidate bounded evidence without upgrading historical acceptance verdicts."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'docs/quality/system-assessment-194'
PRIVATE = ROOT / 'dev/copypaste-delivery/.data/assessment-194'
OUT.mkdir(parents=True, exist_ok=True)

def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def save(name, data):
    (OUT / name).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

old = load(ROOT / 'docs/quality/remaining-work-stage167.json')
server = load(PRIVATE / 'server-inspection-v1.log')
capacity = load(PRIVATE / 'server-inspection-v2.log')
public = load(PRIVATE / 'public-role-probe-v2.json')
assert len(old['requirements']) == 102
assert capacity['execution_capacity_released'] and public['roles']['status'] == 200
assert public['cleanup']['owned_browser_closed']

# A work group is not a reproducible defect, and is not a percentage denominator.
rows = [
('01','P1','未接通真实服务','生成式视频','已有异步作业、取消/对账、MP4 校验和交付代码；线上 video=false。','接通公司真实视频能力，完成原作业恢复、实际成片及费用验收；范围以承诺规格为准。','019'),
('02','P1','未接通真实服务','配音与转写','已有业务协议和处理代码；线上 speech/transcription 均 false。','真实语音模型、音频与字幕结果、失败及计费验证。','021'),
('03','P0','未接通真实服务','Google Ads','Google OAuth 与 Ads developer token 未配置；不能表示真实广告账户已可用。','真实客户授权、账户范围、分页增量、撤权及费用/报表口径验收。','004,025'),
('04','P0','未接通真实服务','GA4 / Search Console','Google 客户端凭证未配置；现有协议/夹具不等于真实网站数据接入。','接通实际 property/site，验证时区、权限、指标和历史同步。','027,028'),
('05','P0','未接通真实服务','Meta Ads','Meta 应用凭证未配置；广告分析入口不能替代真实账户授权。','真实应用权限、客户账户、数据同步、撤权和异常恢复。','004,026'),
('06','P1','未接通真实服务','社交内容真实发布','Meta publication 应用凭证未配置。','真实授权下的预览、审批、发布回执与未知结果对账；不得用重复发布恢复。','010,034'),
('07','P1','实现有明确限制','Linux Office 在线预览','源站 Linux 的 Office 原生渲染受平台限制；PDF 与原文件下载仍可用。','提供支持的 Office 转换/预览实现及格式兼容验收，或准确展示受支持格式。','012,022,035'),
('08','P0','专业验收未完成','至少 12 个专业角色','19 个不同专家预设、50 个 Skill 包版本和实际 Codex Skill 加载已存在；本轮 API 为 18 个专家依赖可用、1 个可选云电脑专家不可用，另有默认助手。所有目录资格仍为 unverified。','至少 12 角色逐个完成实际任务、修改、依赖/权限异常、真实文件/版本/费用证据。不可将静态资格数为零解释成角色没实现。','073,074,075,076,078,080'),
('09','P0','专业验收未完成','完整设计师交付','真实 gpt-image-2 生成、编辑及设计师交付已有 189 证据；完整可编辑工程、品牌一致性及专业修订质量未全面验收。','按实际客户 brief 验证成套成果、源工程、修改及稳定性。','015,077,078'),
('10','P0/P1','实现及专业质量待完善','字体 / 排版 / 批量适配 / 模板视频 / 特效','存在相应工具、素材和流程；未取得覆盖完整承诺规格的真实专业验收。模板视频与生成式视频必须分开评价。','字体授权与中英排版、各尺寸适配、可恢复工程、真实特效成片和审阅导出。','016,017,018,020,022'),
('11','P0','真实业务验收未完成','广告数据口径与创意反馈','导入、确定性分析及反馈链路有实现；真实平台综合核对尚未完成。','跨币种/时区/归因窗口、重复修订、花费/收入核对，以及客户真实报表校验。','023,024,031'),
('12','P0/P1','真实业务验收未完成','SEO / GEO','已有工具与工作流证据；未证明完整真实网站、品牌与模型观察的业务效果。','真实站点抓取与诊断、原始引用可追溯、优化前后同口径验证；不能承诺未实测的排名提升。','029,030'),
('13','P0','真实业务验收未完成','企业流程与重复工作','流程/调度/幂等和有界续跑已实现；全业务真实外部动作矩阵未验收。','用实际客户流程验证时区、授权过期、重复触发、原动作对账、失败补偿及交付。','009,010,032,033,034'),
('14','P0/P1','对标范围与验证未闭合','Desktop 本机操作','0.7.4 的本机 Codex、文件/命令、完整本机权限和真实结算有实测；可枚举本机监听/批准程序路径有实现。','先定义对标版本、目标应用和操作清单，再验收冲突、撤权、离线重连、休眠恢复；不增加“睡眠时运行”或任意应用保证。','039,040,044'),
('15','P1','安装兼容矩阵未完整测试','Desktop 安装与升级','Windows 安装版/便携版已发布且能下载；不能用源码或既有机器测试代替全部客户安装环境。','干净 Windows、安装/覆盖/卸载/回滚、默认浏览器、显示缩放、安全软件及权限降级矩阵。受信签名按用户要求移出。','003,039,054'),
('16','P0/P1','完整文件矩阵未验证','Extension 文件与 Native Host','原生右侧 Side Panel、对话/附件、获准本地文件读取和云端执行链路已有证据。','真实 Chrome/Edge 兼容、目录权限撤销、Host 安装、文件变化/冲突、大文件和断线恢复；ZIP 手动安装摩擦仍在。','036,037,038'),
('17','P0','完整跨端矩阵未验证','登录 / 接续 / 企业身份','邮箱验证码、Web/Extension/Desktop 登录和 PKCE 已实测；企业 SSO 公共支持标志不代表真实 IdP 已部署。','实际企业 IdP、首次安装登录、换账号、多设备、会话过期和迟到响应组合。','003,041'),
('18','P0','完整状态矩阵未验证','持久任务与恢复','队列、事件、暂停、输入补充及有界故障恢复已有实现和测试。','所有业务的真实部分成果、多 Worker 崩溃/重启、网络分区、取消竞争及不重放副作用验证。','007,008,009,011'),
('19','P0','对账与财务矩阵未闭合','预算、费用与权益','三笔原 QA 请求仍是未知费用；本轮确认 capacity_held=false 且不占执行槽。后台充值/VIP、费用与权限已有实现。','依据真实上游凭据完成旧款对账，验证全部退款、修订、预留、换方案和权益执行；未知不能当零，也不是并发占用回归。','046,047,086,087,088,089,101,102'),
('20','P0','全业务负向矩阵未验证','企业隔离与细粒度权限','RLS、项目/字段权限、撤权、独立后台身份及多类越权测试存在。','覆盖连接器、导出、异步任务、媒体、团队及在途撤权的全部承诺路径；本轮未确认新越权事故。','001,002,010,050,057,083,094,100'),
('21','P0','规模与全资源矩阵未验证','Admin 内容管理与批量操作','用户/企业新建删除、批量、逐模型 API/key 编辑删除、费用/VIP、最高管理员直执行及审计已补齐。','全资源/角色/字段组合、跨端及时生效、批量部分失败、并发审批和大规模导出验收。不能再列成后台没有这些功能。','048,084,085,090,091,092,093,096,097,098,099'),
('22','P0','完整生命周期未验证','记忆、资料、成果及删除','品牌资料、分域记忆、版本、历史清除与恢复后删除重放有局部证据。','所有索引/缓存/引用/衍生文件、导出副本及备份恢复的一致性与期限验证。','005,006,012,013,049'),
('23','P0','大文件完整矩阵未测试','上传下载与断点续传','常规文件和约 185 MB 公共安装包下载已验证；不等于私有 1 GiB 上传/续传达标。','媒体 1 GiB、100 MiB 普通资料、校验、撤权、磁盘满、断线、并发及各端内存峰值。','014,037,052'),
('24','P0','生产运行验收未完成','生产配置与依赖','真实文字/图片已配置且 DEMO_MODE=false，但 NODE_ENV=development、测试邮箱、原生本地文件存储仍在。','分离开发/生产行为、配置与凭证轮换、持久存储容量/备份、告警与故障处置。S3 不是唯一必选方案。','043,045,050,054,058'),
('25','P0','性能及长期稳定性未证明','容量、延迟与可用性','瞬时源站与公网 200、执行槽配置不能证明负载目标和月度可用性；此前脚本/浏览器网络差异仍需运营观测。','按既定负载验证 P95、并发公平性、队列、长任务、资源回收、后台大列表及持续可用性。','042,051,052'),
('26','P0','灾难恢复验收未完成','备份 / 恢复 / 发布回滚','有备份、删除账本和版本回滚设计及局部记录。','真实生产数据隔离恢复、RPO≤15 分钟/RTO≤4 小时演练与恢复后的权限/删除/费用一致性；多节点发布仍未完整验收。','049,053,054'),
('27','P0','全量回归未在最终版本证明','全端最终回归','189 后端全量曾为 1949/1950（1 超时），后有定向复验；192 为 306 项定向加 8 项 Linux，193 为下载相关范围。','对最终冻结组合建立一致的全量结果、失败归因及受影响实机旅程；不把不同版本的通过数简单相加为全产品全绿。','054,056,060'),
('28','P0','客户效果未验证','真实业务成功率','真实示例任务成功不等于目标客户能长期稳定完成工作。','现有 marketing 团队的开发/设计/分析代表任务，同题盲评交付、返工、耗时、费用及重复使用；当前无可核验的同题 WorkBuddy 成功率比较。','056,078,080'),
('29','P0','文档与验收口径待收敛','状态台账一致性','167 台账与后续实现/验收文件存在时间差；一份旧表记 1 项正式接受、另一份旧进度记 0，不能拿来算当前完成率。','按原 REQ/TC 合并当前证据，区分依赖可用/任务成功/专业验收/生产验收，保留历史失败。本报告提供 102 条追溯附录，不伪造全量复验。','058,060'),
('30','P0','交互尚未全面完成','统一输入与成果工作区','对话、任务、文件和成果修改存在；多为分页面。Web 源码检查未找到通用拖入/剪贴板图片/@文件引用的输入闭环。','统一任务上下文、附件、结果/文件/差异/浏览器/终端切换，并提供清楚的新工作与原成果修改语义。见 UX 表。','007,012,035,041,081,082'),
('31','P0','完整体验矩阵未测试','品牌、可访问性与边界状态','品牌主题、双语、无边框 Desktop、Side Panel、选定宽度及隐藏/统一滚动条已有实现与实测。','全页面双主题/双语、375/768/1024/1440、100/200% 缩放、键盘/读屏/对比、长内容及错误/等待/空态。','035,039,055,081,082,098'),
('32','P1','可观测与运维闭环未验收','运营与支持响应','后台请求/执行/费用、原始错误和审计入口已存在，REQ-095 曾完成有界受控支持验收。','端到端业务监控、真正触发告警、责任人与处置/升级/恢复演练；不能把日志入口当作长期运营闭环。','011,048,052,054,095'),
]

ux_rows = [
('UX-01','首用引导','首项任务已能提交；专业角色、项目、模式和预算等表单仍较多。','减少首次必填；按需补资料；实测访问→登录→首次有效成果的时间与失败点。'),
('UX-02','统一附件输入','已有文件与附件入口，Web 会话文件目前另有入口；源码未发现通用拖拽/图片粘贴/@引用处理。','在同一输入区引用项目/本地/网页资料，准确标清上传与权限范围。'),
('UX-03','继续修改与新任务','已有成果修订与原线程续做；会话委派默认可创建独立预算任务。','把原成果修改、新工作、重新执行和新增费用用一致按钮与说明区分。'),
('UX-04','执行与恢复反馈','有持久事件、原始错误及待对账展示；完整业务状态与恢复组合未验收。','每个等待/失败说明卡在哪里、已做什么、是否计费、下一步由谁处理。'),
('UX-05','成果工作台','文件、预览、软件检查、浏览器成果和版本差异已有模块；尚未实现同等完整的一体多标签工作区。','对话旁就地预览/编辑/看差异/终端/网页，并可回到当前任务。'),
('UX-06','长历史与导航','已有列表、筛选与会话任务入口。','跨三端验证长历史查找、当前任务定位、返回路径、未读/失败通知直达与上下文保留。'),
('UX-07','角色可用性语义','依赖 ready 与专业 qualification 已分开；当前 19 专家均未完整登记专业资格。','选择前解释真实可做范围、示例、缺依赖及成果形式，不能让可点击被误读成全面专业验收。'),
('UX-08','版面和滚动条','选定页面已隐藏/统一滚动条，Desktop 无边框。','检查长表、长路径、中英、200% 缩放及小屏：不露横向溢出，同时保留滚动、键盘与内容可达性。'),
('UX-09','无障碍、输入与性能','有主题 token 和局部检查；没有全产品 WCAG/读屏/IME/冷启动实测。','补焦点、错误关联、弹层回焦、对比/减弱动画、中文输入法、快捷键及大任务列表响应。'),
('UX-10','客户可用性验证','已有开发者旅程测试；缺少目标 marketing 用户独立完成任务的系统性证据。','用真实首次使用、改稿、失败恢复和交付任务观察，记录完成率、误操作和返工。'),
]

sources = {
 'WB-START':('入门指南','https://cloud.tencent.com/document/product/1831/134389'),
 'WB-PANEL':('右侧边栏','https://cloud.tencent.com/document/product/1831/134400'),
 'WB-INSTALL':('安装指南','https://cloud.tencent.com/document/product/1831/134387'),
 'WB-SKILLS':('技能','https://cloud.tencent.com/document/product/1831/134432'),
 'WB-AUTO':('自动化','https://cloud.tencent.com/document/product/1831/134399'),
}
comparison = [
('WB-01','本机 Agent 执行','本机文件、工作目录及任务执行。','本机 Codex、完整权限及文件/命令真实执行已有证据。','基础能力有交集；全应用操作与成功率差距未量化，不能判定智力相同。','WB-START'),
('WB-02','输入与任务创建','一句话、默认/自选工作区、@引用、粘贴图片及拖入文件。','自然语言委派存在，但仍较多表单与独立文件入口。','明显体验差距，需统一输入及渐进引导。','WB-START'),
('WB-03','成果工作区','产物、文件、变更、浏览器和终端统一多标签。','相应能力分散于任务/文件/成果及独立视图，未达到同等整合程度。','大差距；是当前交互主差距。','WB-PANEL'),
('WB-04','成果预览与继续工作','官方描述预览/编辑、多标签切换及任务内继续工作。','有预览、版本及成果修订；Linux Office 预览有明确限制。','部分实现，跨格式与就地改稿整合仍有明显差距。','WB-PANEL'),
('WB-05','技能使用生态','本地包导入、查找/创建、启停和卸载。','19 专家及 50 包版本实际加载，主要为公司受控目录。','预设底座已具备；面向用户的通用技能生命周期仍有明显差距。','WB-SKILLS'),
('WB-06','自动化','周期触发、工作目录、模型/技能选择、结果保存及小程序通知。','有云端计划、模板、触发和幂等实现；真实依赖/异常矩阵尚未收口。','有功能基础；真实可靠性和配置/通知体验差距未同题测量。','WB-AUTO'),
('WB-07','安装、平台及更新','Windows 与 macOS（ARM/Intel）发行，应用内检测并下载升级。','Windows 0.7.4 手动安装/便携和 Extension ZIP；macOS 未交付，自动更新未完整验收。','分发体验大差距；Mac 为比较差距，不伪装成首发 Windows 必选缺陷。','WB-INSTALL'),
('WB-08','专业业务与质量','官方入口覆盖多种工作任务；未据此证明所有广告/设计业务质量。','真实文字/图片可用，但视频/语音/广告授权未接通，12 角色专业资格未完成。','我们的业务承诺仍有大敞口；没有双方同题实测，不能编造质量百分比。','WB-START'),
('WB-09','企业管理与平台范围','WorkBuddy 桌面及腾讯企业/托管平台需分别比较。','本产品已有独立 Admin、HKD 预算/VIP、权限审计及公司模型网关。','不能用另一托管产品的全部能力当作桌面标配，也不能把我们已有 Admin 说成缺失；成熟度需独立验收。',None),
]

groups = [dict(id=r[0],priority=r[1],status=r[2],area=r[3],current=r[4],to_close=r[5],requirements=['REQ-'+v for v in r[6].split(',')]) for r in rows]
ux = [dict(id=r[0],area=r[1],current=r[2],to_improve=r[3]) for r in ux_rows]
wb = [dict(id=r[0],area=r[1],official_documented=r[2],current_product=r[3],assessment=r[4],source=r[5]) for r in comparison]
assert len({g['id'] for g in groups}) == 32
valid_ids = {r['id'] for r in old['requirements']}
assert all(set(g['requirements']) <= valid_ids for g in groups)

evidence = {
 'stage':194, 'collected_at':datetime.now(timezone.utc).isoformat(),
 'scope':'Fresh read-only deployment/public configuration/canonical cost projection and browser GETs; no paid model calls, product changes, full suite reruns or performance qualification.',
 'source_host':{k:server[k] for k in ['at','origins','environment','public_config','schema_version','models','capacity_policy']},
 'public_browser':public,
 'canonical_cost_and_capacity':capacity,
 'discarded_diagnostic_inferences':[
  'The V1 root-SSH availability check was outside the real non-root delegated service and read the default Windows contract. It is not an outage finding. Fresh actual API role availability validates program/browser-dependent presets in the service.',
  'V1 raw ai_gateway_requests.released_at is accounting history, not execution capacity. The V2 canonical view shows all three original QA requests release capacity while cost stays unknown.',
  'Browser probe V1 hardcoded an old workspace and returned 404 without an error-code capture; that does not establish a product outage or its cause. V2 derives an authorized membership and returns 200. Both original attempts remain preserved.'
 ],
 'raw_private_sources_sha256':{name:sha(PRIVATE/name) for name in ['server-inspection-v1.log','server-inspection-v2.log','public-role-probe-v1.json','public-role-probe-v2.json']},
}
save('current-evidence.json',evidence)

amendments = {
 'REQ-003':'192 本机 PKCE 登录有真实证据；正式企业 IdP 与完整会话/安装矩阵未闭合。',
 'REQ-014':'193 公共大安装包下载已成功；不能代替私有 1 GiB 上传/续传验收。',
 'REQ-015':'189 真实图片生成、编辑和设计师交付通过；当前 gpt-image-2 发布与验证有效。',
 'REQ-018':'模板视频与 REQ-019 真实生成视频分别评价，video=false 不足以否定 FFmpeg 模板流程。',
 'REQ-019':'独立代码/需求反驳后保留 partial：异步代码已有，真实视频服务当前 false；只要求实际承诺规格，公司适配层可落实原作业对账。',
 'REQ-021':'当前 speech=false、transcription=false；协议实现不能替代真实服务验收。',
 'REQ-025':'当前 Google OAuth/Ads token 未配置；需真实账户验收。',
 'REQ-026':'当前 Meta OAuth 未配置；需真实账户验收。',
 'REQ-027':'当前 Google OAuth 未配置；需真实 GA4 property 验收。',
 'REQ-028':'当前 Google OAuth 未配置；需真实 GSC site 验收。',
 'REQ-035':'193 下载页/入口已上线并实测；完整工作台 UX 见 194 UX 表，不能将已修入口再列为缺失。',
 'REQ-039':'Desktop 0.7.4 本机 Codex、完整权限、实际任务/文件/命令/费用及发布包已有证据；不是云端桥接替代。',
 'REQ-040':'三方审查收窄：可枚举本机调度能力已实现；完整对标须明确目标应用/操作与恢复矩阵。开放式任意应用不是确认缺陷，不要求睡眠时运行。',
 'REQ-043':'194 gpt-6-luna 与 gpt-image-2 逐模型上游/密钥存在、验证 passed；其他真实能力未接通。',
 'REQ-044':'Codex 唯一内核和本机/云端路径已有证据，不能重复列为未接入。',
 'REQ-045':'逐模型 API/key 的新增、编辑、删除已补齐；不能再当缺失入口。',
 'REQ-046':'194 原三笔 QA 请求未知费用保留，但执行容量已释放；对账与并发必须分开。',
 'REQ-054':'193 下载交付已通过；用户移出的受信签名不作为新必做阻塞。全量最终回归和生产维护仍有边界。',
 'REQ-058':'当前 configured_services、text/image=true，非全站演示；视频/语音=false。依赖可用不等于专业合格。',
 'REQ-059':'可选专属云电脑的 computer-operator 当前 TOOL_NOT_IMPLEMENTED:computer.read；不计入 32 组必做核心业务，也不等于常规云端程序/浏览器失效。',
 'REQ-060':'193 下载/中英 README/媒体已发布；194 新增追溯附录与边界澄清，不宣称旧全量验收已全闭合。',
 'REQ-073':'19 个专家预设+默认助手，19 专家中当前依赖可用18、可选云电脑1未可用；不能以静态条目数量等于12专业合格。',
 'REQ-074':'实际存在50个Skill包版本、哈希与版本绑定，不是仅命名提示词。',
 'REQ-075':'真实 Codex typed skill 加载链及既有运行证据存在。',
 'REQ-077':'189 指定 gpt-image-2 真实生成/编辑/设计师交付已有证据；完整工程/品牌质量仍未全验收。',
 'REQ-080':'三方审查确认12专业角色完整资格证据未齐；不强制名为qualified的专用API，也不将0静态资格误写为0实际成功任务。',
 'REQ-082':'下载页选定320/390/1440、双语/深色已测；不等于所有页面和缩放/无障碍矩阵。',
 'REQ-085':'用户与企业的新建、删除、状态控制及批量已实现；全资源/权限矩阵继续开放。',
 'REQ-095':'167 记载有界原12项条件正式接受；保留其范围，不因报告其他开放项倒退成未实现。',
 'REQ-096':'最高管理员直执行、其他角色按策略审批并完整审计已有补充实现。',
 'REQ-097':'已有列表批量功能与定向证据；全部资源/权限/规模/部分失败矩阵未全验收。',
 'REQ-099':'逐模型上游API/key管理已有；新增视频/语音等仍需真实能力配置和验证。',
}

appendix = []
for r in old['requirements']:
    related = [g['id'] for g in groups if r['id'] in g['requirements']]
    appendix.append({
      'id':r['id'],'module':r['module'],'origin':r.get('requirement_origin'),
      'optional':r.get('optional',False),'historical_167_assessment':r['recorded_assessment'],
      'historical_167_acceptance':r['full_acceptance'],
      'implemented_scope_at_167':r['implemented_scope'],
      'historical_remaining_scope':r.get('current_audit_remaining',r['remaining']),
      'current_194_overlay':amendments.get(r['id'],'本轮未独立重做此项完整验收；保留原范围及后续证据，不把开放状态当作新发现缺陷。'),
      'current_group_references':related,
      'full_acceptance_reclassified_this_round':False,
    })

review_files = sorted((OUT/'requirements').glob('*.json'))
assert len(review_files) == 9, 'Three initial reviews plus independent code and spec refutations required'
reviews = [{'file':p.relative_to(OUT).as_posix(),'sha256':sha(p)} for p in review_files]
for p in review_files:
    load(p)

data = {
 'stage':194,'review_date':'2026-11-06','verdict':'Core real workflows exist; full business scope, professional acceptance, production qualification and UX parity remain incomplete.',
 'inventory_scope':'32 grouped open work areas plus 10 UX observations; overlapping groups are not bug counts or completion percentages. 102-row appendix is evidence consolidation, not 102 fresh formal audits.',
 'historical_167_summary':old['summary'],'fresh_formal_requirement_reviews':['REQ-019','REQ-040','REQ-080'],
 'current_open_groups':groups,'ux':ux,'workbuddy_comparison':wb,
 'official_sources':{k:{'title':v[0],'url':v[1],'accessed':'2026-11-06'} for k,v in sources.items()},
 'intentional_and_optional_boundaries':[
  'User retained test mailbox; real SMTP absent is a commercial deployment boundary, not another confirmed mailbox delivery bug.',
  'Trusted Windows code signing (old item12) explicitly excluded by user; no required action reintroduced.',
  'macOS builds, browser store listing and open ecosystem parity are distribution/comparison gaps, not silently added first Windows release requirements.',
  'REQ-059 dedicated cloud computer is optional; REQ061-072 remain 12 unconfirmed expanded design suggestions, not silently promoted to mandatory.',
 ],
 'evidence':'current-evidence.json','independent_reviews':reviews,
 'requirements':appendix,
 'no_claims':['No zero-bug guarantee','No numerical completion or competitive quality percentage','No fresh paid task or full-suite pass claim','No rollback of proven 191-193 fixes'],
}
data['source_heads_before_assessment_publication'] = {
 name:subprocess.check_output(['git','rev-parse','HEAD'],cwd=(ROOT if name=='docs' else ROOT/'dev'/folder),text=True).strip()
 for name,folder in [('docs',''),('backend','copypaste-platform'),('web','copypaste-web'),('admin','copypaste-admin'),('desktop','copypaste-desktop'),('extension','copypaste-extension'),('delivery','copypaste-delivery')]
}
save('assessment.json',data)

def cell(value):
    return str(value).replace('|','／').replace('\n',' ')

def table(headers, items):
    return '\n'.join(['| '+' | '.join(headers)+' |','| '+' | '.join(['---']*len(headers))+' |']+['| '+' | '.join(cell(v) for v in row)+' |' for row in items])

lines = [
 '# 194 · 当前完整性、WorkBuddy 差距与体验评估',
 '',
 '评估日期：2026-11-06（Asia/Taipei）。结论：**已经存在可用的真实云端/本机 Agent 主链路，但尚未完成全部业务、专业角色、生产运行和交互体验验收；不能声称完全符合所有要求或与 WorkBuddy 体验相当。**',
 '',
 '本轮为需求、源码及现有证据复核，新增服务器只读查询和真实公网浏览器 GET；没有新增付费模型调用、全量测试、产品修改或服务重启。浏览器实例已关闭。对 REQ-019/040/080 分别做初审、独立代码反驳、独立需求反驳，共九份报告；不是全 102 条新一轮正式审计。',
 '',
 '## 当前已确认的基础能力',
 '',
 '- Codex 是唯一内核；Web/Extension 云端执行、Desktop 本机执行，并有客户主动授予的完整本机权限。192 有真实模型、文件/命令、云端程序/浏览器及费用记录。',
 '- 本轮三个正式域名均在实际 Chromium 中返回 200；服务器为 configured_services，非全站演示。gpt-6-luna 与 gpt-image-2 发布、密钥存在且最近验证通过；本轮未重复付费生成。',
 '- 已有逐模型 API/key 新增、编辑、删除，以及 Admin 用户/企业增删、批量、费用/VIP、最高管理员直执行并审计。全矩阵未验收不等于这些入口没有实现。',
 '- 下载页与站点入口已经上线；Windows 0.7.4 安装/便携及 Extension 0.5.4 ZIP 已经真实下载校验。Extension 原生右侧栏与无边框 Desktop 均有实现。',
 '- 实际存在 19 个专家角色、50 个 Skill 包版本及真实 Codex 加载链；本轮 API 为 18 专家依赖可用、可选云电脑专家未可用，另有默认助手。全部目录仍是 unverified，不能据此抹去真实成功任务，也不能宣称 12 专业角色合格。',
 '',
 '## 如何读开放项',
 '',
 '“未接通”指当前真实服务不可用；“实现限制”指有明确平台/范围约束；“待完善”指已有部分功能但尚未达到目标；“未验证/未测试”指缺证据，**不自动等于代码有 bug 或从未测试过**。以下 32 组有范围重叠，是交付工作归类，不是 32 个独立可复现错误。',
 '',
 table(['编号','优先级 / 状态','范围','当前事实','完成条件'],[(g['id'],g['priority']+' · '+g['status'],g['area'],g['current'],g['to_close']) for g in groups]),
 '',
 '测试邮箱是用户明确保留的现阶段选择；真实 SMTP 不存在属于正式对外运营边界，不再冒称验证码功能反复损坏。Windows 受信签名旧项 12 已由用户移出，不重新列为必须解决的问题。可选云电脑、macOS、应用商店上架与通用生态扩展单列为比较/选择项。',
 '',
 '## 交互体验：尚未全面实现',
 '',
 '已有品牌配色/主题、双语、圆角控件、无边框 Desktop、Side Panel、局部滚动条及页面布局优化。截图与局部旅程通过只能证明被测范围；以下仍需要产品整合或完整体验验收。',
 '',
 table(['编号','体验面','当前情况','剩余工作'],[(u['id'],u['area'],u['current'],u['to_improve']) for u in ux]),
 '',
 '## 与 WorkBuddy 的差距',
 '',
 '依据腾讯官方 WorkBuddy 文档进行静态能力对照，未安装 WorkBuddy 做同题实测；“大/明显/部分”是能力与流程整合的定性判断，不是性能或成功率测量。桌面产品与腾讯其他托管平台分开，不混为同一个验收对象。',
 '',
 table(['编号','维度','WorkBuddy 官方描述','当前产品','差距判断 / 来源'],[(w['id'],w['area'],w['official_documented'],w['current_product'],w['assessment']+((' ['+sources[w['source']][0]+']('+sources[w['source']][1]+')') if w['source'] else '')) for w in wb]),
 '',
 '最大的差距是**一体化任务/成果工作区、自然输入与上下文、专业业务稳定交付、分发更新体验及生产验收**。基础 Codex 执行不再是“完全没有”，但“内核可执行”不能替代完整产品与客户业务效果。没有双方同输入、同任务、同预算的重复测试，不给出完成率、差距百分比或“已追平”结论。',
 '',
 '## 现有测试及未测范围',
 '',
 table(['证据','确实覆盖','不能外推'],[
 ('189 真实图片与回归','真实生成、编辑、设计师交付；后端全量记录 1949/1950，1 项超时，后有定向复验。','不能写成最终冻结版本全量 1950/1950 已通过。'),
 ('192 原生复查','Backend91、Web30、Admin22、Extension89、Desktop控制器74，共306项；另Linux8项及实际任务。','不是任意应用、所有失败组合或全部专业业务的最终验收。'),
 ('193 下载交付','Web32、Extension89，17组实际浏览器检查、三份实际下载及散列、选定宽度/主题/语言。','不是整套产品的完整交互、无障碍、付费业务或安装兼容矩阵。'),
 ('194 本轮','源站配置、实际三域名200、授权角色目录与原三笔未知费用的只读核对。','没有新付费生成、并发压测、月度SLA、物理休眠、生产灾备或双方质量盲测。'),
 ]),
 '',
 '既定性能/可用性与灾备数字来自 NFR 设计目标，不是实测成绩：普通列表 P95≤800ms、月度可用性99.5%、RPO≤15分钟/RTO≤4小时、1GiB媒体及完整无障碍矩阵均须相应证据。不得因本轮健康 200 宣称达标。',
 '',
 '## 台账与正式收口',
 '',
 '167 历史台账共102条，记录88条必需验收开放（76部分验证、12未证明完成）、12条未确认扩展建议、1条可选项、1条有界正式接受。它是历史验收口径，不代表现在有88个功能没写，也不能换算为“仅完成1/102”。其后191/192/193修复与交付必须作为增量保留。',
 '',
 '另一旧进度文件的0项接受与167的1项存在口径差异；本轮不选择有利数字制造完成率，而是保留历史来源，并提供[完整102条追溯附录](requirements-102.md)和[机器可读汇总](assessment.json)。附录的旧状态标明日期来源，194增量不擅自改写正式接受。',
 '',
 '建议依次收口：①真实业务依赖与可用范围；②至少12角色的专业交付；③统一输入和成果工作区；④权限/恢复/账务及各端安装完整矩阵；⑤生产配置、负载、监控和灾备。先前用户授权减少测试以冻结发行，不能当成这些项目已经完成。',
 '',
 '## 证据与审查边界',
 '',
 '[194只读证据及探针边界](current-evidence.json) · [189图片](../../development/189-real-image-and-acceptance.md) · [192原生复查](../192-native-recheck.md) · [193下载](../193-product-downloads.md) · [NFR目标](../../requirements/02-nonfunctional-and-service-levels.md)',
 '',
 '第一版诊断在root SSH进程检查原生能力，缺少真正API服务的非root/cgroup条件，并读取默认Windows契约；其false不是线上执行器故障。第一版角色GET硬编码旧企业得到404且未记录错误码，不能据此判断产品故障及原因；第二版按当前登录成员资格读取为200。第一版原始released_at也不是并发字段；第二版canonical视图证明三笔未知费用均不占执行槽。原探针记录保留，不能误报为新回归。',
 '',
 '独立审查及两轮反驳：',
 '',
 '\n'.join('- ['+p['file'].split('/')[-1]+']('+p['file']+')' for p in reviews),
 '',
 '## English scope note',
 '',
 'Real cloud and local Codex workflows exist. Complete business integration, at least twelve professionally qualified roles, unified workspace UX, final full regression and production readiness remain unaccepted. This review distinguishes implementation gaps, disabled integrations, partial implementation and missing validation. It does not claim zero defects, a numeric completion rate or measured parity with Tencent WorkBuddy. Code signing remains explicitly excluded and the test mailbox remains an intentional user choice. All fresh browser instances were closed; no local Docker/WSL, paid model call or service restart was used.',
 '',
]
(OUT/'README.md').write_text('\n'.join(lines),encoding='utf-8')

appendix_lines = [
 '# 194 · 完整 102 条需求追溯附录', '',
 '这是167历史验收台账与194最新增量的并列追溯，不是102条重新执行的正式审计。旧开放项不能直接当作现在未实现；所有新旧增量和已有通过证据均保留。未确认扩展建议不自动升为必需，REQ-059为可选。完整证据详见[总报告](README.md)。','',
 table(['REQ','模块 / 来源','167历史状态','167实施范围与剩余验收','194增量 / 当前工作组'],[(r['id'],r['module']+' · '+str(r['origin'])+(' · 可选' if r['optional'] else ''),r['historical_167_assessment']+' / '+r['historical_167_acceptance'],'已有：'+r['implemented_scope_at_167']+'；原完整范围：'+r['historical_remaining_scope'],r['current_194_overlay']+'；工作组：'+(','.join(r['current_group_references']) or '未列为本轮独立新缺陷')) for r in appendix]),
 '',
 'Historical acceptance labels remain historical. No whole-requirement acceptance is invented from partial successes. See assessment.json for exact fields and references.','',
]
(OUT/'requirements-102.md').write_text('\n'.join(appendix_lines),encoding='utf-8')
print(json.dumps({'status':'written','groups':len(groups),'ux_observations':len(ux),'competitive_dimensions':len(wb),'requirement_rows':len(appendix),'independent_reports':len(reviews),'output':str(OUT)},ensure_ascii=False))
