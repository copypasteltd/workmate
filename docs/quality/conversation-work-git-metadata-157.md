# 157 Git 原始字节保存 / Exact source bytes in Git

首次发布检查在提交之前发现Windows换行规范化会改变已验证源码字节，已停止，未创建提交或推送。仅为4处Git属性添加原始字节保存规则；应用代码、迁移、已执行测试及证据均保持原字节，Desktop根.gitattributes和原冻结发布保持不变。

原始2015项资格绑定中只有renderer/.gitattributes属于此次明确的Git元数据差异，其他2014项字节一致。补充检查点保留原检查点和成功测试报告的引用，明确记录该差异，不重写原证据；不为Git属性重复运行应用测试。

The initial publisher stopped before any commit/push because newline normalization would alter qualified bytes. Four Git attribute files now preserve the original runtime/fixture bytes across fresh clones. The explicit supplement changes one previously bound metadata file only; no runtime source or frozen release bytes changed. Original reports, checkpoint and failed publication receipt are retained.

[元数据记录](conversation-work-git-metadata-157.json) · [补充检查点](conversation-work-checkpoint-157-git.json) · [原资格检查点](conversation-work-checkpoint-157.json)
