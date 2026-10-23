# DESK-UI01：Desktop 布局与滚动呈现

**阶段 79 当前增量：** 不可变品牌版本、固定专家/云端设计任务、真实字体/价格/渠道/期限检查与来源治理；Web/打包 Desktop 品牌表单已实际执行。平台 874、客户端 68、打包 30、品牌 Web 4、Web/Admin 4、原生侧栏 8 项分别通过。SQL096 为新增迁移，SQL001–095 与原规范各自字节保留。原 102 REQ/102 TC 为 82 部分/20 未证明/0 完整验收，G01–G10 与 TC-056 仍未证明。Desktop 保留本机 Codex、无边框、真实进度及无可见纵横滚动条、可滚动和键盘访问。见 [方案与限定证据](../technical/79-versioned-brand-production.md)。

**阶段 78 历史基线：** 补齐固定交付版本的接受/修改/弃用、独立人工投入、实际读取复用及带范围的后台品质汇总，修正控制端来源检查。Desktop 保留本机 Codex、无边框、真实进度和隐藏滚动条；紧凑窗口实际聚焦输入、输入区及回执可用。平台 861、客户端 68、打包 26、Web/Admin 4、原生侧栏 8 项分别验证。新增 SQL095 和六项接口（434 总计），SQL001–094 与原规范不变。102 REQ/102 TC、81/21/0、G01–G10 及 TC-056 真实业务验收边界保留。见 [方案与当前证据](../technical/78-business-delivery-quality.md)。

生效日期：2026-10-23。来源：用户在本会话更正此前关于进度条的表述。本补充与 [CLIENT01](03-client-execution-amendment.md) 一起适用，不变更原始 102 REQ/102 TC 或其验收结论。

> 收回上一条关于进度条的约束，是我表述错误。请你注意，要求desktop版本的内容要设计美观，不要出现任何侧边的上下滚动条 以及其他地方不要出现 左右滚动条。

撤销的是关于「进度条」的上一项约束。上传、执行、流程和视频的真实状态与进度反馈继续保留；不据此删除原有反馈或编造进度百分比。

| 编号 | 生效要求 | 核查方式 |
| --- | --- | --- |
| DESK-UI01-A | Desktop 沿用 CopyPaste 品牌、字体、浅深主题及无边框窗口；留白、对齐和控件层级须适合持续工作 | 实际打包窗口截图与人工视觉复核 |
| DESK-UI01-B | 主侧栏、会话列表、消息区、成果及弹层不显示系统纵向滚动条；产品界面不出现横向滚动条 | 检查实际溢出区域、计算样式与截图 |
| DESK-UI01-C | 不通过隐藏内容来满足外观；滚轮、触控板、键盘、焦点自动定位继续到达最后一项和操作 | 真实长消息、长列表、Tab、PageDown/End 及滚轮交互 |
| DESK-UI01-D | 产品内容自动换行或重排；长文件名、路径、代码和表格不能依赖横向滚动来访问 | 窄窗口检查横向尺寸及完整文本、末项与下载操作可达性 |
| DESK-UI01-E | 在 800×600、1280×800、1440×980 的实际窗口中，输入、费用、停止/撤权及成果操作可用；英文、繁中与浅深主题均复核 | 同一真实会话切换尺寸/主题/语言，保存截图及录制 |
| DESK-UI01-F | 自建浏览器的可信控件同样不出现滚动条；远程网页只隐藏滚动条外观，保留其真实布局、滚动、输入和网页行为 | 实际 OS 窗口捕获与真实网页操作；不拼图、不改写第三方业务页面 |

消息、会话和成果采用有边界的纵向滚动容器，滚动条外观隐藏，保留原生滚动能力。重点滚动区域可用键盘聚焦并显示焦点环。成果在可用宽度内换行，多项成果纵向访问；表格与代码保留完整内容，以单元格换行、固定表格布局或纵向详情呈现。

「没有滚动条」不等于「没有溢出」或「内容可达」。验收必须同时证明布局尺寸、末项访问和实际输入/下载操作。旧截图中横向成果条与可见纵向条仅是历史证据，不能作为本补充通过的依据。浏览器、完整 OS 操作、全角色专业交付及生产验收仍按原定义逐项证明。

## English

The user withdrew the previous progress-bar constraint. Existing truthful upload, task, workflow and video progress feedback remains. Desktop must match the CopyPaste visual identity, show no vertical scrollbar rails in its sidebars or work areas, and show no horizontal scrollbar rails elsewhere. Content must wrap or reflow rather than become clipped or unreachable. Wheel, touchpad, keyboard navigation, focus reveal, last-item access and actual actions remain functional. Verify real packaged windows at 800×600, 1280×800 and 1440×980 in English/Traditional Chinese and light/dark themes. The owned local browser hides scrollbar presentation without rewriting third-party page layouts. This supplement does not change the original acceptance inventory or claim full product acceptance.
