# 前端品牌规范与设计系统集成

<!-- stage51-support -->
阶段 51 的 [支持授权与只读视图](51-controlled-read-only-support.md) 延续现有 CopyPaste 蓝色、纸面/墨色、Logo 和字体 token；实际浅深、繁中/英文与 375/768/1024/1440px 截图在专册。Desktop 自绘标题栏、窗口按钮和 Chrome 原生 Side Panel 规则继续适用，不能据这组页面检查宣称全部无障碍或品牌验收完成。

版本：1.5 · 2026-10-18 · 对应 REQ-081/082。产品视觉以 [品牌规范](../product/07-brand-design-system.md) 为准，以下是后续应用开发约定。

## 1. 资源与权威来源

[brand-tokens.json](../design/brand-tokens.json)保存官网来源、两主题基础色、产品扩展、字体、尺寸、圆角、阴影、过渡和对比检查组合。[brand-tokens.css](../design/brand-tokens.css)由 [构建脚本](../tools/build_brand_design.py)生成。源码引用产品资源版本，不远程导入官网 CSS、脚本或字体链接。

应用初始化后建议在共享 UI 包内承接这些 token/组件，Web 与 Desktop 共用 React 实现，Chrome 扩展复用可用组件及同一 token；原生主进程与系统文件选择器保持系统规范。当前未创建应用目录，本次只在 docs 提供设计材料和验证工具。

## 2. 组件与样式约定

基础组件至少包括 Button、IconButton、Input/Composer、Card、Sidebar/Nav、RoleCard、TaskStep、StatusBadge、FileItem、ArtifactPanel、Table/Chart、Dialog/Drawer、ThemeControl；颜色、圆角、字号、间距和 motion 均从语义变量取值。扩展侧栏改变布局，不另定义品牌色。

颜色使用 --cp-color-\*；主要动作通过 text/bg 映射，强调色用于链接/选中/焦点。必要输入边界使用增强 control-border，不使用较淡的装饰 border 冒充可辨控件。状态色与图表色独立于品牌蓝，状态仍须有文字及图标。禁止新页面硬编码一套主色或复制竞品组件主题。

字体以 display/body/code 三组加载，展示型衬线标题只用于适合的位置。繁中字符、价格/日期/金额、英文及混排需实际渲染检查；生产字体包记录来源/许可/摘要，不依赖本机恰好装有某字体。加载失败走登记回退，不影响关键文字可见。

## 3. 主题与资产

data-theme=light/dark 决定一套完整 token，跟随系统在本端解析后使用；用户偏好在首帧前应用，防止闪烁。主题切换不改任务、预算或导出工程。Logo 使用官网相应浅深资产，可用 SVG 并以 PNG 降级；资源不能加载时保留文字品牌和可访问名称。

平台 UI 主题与 customer_brand_version 分别传入不同组件/管线，渲染客户交付时只使用客户 brief/品牌资源。Artifact 预览不得从父页面 CSS 继承字体/填充颜色而改变作品；使用既有隔离预览，截图与导出比较作品内容不变。

## 4. 布局、性能与资源

采用既有 React/TypeScript/Vite 与 Electron/Manifest V3 选型。共享组件不要求引入新的 UI 框架；如选组件库，只取可访问交互基础并完全映射本品牌 token。图标使用统一 SVG，禁止 emoji 代替功能图标。

Desktop 主窗口使用 40px 品牌自绘标题栏，无原生边框和 Electron 默认菜单；Web 业务顶栏与该原生壳层分开。Chrome 使用按钮触发的原生全局 Side Panel，默认右侧并尊重浏览器位置偏好。具体布局、隔离边界与实际截图见 [窗口及侧栏实现](30-native-window-and-browser-sidepanel.md)。

375/768/1024/1440px 和 200% 缩放检查导航、目标输入、会话/成果、角色卡、表格及弹层；正文换行。Desktop 另外遵守 [DESK-UI01](../requirements/04-desktop-layout-and-scroll.md)：隐藏滚动条外观，保留纵向滚动与键盘访问；成果、表格、代码和长文件名在容器内重排/换行，不依赖横向滚动。Web/Admin 的独立宽表容器沿用各自规范。先加载 UI 字体/文本，媒体懒加载；装饰图形静态或 respect reduced-motion，避免长期占用渲染资源。

开发和验证使用原生进程。所有浏览器页面/上下文有任务归属，成功、失败和取消通过 finally 回收；检查工具不关闭用户原有页面。

## 5. 设计验收及脚本

build_brand_design.py 生成 JSON/CSS 和预览，verify_brand_preview.py 用独立原生浏览器核对浅/深/跟随系统、四种屏宽布局、主题/角色交互、键盘焦点、客户作品隔离及截图；validate_docs.py 检查官网色值映射、文件摘要、token/CSS 同步、列出的对比组合及需求追踪。样板报告记录当前输入文件摘要，避免设计改动后沿用旧的通过记录；真实浏览器 200% 缩放及完整页面/无障碍检查在产品验收阶段执行。

本次视觉样板覆盖代表性新工作、角色卡、成果和状态，不包含真实 AI 或完整页面路由。样板通过不表示产品所有 P 页面、扩展或 Desktop 已实现；TC-081/082 在产品实际开发后执行并提交跨端视觉/可访问证据。

## 6. Admin 设计系统复用

A01–A16 采用同一品牌 token、Logo、无衬线正文、等宽金额、胶囊操作及细边圆角卡片；后台结构为导航、范围/身份栏、筛选、指标、分页表格和详情，不复制官网营销页布局。高密度数据保留可读间距及必要边界，375/768px 用摘要与字段展开，宽表只在自身容器滚动。

费用、VIP、权限和批量表单分别组件化；显示主体、单位、时段、来源与前后差异。错误摘要可聚焦并链接就近字段，提交后读取真实操作状态。权限菜单由服务端上下文生成，动作和字段仍由 API 再次核验；主题不改变业务状态。后台页面和异常矩阵见 [产品分册](../product/08-admin-dashboard.md)，Admin 的运行视觉与 G10 需实际实现后单独提交证据，既有品牌样板未新增后台页面。
