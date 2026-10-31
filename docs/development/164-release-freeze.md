# 164 · rc.4 构建与冻结 / Build and freeze

本轮不新增业务范围；将阶段162启动检查和阶段163会话修复正式纳入统一冻结交付。六个仓库重新构建；Windows生成完整目录、便携程序和NSIS安装程序，并核对实际ASAR及固定Codex。主文档与六仓中英README同步当前版本、操作步骤和原始真实媒体。

This increment freezes the existing startup/session corrections without expanding product scope. It rebuilds all six repositories, generates unpacked/Portable/NSIS Windows distributions and binds ASAR/runtime bytes to current outputs.

发布顺序为：源码与固定配置摘要 → 当前构建 → 精确包内容核对 → 八分支与七标注标签原子推送 → 七类归档与完整ZIP → 六个GitHub资产摘要核对 → 公开候选版 → 发布回执。已有rc.1/rc.2/rc.3标签与包保留；不强推。私有配置、数据库、Git历史及用户清理文件不进入交付。

Publication binds source snapshots to builds, atomically pushes eight branches/seven annotated tags, freezes seven archives and a complete ZIP, verifies six GitHub asset digests and records publication. Previous releases are preserved. Private configuration, databases, Git history and user-owned cleanup files are excluded.

按要求复用源码未变的28项HTTP、3组实际Web/SQL和9项启动检查，省略全量历史回归。没有新增原生安装、真实外部提供方或全专业业务验收。完整102原编号保留，88项必选全范围验收继续开放；这不是88个未开发模块。

Focused prior results are inherited only when their exact sources still match. Broad regression is omitted. Production providers, installed-client acceptance and professional whole-scope acceptance remain tracked.

[完整使用 / Full guide](../releases/v0.1.0-rc.4.md) · [定向构建 / Build receipt](../quality/release-freeze-checkpoint-164.json) · [全部原编号 / All IDs](../quality/remaining-work-stage164.md)

首次ASAR核对工具将Windows嵌套路径转换为正斜杠导致误报；原始失败及七项成功构建日志保留。v2沿用同一构建，使用原生路径重新逐文件比对，不改产品源码、构建或旧验证器。

The first ASAR comparison failed because the verifier changed native Windows nested paths to POSIX. Its original failure and seven successful build logs are retained. v2 compares the same build with native paths; it does not alter product source, output or the executed original verifier.
