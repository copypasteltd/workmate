# 发布核查的媒体链接解析 / Media URLs in publication checks

首次阶段 89 发布在历史检查调用结束时失败，远程推送尚未开始。原始失败回执及工具原字节保存在 [修复前记录](../quality/history/stage89-before-publication-link-fix/receipt.json)，不改写原状态。

重现发现，发布工具把 GitHub 截图/视频链接的 `?raw=true` 当成了 Git 文件名。22 个链接的实际文件均存在。现在仅解析 URL 的路径部分，同时保留分支检查、独立仓库边界和目录穿越拒绝。检查实际 14 份 README，并验证查询参数、片段、编码文件名和越界路径；结果见 [链接记录](../quality/work-intake-publication-url-check-01.json)。

产品源码、阶段 89 的 14 项浏览器及 195 项客户端结果、媒体字节和原需求保持原范围。正式推送仍需通过完整历史检查并核对八个远程分支，最终状态以发布操作回执为准。

English: The first stage-89 publication failed during its history-check command before any remote push. The exact receipt and auditor source are preserved. Reproduction found that the auditor treated the `?raw=true` media parameter as part of a Git filename; all 22 actual files exist. URL resolution now uses only the path while retaining branch and repository traversal checks. All 14 current READMEs and query/fragment/encoded-name/boundary cases are checked separately. Product source, scoped browser/client results, original media bytes and full-product requirements remain unchanged. A fresh complete history audit and eight-ref remote verification are still required.
