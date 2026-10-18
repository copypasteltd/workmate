# CopyPaste Platform

[English](README.en.md) · 原生企业 Agent 服务 · 0.1.0

本仓库提供真实 PostgreSQL 持久化、用户与管理员身份、企业/项目权限、Codex 任务执行、营销资产、数据分析、流程、设备调度与运营控制面。它是独立 Git 仓库，不依赖相邻仓库源码。完整项目主文档位于交付根目录的 `docs/`。

## 运行前提

Windows x64 已验证；Node.js 22.14+、npm、Git、原生 Codex `0.163.0-alpha.10.2`、FFmpeg/FFprobe。依赖锁文件随仓库提交。所有步骤使用原生进程，禁止 Docker、WSL 和虚拟化环境。其他操作系统未执行验收。

```powershell
npm ci
npm run setup:local
npm run db:local
```

保留数据库终端，在另一个终端执行：

```powershell
npm run db:migrate
npm run dev
```

本机 API：`http://localhost:4310`；数据库：`127.0.0.1:55432`。`db:local` 初始化开发数据库和全部迁移；`db:migrate` 也准备隔离的 `copypaste_test` 数据库。迁移只通过 owner 身份执行，API 使用独立受限连接。

`setup:local` 仅在 `.env` 不存在时生成随机数据库密码及持久 MASTER_KEY。`.env.example` 是无密钥配置参考，不能覆盖现有 `.env`。Windows 中文路径通过临时 ASCII junction 供 PostgreSQL 引导使用，数据和二进制仍位于本仓库；关闭时只移除该别名。

## 从访问到使用

```mermaid
flowchart LR
  V[访问 Web] --> E[工作邮箱验证码]
  E --> S[独立用户会话与 CSRF]
  S --> O[创建企业和首个项目]
  O --> R[选择预设角色和项目素材]
  R --> P[权限 / 模型 / 权益 / 预算校验]
  P --> H[钱包原子预留]
  H --> Q[事务 outbox 与 pg-boss]
  Q --> C[受控 Codex app-server]
  C --> G[公司内部 AI 网关]
  C --> T[授权工具与不可变资产]
  T --> B[实测用量结算或对账]
```

邮箱首次验证可创建用户。验证码 10 分钟有效、最多 5 次错误、并发只有一个消费者。开发邮件写入 `.data/mailbox/<challenge-id>.json`，需在本机查看验证码；生产必须使用 SMTP。Web/Admin 会话分别使用 HttpOnly Cookie，写请求检查 Origin、CSRF；原生端使用 PKCE、短期 access token 和轮换 refresh family。退出、封禁与会话撤销使令牌失效。

## 管理员开户

```powershell
npm run admin:create -- admin@your-company.example super_admin
```

在 `.data/enrolment/<id>.json` 中读取本次生成的 TOTP enrolment URI，导入认证器后删除文件。管理员需邮箱验证码和 TOTP 双重验证；没有共享默认账号、密码或后门。CLI 是受信部署操作，不向普通用户暴露。

后台支持 8 个内置角色、67 个权限键，global/tenant/project 范围、显式 deny、金额/期限/批次数限制及委派限制。敏感操作要求最近 10 分钟内 MFA；不能自授权限或撤销最后一个永久有效超级管理员。

## 已实现模块

| 模块       | 本次实现                                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------------------------- |
| 身份与企业 | OTP、独立 Admin MFA、原生 PKCE、邀请、成员/项目授权、最后 owner 保护、数据库 RLS                            |
| Agent      | 唯一 Codex 内核、版本固定、28 个哈希校验 Skill 包、18 个角色、任务/事件/取消/租约/fencing                   |
| 费用与权益 | HKD 整数 micros、资金来源批次、预算预留/一次结算、人工确认入账/赠送/来源退款、个人/企业 VIP、冻结套餐版本   |
| Admin      | 完整分页用户与企业列表、按权限消耗、两步预览提交、独立审批、内容隔离/撤销分享、批量/导出、配置发布、审计    |
| 素材与设计 | 本地/S3 存储适配、不可变版本、授权下载/预览、品牌资料、图文/PNG 图层工程、SVG/PNG、真实 FFmpeg MP4 模板动效 |
| 数据       | CSV 导入、精确汇总 CTR/CPC/CPA/ROAS、零分母 null、SEO HTML 审核、Google/GA4/GSC/Meta OAuth 与有界报表适配   |
| 流程与设备 | 最多 8 步持久工作流、数据/Agent/人工审批、设备注册、Ed25519 签名命令、限时目录 grant、一次性 nonce 结果     |

18 个角色：全栈、前端、后端/API、软件测试、UI/UX、设计师、品牌视觉、广告创意、电商、社媒、插画/IP、字体版式、演示、网页/落地页、信息图、视频动效、营销分析、流程自动化。定义见 `catalog/role-preset-catalog.json`，实际 Skill 内容见 `skills/` 与 `catalog/skill-packages.json`。

安装 Skill 不代表该角色已完成真实业务验收。当前全部角色的资格状态为 `pending_live_validation`；AI 未配置时禁止假成功。

### 当前 Codex 工具边界

