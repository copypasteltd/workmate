# 已有模型的编辑与删除 / Existing model management

用户明确要求：模型能力中已有的模型，也必须能编辑 API 地址、API Key，并能删除。不能仅提供新增或“建立新版本”作为管理入口。

1. 当前模型列表及详情提供明确的“编辑模型”和“删除模型”按钮，遵循管理员现有权限。
2. 编辑表单预填当前模型及接口资料。API Key 输入框保持可输入，填新 Key 自动替换；地址和网络范围相同时可保留已保存的 Key。保存后当前列表直接显示更新后的同一模型条目。
3. 配置变更需重新验证、发布后供新工作采用。历史任务继续使用原先确认的版本、费率和连接。
4. 删除需要产品内确认，完成后从当前可用目录移除整个模型条目。被删除的默认模型不得重新从演示／初始模型回退，新代理和新顶层工作不得选择其已删除版本。
5. 原任务及账务记录保留，旧工作及其子任务按原授权继续；不物理删除审计、使用记录或其仍需使用的加密连接。已删除模型和历史配置可只读查询。
6. 并发编辑、删除使用版本检查，过期页面不得覆盖其他管理员的更新。重试同一次操作不得产生重复修改。

Existing models need explicit Edit/Delete controls. Edits update the current management entry while retaining immutable facts. Deletion removes future availability and keeps exact task/accounting history; it must never silently reactivate a bootstrap model. Saved keys stay encrypted and are not returned to the administrator browser.
