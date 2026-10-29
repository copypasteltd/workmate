# Admin 正文修订 / Admin content revisions

状态：本增量的五个完整相关后端文件 75/75、实际 Admin 页面 7/7 已通过，并取得四档宽度的 7 次布局观察。面向 REQ-048/090/094/096 的三类修订；完整产品及其余资源验收仍单独跟踪，正式远端版本以发布回执为准。

Admin 已有正文读取、隔离、恢复、删除和资产版本上传，但团队、共享项目配置及业务方法缺少管理端正文修订流程。本轮构建这三类对象的真实修订，保留现有客户任务的固定版本。

| 对象 | 修订结果 | 执行影响 |
| --- | --- | --- |
| 专业团队 | 追加团队版本和精确成员绑定 | 新执行仍需客户自己的计划与预算确认 |
| 共享项目配置 | 追加发布版本并更新草稿 | 已有任务保留原配置；确认时明确说明替换当前草稿 |
| 业务方法 | 同族追加草稿版本 | 沿用客户试运行、审阅和发布要求 |

要求同时满足当前 `admin.content.read`、`admin.content.body.read`、`admin.content.version.create` 的对象范围，显式 deny 优先；近期 MFA、当前会话和权限在事务中重查并持锁。不会借用客户登录或给旧角色增加权限。

修订流程：读取可编辑表单 → 提交完整定义、原内容版本及管理版本、原因 → 服务端解析并解析精确依赖 → 返回前后差异和五分钟有效的签名预览 → 管理员明确确认 → 原范围、版本、定义与依赖再次核对 → 一次事务追加版本、管理员来源、修订记录和审计。

签名绑定管理员、会话、对象、原版本、管理版本、前态和后态摘要、目标版本、原因及截止时间。预览不改动内容、不创建任务、不调用 AI、不产生费用。数据库新增管理员独立来源字段与修订事实；普通应用及队列数据库角色不能伪造管理员版本，历史客户来源不重写。

提交使用稳定的幂等键。浏览器仅持久保存请求键、对象、摘要及预览期限，不保存正文。响应未知时查询原请求；查询与原提交共用事务锁。只有原提交已确认，或预览过期且原提交已排除，才允许开始下一次修订。权限失效时清空正文和预览。

页面沿用 CopyPaste `--blue #1f5eff`、`--blue-soft #edf2ff`、`--surface #ffffff`、`--bg #f6f6f4`、`--ink #15171a` 和 `--line #e3e4e5`；标题沿用 Fraunces、表单沿用 Manrope/繁中文字型、版本数字使用现有数据样式。核心布局是编辑表单与前后差异，窄屏顺序排列；减少装饰，保留键盘焦点、缩放与暗色主题。

## API 与数据边界

路径统一为 `/v1/admin/content-revisions/{kind}/{id}`，`kind` 只允许 `agent_groups`、`project_configurations`、`solutions`；不是任意表名。六种操作为读取编辑定义、`GET /options?q=`、`GET /history?before=`、`POST /previews`、`POST /apply`、`POST /requests/{key}`。参照按当前授权范围搜索，每类最多 200 项；页面保留原来已选中的绑定。历史使用每页 20 项的稳定游标，不返回正文副本。

管理员新选连接账户仍需额外连接读取权限。共享项目资料必须已经共享到该项目；私人和其他企业资料不能通过后台编辑器绕过。三类修订复用原有领域校验，固定精确角色、Skill、品牌和资料版本。普通客户解析方法模板时沿用原有只读权限；管理员专用路径只锁住可变模板指针，不要求客户或管理员修改不可变模板版本表。

迁移 `130-admin-content-revisions.sql` 新增不可变修订事实表。历史客户版本继续保留客户来源；管理员版本的客户来源为空，并绑定独立管理员及事实记录。数据库角色权限、版本来源约束和触发器共同检查对应对象、版本、范围及摘要；审计插入失败时整笔事务回滚。SQL001–129 保持原文件。

## 实际验证与失败保留

