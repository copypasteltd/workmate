# 固定版本的完整交付包

客户可以在 Web、实际 Chrome 右侧栏的原对话直接点击“下载完整交付包”，也可以在任务的交付审阅区操作。Desktop 的已提交成果使用原生保存窗口；其本机 Codex 工作区继续在客户电脑运行，不自动扫描或上传工作区。

```mermaid
flowchart LR
  A[原对话中的任务成果] --> B[读取当前审阅版本及交付摘要]
  B --> C[验证登录 项目权限 私有范围及来源]
  C --> D[顺序读取成果 流式计算大小和SHA256]
  D --> E[磁盘生成ZIP 版本清单 编辑说明]
  E --> F[再次验证当前权限 来源及原选定版本]
  F --> G[客户保存完整交付包]
  G --> H[原对话反馈及新工作预算确认]
```

## 接口和精确版本

`GET /v1/tenants/{tenant}/projects/{project}/tasks/{task}/delivery-package` 必须带 `expected_version` 和 `expected_delivery_hash`，由现有 `/quality` 返回。新补充契约为 Backend 的 `contracts/delivery-package-v1.json`；已发布的 SQL001–135、主任务定义与原 OpenAPI 不需要修改。

入口复用交付审阅的 `deliveryTaskAccess` 和 `deliverySnapshot`。先验证企业身份、项目读取权限、任务私有范围、分析报告与原任务内容来源，再取得当前素材版本。只有 `succeeded`、`failed`、`cancelled` 且非 `plan` 的任务可导出。任务版本或交付摘要不匹配返回409；没有可用文字及成果也返回409。

素材头锁在 `assets`，不会向应用身份授予对不可变 `asset_versions` 的写权限。生成期间不长期占用数据库事务，完成后开启第二次事务重查原选定版本、全部文件、权限、来源和保留状态。新摘要不同即拒绝，不混合多个版本。两次授权之间的文件名变化也会使包失效。

## 包内结构

| 路径 | 内容 |
| --- | --- |
| `result.md` | 原任务文字答复；只有实际存在时才加入 |
| `artifacts/{asset UUID}/v{version}/{portable name}` | 原始成果字节；相同名字以素材身份分开保存 |
| `manifest.json` | 任务、角色、技术状态、数据模式、交付摘要、全部素材版本／大小／SHA-256及恢复范围 |
| `README.md` | 中英双语阅读、编辑、源代码／SVG／PPTX／工程文件说明及部分交付说明 |
| `SHA256SUMS` | 成果、文字、清单和说明的 SHA-256；不递归包含自身 |

清单排除内部存储键、任务提示、凭证和完整执行上下文。ZIP 文件名只由服务器校验过的任务 UUID 和版本生成。内部文件名规范化为单个可移植名称，替换路径分隔符、控制字符、双向文字控制、Windows 保留名称和非法字符，限制长度；原显示名称作为 JSON 数据保留。

实际已交付的代码、设计和分析源 ZIP 保留原字节及其原始依赖说明和执行回执；已交付的工程 JSON、字幕、探测报告等作为普通成果一起保留。当前包不会执行任何代码，也不会据成片推断不存在的编辑工程。未提交的本机源文件、没有导出的工作区状态及未交付输入不被加入。完整工程的重新导入、跨环境恢复和所有专业类型的依赖完整性继续按原需求验收。

## 文件完整性与资源

使用锁定版本 `yazl` 生成流式 ZIP，必要时自动使用 ZIP64；保持素材原字节，以非压缩存储降低大型视频打包 CPU 负载。每次只打开一个素材流；计算实际大小及 SHA-256，与不可变素材版本比较。发现缺失、损坏或读流错误时，发送任何成功下载头之前就失败。最终 HTTP `Content-Length` 和 `X-Content-SHA256` 覆盖整个 ZIP，响应为 `Cache-Control: no-store`。

每包服务容量为16 GiB、10,000个成果／文字条目；超过时返回413，不截断。每个服务进程最多两个活动导出，每用户最多一个，路由每来源每分钟最多六次请求；总操作最长五分钟。开始前检查磁盘可用容量并预留64 MiB余量。受控临时目录位于已配置数据目录，完成、客户端断开或生成失败后清理；重启后遗留临时目录的维护和多节点容量属于既有运维生命周期的后续覆盖范围。

Web 使用既有浏览器下载入口；其 Blob 回退和全量1 GiB浏览器内存验收仍按 REQ-014／052保留。Desktop 通过主进程、公司 API 授权和原生保存窗口，将响应流写入临时文件，校验整包后落盘。取消保存不发起导出请求，也不显示成功。Extension 新增 Chrome `downloads` 权限，只允许可信扩展页面请求经过 UUID／版本／摘要校验的任务导出，授权信息只在公司请求头中传递，不进入 URL；文件交给 Chrome 下载管理器，使用浏览器默认下载位置和冲突改名。界面区分“交给下载管理器”与真正下载完成。

## 权限、审阅与账务

只读项目成员可下载有权读取的共享交付；审阅仍要求原来的批准权限。其他企业、无项目绑定、停用用户、已撤权限及他人的私有任务无法通过。最终重新授权之后的下载视为该时点已授权的读取；下载完成的客户副本不能被后来云端撤回远程删除。

导出记录 `task.delivery_package.download`，保留任务版本、交付摘要、文件数、包大小和包摘要；它记录通过授权并交给下载流的事实，不代表客户完成保存。导出不调用模型、不新建任务、不变更费用、预算或素材存储配额。审阅仍保存原固定版本，客户需要修改时返回原对话，沿用原任务委派和费用确认规则。

## English

The server packages actual outputs of an exact completed, failed or cancelled task. It reuses existing project/private-task/source authorization, verifies every stored byte before sending download headers, and repeats authorization and version checks after construction. Stale or damaged deliveries fail as a whole. ZIP64, sequential streams, disk staging, concurrency, capacity and cancellation controls keep server memory bounded. Exporting never executes AI or changes task charges.

Web and native Chrome SIDE_PANEL expose the action in the original conversation. Desktop uses authenticated native IPC saving and verifies the complete archive checksum. Local-only Codex workspace content is never silently uploaded. Editing instructions distinguish actual source projects from flattened outputs; professional completeness and full cross-environment project recovery remain separately qualified.

[需求](../requirements/14-complete-delivery-package.md) · [CLIENT01](../requirements/03-client-execution-amendment.md)
