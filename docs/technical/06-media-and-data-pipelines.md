# 媒体、数据与分析管线开发设计

**阶段 79 当前增量：** 不可变品牌版本、固定专家/云端设计任务、真实字体/价格/渠道/期限检查与来源治理；Web/打包 Desktop 品牌表单已实际执行。平台 874、客户端 68、打包 30、品牌 Web 4、Web/Admin 4、原生侧栏 8 项分别通过。SQL096 为新增迁移，SQL001–095 与原规范各自字节保留。原 102 REQ/102 TC 为 82 部分/20 未证明/0 完整验收，G01–G10 与 TC-056 仍未证明。Desktop 保留本机 Codex、无边框、真实进度及无可见纵横滚动条、可滚动和键盘访问。见 [方案与限定证据](79-versioned-brand-production.md)。

<!-- stage60-template-video -->
基础模板视频的当前增量实现见[独立视频工程](../technical/60-template-video-production.md)：脚本/分镜/字幕/授权音轨与真实成片分开交付，固定输入、版本化队列、当前权限、媒体探测及删除可追溯。此项本地合成与生成式视频、特效、TTS/ASR 分别验收，原始需求范围保留。

版本：1.2 · 2026-10-18。业务规格见 M04–M08；本稿定义执行 DAG、缓存、恢复及数据校验。

## 1. 通用步骤结构

每步有 step_key、type、depends_on、input_refs、input_hash、tool_version、operation_id、resource_class、timeout、retry_policy 和 output_refs。步骤输出不可变，只有成功校验并提交的结果可被下游引用。

缓存键包含企业、来源资产版本、参数、品牌、字体、能力/工具版本。不能跨企业复用未经授权内容；历史缓存不替代已撤销访问。输入或工具版本变化使相关节点失效，独立节点可复用。

## 2. 图像 DAG

brief.validate → creative.plan → image.generate/edit → image.validate → layout.render[locale,size] → layout.check → package。

生成先写 operation，再请求内部服务；结果取回后核对实际文件、尺寸和格式。布局在受控字体环境渲染，文本经过转义，不允许用户输入注入脚本或任意远程 URL。排版 worker 为每批次建立受限 Chromium context，完成/失败后关闭不用的页面与 context。

text layer 变化只失效 layout 之后节点；背景变化失效相关布局；品牌字体变化创建新的工程与结果版本。布局检查输出缺字、溢出和安全区结果，不能只返回 success 布尔值。

## 3. 视频 DAG

script → storyboard → source_media → timeline.validate → preview → final_render → encoded_checks → package。source_media 可调用内部生成式视频，也可使用授权本地/云端素材。

渲染清单包含每个素材摘要、入出帧、轨道、字幕、字体和输出 codec preset。FFmpeg 通过参数数组启动，不拼接用户 shell。限定编码时长、像素、线程、输出字节和磁盘空间。

实际成片用探测与抽帧核对时长、帧率、分辨率、音轨、字幕和首尾。只有通过编码检查的文件成为 ready。预览和最终渲染使用不同产物类型，避免用户误下载低清预览。

## 4. 媒体异步恢复

创建前持久保存 request_hash 与 operation_id；上游接受后保存 provider_job_id。响应丢失但可能已接受时进入 unknown，使用原 operation/job 查询；只有确认未接受才允许重新创建。

轮询采用有上限的退避和抖动，达到超时进入可查询故障状态，费用预留继续对账。回调使用 provider event_id 去重并验证签名；回调与轮询并发通过版本条件更新收敛。

## 5. 广告数据管线

extract → raw snapshot → validate → normalize → deduplicate → calculate → evidence → narrative → report validation。

raw 保存原文件/响应摘要和取数条件；normalize 以平台字段映射版本处理金额与口径；deduplicate 根据实际粒度而非行序号。数值用 Decimal，不把缺失值、零与不适用混在一起。

计算输入冻结为 Snapshot。计算服务输出 metric_id、value、unit、currency、scope、formula_version、evidence_id 和 null_reason。叙述生成引用这些 ID，输出后执行数字和引用检查，不一致则返回修正或明确报告失败。

## 6. 增量同步和报告复现

同步分页保存 checkpoint，部分完成可用于明确范围的分析但不标全量。回补迟到数据产生新快照，旧报告维持原样。报告重跑记录新 snapshot_id，用户可以对比数据更新时间变化。

GSC/GA4 的限制和聚合方式进入 metadata；平台报表数字变化不自动表示本产品算错，需结合相同查询条件和截止时间核对。

## 7. SEO/GEO 执行

SEO 按 URL 范围和页数预算抓取，每跳重定向检查目标，记录失败页面和覆盖率。GEO 按固定 experiment_version 生成样本，AI 请求走内部网关；结果抽取保留实际回答证据，不能只存模型自述的引用。

## 8. 交付与管线测试

每条管线提供固定输入、期望文件/指标、失败注入点及恢复结果。验证输入变化时缓存失效、步骤中断时不重复计费或写入、缺失文件时不能生成成功 manifest。实际媒体质量测试与 JSON schema 测试分别报告。

## 9. 角色驱动的设计管线

角色模板只组合已登记步骤，不能代替媒体能力验证。R06「设计师」由 Codex 加载创意方向、图像指导、内部 Image 2、字体排版及交付技能；Image 2 生成/编辑结果经下载校验、内容探针和版本入库后供布局引用。真实文案/价格/Logo 图层由渲染器产生，修改文字复用背景，修改背景保留准确文字。

R07–R16 按品牌/广告/商品/系列/插画/排版/演示/网页/信息图/视频工作约定复用管线；矢量、PPTX、图表和视频分别校验实际格式及可编辑范围。基础视频采用模板渲染，内部生成式视频和配音是独立可选能力。逐角色记录真实成果和局部修改证据，纯文本方案不能替代模板承诺的图片、源工程或成片。
