# Web 滚动区域调整 · 187 / Web scroll refinement · 187

1. 新增集中滚动样式：隐藏页面、侧栏、消息和弹窗外层滚动条；保留原生滚动。Added shared styling to hide outer rails while retaining native scrolling.
2. 必要内部滚动条统一为细款、透明轨道与主题色滑块；适配浅色、深色和强制色彩。Unified necessary inner rails with thin, theme-derived styles and forced-color fallback.
3. 修正侧栏收缩、窄屏标签/筛选换行与长文本，宽表格限制在自身容器。Adjusted sidebar shrink behavior, narrow control wrapping, long text and contained table overflow.
4. Web TypeScript/Vite 构建通过，最终 10 项实际内网页面检查通过；保留初次 7 项回执和最终回执的原范围。Build and ten final deployed-LAN browser checks passed; original receipts retain their separate scope.
5. 已上线新 Web 静态目录，保留其他服务与配置；补充双语说明、真实截图、实际滚轮 GIF 和回滚路径。Deployed the Web-only update with bilingual guides, actual masked screenshots, a real scrolling GIF and rollback instructions.

[需求 / Requirements](../requirements/187-web-scroll-surfaces.md) · [方案与证据范围 / Implementation and limits](../development/187-web-scroll-surfaces.md) · [证据 / Evidence](../quality/web-scroll-surfaces-187.json)
