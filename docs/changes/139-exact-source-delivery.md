# 阶段139：源码与验证记录保持相同字节

发布预检第一版正确拒绝了Git自动换行转换：后端17份、交付核查17份文件的工作区原始CRLF字节与首次提交的LF字节不同。完整只读差异记录见 [首次检查](../quality/native-teams-publication-eol-139-attempt01.json)。

本次没有改变已执行的程序、测试或核查脚本，也没有放宽字节比较。只为后端与交付仓库增加明确的Git属性，重新提交这些文件的原始字节；Desktop的Git属性保持用户指定的原始SHA不变。原始检查点、源码归档、实际Windows包、通过及失败记录全部保留。

[交付检查点](../quality/native-teams-release-checkpoint-139.json)逐项核对当前工作区与实际Git对象，保留原1756份运行核查源码；其中仅后端Git属性这一版本管理文件新增规则，并单独列出前后摘要。另绑定交付仓库Git属性，防止脚本在检出时改变。177项相关检查与6项实际Windows旅程来自原始记录，没有把它们表述为再次执行。

The first publication preflight rejected34 newline-only Git conversions. The correction preserves every executed source, verifier, raw attempt and runtime receipt byte-for-byte. Only version-control attributes change; strict Git-versus-working-byte equality remains required. The supplementary release checkpoint proves the sole backend attribute change, exact current committed sources, unchanged professional/runtime code and preserved original177 tests and six actual Windows journey checks.

Desktop的用户保护属性文件保留原始本地SHA `82eabadd…9185e` 及原始Git SHA `e6824c65…22aa8`，仅此版本管理文件存在原始CRLF／LF表示差异；核查明确记录两者及仅换行差异，不修改用户文件。所有程序、用例、核查脚本和证据继续要求Git原始字节严格相等。补充记录器第一版对此元数据的拒绝也保留，第二版只区分该固定的非程序文件。
