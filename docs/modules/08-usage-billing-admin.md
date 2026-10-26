# M11/M12 内部 AI、费用、权益与运营


**阶段 108 / Stage 108：** 后台语音／转录不可变发版、平台预算持久验证、独立审批／回滚及原始不明 POST 不重发已接通；229 项后端、6 项后台单元及 8 项实际页面流程通过，明确假模型。见[方案及证据](../technical/108-managed-audio-capabilities.md)。原完整验收与未归因超时保留。



**阶段 104 / Stage 104：** 已接通私有对话／成果到明确确认的云端每日／每周计划、不可变版本、逐次 run、人工审批、费用结算、暂停／取消隔离、客户恢复确认和按范围的 MFA Admin 暂停。78 项相关后端检查、8 项实际跨端流程、8 张截图、3 组交互录制；明确假数据。SQL120 新增，SQL001–119 保留。Desktop 本机 Codex 不被云端替代；原 102 REQ／TC 和完整验收结论不改写。见[方案与实际范围](../technical/104-private-cloud-schedules.md)。



**阶段 103 / Stage 103：** 已实现持久后台账户批量任务、冻结目录／用量／费用／审计导出、逐项事务结果、取消、失败子任务重试、MFA／权限重查与过期密文清理。94 项后端检查、7 项真实后台流程、6 张截图和 2 组交互录制；明确假数据。SQL119 新增，SQL001–118 保留。原 102 REQ／102 TC 与 G01–G10 完整验收结论不变。见[方案与实际范围](../technical/103-persistent-admin-data-jobs.md)。



## 阶段 102 用户端内容发版 / Stage 102 client content releases

后台已接入三端公告、帮助与可选菜单的双语编辑、时间窗口、固定版本、身份前后预览、定向保底、发布和历史回滚。确认时复核全局权限、显式拒绝、有效会话及 MFA；失效预览不能覆盖新发版。Desktop 保留本机 Codex、无边框与无可见滚动条；Extension 保留原生右侧栏和获准上传。

Admin controls bilingual client guidance and optional menus through immutable drafts, recipient previews, targeted baselines, guarded publication and historical rollback. Confirmation rechecks global authority, explicit restrictions, the live session and MFA. Desktop remains local; Extension remains a native right Side Panel.

[Design / 方案](../technical/102-client-content-releases.md) · [Evidence / 证据](../quality/client-content-checkpoint.json). Original complete requirement, live role and G01–G10 acceptance decisions remain unchanged.


当前实现新增 [企业席位与存储约束](../technical/48-enterprise-seat-and-storage-enforcement.md)：仅企业方案决定共用容量，个人 VIP 不扩容；启用成员、所有未擦除版本和有效上传预留据实统计。准入与授权变更串行化，超额拒绝新占用，降级保留既有数据；后台整体范围读取同时要求企业与权益权限。本册其他完整商业和综合验收要求继续保留。

关联：REQ-043–048、050、052–054、056、058、060、083–102。ADMIN01 的页面规格见 [Admin Dashboard](../product/08-admin-dashboard.md)，技术主线见 [后台控制面](../technical/11-admin-control-plane.md)。

## 1. 能力与内部路由

CapabilityVersion 记录能力 ID、内部模型别名、wire protocol、推理参数、输入输出类型、工具支持、媒体参数、配额、计价版本及验证状态。状态为 unverified、verified、degraded、disabled。

任务只选择已开放的能力，固定 capability_version；用户指定模型与推理强度不被静默替换。降级需要预先配置的产品策略和可见记录；内部网关无法支持的参数显式报错。

LLM、图片、视频、语音、向量及其他 AI 请求进入同一公司服务边界。文件转换、确定性指标计算和普通媒体编码属于非 AI 工具，可由执行器原生处理。业务平台 API 保持独立连接器。

## 2. 费用数据和单位

内部资金字段采用 `Money{currency, amount_micros}`，amount_micros 为非负整数十进制字符串，表示百万分之一货币单位；v1 计费货币默认 HKD。数据库用 bigint，业务计算不使用浮点。

同一任务显示已确认费用、估算费用、预留及待核对费用。内部网关返回的 token/图片/视频等用量保留原始单位和计价版本；供应商公开价不能替代公司实际内部单价。账单最终按货币最小单位统一舍入，保留舍入调整行。

## 3. 预算预留与账本

提交任务时原子检查企业可用额度和任务预算，创建 reservation。每次付费调用先检查剩余额度并分配调用预留，完成后按唯一 usage_event_id 记消费；余额、账本及 reservation 更新在同一事务内。

