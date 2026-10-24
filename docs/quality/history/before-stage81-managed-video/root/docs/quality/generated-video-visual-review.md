# 生成式视频与 Desktop 布局复核 / Generated-video visual review

2026-10-24，按真实页面截图复核；截图没有拼接、重绘或修改。此记录只覆盖下表中的布局及操作，不构成全产品或真实客户业务验收。图片来自 Desktop 38、Web/Admin 08、Extension 16 的独立实际执行，精确字节与录制绑定在 [检查点](generated-video-checkpoint.json)。

| 实际画面 | 复核结果 |
| --- | --- |
| [Desktop 1440×980 英文浅色](../design/implementation/copypaste-desktop__workmate-local-38-generated-form-1440-en.png) | CopyPaste 蓝白、品牌图标与字体层级一致；无原生菜单或窗口边框。设置面板在输入区上方展开，留白、对齐与控件层级清楚。 |
| [Desktop 800×600 繁中深色](../design/implementation/copypaste-desktop__workmate-local-38-generated-form-800-zh-dark.png) | 参数、预算及开始操作完整可见。主侧栏、专家会话及内容区没有可见纵向或横向滚动条；紧凑设置面板没有挤走会话滚动区域。 |
| [Desktop 800×600 视频](../design/implementation/copypaste-desktop__workmate-local-38-generated-playback-800-en.png) | 播放器完整落在消息区域内，输入、预算及费用回执可见。实际检查使用滚轮、Home/End 和焦点访问长记录末项，播放、原生保存及重开恢复均执行。 |
| [Web 390px 视频](../design/implementation/copypaste-web__workmate-generated-08-mobile-en.png) | 状态、服务回报进度、报价、确认费用、播放和下载在窄屏中重排。视频与交付评审纵向排列，没有依赖横向滑动的操作。 |
| [Admin 780px 繁中深色费用卡](../design/implementation/copypaste-admin__workmate-generated-08-cost-zh-dark.png) | 费用字段及重查按钮完整处于可访问宽度内，元数据纵向换行；原报价 HK$0.40 和确认费用 HK$0.10 分开显示。截图是滚动至卡片操作的实际视图。 |
| [Chrome 原生侧栏视频](../design/implementation/copypaste-extension__workmate-chat-16-generated-video-en.png) | 生成结果沿侧栏纵向排列，包含实际服务的完成状态、费用、播放和保存；没有 Desktop 依赖。关闭当前任务后实际清理轮询与预览 URL。Desktop 的隐藏滚动条补充不扩大到浏览器原生侧栏。 |

本次保留用户撤回进度条约束后的真实状态反馈。35% 和 100% 来自测试内部服务的明确观察；费用未知时显示保留状态，不用计时器编造进度。视频内容、推理和测试客户是明确夹具，身份、数据库、文件校验、媒体解码与费用回执实际执行；Desktop 使用固定的本机 Codex，部分原生同意决定由测试夹具提供。

主桌面、桌面本机浏览器、品牌库、Web、Admin、侧栏各自保留实际时间的 GIF/MP4，检查点另外核对编码、帧数及两种格式的时长。没有将失败或中断尝试的媒体改标为通过，也没有通过静态截图推断滚动或播放已经发生；这些操作由相应交互回执证明。

原生浏览器原 GIF 包含额外编码尾帧（26.50 秒，对应实际 MP4 为 24.20 秒）。原文件和执行回执原样保留；当前展示另存的 24.17 秒 GIF，由该实际 MP4 按原时间重新编码并限制尾部时长，没有加速、补造响应或修改页面画面。详见[独立媒体处理记录](generated-video-media-normalization.json)。English: The native-browser GIF is a separately identified timing-corrected derivative of its actual MP4; the original GIF and raw journey remain unchanged.

English: These unedited captures were visually reviewed for the bounded layouts above. Interaction receipts separately establish actual scroll/focus access, media playback, exact downloads and owned-resource cleanup. Model/video content, customers and selected native consent decisions are explicit fixtures. This review does not establish live-provider, complete professional-role, signed-installer or whole-product acceptance.
