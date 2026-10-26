# 云端计划发布记录修正

提交内容核对发现三份新增文档工具的工作副本采用 CRLF，而仓库明确声明 `text:auto`、`eol:lf`，实际提交采用 LF。原发布记录漏记该转换，校验正确拒绝通过；现按实际 Git 对象修正摘要，并保留工作副本摘要及明确的转换类型。产品源码、既有验证器、原始验收记录和录制素材保持原字节。

新增核查工具逐条验证全部发布记录与七个仓库的实际 HEAD 对象，并要求仓库干净；另行读取全部当前验收源码和每个声明的换行转换。历史工作副本由干净索引及内容寻址 Git 对象覆盖，避免重复读取数万份历史副本。该范围明确记录在核查回执中。

从项目根目录运行 `python -X utf8 docs/tools/repair_cloud_schedule_publication.py verify --report dev/copypaste-delivery/.data/publication/<新目录>/committed-proof-verification.json`。通过后按既有映射导入六端提交、核对远端祖先关系，使用 `git push --atomic` 普通推送八个明确分支，再重新读取远端 SHA；不强推、不删除远端分支。实际推送回执位于 Delivery 的 `.data/publication/`。

[修正证据](../quality/cloud-schedule-publication-repair-01.json) · [功能方案与验收范围](../technical/104-private-cloud-schedules.md)
