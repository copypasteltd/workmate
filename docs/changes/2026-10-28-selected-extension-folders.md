# Extension 资料夹核对导入

Extension 0.5.1 在附件旁新增「资料夹」：浏览器选择、核对路径和勾选、确认上传，返回后输入讯息并发送。无需 Desktop／nativeMessaging。空白输入框最多 19 个非空文件（每档 ≤5 MiB）及一个 JSON 索引；隐藏／建置路径预设不选，空档和过大档不可选。失败沿用精确回执重试，取消移除本批待发送附件，已提交私人上传依正常生命周期保留；换范围清除旧核对及结果。

以全新编号运行 run-extension-folder-v1.mjs NN core|clients 及 run-extension-folder-ui-v3.mjs NN。发布改用 publish-workmate-v2.mjs --push：全部历史 proof 保留于 ≤20 MiB 摘要绑定切片，在八分支原子非强推前核对每条真实 Git 对象。失败证据与执行过的校验器保持原样。

59 backend + 59 Extension checks + 7 adversarial proof-reader cases; 13 builds; 6 actual UI flows; 4 layouts; 7 PNGs and 2 GIF/MP4 pairs.

[Runbook / 方案](../technical/119-extension-selected-folders.md) · [Evidence / 证据](../quality/extension-folder-checkpoint.json)
