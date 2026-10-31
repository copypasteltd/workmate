# F147 最终独立反证 v6：测试上下文修正与组合覆盖

日期：2026-10-31。工作区：`D:\dev\copypasted\自有agent\`。

## 结论

未发现当前 v2 测试放宽原有流程、断言或产品权限，也未发现这次组合覆盖把失败报告改写为成功的事实。现有证据支持：相同产品源码上的 92 项既有后端检查，与单独复测通过的 3 项并发检查组成 95 项覆盖；它不等于新一次完整 95 项全部通过。UI08 的 5 项客户流程另有独立通过记录，内部 Responses 仍为明确标识的假数据，不能据此宣称生产模型或全产品专业质量验收。

本次没有运行服务、模型、测试、记录器、准备器或文档写入器；仅阅读现有记录与源码，并独立进行文件摘要和文本差异核对。没有修改产品、测试和旧报告。与 v5 不同，复核时 backend11 已留下完成记录，因此下文可引用其现有结果，不是本代理重新执行测试的结果。

## 1. 原失败的具体来源与 v2 的边界

原始 `dev/copypaste-delivery/evidence/functional-closure-147/backend-10.tap:1223`、1238 行保留两个失败，分别是持 child 的来源读取、正式撤回等待读者两项。堆栈落在 v1 测试的 84、108 行，错误为 `TASK_SOURCE_REVOKED`；原始统计仍是 `tests 95 / pass 93 / fail 2`（2670–2673）。JSON 也仍为 `status=failed`、`result_exit_code=1`。

这两个位置直接使用 `control.connect()` 后的原始持锁连接读取 manifest。`dev/copypaste-platform/migrations/082-task-content-source-lineage.sql:167` 的 SQL 函数即使以 definer 身份执行，仍显式比较 `app.tenant_id`，且 private owner 还比较 `app.actor_id`（170–171）。原始连接缺少上下文时返回空 manifest，是可由源码解释的测试搭建错误；不是因为已有产品来源检查应该被关闭。

新增 `dev/copypaste-platform/tests/task-local-handoff-concurrency-147-v2.test.ts:22` 的 `scopeHolder` 仅设置以下七项 transaction-local 上下文，与 `src/db.ts:32`–49 的 `Database.tx` 一致：

| 设置 | v2 的实际值 | 对应正式事务 |
| --- | --- | --- |
| `app.tenant_id` | 当前 fixture tenant | 事务 tenant |
| `app.actor_id` | 当前同一客户 user | 事务 actor |
| `app.data_mode` | 由同一 `DEMO_MODE` 决定 | 相同分支 |
| `app.ai_gateway_fingerprint` | 同一 synthetic 标识或 `AI_BASE_URL` 的摘要 | 相同 hash 与配置来源 |
| `app.task_id` | 空 | 相同重置 |
| `app.billing_actor_id` | 空 | 相同重置 |
| `app.erasing_content` | `false` | 相同重置 |

所有 `set_config` 的第三个参数均为 `true`，随事务结束失效；没有增加删除豁免、取消来源检查、变更租户、修改产品对象或放宽计费。三次调用均在原 `BEGIN` 之后、原实际持锁操作之前（67、91、118）。

独立文本核对结果：从 v2 移除新增的两个 import、完整 scope helper 段及三次 `scopeHolder` 调用后，与 v1 全文一致。原三项流程、真实数据库竞争等待、HTTP 返回值、来源撤回拒绝、费用及重复执行断言全部保留；没有用新的宽松断言替换旧断言。对 helper 正文另行逐行核对，而不只依赖区段剥离结果。

## 2. 运行记录和源码指纹的独立核对

| 证据 | 实际读取到的结果 | 独立核对 |
| --- | --- | --- |
| backend10 | 原始 95 项，93 通过、2 失败；失败仍保留 | `source_manifest`、`raw_report`、`verifier` 三项 SHA-256 均与 JSON 相符；失败名精确对应上述两个原测试。 |
| backend11 | JSON 时间 `2026-10-31T00:32:40.572Z`，passed、exit 0；TAP 为 3/3，通过名称是原三项并发测试名 | 三项证据 SHA-256 均相符；源码未变化，compiler/build/bootstrap exit 均为 0；fixture cleanup passed，数据库已关闭且端口已关闭。 |
| UI08 | passed、exit 0，5 项客户流程；journey 记录 cloud 5 次、native 2 次受控 provider 请求 | 三项报告证据及 journey SHA-256 均相符；browser/desktop/extension/API/fixture/provider 六类关闭状态均为 true。 |

独立比较保存的 platform 来源清单，并重新计算其对应当前文件的摘要：

- backend10 与 UI08 各有 **1317** 个 platform 文件，所有保存摘要均与当前文件一致。
- backend11 有 **1318** 个 platform 文件；相对上述两个来源清单均只新增 `tests/task-local-handoff-concurrency-147-v2.test.ts`，没有删除或修改任何旧文件。
- backend11 的全部 1318 个摘要也与当前文件一致。因此，这次没有借修正测试上下文夹带产品、旧测试或 fixture 的修改。

`backend-11-verifier.mjs:88`–89 明确只选择 v2 测试文件运行，不能被描述为完整 95 项重跑。其 snapshot 使用 tracked 与未忽略的 untracked 文件收集相关源码、测试、脚本、迁移与配置（27–38），并在运行后比较相同集合和摘要（119）。

## 3. 组合绑定脚本是否掩盖失败

`docs/tools/functional_closure_147_binding_v1.py` 的当前静态行为符合这次固定版本的证据边界：

| 编号 | 约束 | 证据 |
| --- | --- | --- |
| V6-01 | 要求真实新复测成功 | 47–51 行要求当前报告 passed、exit 0，原始 TAP 严格为 3/3、0 fail。 |
| V6-02 | 要求原失败继续保持失败 | 52–59 行要求 backend10 仍 failed、exit 1，统计严格 95/93/2，失败名精确匹配两项，且新 TAP 有对应成功名。 |
| V6-03 | 禁止用更换旧产品来复用旧结果 | 60–64 行要求 platform 集合只新增 v2，所有旧摘要完全相同；90–95 行对 UI08 同样要求仅新增该测试。独立摘要核对也符合这些约束。 |
| V6-04 | 原断言和流程不能被替换 | 65–76 行移除唯一上下文增量后要求 v1/v2 全文相同。本报告另核查 scope 正文确为上述七项正式事务设置。 |
| V6-05 | 明确输出组合范围 | 81–86 行同时保存旧、新真实统计、92 项既有用例与 3 项当前并发用例；`verified_case_coverage=95`，scope 明确否认新一次完整 95 项重跑。 |

绑定函数本身不重新执行旧测试，也没有把 backend10 的 status 改成 passed。对于当前来源与当前脚本，没有发现失效后端结果被重命名为完整通过的路径。结论限定在本次已逐字核对、已绑定摘要的 helper 正文，不能将区段剥离算法单独视为未来任意 helper 代码的语义证明。

## 4. 记录与文档生成链的准确性

`docs/tools/record_functional_closure_147_v1.py:39`–40 调用后端绑定与 UI 来源比较；51–59 行把新增 v2 加入最终 source 集合并核对当前字节。其 74–79 行归档所有原始尝试及各自真实 status，没有只保留成功尝试；95–101 行保留“当前实际 3 项”与“组合覆盖 95”的区别，并将完整验收新增数量维持为 0。

`docs/tools/prepare_functional_closure_publication_147_v1.py:45`–59 重新核对同一绑定函数、checkpoint 和归档摘要、当前来源字节；不是仅信任文字中的成功状态。

`docs/tools/write_functional_closure_docs_147_v1.py:64`–70 的拟生成说明明确写出 92+3、backend10 原始 2 fail 保留、没有重复完整套件或 UI08，并说明假数据、固定 QA Codex 二进制、专业验收和生产验收边界。双语 README 的相关段落也紧接说明组合覆盖和原始失败保留（116–117）。这些脚本在本次复核中均未执行，不能把脚本中的拟生成说明当作已经完成归档或发布。

UI08 的现有 journey 明确记录真实 Codex 进程、本地 CSV、显式上传和原线程暂停／继续，同时指出 Responses 使用 synthetic replies、工作流 UI 另有脚本模型。它支持当前功能链和界面交互的验收，不能外推为真实生产 AI 服务、完整专业质量或全 OS 行为均已验证。

## 最终判断

本次没有发现需要阻断当前组合资格的具体反例。可准确采用“同一产品字节上的 95 项组合覆盖：92 项既有检查与 3 项针对性复测；UI08 的 5 项实际流程另行通过”的表述。原 backend10 两处失败继续保留，当前 v2 的三项通过也有已结束的独立原始记录。最终归档、提交与发布是否完成，仍须读取对应后续产物；本报告不代替这些动作的结果。
