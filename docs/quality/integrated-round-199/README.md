# 199 · 直接设计编辑整批交付

本轮增加从真实Codex成果继续编辑的直接画布、服务器未保存预览、会话草稿恢复、版本冲突确认和实际交付包。私人源文件需要用户明确发布，发布过程中保留已验证类型，修复“已生成却无法选择继续编辑”的断点。Web与Desktop共用交互；Desktop仍在客户电脑本机运行Codex。

| 项目 | 本轮证据 |
| --- | --- |
| 构建与回归 | 六端构建、Desktop主进程／渲染类型检查、568项相关测试；[汇总](test-summary.json)，后端为选定风险回归 |
| 本地功能旅程 | 原生PostgreSQL、实际服务器／构建Web及真实渲染／导出，夹具明确为模拟；覆盖拖动／缩放／撤销、刷新恢复、真实并发头冲突和版本4ZIP；[回执](isolated-design-journey.json) |
| 真实云端 | 原任务e4872ce5-9c89-4453-b0c2-923d2f791523由实际云端Codex生成源文件，单次HK$0.038898，原任务与费用核对后未重复调模型；[回执](actual-cloud-source.json) |
| 真实Web／Desktop | 线上来源选择、实际保存／导出，最终0.7.11真实PKCE、无边框无菜单、同工程v2→v3及无横向／根滚动条；全部主进程／固定运行时与原已验收包相同；[回执](live-design-journey.json) |
| 部署与下载 | schema163，候选就绪及活动任务0后上线199；凭证不变，数据库／代理进程不变。三个包完成内网全文件HTTP／SHA校验，公开Setup全文件通过；Portable公网取件零字节停滞，保留未完成状态及其他公开元信息结果；[部署](deployment.json)、[下载与公网敞口](public-downloads.json) |
| 失败与范围 | [全部保留尝试](retained-attempts.json)、[102条与32组](requirements-102.md)，没有清除历史失败或按本轮通过关闭全部验收 |

浏览器公网验证使用独立SSH CONNECT出口，Electron使用本次隔离实例的原域名SNI透传；保留原HTTPS、证书及产品鉴权，不替换响应或模型，不修改公司服务／Cloudflare规则。开发机直接公网连接此前超时，服务器部分外网请求出现1010拒绝，原因尚未由转发／网络管理侧确定。本轮通过的通道不能被称为开发机直连恢复。

Web0.5.7／Backend0.5.7／Desktop0.7.11／Delivery0.5.6；Admin0.5.2和Extension0.5.7没有虚增版本。下载入口为[产品下载页](https://agent.copypaste.hk/downloads)，不可变文件位于/releases/199/；受信Windows签名按用户要求排除。

真实视频、语音、Google／GA4／Search Console／Meta等服务配置、全部专业角色样本、任意本机应用与机器矩阵、长期负载／灾备／生产验收、与WorkBuddy同任务盲测继续开放。测试邮箱按既有要求保留。本轮不是整体goal完成证明。

[需求](../../requirements/199-direct-design-editing-round.md) · [开发](../../development/199-direct-design-editing.md) · [更新](../../changes/199-direct-design-editing.md) · [全部JSON范围](requirements-overlay.json) · [实际素材哈希](actual-media.json)

English: This batch adds direct editing, authorized no-model draft previews, bounded scoped drafts, explicit conflict recovery and immutable delivery from an actual cloud Codex source. Six builds and568 selected checks pass. Isolated fixture evidence is clearly distinguished from deployed Web/final packaged Desktop journeys and full inner HTTP downloads plus verified public Setup bytes over owned original-TLS SSH egress; the public Portable download remains open. Failures, all102 original requirements and external/professional/production acceptance remain. Desktop Codex stays local; the overall goal is not marked complete.
