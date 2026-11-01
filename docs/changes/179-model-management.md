# 已有模型可编辑和删除 / Existing models can be edited and deleted

此前只新增了模型接口／Key 表单，“建立新版本”没有提供完整的已有模型管理，删除也缺失。本轮补齐列表及详情中的直接编辑、保存更改和确认删除流程。

The current list now shows the edited model entry. The API Key field accepts a replacement directly, or retains the saved key when the address/network scope is unchanged. Deletion removes availability for the model family, preserves exact historical connections, and blocks automatic default fallback. Current, history and deleted views expose their respective records.

权限、并发版本检查、幂等重试和审计均在后端执行。新增模型管理身份与修订关联，数据库版本158；原模型配置和账务事实不被覆盖。已删除模型无法再验证或重新发布，新代理及新顶层任务无法选择它；旧工作按原绑定继续。

Native PostgreSQL and two actual HTTP fixture upstreams verify state changes, independent routing, deletion, authorization, stale editors and retention. Real public-domain browser captures demonstrate edit/save/delete. Earlier failed verifier/test attempts retain their original records; frozen packages and previously qualified evidence keep their original scope.
