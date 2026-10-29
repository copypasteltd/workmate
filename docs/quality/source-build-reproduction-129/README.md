# 六端全新源码构建补充验收

阶段128已发布源码的六个独立仓库均完成全新依赖安装和实际构建。检查时间为2026年10月30日（香港时间）。本补充验证安装与编译可复现；完整功能、正式服务和安装包验收继续按[102条编号记录](../remaining-work-stage128.md)推进。

| 编号 | 仓库分支 | 固定源码提交 | 安装 | 实际构建 | 成功记录 |
| --- | --- | --- | --- | --- | --- |
| 1 | backend | `0dfc253b8a1c3cec200cba2973189c10306a33e8` | 通过 | 通过 | 02 |
| 2 | web | `b7c948e07c2bb73730212cacd0419e9ff5a839cb` | 重试通过 | 通过 | 03 |
| 3 | admin | `ab746ab5c9e0eafff2de627d186bd512bcfbe8cc` | 通过 | 通过 | 02 |
| 4 | desktop | `83ac69d0009de328ef73ccb066dba9f27994dd0b` | 通过 | 通过 | 02 |
| 5 | extension | `a33e732392e7aec66d4f858ad869e11bd9e84957` | 通过 | 通过 | 02 |
| 6 | delivery | `1f8bac7165fffddb57610caf90f6e96664394d49` | 通过 | 通过 | 02 |

使用原生Windows、Node v22.14.0、各自提交的package-lock.json，依次执行 `npm ci --no-audit --no-fund` 与 `npm run build`。源码来自独立浅克隆的本地Git传输；没有复用原仓库的node_modules、构建产物或.env。构建模式为mock，未发起AI调用，没有启动浏览器、应用服务或虚拟化环境。本次不声称验证了从GitHub下载到另一台电脑的完整安装。

构建后重新核对六端提交、Git tree、依赖清单及锁定文件，工作树均干净；重新逐文件核对1841项阶段128源码/素材绑定。仅Desktop根.gitattributes使用已声明的CRLF到LF Git规范化，原工作区文件字节保持原样。检查结果见[归档索引](index.json)，英文说明见[English README](README.en.md)。

记录01在完成前五端独立源码克隆后，对Delivery的完整历史证据检出进行主动取消。该端包含385432个受控文件，主要是历史证据；保留原失败和取消原因，再新建独立稀疏克隆，仅排除evidence/。记录02中五端安装及构建成功，Web下载遇到registry.npmjs.org的EIDLETIMEOUT，因此原结论仍是失败。记录03只重试同一Web源码的安装与构建，两项均通过；其余五端复用记录02的成功结果，并重新核对源码。三个原始结果、原始日志、实际执行的核查脚本和npm错误日志均按字节保存，未将旧失败改写成通过。

Delivery仅做源码开发和编译时可使用下列PowerShell方式，避免检出历史证据。`$deliverySource`应指向新建的源码目录；正常全栈运行仍按各端双语README配置六个相邻独立仓库。需要历史验收素材时执行 `git sparse-checkout disable`，恢复完整文件。

```powershell
$deliverySource = 'D:\dev\copypasted\自有agent\dev\workmate-delivery-source'
git clone --depth 1 --single-branch --sparse --branch delivery git@github.com:copypasteltd/workmate.git $deliverySource
"/*`n!/evidence/`n" | git -C $deliverySource sparse-checkout set --no-cone --stdin
Set-Location -LiteralPath $deliverySource
npm ci --no-audit --no-fund
npm run build
```

实际核查采用相同稀疏规则的本地Git传输；以上远程克隆写法为使用说明，未作为本次网络克隆成功证据。排除范围只有历史evidence/；提交、tree、源码、scripts、tests、QA文件与依赖锁定不变，Delivery实际编译通过。

阶段128的[本机安全启动恢复](../../technical/128-desktop-startup-recovery.md)已通过91项相关控制检查、43项真实本机Codex检查、30项原生数据库/API检查、3项当前编译与6项实际未签名打包界面检查，原始源码绑定及限制保留在[检查点](../startup-recovery-checkpoint-128.json)。本补充新增的是六端全新安装/构建凭证，不追加运行时测试数量，不关闭整体验收项：89条必需、12条待确认建议及1条可选仍开放。

本次发布仅新增文档和不可变归档；阶段128的六端源码、截图、GIF、双语仓库README、发布清单及旧检查点保持原版本。索引同时保存阶段128八分支推送成功的原始凭证。后续文档补充推送需要另存远端回读凭证，不能由构建成功推断推送成功。
