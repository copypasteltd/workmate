# 机器契约、编辑工程与固定样例

<!-- stage62-scoped-seo -->
新增 [scoped-seo-openapi.json](scoped-seo-openapi.json)：8 个补充操作、14 个严格结构，绑定当前模型/路由源码及真实 HTTP 响应样本。原规范 openapi.json 保持原摘要；补充契约不代表完整规范 TaskDTO 与 POST /v1/tasks 已对齐。

版本：1.5 · 2026-10-18。以下接口为拟实施的产品契约，示例域名、UUID、文件摘要和业务数据均为虚构，不代表已部署服务；品牌取样另有实际官网来源。

## 1. 文件与用途

| 文件 | 用途 |
| --- | --- |
| [openapi.json](openapi.json) | 产品 HTTP API，OpenAPI 3.1；含请求、响应、认证、权限、需求和最早阶段 |
| [task-event.schema.json](task-event.schema.json) | 持久任务 SSE data JSON；按 type 限定 payload |
| [device-command.schema.json](device-command.schema.json) | 带签名、授权、输入摘要及租约代次的设备命令 |
| [device-channel.schema.json](device-channel.schema.json) | WebSocket 握手、先同步撤销、命令与结果确认帧 |
| [creative-project.schema.json](creative-project.schema.json) | 最小图文可编辑工程：画布、图片/文本/形状图层与字体引用 |
| [video-project.schema.json](video-project.schema.json) | 最小视频工程：整数帧时序、轨道、素材及字幕图层 |
| [delivery-manifest.schema.json](delivery-manifest.schema.json) | 导出文件路径、摘要、版本、使用范围及缺项 |
| [analytics-metric-vectors.json](analytics-metric-vectors.json) | 加权指标、零分母、缺失转化及多币种固定预期 |
| [role-preset-catalog.json](role-preset-catalog.json) | 18 个角色、29 个逻辑 Skill、必需/可选模型、输入流程/交付/逐角色场景；当前 design_only |
| [role-preset-catalog.schema.json](role-preset-catalog.schema.json) | 设计目录结构；至少 12 个条目及内部 AI 路径等静态约束，非运行资格 |
| [admin-permission-catalog.json](admin-permission-catalog.json) | 八类后台角色、显式权限、范围、字段和执行约束；设计快照 |
| [admin-permission-catalog.schema.json](admin-permission-catalog.schema.json) | 权限目录严格结构，不允许通配符或生产授权声明 |
| [官方 OpenAPI meta-schema](vendor/openapi-3.1-meta.schema.json) | 离线校验 OpenAPI 结构的官方 schema 副本 |
| [需求追踪机器记录](../quality/traceability.json) | 全部 REQ、文档、operationId 与 TC 关系 |
| [验收用例机器记录](../quality/test-cases.json) | 前置、操作/异常、预期及未执行状态 |

## 2. 有效样例

| 样例 | 对应验证 |
| --- | --- |
| [admin-fee-gift.json](examples/admin-fee-gift.json) | 虚构 HKD 500 赠送请求，独立到期与原因，不表示收款 |
| [admin-vip-grant.json](examples/admin-vip-grant.json) | 虚构三十天企业 VIP，固定方案版本，不自动扣款 |
| [task-create.json](examples/task-create.json) | 两种语言、一个尺寸的图片任务与 HKD 预算 |
| [task-event.json](examples/task-event.json) | queued → running 持久事件 |
| [device-command.json](examples/device-command.json) | 五分钟有效的目录内 file.read 命令 |
| [device-public-key.json](examples/device-public-key.json) | 公开的文档测试公钥与使用边界 |
| [device-channel.json](examples/device-channel.json) | 设备 hello 帧与重连游标 |
| [creative-project.json](examples/creative-project.json) | 产品内布局工程，引用虚构字体 ID |
| [video-project.json](examples/video-project.json) | 15 秒、30fps、9:16 的最小时间线 |
| [delivery-manifest.json](examples/delivery-manifest.json) | 虚构交付清单，非已渲染媒体包 |