| 编号 | 结果 | 范围 |
| --- | --- | --- |
| 123-01 | 75/75 后端检查 | 完整运行修订、团队、项目配置、业务方法、架构兼容五个文件；16 项新增修订专项。失败、取消、跳过均为零。 |
| 123-02 | 三类实际编辑 | 真实邮件/MFA 登录，结构化团队职责、项目说明与精确 HKD、方法多行资料要求；客户可读到新版本，旧任务保留原版。 |
| 123-03 | 原提交恢复 | 实际服务完成提交后故意丢弃 HTTP 响应；刷新后凭原请求核对成功，浏览器无正文或原因持久副本，没有第二次修改。 |
| 123-04 | 当前撤权 | 向实际管理员增加项目显式拒绝，已打开的正文、原因、预览和历史在轮询后清除，无需刷新页面。 |
| 123-05 | 无执行副作用 | 页面前后任务、费用预留和网关请求数一致；本编辑流程模型请求为零。 |
| 123-06 | 布局及媒体 | 375/768/1024/1440px 下弹窗和输入横向边界均位于视口；6 PNG、2 GIF、2 MP4 及原始帧保留。 |

后端文件为 `admin-content-revisions.test.ts`、`agent-groups.test.ts`、`project-configuration.test.ts`、`solutions.test.ts`、`schema-compatibility.test.ts`。不把这 75 项表述为全部后端重跑。测试包含当前范围/MFA/CSRF、过期和篡改预览、定义变化、客户并发编辑、依赖变化、重复提交、恢复结果、撤权、独立来源、数据库角色与事实不可变、原子回滚，以及共享/私人/跨企业资料和 21 条历史的稳定分页。

第 01–04 批后台失败与当时验证器、原始输出和源码快照保留；第 05 批相关文件全部通过。第 01 批实际页面在恢复回执处失败：清除待确认记录误卸载了成功窗口。现在恢复窗口保存独立的目标引用，直到管理员主动关闭。第 02 批通过原页面断言，但人工复核发现 375px 截图裁切；新 V2 验证器补充完整视口边界、字体就绪及布局帧等待，第 03 批通过并生成当前使用的材料。旧通过范围、失败与截图不覆盖。

所有运行均绑定当时确切源码；所属浏览器、API、预览、原生 PostgreSQL 及测试端口关闭，所属测试数据回收通过。不调用本地 Docker/WSL/虚拟机。

[限定检查点](../quality/admin-content-checkpoint-123.json) · [完整证据索引](../quality/admin-content-evidence-123/index.json) · [编号待办](../quality/remaining-work-stage123.md) · [更新说明](../changes/123-admin-content-revisions.md) · [Admin 双语页面与录制](https://github.com/copypasteltd/workmate/blob/admin/README.md)

## 范围与发布

新发布器 V6 在六个独立组件提交及中央文档证明一致后，执行凭据、历史对象、媒体、链接和远端祖先检查，再普通原子推送 `backend/web/admin/desktop/extension/delivery/docs/main` 并读取 SHA。既有证明身份完整保留，旧全量后端与阶段 122 启动验证按原源码版本归档；不改写为当前全量通过。

本增量没有新增 Desktop 或 Extension 执行方式。Desktop 仍在客户本机运行 Codex、客户主动授予并可撤回本机权限；Extension 仍是原生右侧栏、获准文件上传及云端 Codex。假模型/媒体继续获准；真实供应商、专业业务质量、生产签名安装及完整 102 条验收另行跟踪。

The implementation adds actual scoped revisions for teams, shared project guidance and business methods. Signed previews and explicit confirmation precede atomic versions, separate administrator provenance and audit. Existing work retains pinned inputs; method revisions remain drafts subject to customer trial and publication. All 75 checks across five complete related backend files and seven actual Admin UI flows passed, including original-request recovery after a genuinely lost committed response and live scope withdrawal. Four viewport widths received seven dialog/field-bound observations; six screenshots and two GIF/MP4 pairs retain their original capture files. Earlier failed attempts and the weaker second UI capture remain historical. Owned resources were closed and fixture cleanup verified. V6 publication verifies exact committed sources and preserves historical proof identities before an ordinary atomic eight-ref push and SHA readback. Full product, live professional quality and production qualification remain separate.
