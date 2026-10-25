# 历史文档链接核查 / Archived document links

项目主文档保存在 `docs/`，各独立组件保留随仓库交付的中英 README。历史快照保留原字节和原链接；不得为了让今天的通用链接检查通过而改写已归档的证据。

## 核查方式

[归档感知校验器](../tools/audit_archive_links.py)使用 CommonMark 解析当前 Markdown、已登记的历史 Markdown 快照及六组件的中英 README。代码围栏中的示例不作为真实链接。外部网址、协议链接和页内锚点单独计数，不作网络访问或锚点有效性证明。

历史文件先通过已有归档清单中的 SHA-256 校验，再按清单记录的原始文件位置解析相对链接。一个历史链接指向同批次已保存的目标时，优先核对该批次目标的原始字节；否则核对当前工作区的目标文件。`.md.snapshot`、`.md.txt` 等归档扩展名不能替代原始路径。历史 Markdown 的来源缺失或有歧义时检查失败，不自动猜测基准目录。

有些旧清单以内容摘要命名非 Markdown 文件，多个原文件因字节相同而共用一个归档文件。校验器逐项核对这些原始路径和摘要，将此类重复记录为字节别名；它们不参与 Markdown 链接基准选择。不能以该规则跳过有歧义的历史 Markdown。

校验器在结束时重算全部输入摘要，要求运行期间输入未变化，且不修改历史档案。每次使用新的两位检查编号，保留失败和通过报告，例如：

```powershell
python -X utf8 docs/tools/audit_archive_links.py --report docs/quality/archive-aware-links-04.json
```

在项目根目录执行；已有同名报告时工具拒绝覆盖。最终发布前，应先固定当次文档和 README，再以新编号检查。新增文档后，旧报告继续说明旧输入，不能自动证明新文档已通过。

## 已保留证据

[第 03 轮报告](../quality/archive-aware-links-03.json)通过，覆盖 942 份文档、24,013 个本地文件链接及 80 份来源元数据；其中 758 份为摘要校验后的历史 Markdown，另有 183 份当前文档和一份直接编写的历史说明。报告记录 127 个非 Markdown 字节别名，所有输入在运行期间保持不变，历史档案未修改。

该报告的本地文件存在性和归档字节核查通过，不表示外部网址、页内锚点、文档陈述的产品功能或业务验收已通过。原始需求、测试条件和全产品差异仍以[当前差异评估](../quality/2026-10-25-goal-gap-assessment.md)及逐项验收登记为准。

## English

Historical documents retain their original bytes and relative links. The archive-aware checker parses CommonMark in current documentation, registered historical Markdown snapshots and all twelve component READMEs. It verifies recorded hashes and resolves each archived link from its original source location, preferring a verified target in the same archive collection before the current workspace.

Missing or ambiguous Markdown origins fail the check. Identical non-Markdown blobs shared by historical manifests are recorded as byte aliases; they never establish a Markdown link base. Code-fence examples are ignored. External URLs, other schemes and document fragments are counted separately without network or anchor validation.

Run the tool from the project root with a fresh two-digit attempt number after freezing documentation. Existing reports are never overwritten. All input bytes are checked again at the end, and historical files remain untouched. Attempt 03 passed for its exact inputs: 942 documents and 24,013 local file links. This is a documentation integrity result; product qualification and complete acceptance remain separate.