账本使用 append-only 的 reserve、consume、release、adjust、refund 事件，引用相同 operation_id；不直接改写历史费用。并发调用以企业预算行锁或等价串行化保证不重复承诺。

reserve 将可用额度转为预留；consume 从预留转入确认消费；release 只退还剩余预留；refund 引用已发生消费后返还。adjust 明确 debit/credit 方向及原因，不以负数 Money 或覆盖旧行表达。企业额度、期间限额、任务上限分别核查；BudgetUpdate 的 new_limit 修改当前预算周期限额，不直接充值或抹除消费，低于已消费与已承诺金额时拒绝。企业付款/授信与人工调整作为独立审计事件。

上游已接受但费用未知时保留相应预留，进入 reconciling；取消不立即返还全部额度。上游若不能限制最大消耗，则不能承诺绝对硬封顶，产品应限定允许规格或不开放该模式。对账完成后一次性消费/释放差额。

## 4. 商业权益

PlanVersion 定义席位、可用能力、默认并发、包含用量和保留策略；Subscription 引用版本和生效区间。超额处理可为拒绝、需增加额度或已约定的后付费，首期默认不自动超额扣费。

Web、扩展和 Desktop 入口使用同一企业权益，不按安装客户端自动赠送媒体额度。人工调整需要原因、操作人和审计，重复支付回调按外部 event_id 去重；账单争议引用实际任务及用量，不暴露供应商凭证。

## 5. 运营与支持

控制台提供完整用户、企业关系、消耗、费用与 VIP、客户内容、任务/计划、连接健康、权限和审计。列表按角色显示字段；获授内容管理权限的管理员可直接读取和管理授权范围内正文，不逐次索取客户确认。客服默认只看元数据，额外正文访问受限时支持授权及独立正文权限共同约束。

支持人员可以重新查询状态、提交对账或创建明确的恢复任务；不通过直接改终态伪造成功，也不跳过用户授权重放外部副作用。运营动作和用户动作使用相同权限与事件模型。

## 6. 指标与告警

业务指标为可用交付率、人工时间、返工、每次成功交付成本和复用。运行指标为任务/步骤延迟、上游错误率、队列等待、未知费用、设备命令积压和浏览器无主资源。

告警示例：已接受任务没有被调度、unknown 动作超过对账期限、费用预留长期未释放、对象引用缺失、跨企业拒绝异常增多。告警以稳定错误类型分组，避免客户内容进入监控标签。

## 7. 交付与证据

上线前必须完成内部网关真实工具循环、能力逐项验证、费用对账、企业隔离、备份恢复与本地资源清理验证。本套文档提供标准与契约，不代表上述运行证据已经存在。

REQ-082 / G09 的品牌检查由交付流程保存实际页面、主题、屏宽、缩放、字体、状态及键盘/对比结果，采用 [品牌规范](../product/07-brand-design-system.md) 和 [前端集成规则](../technical/10-frontend-design-system.md)。运营/用量/企业管理页面共用品牌组件；静态样板通过与真实产品验收分别记录，不提升产品或角色可用状态。

## 8. Admin 服务及权威边界

M12 组织用户详情与管理读模型，通过 M01 执行身份与成员治理，通过 M11 执行账户、收费、VIP 及方案命令，通过各内容模块的注册控制器修改内容。所有后台写入返回 AdminOperation；事务内产生审计和 outbox 后，worker 才能执行后续动作。后台不是数据库通用编辑器，不能绕过领域校验或变更 Codex/内部 AI 硬约束。

费用增加、扣回、退款、信用额度分别有注册动作；实付余额和限时赠送额度分桶，预留按桶引用并独立显示。人工充值关联已确认 PaymentRecord；促销不形成实收发票。退款按原账项及累计已退金额校验，支付原路退款与转回可用余额分开，未知结果保留对账状态。平台 Admin 改预算上限不等于充值。

EntitlementGrant 保存个人/企业主体、精确 PlanVersion、来源、有效时段与操作者。新请求实时求有效权益；到期调度只做缓存和通知，不决定是否仍可使用。个人 VIP 不扩大其所在企业权限或替企业付费，企业授予也不在成员之间复制余额。人工开通默认不自动续费；单独赠送额度须另记幂等账项。

后台角色和字段权限以 [注册权限目录](../contracts/admin-permission-catalog.json) 为准。客服不具备充值/正文默认权限，财务不自动获得客户文件；管理员授权与普通企业 Membership 分离。G10 用例覆盖费用并发、VIP 边界、全内容隔离/恢复、字段与下载权限、批量部分成功，均需实际实现后执行。