签名样例使用可公开复现的固定测试密钥，**不能用于生产设备**。校验包括有效签名和参数篡改拒绝。样例只含 ASCII 对象键与整数签名字段，Python 排序 JSON 在该受限样例可用；生产必须使用 RFC 8785 实现并做 Unicode、数字及跨语言一致性验证，不能把当前算例扩大为完整 JCS 认证。

## 3. 语义校验与状态

schema 证明字段、类型和部分互斥规则；业务服务仍要验证 tenant/project 归属、当前角色、能力版本、预算、日期顺序、批次乘积、图层安全区、时间线依赖、轨道 ID、重复图层、总帧范围及文件实际摘要。相对路径只接受正斜线；原生执行还要验证根身份、文件句柄、重解析点、系统保留名及竞争条件。

工作流发布另外校验 input/output JSON Schema 本身、DAG、绑定引用、工具与失败策略；每次运行指定固定 workflow_version_id。视频 effect_ids 在实施时引用注册的明确版本，任意表达式不作为可执行代码。当前编辑格式支持产品自身恢复；PSD/AI/AE/剪映等由独立适配器和验收决定。

x-stage 是共享接口的最早引入阶段，不表示该接口枚举的所有能力均在当阶段开放。例如媒体入口 M1 可用，生成式视频、语音仍按 M4 及实测状态开启。x-requirements 表示设计关系，不能替代该需求的运行证据。

会话消息不隐式创建收费任务；Web 明确 intent=delegate 并给出预算时，可在同一事务保存消息与计量任务，返回 task_id。普通 discussion 只保存讨论；supplement 携带目标 task_id/expected_task_version 补充原任务，结构化缺项也可用 provideTaskInput。产物修改由 editArtifact 接受已上传的编辑工程，返回新任务，完成后产生新版本；source_cell_ids 用于固定批次中局部返工。

自然语言入口使用 type=delegation，只需 prompt，即可先持久接受、计量规划步骤并进入 needs_input；选择具体模板时使用严格类型输入。界面的「交给 Agent」可在同一动作创建会话消息和任务，不额外要求用户确认已授权预算范围内的读取操作。消息、任务及幂等关联由服务端事务维护。

历史产物通过 createVersionDownload 固定 asset_version_id 下载；createAssetDownload 用于选择资产当前可访问版本，签发时同样冻结具体版本。BrandCreate 带 brand_id 表示为现有品牌新增版本；省略则新建品牌身份，始终核验项目归属。

Web 1.1 增加 Agent/Group 互斥目标、技能版本与有效绑定、云文件节点、项目配置、方案版本、计划批准、依赖恢复及 Routine 草稿。schema 约束目标互斥和补充消息版本等结构；只读模式、撤销即时生效、总预算、共享范围和计划摘要仍需服务端运行验收。静态校验不将这些行为标为已实现。

竞品来源只读复核可单独运行 python -B -X utf8 docs/tools/check_benchmark_sources.py，更新 [来源元数据](../research/02-source-checks.json)；它访问公开官方页面，不启动浏览器。链接或内容变化需要人工重读 [研究报告](../research/01-web-benchmark-workbuddy-accio.md) 中相应结论，HTTP 200 不是语义验证。

## 4. 重建与核查

依赖为 Python、jsonschema（含 referencing）和 cryptography；固定版本记录在 [requirements.txt](../tools/requirements.txt)。不依赖应用代码、浏览器或虚拟化服务。

按依赖顺序，在工作区根目录分别运行：

    python -B -X utf8 docs/tools/build_contracts.py
    python -B -X utf8 docs/tools/build_quality.py
    python -B -X utf8 docs/tools/validate_docs.py

前两个脚本生成 JSON 与质量文档，第三个只执行静态验证并写 [报告](../quality/validation-report.json)。先修改生成脚本或 SRS 再重建，避免生成物和来源不同步。媒体样例不是可播放文件，本套核查不会声称真实生图或视频已完成。

## 5. 外部 schema 来源

