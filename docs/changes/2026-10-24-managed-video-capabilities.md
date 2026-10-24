# 后台视频能力发布 / Managed video capability releases

后台原能力管理只接受文字／图片，本次增加视频模型与正数秒费率的不可变草稿，16 案例的持久异步验证，以及现有独立审批、发布、回滚。每次 HTTP 前记录原 operation 和平台预算报价；失联、租约接管和服务退出均复用原作业，不重复生成。两小时冻结授权复核原会话、权限、网关、Codex 摘要及数据库时钟；只有原资源查询／取消可以继续核对已发出作业费用。

新增 SQL098 保留旧预算函数 OID，使升级前的 prepared queries 也计入视频占用。原输入计数、审核覆盖层、用户视频、并发和分钟速率语义保持。取消确认之后必须另行读取原资源；15 个生成案例须核对真实 MP4/H264 摘要、尺寸、时长并完整解码。费用未知不能视为免费；超报价留下不可变违规事实，不能发布。

Admin 显示当前费用与资格决定时的原回执、逐案例真实进度、停止和重查。未知用量期间禁用再次验证；费用确认后明确新验证会创建新付费回执。页面有英文／繁中、深浅主题和窄屏，只有读取权限的管理员无变更入口。视觉复核统一了操作选择器样式，并在费用确认后结束待核对提示。

English: Video configurations now use durable platform-funded verification with 15 real decoded media probes plus one cancellation followed by a separate resource observation. Original-operation recovery survives lost replies, processor fencing and graceful shutdown without duplicate generation. Existing tasks retain frozen model/rates. Independent preview/approval/publication/rollback continues to reject self-review and recheck current authority. Live costs can be reconciled without rewriting immutable eligibility.

验证 / Validation: 929/929 current platform cases in 71 files/18 batches, all original 912 retained; 106/106 separate compatibility checks, seven contract checks and seven actual Admin UI checks. Native PostgreSQL, auth/TOTP, pinned Codex version and actual MP4 decoding are real; service/model/video content is explicit synthetic data. Historical client captures retain their original qualification scope. Owned browsers, previews and databases close; no Docker/WSL/VM.

部署前应用 SQL098。SQL001–097 与两份原 OpenAPI 字节保持。14 份中英 README、方案、流程图、真实截图和 3 段 GIF／MP4 同步。原 102 REQ/102 TC 保持 83 部分、19 未证明、0 完整验收；真实供应商、完整专业业务、TC-019／TC-056、签名安装及 G01–G10 保留。

主文档仓库只忽略根目录 `/dev/`，保留文档历史中用于核查的同名源码归档。The documentation repository anchors its development-directory ignore rule to the root, so exact source archives nested under documentation history remain publishable.

首次完整回归的假服务分配到 2049 端口，Node Fetch 在 HTTP 前拒绝请求；该失败保持失败，实际端口／错误观察及仅自建进程和精确夹具清理记录保留。修复仅将假服务接入现有安全端口工具，并给测试信号等待增加时限，未删断言、改测试名或改产品代码。当前专项 17 项及完整 71 文件重新运行；旧兼容和页面保留自身原始执行，明确记录后续两处夹具差异，不冒充新录制。

The original combined-run failure remains failed. Its live owned-port witness proves Fetch rejected 2049 before HTTP. Only safe fixture-port selection and a bounded test wait changed; assertions, test names and product bytes remain intact. Current core and complete-platform runs re-execute the repaired harness. Earlier passing compatibility/UI receipts retain their original run scope with exact later harness differences reviewed.

[方案 / Design](../technical/81-managed-video-capability-releases.md) · [精确证据 / Evidence](../quality/managed-video-checkpoint.json) · [严格契约 / API](../contracts/capability-releases.openapi.json)
