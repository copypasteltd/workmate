# 音频录制主题修正

第 51 轮打包 Desktop 的本机执行、实际 WAV、人工字幕版本和三种窗口尺寸的无滚动条/末项焦点检查均已执行。复核原始截图时发现，音频辅助脚本只点击了一次主题按钮，没有检查最终主题。此前视频步骤可能留下 `system` 状态；因此名为 `audio-zh-dark` 的第 51 轮画面实际上是繁中浅色，不能用于证明该音频画面的深色主题。

原始第 51 轮回执和画面均保留。修正仅要求通过实际主题按钮切换，直到页面真实 `data-theme` 为 `dark`，并增加明确断言；没有改动产品主题实现、权限、收费或既有功能检查。修正前的辅助脚本字节保存在 [原始辅助脚本](history/stage84-before-audio/audio-theme-helper-before.snapshot)。新轮次重新执行完整打包交互和实际录制，以新回执为当前主题证据。

代码变化期间正在运行的第 10 轮兼容检查须保留其实际 `source_unchanged` 结果；即使测试用例通过，也不能将变化中的源码认定为当前版本核验通过。后续检查使用新的轮次，保留失败/失效回执，不覆盖历史。Web 第 05 轮的繁中深色画面经实际复核为深色；原生 Extension 使用其独立侧栏主题，不代替 Desktop 主题证明。

English: Native run 51 verified local execution and layout, but its audio screenshot named `zh-dark` was light because the helper clicked the theme button once from an unspecified prior preference. The original receipt/capture is retained and is not accepted as dark-audio evidence. The helper now uses actual theme controls and asserts the resulting dark state; product code and all previous functional assertions are preserved. A fresh complete native run and fresh source qualification supersede the earlier scope.
