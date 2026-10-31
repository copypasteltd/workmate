# 完整会话目录 / Complete private conversation directory

细化原REQ-061，不新增原始需求数量。首200条上限曾使同名或名称不详的旧空会话没有继续浏览入口；知道独特名称或ID仍能找回，不将旧情况描述为所有旧会话均不可访问。

| 编号 | 需求约束 / Requirement |
|---|---|
| 1 | 当前用户可在当前有权项目中完整浏览自己的正常或已封存会话，不因超过200条而被截断。 |
| 2 | 按置顶、活动时间和ID降序稳定排序，时间游标保留数据库微秒，下一页不重复或跳过静态目录中的同时间行。 |
| 3 | 搜索使用名称的大小写不敏感字面匹配，先筛选再分页；同名结果和封存结果同样支持继续浏览。 |
| 4 | 游标签名绑定当前用户、exact session、身份版本、企业、项目或全企业范围、筛选、页量及30分钟有效期；每页重新查权限与可见状态。 |
| 5 | Web/Desktop显示上一页、下一页、当前页和刷新；换用户、项目、搜索或封存筛选回到第一页。 |
| 6 | Extension在原生右侧Side Panel增加搜索、封存和前后页；浏览目录不切换当前对话或清空草稿、附件、待确认回执。 |
| 7 | 新建会话与目录请求使用独立的状态校验；换范围/reset丢弃迟到响应；读取失败不保留旧目录结果。 |
| 8 | 标准GET /v1/conversations按既有接口定义支持可选project_id，缺省只跨当前有权项目；返回规范title等字段，旧端点保持兼容。 |
| 9 | 当前列表使用实时keyset分页，不是冻结的导出快照；修改/置顶/删除等变化后可刷新查看当前目录。 |

Users can browse every private conversation beyond the former200-row cap, including archived and same-name records. Every page requires current authority. Directory navigation preserves the open Extension chat and its pending receipt; scope changes discard late replies.

[方案 / Implementation](../development/156-conversation-directory.md) · [接口 / API](../contracts/conversation-directory-openapi.json)
