# 固定版本专家复制 / Reviewed specialist copying

本项细化原REQ-079，不增加原始需求数量。适用于Web和Desktop共享的云端专家设置；Extension从Web打开设置。本次修改在首个冻结版之后，未加入冻结ZIP。

| 编号 | 约束 / Requirement |
|---|---|
| 1 | 复制指定当前项目中可用的精确专家版本；仅改名、工作说明及缩小获准工具。 |
| 2 | 保留原Codex运行时、角色摘要、模型及费率版本、skill安装和版本、固定品牌版本及模板来源。后来发布品牌v2不得令v1副本暗中升级。 |
| 3 | 提交前显示原版本和复制范围，并要求主动勾选确认；预览有效10分钟。 |
| 4 | 确认必须绑定原用户、exact session、身份版本、企业、项目、来源版本、提案及当前守卫。事务内先验会话和权限，再处理来源与幂等。 |
| 5 | 来源改变、品牌隔离、skill停用、权限或会话撤销时拒绝新复制，清空旧预览。不得自行安装或启用skill。 |
| 6 | 一个签名预览仅产生一个副本，即使重试更换HTTP幂等键。受理后丢失响应可恢复原回执；删除副本后不能重建。 |
| 7 | 不复制对话、私人记忆、文件、连接凭据、连接授权或本机完整权限。复制配置本身不请求模型或产生模型费用。 |
| 8 | 退出、换账号、切换项目或关闭预览后，未发送的异步操作不得继续提交；已受理操作按同一回执恢复。 |
| 9 | 不修改原专家和旧任务的固定绑定；更换品牌或升级方法使用既有比较与明确采用流程。 |

A copy retains the source definition instead of resolving the latest defaults. It is independent configuration inside the same authorized project. Private content and permissions are excluded. Brand/method upgrades require the existing compare-and-adopt flow.

[实现 / Implementation](../development/155-specialist-copy.md) · [接口 / API](../contracts/specialist-copy-openapi.json)