实际工具包括 `project_assets`、`asset_text_read`、`deliver_text`、`marketing_metrics`；按角色开放 `code_read`、`code_write`、`code_package`、`font_catalog`、`design_render`、`image2_generate`、`image2_edit`。源代码支持 CAS 哈希编辑、真实 ZIP 和 manifest，但不执行用户不可信代码或声称已运行测试。设计工具生成可编辑 JSON、SVG、PNG 及有限模板 MP4。图像生成/修改只调用内部 Images 接口。

目录里其他长期规划的 tool_id 不等于本次已注册工具。AI 视频、语音和云端定时调度尚未实现；需要这些能力的角色明确不可用。人工本地文件调度已贯通，Codex 自动调度本地文件工具尚未接入。

## 内部 AI 网关联调

服务端 `.env` 需配置 `AI_BASE_URL`、`AI_ALLOWED_HOSTS`、`AI_API_KEY`、准确的 `AI_MODEL`，并登记实际 HKD token 费率。Base URL 通常包含 `/v1`；禁止凭 URL 携带凭证、禁止生产 HTTP、禁止自动回退外部模型。

```powershell
npm run codex:probe
```

此命令只验证实际 Codex 版本、initialize 和 thread/start，不发送真实模型 turn。正式启用前还需用公司网关完成 `/responses` 工具回合、实测 token 用量和异常核查，然后设置 `AI_VERIFIED=true`。Image 2 另需 `AI_IMAGE_MODEL`、`AI_IMAGE_HKD_MICROS_PER_IMAGE` 和 `AI_IMAGE_VERIFIED=true`，核查 `/images/generations`、`/images/edits` 的真实 PNG 输出。

`tests/runtime.test.ts` 启动真实 Codex 并与本地受控 Responses fixture 完成工具回合，验证内部路由和用量；它不是公司真实模型能力证明。尚未获得公司网关配置，未进行其真实联调。

## 金额和运营规则

1 HKD = 1,000,000 micros。金额全程用整数，不使用浮点记账。赠送、确认付款、预算预留、消耗和退款分别留账；确认付款引用全局唯一。VIP 不充值钱包，钱包余额不等于 VIP 权限。

Starter / Pro / Business 的并发默认值为 1 / 3 / 8，单任务预算上限为 HK$100 / 500 / 5,000。这些是试点默认约束，月费为未定价占位 0，不代表免费商业承诺；后台可发布版本化套餐。

费用/VIP 操作采用 5 分钟预览 + payload hash + 目标版本 + 幂等提交；默认 HK$10,000 及以上要求另一位管理员审批。上游结果未知时保留预留并进入 `reconciling`，禁止盲目再次收费。付款是人工确认记录，尚无在线支付收单。

批量操作按操作者的批次数上限执行；CSV 导出最多 500 行、15 分钟过期、仅原管理员可下载且重查权限。用户/消耗/内容的集合查询在 SQL 层过滤授权范围及显式拒绝。

## API、检查和目录

```powershell
npm run typecheck
npm run build
npm test
npm run contracts:export
```

`contracts/implemented-routes.json` 是实际 Fastify 路由清单，不冒充主文档的完整规划 OpenAPI。27 项原生测试覆盖身份、隔离、费用并发/重放、权限与 VIP、内容撤销、图片版本、真实 PNG/MP4、真实 Codex 受控协议回合及初始化取消、源代码包。浏览器/扩展/Desktop 验收由独立 delivery 仓库记录。

| 路径                   | 内容                                           |
| ---------------------- | ---------------------------------------------- |
| `src/`                 | API、业务域、Worker、权限和 Codex              |
| `migrations/`          | 按序事务迁移与数据库约束                       |
| `catalog/` / `skills/` | 角色、权限、Skill 包与哈希                     |
| `contracts/`           | 生成的 Codex 协议及实际路由                    |
| `scripts/`             | 本机启动、迁移、管理员开户、协议探测           |
| `tests/`               | 真实 PostgreSQL 与原生媒体/内核测试            |
| `.data/`               | 忽略的本机数据、邮件、密钥 enrolment、运行产物 |

![由真实平台数据驱动的管理后台](assets/screenshots/platform-overview.png)

截图来自独立 Admin 客户端，展示本 API 返回的真实开发数据；平台本身不包含该客户端 UI。

## 部署、恢复和已知边界

生产要求 HTTPS、真实 SMTP、独立数据库身份、持久 MASTER_KEY、受控出站和对象存储。开发原生数据库启动器在 production 被禁用。备份数据库、对象文件和 MASTER_KEY，并通过原生恢复演练后再上线；不要通过删除密钥来“重置”生产服务。

Google/Meta 需设置服务端 OAuth client secret、精确 API version、Google Ads developer token 和回调 URI；未获真实平台授权，尚未做线上报表验收。S3 适配未接真实存储验收。SSO、云计划调度、团队并行 Agent、协同编辑、完整生成视频/语音、生产 SLO、Windows 代码签名和用户代码强隔离属于未完成范围。Codex 集成关闭 shell、浏览器搜索和其他 Agent 能力；原生 OS 服务账号/ACL/网络隔离仍是生产前置工作。

本代码未授予额外开源许可。第三方组件、字体和素材来源见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
