# rc.3 完整冻结补丁 / Complete frozen patch

纳入Admin现行权限、人数、个人预留和云端资源确认扣费修复，连同全部客户端、六仓源码和固定Codex统一发版。按加速要求只重新构建改动的后端/Admin；复用完整源码差异和SHA核对一致的客户端构建。

Ships the current Admin correction with all clients, six buildable source trees and the pinned Codex companion. Only changed Backend/Admin are rebuilt. Existing client binaries are reused after source-diff and digest checks. External dependencies remain synthetic; unsigned Windows and full production acceptance remain tracked.
