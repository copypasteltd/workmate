# Web 滚动区域 / Web scroll surfaces

用户要求检查 Web 前端，不出现滚动轴，或将必要滚动轴统一为产品风格。沿用现有 CopyPaste 色系、排版和浅深色主题。

The Web client should hide unnecessary scrollbars and style necessary ones consistently with the existing CopyPaste light/dark design.

| 区域 / Surface | 要求 / Requirement |
| --- | --- |
| 页面、侧栏、导航、对话消息、弹窗外层 / Page, sidebar, navigation, conversation and modal outer container | 隐藏可见滚动条，保留原生滚轮、触控及键盘滚动能力 / Hide visible rails while retaining native wheel, touch and keyboard scrolling. |
| 宽表格和必要的内部面板 / Wide tables and necessary inner panels | 使用统一的细款滚动条、透明轨道、圆角滑块，颜色随主题变化 / Use thin rails, transparent tracks and rounded, theme-derived thumbs. |
| 手机和窄屏 / Mobile and narrow layouts | 页面不产生横向滚动；标题、标签页、过滤器和长文本允许换行；宽表格在自身区域滚动 / Prevent page-wide horizontal overflow; wrap headings, tabs, filters and long text; contain wide tables locally. |
| 可访问性 / Accessibility | 继续使用浏览器原生滚动和焦点行为，保留强制色彩模式 / Preserve native scrolling, focus behavior and forced-color support. |

本轮交付范围为 Web 的视觉与布局调整，以及相应部署、文档与实际演示。相关页面检查用于验证滚动行为，不代表业务模块的完整功能验收。

This delivery covers Web appearance/layout, deployment, documentation and actual media. Related page checks establish scroll behavior, not full business-module acceptance.

[实现、使用与验证 / Implementation, usage and validation](../development/187-web-scroll-surfaces.md)
