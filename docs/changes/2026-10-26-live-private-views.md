# 私有计划弹窗同步失效

真实无刷新联调复现来源撤回后历史弹窗仍保留旧内容的问题。现已在来源撤回或读取失败时清除私有弹窗，并在正常轮询时保留可读草稿，同步待确认提案的就绪／过期状态。九项跨端流程通过，模型／账号为假数据，HTTP403 明确模拟，来源隔离为真实操作。后端未变，沿用既有 78 项检查基线。11 张实际截图和四组 GIF／MP4 绑定确切源码。

[Design / 方案](../technical/105-live-private-schedule-views.md) · [Evidence / 证据](../quality/live-private-views-checkpoint.json)