OpenAPI 官方 meta-schema 来自 [2022-10-07 schema](https://spec.openapis.org/oas/3.1/schema/2022-10-07)，于 2026-10-18 原生 HTTP 获取并原样保存在 vendor，保留其 $id。采用离线副本避免每次校验依赖公网；规范版本更新时需显式替换及重新审查，不静默更新。

## 6. 角色预设的设计数据与运行契约

[build_role_presets.py](../tools/build_role_presets.py)是目录及 schema 的生成来源，已由 build_contracts.py 顺序调用；修改角色绑定先改此来源，再重建 quality/validate。设计目录有 18 个角色和 29 个逻辑技能，全部包为 planned、能力 unverified、验证用例 not_run，不含生产 Key、真实模型 alias 或技能包内容。

validate_docs.py 对目录执行 schema 与跨引用检查，核对 Skill 精确版本、必需/可选模型传递、工具来源、角色覆盖、指定设计师及逐角色正常/修改/异常设计。OpenAPI 另外描述模板发布、项目预检查、实例化及资格引用。设计快照的条目数不等于通过生产验收的可用角色数；至少十二个真正合格角色的门槛由发布服务及实际运行证据落实。

CORE01 将全部运行配置的 kernel 固定为 codex；目录 schema 使用 const 拒绝其他内核，实例 overrides 也不允许指定 kernel。OpenAPI 1.3.0 的 x-runtime-policy 同步唯一内核、app-server/stdio 集成与禁止自动内核回退的约束，RolePresetDefinition.runtime_profile_id 必须解析到已启用、版本固定的 Codex 配置。静态检查包含非 Codex 目录配置及客户覆盖内核的拒绝样例；实际发布、执行和恢复行为仍由 [Codex 集成与验收](../technical/02-runtime-and-ai-gateway.md) 落实，不以元数据代替服务端校验。

## 7. 品牌设计数据

[brand-tokens.json](../design/brand-tokens.json) 和 [CSS 变量](../design/brand-tokens.css) 属于设计资源，来源为 [品牌规范](../product/07-brand-design-system.md) 与实际官网快照；不属于新增 HTTP API。品牌资源保持 1.3.0；产品文档 1.5 与 OpenAPI 1.4.0 记录当前后台及已有内核约束，主题偏好与客户品牌配置分别维护。

`python -B -X utf8 docs/tools/build_brand_design.py` 重建设计资源及 [离线样板](../design/brand-preview.html)。`python -B -X utf8 docs/tools/verify_brand_preview.py` 另用已有原生 Chrome/Edge 和 Python Playwright 检查样板、更新截图及 [样板报告](../quality/brand-preview-review.json)，所有自建 context/页面/浏览器均在结束后关闭；此工具需要浏览器，与纯静态验证的依赖分开。validate_docs.py 离线核对官网摘要/色值、CSS 同步、指定对比组合与记录，不声称真实产品已通过。

## 8. Admin 契约与验证边界

[build_admin_contracts.py](../tools/build_admin_contracts.py) 由主生成器顺序调用，输出后台接口、严格请求、权限目录及虚构样例。/v1/admin/* 统一采用独立 AdminSession 和 AdminCsrfHeader；普通用户身份只可使用 /v1/effective-entitlements 等企业范围接口，不能获得后台权限。旧 admin/health 同步切换独立认证，明确迁移而不保留普通用户凭证通道。

动作权限、scope、字段、状态和风险策略共同判定；x-action-permissions 为基础权限之外的必需动作权限。资金请求按充值/赠送/扣回/退款/信用上限分型，VIP 固定主体与时间；JSON Schema 拒绝额外字段、负数、通配符等结构错误。日期顺序、历史余额、累计退款、MFA 有效性、角色委派上限、全内容隔离与撤权传播由真实服务验证，静态通过不等于后台运行通过。

## 9. 受控支持的原规范与补充视图

[支持 schema 快照](admin-support-schemas.json) 从原 OpenAPI 按原字节提取八个命名类型及递归依赖，平台副本逐字节相同。原 OpenAPI SHA-256 保持 `51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4`。原用户授权创建/撤销、Admin 支持会话列表/创建/撤销沿用严格规范 DTO；授权列表及只读 view 为明确补充路径。

实际页面保留三个原规范端点响应和从补充 view 提取的一份原会话 DTO，单独严格验证，不计为四个规范操作，也不增加既有 125 份样本的数字。支持上下文头仅可访问绑定自己的只读 GET；费用、VIP、下载、凭证和其他读取/修改都拒绝。细则与原始回执见 [支持专册](../technical/51-controlled-read-only-support.md)。
