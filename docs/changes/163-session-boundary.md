# 163 · 登录与进度流收口 / Session boundary correction

业务接口默认处理401并清除旧工作台；准确的公开/登录/OAuth例外保持。Web、Admin及Desktop界面对所有迟到响应检查当前登录代次；SSE登录失效清理、权限403保留。28项定向检查、三端界面构建、3组实际Web/SQL旅程；原失败保留。源码修复在当前分支，既有rc.3安装/冻结包未替换。

Default business401 handling, unconditional stale-response fences and authenticated progress withdrawal. Explicit public exchanges and permission403 retain their semantics. Original full acceptance scopes remain open.
