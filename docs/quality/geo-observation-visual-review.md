# Stage 83 · 实际画面复核 / Actual visual review

复核对象为真实 Web/Admin/Chrome Side Panel 第 05 轮与打包 Desktop 第 48 轮产物。以下画面已逐张打开观察；截图与 GIF/MP4 的原始文件哈希由检查点绑定。模型、消费者回答、广告及费用均使用已声明的测试数据，不据此声称真实模型品质或客户收益。

## Desktop：外观与可达性

- [800×600 本机工作区](../design/implementation/copypaste-desktop__workmate-local-48-layout-800-en.png)：无 Electron 菜单或系统边框；公司蓝、浅色底和双层导航层级延续现有风格。长会话在独立消息区纵向访问，当前输入、预算、回执及两项成果下载可见；截图中没有可见纵向/横向滚动轨道。焦点环保留。
- [800×600 繁中深色](../design/implementation/copypaste-desktop__workmate-local-48-layout-compact-zh-dark.png)：侧栏已滚到末端，设置和账号仍可访问；工作区列表、对账状态、已撤权提示和输入区保持清晰，无可见滚动轨道。待对账不是已确认零费用，画面保留实际状态。
- [800×600 行销入口](../design/implementation/copypaste-desktop__workmate-local-48-geo-browser-entry-en.png)：四个主要入口在可用宽度内分行，GEO 按钮明确写明 Browser；底部继续存在的内容通过真实纵向滚动访问，没有用裁剪替代内容可达性。
- [实际 35% 视频进度](../design/implementation/copypaste-desktop__workmate-local-48-generated-progress-en.png)：视频任务的真实进度条和百分比仍然显示。输入区固定在工作区底部，内容区可继续滚动；进度条不受用户撤回的旧约束影响。

画面观察与原生交互断言分别成立。第 48 轮的 37 项检查另行验证真实 OS 窗口尺寸 1440×980、1280×800、800×600，滚轮、聚焦区域 Home/End、整页 Ctrl+Home、末项焦点及实际下载；单张静态图不能替代这些行为检查。实际原生 consent 决策与原生保存位置由显式夹具提供，Codex 本机进程和文件操作真实执行。

## Web / Admin / Extension

- [GEO 原始回答](../design/implementation/copypaste-web__workmate-geo-05-original-api-answer.png)：原文弹层清楚分隔问句、内部 API 来源、哈希及原始回答，正文显示明确模拟标记，未把字面匹配包装成真实排名。
- [400px 繁中深色](../design/implementation/copypaste-web__workmate-geo-05-compact-zh-dark.png)：表单、按钮与回答区域适应单列，原始观测下载操作可达，没有横向滚动依赖。项目名和用户输入的英文内容保持原文，不宣称全产品翻译已完整验收。
- [800×600 下载区](../design/implementation/copypaste-web__workmate-geo-05-feedback-preferences-no-overlap.png)：顶栏保留独立背景和高度，语言/主题控件与实际下载按钮分离；第 05 轮已对按钮做真实命中和下载核对。
- [项目范围 Admin 隔离状态](../design/implementation/copypaste-admin__workmate-geo-05-geo-quarantined.png)：后台列表保留配置、run、sample 的类型和各自状态。父 run 显示 Quarantined，子 sample/asset 可仍显示其自身 Active；当前用户导出由父来源门控阻断，不能把子行自身状态误解为绕过父隔离。正文权限独立核对。
- [真实右侧栏繁中画面](../design/implementation/copypaste-extension__workmate-geo-05-native-panel-zh.png)：窄栏保留对话、附件、工作区和明确 GEO 云端入口。该图来自真实 Chrome `SIDE_PANEL` 文档；原生侧栏允许纵向滚动，Desktop 的隐藏滚动轨道要求没有扩展到浏览器其他界面。无横向溢出。

四组 GIF/MP4 逐一完整解码，核对实际观察时间、帧数和哈希；没有加速、补帧或改写原始媒体。Desktop 文档选用的 GIF 是已有本机创意反馈交互，不能作为尚未实现的 Desktop 本机 GEO 协议证据。见[媒体复核](geo-observation-media-review.json)。

## English

The actual Web/Admin/native Side Panel attempt 05 and packaged Desktop attempt 48 screenshots were opened and reviewed. Desktop retains the CopyPaste visual identity, frameless title bar, hidden scrollbar rails, genuine progress and reachable content at compact sizes. Native interaction checks independently verify real scrolling, keyboard focus and downloads. The Desktop GEO entry is an explicit browser handoff, while the local Agent remains local Codex. Web's compact report download is clear of the preferences controls. Admin preserves scoped metadata and transitive quarantine; Extension uses Chrome's real right Side Panel with conversation and authorized attachments. Four original GIF/MP4 pairs fully decode with their observed timing and hashes intact. Synthetic fixtures do not establish real model quality, professional outcomes or complete original acceptance.
