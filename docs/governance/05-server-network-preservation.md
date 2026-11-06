# 服务器网络环境保持规则

来源：用户在本轮明确要求“不允许对服务器的网络环境做任何的修改，防止出现其他业务出事”。这是后续持续开发、部署和排障的约束。

DNS／hosts／解析器、路由／策略路由、网卡／netplan、系统代理、防火墙／iptables／nftables／ufw、反代／Nginx以及内网穿透配置只允许读取。不得改写这些配置、重载反代、停用防护或借排障调整其他业务。连接失败不能成为自动放宽网络策略的依据。

Workmate发布沿用现有监听端口、下载映射和静态入口，只更新自己的应用文件、目录和应用服务。对当前无活动任务、候选就绪、原数据库与代理进程、原凭证和回退路径进行核对。需要的网络条件若无法通过应用自身处理，保留证据并向用户说明；没有明确的新授权不得操作。

本轮以发布前9份网络配置文件的SHA-256和实时路由／规则／防火墙快照为基线，发布后逐项核对。`iptables-save`会加入生成／完成时间注释，核对时只能替换这类时间注释，并且必须精确重构原始基线SHA；任何规则、策略或其他字节变化仍判定不一致，不自动修复。失败检查及后续诊断单独保留。

开发机可使用专属、仅允许公司域名的本地QA传输验证原始TLS，不替换应用响应，不降低证书校验，不改变服务器网络设置。此证据与开发机直连、服务器普通HTTP客户端的连通性分别记录。使用结束后回收所有自建浏览器、客户端和传输监听；保留用户原有程序。

本轮网络保持结果及准确检查范围见[发布回执](../quality/integrated-round-202/network-preserved.json)。HTML下载的统计脚本插入通过应用响应中的 `no-transform` 处理，不修改Cloudflare／反代配置或关闭文件完整性校验。[Cloudflare官方说明](https://developers.cloudflare.com/web-analytics/faq/)解释了该响应指令与自动脚本插入的关系。

English: Server networking is read-only by explicit user instruction. Do not edit DNS/hosts/routes/interfaces/proxy/firewall/reverse-proxy/tunnel settings or reload Nginx. Deploy only the owned application using existing ports/static/download paths. Compare the original configuration and live-rule fingerprints, preserving credentials and database/proxy processes. Timestamp-only firewall export differences must reconstruct the exact original hash; other differences remain failures. Owned local QA transport retains original TLS and responses and is cleaned up afterward. Application-level immutable HTML download handling does not authorize a network configuration change.
