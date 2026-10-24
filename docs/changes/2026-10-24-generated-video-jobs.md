# 生成式视频与紧凑桌面 / Generated video and compact Desktop

新增公司 `company-video-jobs-v1` 持久作业与 SQL097：固定原 operation、角色/Skill/能力/费率与来源版本；提交前持久保存报价，与推理和图片共享预算。断线恢复不重提生成；未知用量保留费用，确认用量后沿用原账本结算。实际摘要、文件大小、MP4/H264、时长/尺寸和完整解码通过后才交付。后台元数据、费用、重查与审批按独立权限和范围管理，不暴露客户正文。

Desktop 本机 Codex、无边框和完整本机权限保留。影片参数默认收起，窄窗口中展开仍可访问会话/输入。隐藏可见纵横滚动条，真实滚轮、键盘和进度保留。Web/本机 Desktop/原生右侧栏均可预览真实 MP4；后台窄屏卡片按可用宽度重排。

实际检查修复了完成页 React key 重复和后台续租导致取消按钮频繁版本冲突；公开控制版本与运行租约分离，真正状态改变仍拒绝旧版本。原生工作流子任务结算前停止并等待心跳，避免将正常完成误判为撤权而停止父流程；加入可确定复现该竞争的单元测试。长录像 GIF 改为两遍流式编码，保留真实时间，避免缓存整段帧。内置演示网关撤下不支持的视频核验标记；侧栏检查在配置服务模式下调用明确夹具的真实公司网关并消费用量回执。失败和中断回执按原样保留，不能计入通过。

统一限流保留原有生成请求、输入 token 计数和独立审核后的并发状态，再加入视频作业；已完成的请求继续计入分钟速率。新增跨视频/推理的实际请求回归。

English: Video admission extends the existing canonical provider projection, including input-token counting and independently reviewed termination facts. Completed calls release concurrency while retaining their rolling-minute rate charge. A new actual-request regression checks both the completed counting/reasoning rate boundary and video-to-counting concurrency, without weakening the original provider tests.

两项升级测试的最终迁移版本断言随新增迁移更新为 97，其余历史夹具、迁移摘要和财务事实断言原样保留，并重新执行完整文件清单。Earlier UI journeys did not execute this migration-test file; a hash-bound receipt records the exact two assertion changes, and the fresh complete platform run executes the final test inventory.

Skill 目录保留 29 类方法与 30 个不可变版本包，同时保留 `video-generation` 1.0.0 和 1.1.0；版本计数测试增加逻辑键与唯一版本 ID 断言，原项目范围、安装权限、幂等与冻结绑定断言保留。完整回归可以先选择计划内批次，最后仍须每个文件全部通过，失败与重复批次不能计入通过。

平台阶段 27 的一批在 Windows 1455 共享内存错误后发生 Node 子进程异常退出，原回执与日志保持失败。阶段 28 在完全相同的完整源码、测试、工具和固定内核下重新执行该批全部四个文件，56/56 通过；其余十七批沿用逐一核对字节一致的完整通过回执。独立复核脚本验证 70 个文件、18 个批次、不重复计数、各自原计划摘要、原始 TAP 和清理证明；没有重写原失败尝试或拼接虚构 TAP。见[复核记录](../quality/generated-video-platform-requalification.json)。

English: A Windows 1455 shared-memory failure interrupted one stage-27 batch. The complete four-file batch passed 56/56 in stage 28 with byte-identical application, tests, harness and native binary. The other seventeen complete passing batches keep their original receipts and plan hashes. The failed attempt remains failed and is excluded; the reviewed aggregate verifies every file, raw report and cleanup without fabricating a single TAP stream.

原生浏览器 GIF 核验发现额外编码尾帧，原 GIF/MP4 和执行记录保留；展示单独标识、由实际 MP4 按原时间重编码的 GIF（24.17 秒，对应 MP4 24.20 秒），没有加速或造帧。A separate timing-corrected GIF removes only an encoder tail; raw media remains hash-bound in the [media receipt](../quality/generated-video-media-normalization.json).

Current validation: 912 platform cases (all previous 874 preserved), 60 focused video/gateway cases, 17 native supervisor cases, 69 client unit cases, 32 packaged Desktop, five Web/Admin and nine native Side Panel checks. Real native Codex, auth, DB, files, media decoding and ledger use explicit reasoning/video/customer fixtures. Source hashes, raw evidence, screenshots, GIF/MP4 and the unsigned local candidate are in the [checkpoint](../quality/generated-video-checkpoint.json).

升级先应用 SQL097，再按双语 README 配置公司视频别名、费率及明确核验开关。公开 Sora 2/Videos API 已停用，不能直接沿用公开服务。视频管理后台完整能力发布、真实供应商、全格式/角色和真实客户接受仍未证明。原 102 REQ/102 TC 为 83 部分、19 未证明、零完整验收；TC-019/TC-056 与全部 G01–G10 保留。未使用 Docker/WSL/VM，所有自建浏览器及测试数据库已关闭。

[方案 / Design](../technical/80-generated-video-jobs.md) · [接口 / API](../contracts/generated-video-openapi.json) · [需求进度 / Progress](../quality/requirements-alignment-progress.json)
