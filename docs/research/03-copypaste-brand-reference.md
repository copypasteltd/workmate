# CopyPaste 官网品牌核查

版本：1.3 · 日期：2026-10-18 · 核查对象：[官网](https://copypaste.hk/)、[样式](https://copypaste.hk/styles.css)和[界面脚本](https://copypaste.hk/app.js)。用途是落实 BRAND01 的产品风格要求。

## 1. 实际核查方式

网页检索工具未能访问首页，随后使用原生 Python HTTP 成功读取官网 HTML/CSS/脚本，并通过本机原生 Chrome 的独立无头实例读取页面、样式、字体及截图；未使用 Docker、WSL 或虚拟化。核查没有登录账号、提交表单或调用产品 AI。

浅/深主题各采样 1440×1000 视图，移动端采样繁中路径 390×844。地址、HTTP 状态、文件字节/摘要、实际 CSS 变量、元素样式、字体及资源释放结果记录在 [source-evidence.json](copypaste-brand/source-evidence.json)。语言可能受官网重定向/选择机制影响，以实际抓取的页面元素为证，不从 URL 单独推断渲染语言。

## 2. 可追溯的视觉事实

| 来源 | 观察 | 在产品中的采用方式 |
| --- | --- | --- |
| CSS `:root` | 深墨/深蓝主色、亮蓝强调、暖灰白底、白表面、深正文及灰辅助字 | 保留原始九个颜色角色，转换成产品 token |
| CSS `html[data-theme=dark]` | 深蓝黑底、浅灰蓝文字、浅蓝强调和深表面 | 为产品定义对应深色主题 |
| `.button-primary` | text 色填充、bg 色文字，999px 圆角；44px 最低高度 | 主动作延续中性高对比胶囊按钮 |
| `.service-card` 等 | 16px 圆角、1px 边框、20px 内距及轻阴影 | 角色/成果/配置卡同源，密集区适度收紧 |
| `.hero-orbit/.visual-panel` | 26px/14px 圆角、淡网格/节点和轻量蓝色线条 | 新工作/空态少量继承，真实任务步骤优先 |
| body / headings | 正文 Manrope 系列、标题 Fraunces 系列的声明；正文行高 1.65 | 保留衬线展示标题与无衬线正文的层级，增加繁中 TC 回退 |
| app logoAssets | 浅/深分别引用 CopyPaste_Light/CopyPaste_Dark，含 SVG 与 PNG 路径 | 采用官网真实资产和主题切换，不重绘公司标志 |
| transition | 常见 160/180/220ms、轻微 hover 抬升 | 用于按钮/卡片反馈，工作区避免装饰循环 |

实际 Chrome 字体调查显示本机使用 Noto Serif SC、Noto Sans SC、Segoe UI 等系统字体；这说明声明栈存在回退。没有从字体家族名称推断远端字体已经加载或已获商用授权。官网样式快照未声明下载 Manrope/Fraunces 的 @font-face；产品字体交付需另行固定。

## 3. 截图参考

浅色：[首页参考](copypaste-brand/homepage-light.png)。深色：[首页参考](copypaste-brand/homepage-dark.png)。移动端：[繁中路径参考](copypaste-brand/homepage-mobile.png)。截图仅显示捕获的视口范围，不代表完整站点或全部页面已经审查。

原始取样：[HTML](copypaste-brand/homepage-source.html)、[CSS](copypaste-brand/styles-source.css)、[脚本](copypaste-brand/app-source.js)。这些是只读研究快照，不在产品运行时执行；原始脚本中的公司内容、导航和表单行为不构成本产品新需求。

## 4. 产品扩展与边界

状态色、增强输入边框、等宽数字、工作台间距、侧栏/双栏、繁中字体和图表分类色是本次产品设计扩展，不能声称来自官网。UI/UX Pro Max 检索得到的 Minimalism/Swiss 风格可辅助检查可读性与密度；其通用蓝橙配色、字体组合和 Hero/Features/CTA 结构不作为品牌依据。

官网品牌约束作用于产品壳和组件，客户创作的图片/视频/演示/网页沿用客户品牌。权威采用规则见 [品牌与产品设计规范](../product/07-brand-design-system.md)，实施见 [前端设计集成](../technical/10-frontend-design-system.md)。

所有核查页面属于独立无头浏览器，代码在 finally 中关闭 context 及 browser，结果在取样记录中登记；没有触碰用户已有浏览器或标签页。
