# 版本化客户交付审阅与品质汇总 / Versioned delivery review and quality

实现固定输出及资产版本的接受、需修改与弃用，保留追加历史；任务版本与交付摘要同时检查，幂等重试不重复写记录或费用。人工基线、累计投入与修改次数独立填报，空值与零不同；复用只统计其他任务实际读取的固定版本。后台以 MFA 与原 `admin.usage.read` 范围读取汇总，显式拒绝仍优先，不能代客户接受或从汇总读取意见正文。修正后台缺少客户上下文时错误排除有效来源的逻辑。

Web、实际打包 Desktop、Chrome 原生右 Side Panel 及 Admin 接通对应流程。Desktop 保留客户本机 Codex、明确完整授权、无边框和真实进度；隐藏滚动条，重排长内容，修复保存后表单收起，并验证 800×600 下输入框真正可见/聚焦、输入区及回执留在窗口内。角色、权限与预算控件统一品牌样式。Extension 始终独立使用云端 Codex和获准文件上传。

先安装 SQL095 再发布依赖 API/UI，SQL001–094 原字节及原任务 OpenAPI 不变。实际 HTTP 方法/路径由 428 增至 434，新增六项质量操作。旧单值接受状态没有交付快照，升级后需要客户重新审阅。均摊服务成本只在费用完整确认且有接受交付时显示；不含退款抵减、外部服务与人工费用，不推断 ROI。

当前范围：861/861 平台测试、68 客户端单元、26 打包旅程、4 Web/Admin 及 8 原生侧栏检查，分别计数；保留的 17 项原生监督器证据中 57 份绑定源码不变。SQL、原规范、源码、实际媒体摘要及资源清理见[检查点](../quality/business-quality-checkpoint.json)。阶段 77 的 851 项测试全部保留，新增十项。模拟的是模型、业务/客户输入和系统对话框决定；身份、数据库、本机 Codex、进程、文件及费用真实执行。

失败与未选记录保留：定向 01/02 分别为验证夹具 JSON 和私有任务范围错误；页面 01/02 为服务运行目录错误，03 发现后台来源统计问题，04 暴露最初修正中 SQL 函数对未授权内层函数的计划检查，均已修复。页面 05 的主题重载被测试初始化覆盖，06 的静态截图捕获按钮颜色过渡，不采用为最终图片。Desktop 29 为表单展开保持修复前的通过记录；30 在改尺寸后的滚轮检查超时，原验证器只等待 innerWidth 而未等待稳定命中区域；改为稳定悬停、真实命中检查及可信滚轮诊断后在最终 31 重跑通过。未把局部通过或历史媒体冒充最终全量结果。

平台20第十批两项迁移测试仍断言最新版本 094，在正确执行 SQL095 后失败。仅将该测试文件的两个期望值更新为 95，原文件及前后摘要单独保留，平台21重新验证全部测试。Desktop31、Web/Admin07 的运行代码、界面与旅程脚本不变，其绑定清单中这一项测试文件差异逐字审核，保留原实际截图/录制和原始执行记录，明确为有此测试差异的证据，不冒充在后来测试字节上重新执行。

原 102 REQ/102 TC、81 部分/21 未证明/0 完整验收及 G01–G10 保持。REQ-056 的独立记录与汇总已有局部实现证据，三类各十个真实代表任务、人工基线、盲审和续用证据仍未执行；18 角色/29 Skill 的完整专业交付、正式模型和生产验收亦未证明。

## English

Customer reviews now bind current output and artifact versions and preserve append-only accept/change/discard history. Product forms enforce both task version and delivery digest; idempotent retry adds neither duplicate facts nor charges. Reported human baseline, cumulative effort and revisions retain unknown versus zero. Reuse requires another task's observed fixed-version read. The MFA Admin dashboard returns scoped metadata under its existing usage permission and explicit denies; it cannot review on a customer's behalf. Control aggregates validate task lineage without borrowing customer session scope.

Actual Web, packaged local-Codex Desktop and native Chrome right Side Panel flows are connected. Frameless Desktop preserves explicit local permission, truthful progress, native scrolling and keyboard access with hidden rails. Compact focused inputs, composer and receipt remain visible; effort-form refresh and branded controls are corrected. Extension independently uploads authorized files to cloud Codex. Apply SQL095 before the dependent API/UI; all 94 published migrations and the original task contract are unchanged. Six additive operations bring the actual route inventory to 434. Legacy unversioned acceptance requires a current customer review. Company service costs exclude refund offsets, external services and labor; incomplete settlement never becomes a complete cost or ROI claim.

Separate current checks cover 861 platform cases, 68 client units, 26 packaged-Desktop scenarios, four Web/Admin scenarios and 8 native Side Panel scenarios; the retained 17-case native-supervisor proof has all 57 bound files unchanged. All 851 previous platform cases remain. Earlier fixture, scope, working-directory, SQL planning, theme-initialization, transition-capture and resize-hit-testing failures are retained. Final proof binds current source and actual media, with owned browsers, processes and databases closed. Models, campaign/customer input and native-dialog decisions are explicit fixtures. TC-056 real representative tasks/baselines/blind review, complete professional/OS parity and original production gates remain unproven.

Platform20 batch10 exposed two stale expected-latest-version assertions, 94 after SQL095 had correctly applied. Only those two test values changed, with exact before/after archives, and Platform21 freshly reruns all tests. Desktop31 and Web/Admin07 retain their original journeys and real media with this one reviewed non-runtime test-file difference; every runtime, UI and journey source remains unchanged. Earlier receipts are never rewritten or represented as executed on later test bytes.
