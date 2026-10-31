# 第一版冻结执行 / First release freeze

用户授权在主功能闭环下跳过部分验证。停止增加功能、广泛回归与历史扫描，仅绑定已完成的后端03、构建01、实际UI04；冻结源码后打包，普通原子推送8分支及7个不可变标签。打包不重编译、不替换已核查的Windows目录包。所有文档在docs，执行脚本与产物在dev；禁止虚拟化。

At the user's request, stop feature expansion and broad verification. Bind the completed focused results, commit independent repositories, package existing qualified builds, atomically publish eight branches and seven immutable tags, and verify remote references. Do not rebuild or replace the qualified Windows package during packaging.

原始失败保留。新包只含运行所需构建/完整可构建源码和当前媒体；旧证据与完整历史仍在冻结Git标签，未重新扫描。发布回执位于delivery/.data/marketing-import-148/publication-UUID/，避免文档提交与回执自引用。

Existing evidence remains immutable. Compact archives omit historical evidence while frozen Git tags retain complete histories. A separate publication receipt maps exact commits, artifact checksums and remote readback.

[Release guide](../releases/v0.1.0-rc.1.md)
