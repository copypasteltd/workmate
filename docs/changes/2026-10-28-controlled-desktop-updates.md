# Desktop 受控更新

Desktop 0.6.0：登录前可点击自绘标题栏更新图标，登录后也能在账户设置进入。检查→下载→原生验证→本机确认安装。主进程验证 Ed25519 规范清单、版本／分批／期限及加密单调序号；流式下载公司同源固定文件，核验完整 SHA-256、Windows 证书链及精确签署证书。安装时关闭新本机操作入口，等待 Agent／计划／程序／浏览器检查点，再核对当前发布，以锁定原生助手、固定参数和明确提交握手安装。开发／可携版本可下载验证，安装需手动进行。正式安装包使用 npm run package:release，显式提供公钥／最低序号和公司签名凭据；未签名正式打包直接失败。惰性测试文件不能替代产品安装包。本机 Codex 与客户可主动授予的完整权限继续保留。

64 backend + 96 Desktop + 22 native Codex checks; 13 builds; 4 real UI flows; 5 layouts; 2 GIF/MP4 pairs.

原生 Windows 验证为实际运行。公司签名已安装版本升级、完整产品和真实模型验收仍未证明，原始失败尝试完整保留。

[Runbook / 方案](../technical/116-desktop-updates.md) · [Evidence / 证据](../quality/desktop-updates-checkpoint.json)
