# Web 首项工作画面核对 / Web first-work visual review

范围：阶段 89、实际构建 Web、独立原生 PostgreSQL、明确假客户及模型内容。原图与录制保留，没有绘制或补写画面。以 [当前检查点](../../quality/work-intake-checkpoint.json) 和 [完整解码记录](../../quality/work-intake-media-review-01.json) 为准。

| 编号 | 实际画面 | 核对结果与边界 |
| --- | --- | --- |
| VIS89-01 | 1440×980 已恢复的影片需求表单 | 角色、方式、标题、繁中原文、输入依赖可读；保持蓝色按钮、浅底和现有字体。表单长于视口，下部需滚动，不能把全页截图当作所有控件同时可见。 |
| VIS89-02 | 800×600 英文表单，焦点位于预算 | 预算、输入说明、提交及清除操作可读，无横向溢出；画面为真实焦点滚动位置，顶部字段在上方。 |
| VIS89-03 | 375×812 英文表单 | 文本自然换行，预算和提交按钮可操作，无横向溢出；窄屏保留独立竖向浏览能力。 |
| VIS89-04 | 800×600 繁中表单 | 预算/预留说明、开始/清除动作未重叠。英文品牌标语和部分渠道名称属于固定品牌/专有名词；全部动态文本的双语矩阵仍待验收。 |

实际脚本同时检查字段可编辑、预算可聚焦及表单 `scrollWidth <= clientWidth + 1`。截图使用浏览器 fullPage 模式；固定遮罩只覆盖实际视口，视口外背景属于原始捕获，不是产品拼图或修图。两组 GIF/MP4 已逐帧完整解码且保持原 SHA-256。

本核对仅支持上述 Web 表单范围。Desktop 源码没有修改；完整键盘焦点、屏幕阅读器、200% 缩放、DPI、所有动态/错误状态和全端视觉品质继续保留在 GAP-21。

English: Reviewed actual 1440×980, compact 800×600 English/Traditional Chinese and 375×812 English form captures. Brief fields, wrapped text, budgets and actions remain readable without horizontal overflow. Lower-field captures show the real focused scroll position, not every control at once. Full-page screenshots retain the viewport-limited fixed overlay and untouched background. Both GIF/MP4 pairs fully decode with unchanged hashes. This is a bounded Web review; Desktop is unchanged and complete accessibility/zoom/DPI/state coverage remains open.
