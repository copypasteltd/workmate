# Web 对标研究：WorkBuddy 与 Accio

版本：1.4 · 核查日期：2026-10-18（Asia/Taipei）。目标：提取 CopyPaste Web 的产品逻辑，并落实到需求、流程与验收。

## 1. 结论与研究边界

建议将 Web 定义为**企业云端 Agent 工作台**。用户从一句工作目标开始，在同一会话中补充资料、了解执行、检查和修改成果；项目持续保存团队的资料、规则和可复用能力。marketing 是首批深入服务的业务领域，平台同时承载其他企业工作。

本轮检查官方产品页、公开 Web 应用 HTML 和帮助文档。证据分为：H＝公开应用 HTML 可读取；D＝官方文档描述；I＝据此提出的 CopyPaste 设计。H 不代表实际点击成功，D 不代表登录后的 Web 已逐项验证。当前环境没有可调用的交互浏览器控制工具，未登录、未执行竞品任务、未测试付费能力或生成质量。

用户给出的 Accio 域名当前首页标题指向 Accio Work；其官方浏览器入口是 [Accio Web](https://www.accio.com/work/app)。WorkBuddy 官方产品页链接到 [在线应用](https://www.workbuddy.cn/app)。研究同时保留这些产品的跨端设计，但不把桌面说明直接当作 Web 已上线证据。

## 2. 官方证据索引

下面只摘取与本次决策有关的事实。推广中的效率、用户规模、能力数量及安全保证未作为效果证据。复核元数据见 [来源核查记录](02-source-checks.json)。

| ID / 类型 | 官方来源 | 直接观察或文档描述 | 适用范围 / 限制 |
| --- | --- | --- | --- |
| WB01 / D | [腾讯云产品介绍](https://cloud.tencent.com/product/workbuddy) | 自然语言委派、专业专家、云端执行和团队项目复用 | 同页包含本地与云端，不能合并权限边界 |
| WB02 / H | [WorkBuddy 应用](https://www.workbuddy.cn/app) | 官方在线入口返回应用 HTML 与前端资源 | 未获得登录后的交互证据 |
| WB03 / D | [新建任务栏](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Task-Bar) | 输入目标后进入会话；提供执行、计划、问答模式和附件输入 | 页面明确介绍本地工作台；借鉴交互，不照搬本地目录权限 |
| WB04 / D | [项目](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Project) | 项目组合指令、资料、专家、技能、连接器；任务可分享与转交 | 明确 Web/客户端个人技能库不同，项目技能共享 |
| WB05 / D | [专家](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Expert-Center) | 区分技能、专业角色与专家团；缺少连接时就地引导并续做 | 专家不会因角色说明而自动获得权限 |
| WB06 / D | [技能](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Skills-Market) | 支持发现、安装、导入、创建、启停及卸载 | 关闭与卸载不同；页面描述旧会话仍可能保留已加载技能 |
| WB07 / D | [右侧边栏](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Right-Sidebar) | 产物、工作空间文件和变更在会话旁查看；部分任务有浏览器/终端 | 通用说明含桌面能力，不能保证浏览器版全部具备 |
| WB08 / D | [结果查看](https://www.workbuddy.cn/docs/workbuddy/Results) | 文件预览、引用回对话、变更检查和成果分享形成后续工作入口 | 打开本地目录、默认应用属于本地环境 |
| WB09 / D | [多人多 Agent 协作](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Library/Collaboration) | 团队资料权限约束 Agent；文档评论和修订围绕同一内容 | 这是产品说明，未实测实时协同和冲突处理 |
| WB10 / D | [助理：远程任务](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Assistant) | 此模式通过 IM 触发电脑上的任务，要求电脑开机运行 | 远程入口与真正云端执行必须区分 |
| WB11 / D | [企业智能体](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/CloudAgent) | 区分 Agent 配置、Runtime、Session，提供版本和运行生命周期 | 企业管理/开发者能力，不能当作普通 Web 用户默认配置流程 |
| WB12 / D | [设计创意](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Design-Idea) | 对话生成、选区修改、画布精修与交付衔接 | 涉及 Ardot 授权；不能推导为 CopyPaste 已有该集成 |
| WB13 / D | [左侧导航](https://www.workbuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/Sidebar) | 高频工作、项目、历史与能力入口分别组织 | 客户端说明，不照抄菜单名称与数量 |
| AC01 / H | [Accio 首页](https://www.accio.com/) | 当前 HTML 标题为 Accio Work 商务 Agent 团队 | 首页为动态应用，静态标题不足以验证能力 |
| AC02 / H | [Accio 浏览器应用](https://www.accio.com/work/app) | HTML 含 New task、Agents、Plugins、Channels、Design，以及 Agent/Group 入口 | 未实测点击、登录或执行；不据此判断连接器可用性 |
| AC03 / D | [创建 Agent](https://www.accio.com/wow/doc-create-agent-guide.html) | 持久身份、角色模板、工具、技能、记忆和工作空间共同构成 Agent | 文档混合本地与通用概念，模板清单不是 Web 验证清单 |
| AC04 / D | [会话与右侧面板](https://www.accio.com/wow/doc-chat-guide.html) | 同一 Agent 可有多个会话；附件、Artifacts、项目文件树分开查看 | 独立悬浮聊天窗口明确为 Desktop Only |
| AC05 / D | [Agent Group](https://www.accio.com/wow/doc-agent-team-guide.html) | 协调者分工，成员按职责执行，结果回到同一群组 | 文档能力，未验证浏览器版的成员管理与运行效果 |
| AC06 / D | [协作机制](https://www.accio.com/wow/doc-agent-collaboration-overview.html) | 持久群组与临时 SubAgent 是两种不同协作方式 | 内部并行与用户可见团队不等价 |
| AC07 / D | [技能](https://www.accio.com/wow/doc-help-skills.html) | 技能封装业务方法；可安装、按 Agent 配置，并在会话中指定 | 技能过多会增加上下文负担；宣传中的准确性不作为保证 |
| AC08 / D | [Plugins](https://www.accio.com/wow/doc-help-plugins.html) | 将连接器、技能及相关指令打包为面向业务的工具包 | 不代表所有包都已验证可用 |
| AC09 / D | [自动化](https://www.accio.com/wow/doc-automations-guide.html) | 可以直接在对话中提出定时工作，也可在专页管理 | 未实测关闭桌面后的调度行为，不推断其运行位置 |
| AC10 / D | [记忆](https://www.accio.com/wow/doc-agent-memory-guide.html) | 会话、工作记录、长期要点和身份偏好有不同存储作用 | 本地索引说明不能转述为云推理数据不外发 |
| AC11 / D | [Agent 工具](https://www.accio.com/wow/doc-help-agent-tools.html) | 自然语言选择工具，角色有不同能力预设 | 浏览器自动化标有 Chrome 连接条件 |
| AC12 / D | [权限](https://www.accio.com/wow/doc-permissions-guide.html) | 工具执行独立做允许、询问或拒绝判定 | 声明不等于经过本轮安全测试 |
| AC13 / D | [营销工作示例](https://www.accio.com/wow/doc-help-automated-marketing.html) | 以竞品研究接脚本/分镜，或站点诊断接优化/监测 | 示例不证明产出实际视频或 SEO 效果提升 |

## 3. 核心产品逻辑比较

以下为 I 类分析，来源编号可回到上表核查。

| 维度 | WorkBuddy 的组织思路 | Accio 的组织思路 | CopyPaste 应形成的规则 |
| --- | --- | --- | --- |
| 开始工作 | 任务输入与执行会话连接，专业入口按需使用（WB03/05） | 新任务与可选择的 Agent/Group 并存（AC02/03） | 默认直接委派；模板是捷径，完整配置页不是首次工作门槛 |
| 专业化 | 专家描述工作视角，Skill 承载方法，连接器带来资源（WB05/06） | 角色绑定技能，Plugin 包装业务组合（AC03/07/08） | 把角色、技能、工具、授权和解决方案包分别建模 |
| 工作延续 | 项目承载共享配置，任务组织一次工作（WB04/11） | Agent 持久存在，可开展多个会话（AC03/04） | Agent、项目、会话、任务分别保存，连续沟通可发起多个具体任务 |
| 可信执行 | 有过程、产物与变更视图（WB07/08） | 工具卡片和成果面板跟随会话（AC04） | 展示真实步骤、阻塞原因、文件版本和费用，不用动画代替运行状态 |
| 协作 | 团队共享资料和标准，专家团完成分工（WB04/05/09） | 可见的 Agent Group 与后台 SubAgent 分开（AC05/06） | 同事协作、专家分工、后台并行是三个独立层次 |
| 成果迭代 | 可将产物再次引用，设计支持语言和选区修改（WB08/12） | Artifacts 独立预览，文件可回到工作上下文（AC04） | 结果可继续编辑、审阅、进入下一任务并沉淀到项目 |
| 重复工作 | 项目使成熟能力可供团队复用（WB04） | 自动化可在对话发起，业务包减少组合成本（AC08/09） | 一次成功工作可保存方法、套用到他人项目、配置云端计划 |

## 4. 提取出的八项产品原则

1. **目标驱动**：输入“本周广告花费为什么上升，做三组新素材”即可开始；系统将分析、创意和交付组织起来。用户不必先挑完整工具链。
2. **渐进配置**：先完成第一项可用工作，再沉淀品牌和长期配置；必要账户或资料缺失时才说明原因并就地补齐。
3. **持续身份与独立上下文**：Agent 保留职责和授权内记忆；新会话清理临时讨论，不清空项目资产，也不悄悄混入其他客户的内容。
4. **可检查的执行**：区分计划、执行记录、结果和业务审阅；用户能定位卡点并控制运行，关闭 Web 不丢云端工作。
5. **成果成为下一步输入**：文档、报告、图片、视频和编辑工程是工作对象。选区反馈和新版本应进入同一工作链，不要求重贴完整背景。
6. **方法可以积累**：把稳定方法保存为 Skill，把职责保存为 Agent 模板，把资源组合保存为解决方案包，把重复委派保存为计划。
7. **协作有清晰责任**：协调者对总交付负责，专业 Agent 有具体任务和结果；团队共享配置不等于共享所有个人对话或凭证。
8. **统一产品，执行位置明确**：Web 的云文件与本机文件、云端任务与远程本机任务分别呈现。三端复用身份、项目与结果，能力取决于实际授权和运行环境。

这些是 CopyPaste 的设计建议；并非声称两款产品全部已经实现相同机制。

## 5. 落到 CopyPaste 的一次完整工作

    输入目标与附件
      → 识别项目、Agent 与可用资料
      → 仅补阻塞信息；必要时先审阅方案
      → 云端执行；就地连接缺少的业务资源
      → 在右侧预览真实报告、图片/视频与变更
      → 选区反馈、局部修改、审阅和下载
      → 保存到项目，并转为下一次任务或定时工作

例：上传本周 Google/Meta 导出报表与商品图，要求“解释高花费低转化的素材，制作下一轮繁中广告”。一个会话承载多个任务：数据预检与计算 → 证据报告 → 用户认可的创意 brief → 图片/视频生产 → 审阅导出。已有平台连接可替代文件上传，人工确认的素材 ID 关联用于后续复盘。每个环节有自己的输入版本、费用、失败恢复和交付条件。

## 6. 本次需求修订及其原因

| 旧基线中的不足 | 本次修改 | 需求落点 |
| --- | --- | --- |
| 主页容易变为业务模块目录，P03 偏完整表单 | 首页自然语言委派，业务示例预填；表单变为按需结构化补充 | REQ-007/035/072；UC01/02/04 |
| 默认一个 marketing Agent，多角色长期后置 | 提供默认助手及可选专业模板，支持创建、复用及受控团队协作 | REQ-005/062/066；UC14/15 |
| 品牌、上传、成果与云工作目录关系不清 | 分开会话附件、云工作文件、项目资料和交付版本 | REQ-014/063/068；UC13/16 |
| 工具注册取代了用户可管理的 Skill | 补全安装、启用、绑定、版本和有效权限 | REQ-064/070；UC14 |
| 项目主要作为权限/品牌归属 | 增加共享规则、资料、Agent、技能及资源引用 | REQ-065；UC16 |
| 只有通用批准，没有工作模式 | 增加执行、先计划和仅咨询；计划确认绑定版本 | REQ-067；UC13 |
| 自动化主要是模板步骤配置，排到 Desktop 之后 | 可以从对话保存重复工作；基础云端计划列为 Web M2 | REQ-032/033/071；UC07 |

完整 Web 规格见 [Web Agent 工作台](../product/05-web-agent-workbench.md)；正式需求、页面和验收同步更新。该对标未新增采购/供应链主线，内部 AI API 与三端仍按用户要求；当前唯一 Codex 内核由后续 CORE01 指令确定，见 [内核设计](../technical/02-runtime-and-ai-gateway.md)。

## 7. 不直接照搬的实现与待验证项

CopyPaste 不采用竞品的收费数字、模型清单、技能数量、群组人数或默认文件授权，作为自身承诺。Agent 的学习与技能生成先产生可检查的候选版本，不能自行扩大权限、改变预算或绕过内部 AI 服务。

资料中存在版本和端差异：WB10 的助理要求本机开机，WB01/11 则描述云能力；WB04 明确个人技能库跨端不同。Accio 的应用入口已经以 Plugins 组织能力，而部分长篇指南仍用其他入口名；不同指南的模板工具预设也有差异。因此本次提取稳定对象与工作机制，未据此绘制声称经过实测的竞品截图或逐像素复刻稿。

后续实测应检查：匿名到首个成果的真实步骤、登录后 Web 的技能/团队可用范围、长任务断线恢复、共享后可见内容、实际下载与编辑能力、定时任务运行位置，以及费用。上述尚未验证，不妨碍本轮提出并更新 CopyPaste 的设计需求。
