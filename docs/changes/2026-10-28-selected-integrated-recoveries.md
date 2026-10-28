# 完整后端回归与附件恢复

Extension 0.5.2 在明确确认前继续只核对浏览器资料夹元数据。弹窗内显示已有附件待上传／失败的具体原因与恢复步骤；19 档已满时仅禁用未选项，取消一个勾选即可替换；小文件显示准确字节。先等已有附件完成或移除失败项，再确认上传，失败重试沿用精确私人回执，最后另按发送。

以全新编号启动 run-integrated-recovery-full-v2.mjs NN MAX_FILES，逐文件保存真实退出状态并在相同源码下续跑完整后端清单；run-integrated-recovery-v1.mjs NN extension|clients 检查 Extension 单元及各端构建；run-integrated-recovery-client-units-v1.mjs NN 枚举 Web／Admin／Desktop／Delivery 当前全部单元文件；run-integrated-recovery-ui-v1.mjs NN 检查真实 Chrome 流程。每轮归档精确源码，数据库流程使用自有原生数据库并清理。publish-workmate-v3.mjs --push 核查全部历史切片 proof，并原子非强推核对八个分支。失败报告和执行过的校验器保持原样。

1363 backend checks in 111 files + 229 Web/Admin/Desktop/Delivery unit checks + 63 Extension checks + 7 adversarial proof-reader cases; 13 builds; 7 actual UI flows; 6 layouts; 9 PNGs and 2 GIF/MP4 pairs.

[Runbook / 方案](../technical/120-integrated-regression-and-attachment-recovery.md) · [Evidence / 证据](../quality/integrated-recovery-checkpoint.json)
