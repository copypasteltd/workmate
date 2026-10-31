# rc.3 冻结方案 / Frozen patch release

本次收口到授权假数据候选版。仅后端/Admin有运行代码变化，因此重建两者；用完整Git差异约束其余三客户端只能有README/媒体变化，再核对rc.2包SHA并复用。六仓源码采用新冻结提交，ZIP排除Git元数据、本机密钥、数据库和依赖，保留运行源码、锁文件、双语说明和引用媒体。主文档只选择Git已跟踪的允许路径，保护用户未提交文件。固定Codex四个文件重新按新源码根目录封装。

Atomic publication creates seven new annotated tags and updates eight branches without force. The complete distribution contains seven archives, current source/content indexes and SHA256SUMS. The GitHub uploader streams exact bytes, reconciles a lost response using durable asset digests, then publishes the draft only after all six public assets match. Previous releases are preserved.

[使用 / Usage](../releases/v0.1.0-rc.3.md) · [构建与复用依据 / Build and reuse](../quality/release-freeze-checkpoint-161.json) · [剩余原编号 / Original remaining scopes](../quality/remaining-work-stage160.md)
