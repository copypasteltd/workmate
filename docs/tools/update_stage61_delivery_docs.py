"""Publish source-bound connector progress without changing original case text."""
import argparse
from pathlib import Path
from refresh_stage52_capabilities import ROOT, DELIVERY, read

MARKER='<!-- stage61-marketing-connectors -->'


def prepend(path,paragraph):
    text=path.read_text(encoding='utf-8')
    if MARKER in text: return
    title,body=text.split('\n\n',1)
    path.write_text(title+'\n\n'+MARKER+'\n'+paragraph+'\n\n'+body,encoding='utf-8',newline='\n')


def main():
    p=argparse.ArgumentParser()
    for n in ('core','full','ui','native','clients','upgrade'): p.add_argument('--'+n,required=True)
    a=p.parse_args()
    runs={n:read(DELIVERY/f'evidence/marketing-connector{s}-{getattr(a,n)}.json') for n,s in [('core','s-core'),('full','s-regression'),('ui','-ui'),('native','-native'),('clients','-clients'),('upgrade','-upgrade')]}
    assert all(r['status']=='passed' for r in runs.values())
    n,m,uc,nc=runs['core']['counts']['pass'],runs['full']['counts']['pass'],runs['ui']['counts']['checks'],runs['native']['counts']['checks']
    paragraph=(f'阶段 61 的[营销账户同步](technical/61-marketing-connector-synchronization.md)支持四供应商的明确模拟授权、获准账户/项目范围、持久分页、限流恢复、不可变快照和分析来源。'
               f'专项 **{n}/{n}** 纳入平台 **{m}/{m}**，保留原全部 638 项命名测试；实际 Web/Admin **{uc} 项**和新打包原生客户端 **{nc} 项**通过。'
               'Desktop 保持无边框、自绘窗口控制、无 Electron/Alt 菜单；Extension 工具栏开关 Chrome 原生右侧 Side Panel，并提供固定营销工作台入口。'
               'Admin 的企业/项目范围、元数据、正文与新鲜 MFA 撤销分别授权，撤销取消未完成读取并清除凭证。'
               '两库 SQL071→077 保留 157 张原表的全部行摘要及 SQL001–071，新增七表强制 RLS。'
               '当前预览位于各端 `release/connectors-61/`；实际执行 unpacked 程序，签名、安装、商店和正式供应商资格仍独立跟踪。'
               '[当前回执](quality/marketing-connector-checkpoint.json)和[包清单](quality/marketing-connector-artifacts.json)限定实际执行范围；下方较早阶段的源码/截图/测试保持历史范围，原始 102 项及完整 TC/NFR/G01–G10 保留。')
    for name in ('docs/README.md','docs/DELIVERY.md'): prepend(ROOT/name,paragraph)
    prepend(ROOT/'docs/quality/09-implementation-alignment-audit.md',paragraph.replace('(technical/','(../technical/').replace('(quality/','('))
    prepend(ROOT/'docs/quality/02-requirements-traceability.md','阶段 61 对 REQ-004、025–028 的模拟连接子流程增加实际证据，并补强分析来源、权限与 Admin 控制；[绑定当前源码的回执](marketing-connector-checkpoint.json)保留失败记录、原始需求和完整 TC。局部验证不能关闭正式供应商、完整角色或综合系统验收。')
    prepend(ROOT/'docs/technical/30-native-window-and-browser-sidepanel.md',f'阶段 61 继续验证新打包客户端的无边框、自绘最小化/最大化/关闭、无 Electron/Alt 菜单及真实 Chrome 右侧原生 Side Panel。营销授权经固定公司网页和原会话回到 Desktop，JSON 经原生保存窗口；侧栏固定打开公司营销工作台。实际原生 **{nc} 项**见[当前回执](../quality/marketing-connector-checkpoint.json)，包位于各端 `release/connectors-61/`，旧包与旧回执未改写。')
    index=ROOT/'docs/README.md';text=index.read_text(encoding='utf-8')
    row='| 技术 | [61 营销账户同步](technical/61-marketing-connector-synchronization.md) | 授权账户/项目、持久分页、快照来源与后台撤销 |\n'
    if row not in text:
        lines=text.splitlines(keepends=True); i=next(i for i,l in enumerate(lines) if '| 技术 | [60 ' in l); lines.insert(i,row); text=''.join(lines)
    index.write_text(text,encoding='utf-8',newline='\n')
    document=f'''# 营销账户授权与持久同步

阶段 61：已验证明确标记的模拟供应商协议和三端/后台子流程；关联 REQ-004、025–028、023–024、048、090–091。完整原始 TC、实际供应商资格和完整业务/专业角色验收继续保留。

## 本轮修复的问题

旧连接页让用户输入账户 ID，服务端执行一次查询并保存原始 JSON；没有授权目录、完整账户/项目绑定、持久分页、失败恢复和来源口径，不能证明完整同步。新流程为「选择供应商 → 明确标记的模拟 OAuth → 发现获准账户/属性/站点 → 确认账户及项目 → 冻结日期/查询 → 持久同步 → 检查事实与限制 → 下载或关联分析」。旧任意账户授权/报表写入口返回 410，不再对任意 ID 发起供应商请求。

公开 Provider 为 `google_ads`、`meta_ads`、`ga4`、`search_console`；历史内部 `meta` 仅映射兼容。原规范 225 操作及严格 Connection/Sync/Snapshot/AdminOperation 响应保持；[19 操作、24 类型的补充契约](../contracts/marketing-connector-openapi.json)涵盖发现、目录/历史分页、详情、取消/重试、快照和后台治理。

## 授权与范围

一次性 OAuth state 绑定发起人、原会话和 auth_version、企业、归属项目、供应商、固定公司回调、配置摘要及 Google S256 PKCE。回调和每次外部读取前后重验当前权限；Google 校验实际 scope，Meta 读取 permissions。凭证、state 与分页游标加密存储，不进入用户/Admin 正文或原始响应日志。Desktop 只让主窗口通过受控 IPC 打开固定公司 `/connect-provider` 页面，提供一次性不透明 state，不把任意 URL 或供应商 token 交给 renderer。

Google Ads 发现直接账户及经理→客户路径，保留 login-customer-id；经理自身不可选为报告账户。Meta 只使用广告读取权限。GA4 保存属性币种、时区及 reporting identity 的来源；GSC 区分域名/URL-prefix 和 permissionLevel。账户必须从已发现可读目录选择，绑定需当前项目管理权限，归属项目包含在选定范围内；CAS 版本防止覆盖他人的改动。重新发现递增授权版本并清除旧绑定，变更或失效的权限阻止旧作业继续请求及迟到发布。

用户目录按 20 条 SQL 有界读取，项目关系在查询中授权；同步历史按 created_at/id 翻页，不用不受限列表或仅前端截断冒充完整目录。旧连接只补 `legacy-unverified` 目录配置，仍须重新授权和发现；不从旧任意账户参数推导新权限。

## 持久同步与事实

独立队列总并发 2、每企业 1、每连接仅一项活动作业。冻结账户/经理路径、日期、维度、指标、API 版本、时区、绑定/授权修订和查询摘要；租约 90 秒及 CAS 检查防止迟到写入。网络不占用长事务，每次提交一个页面的不可变资产和检查点。重启可重新读取同一只读页；页身份和 revision 防止重复发布。

Google Ads 用 Search nextPageToken；Meta 只读取 after 并重建固定官方主机 URL；GA4 分别查询流量/事件 grain，使用 offset/rowCount；GSC 用 startRow/rowLimit/final/web/byPage。禁止客户端注入 host、GAQL、token 或任意供应商 next URL；官方 HTTPS 主机、版本和返回结构均严格校验。缺失必需响应数组/字段不能被当成正常空数据。

上限：20 账户/项目、500 个目录项、250 页、100000 条事实、50 MB 原始页、5 次重试和 6 小时作业期限。429/Retry-After 和临时失败记录下一次可执行时间，失效凭证要求重授权。超过上限、循环游标、行数变化和后续页失败保留 partial/failed；不能伪装 complete。取消停止后续请求，显式重试新建 retry_of 作业，旧记录保持不可变。

金额/指标使用精确十进制字符串；未知保持 null。Meta 只取明确 purchase action，不叠加重叠子类；GA4 流量和事件不混加用户数；GSC 平均位置与点击等各有定义，分页完成不等于全部搜索明细。保存账户币种、时区、reporting identity、归因/转化定义、阈值/抽样/损失/稀疏日期/覆盖限制。供应商没有提取截止时间时 data_as_of=null，抓取时间独立显示，不能拿同步时间充当数据新鲜度。

脱敏原始页、查询规格、事实 JSON、实际 CSV 和源 SHA 进入资产治理；Google/Meta 生成的规范化 CSV 是独立真实资产，和快照保持不可变关系。分析数据集、报告、分享及下载按该来源检查当前隔离、保留期和实际删除状态；源删除清除派生正文/实际对象，保留不含正文的凭证。撤销阻止未来调用、清除凭证并取消活动作业；已发布历史快照仍按原项目的内容权限与保留期管理。

## Web、Admin 与原生端

Web 提供完整授权、目录/项目选择、日期规格、逐页记录、限流提示、取消/重试、历史、宽屏/窄屏事实检查及 JSON/CSV 下载；页面明确显示模拟、未知截止时间和指标限制。Admin 元数据按企业/项目授权，凭证不返回；正文权限和撤销权限独立，撤销要求新鲜 MFA、幂等键和持久 AdminOperation 202。只读管理员没有正文/撤销控件，API 同样检查权限。

| 管理动作 | 当前权限与附加条件 |
| --- | --- |
| 连接目录、范围及最近同步元数据 | `admin.connections.read`，仅当前获准企业/项目；显式 deny 生效 |
| 从内容面板查看快照源正文 | `admin.content.body.read`，另经内容对象当前范围与治理检查 |
| 撤销连接、停止未完成作业 | `admin.connections.revoke`、近期 MFA、原因及幂等键；返回持久操作与审计 |

目录权限不授予正文、撤销、用户会话或供应商凭证。权限在请求与异步处理期间重查，不只隐藏页面按钮。

Desktop 保持无边框、自绘拖动及窗口控制、无默认 Electron/Alt 菜单；通过原会话浏览器授权、受控 API 桥和原生保存窗口执行同一流程。Extension 工具栏开关真正 Chrome Side Panel，默认右侧并尊重浏览器设置；「营销账户与同步」固定打开公司工作台。实际 Chrome 验证侧栏上下文、主页面宽度变化、不产生 popup/额外工作台页，以及再次点击关闭。

模拟供应商只在非生产回环开发模式启用，执行真实 HTTP/PKCE/分页与故障路径；明确标记合成数据。模拟授权页的 CSP 只允许固定公司 API 回调与 Web 返回地址。所有实际 AI 请求仍只经公司内部 OpenAI 兼容服务与 Codex，本同步不调用 AI。

## 数据升级与当前证据

SQL072–077 在首次成功应用后保持不可变：队列和范围表、独立 CSV 来源、公开资产来源限制、旧连接只读目录、definer 的 RLS 上下文以及隐藏源的数据集限制分别向前追加。两库 071→077 保留原 157 张公共表全部行摘要及 SQL001–071；七张新增表强制 RLS，普通应用只有允许的读取，队列角色没有连接表权限，控制角色不绕过 RLS。

中断恢复测试还修复了原生数据库启动控制：启动期关闭请求经显式控制握手保留，等恢复安全完成后使用 PostgreSQL 自身的检查点关闭；测试等待数据库实际 ready 日志。两项实际「刚启动/已就绪」关闭检查均通过。失败/中断回执、源文件预像与未采纳候选包全部保留，不能改写为通过。

专项 **{n}/{n}** 纳入完整平台 **{m}/{m}**，保留原全部 638 项命名测试；实际 Web/Admin **{uc} 项**、新打包原生端 **{nc} 项**通过。当前验证绑定实际源码、原始输出、28 个真实 HTTP 响应样本、截图、原生运行程序和包摘要，详见[核查回执](../quality/marketing-connector-checkpoint.json)与[当前包清单](../quality/marketing-connector-artifacts.json)。当前包在各端 `release/connectors-61/`；实际执行 unpacked，未签名且没有安装、商店或生产资格。

![实际 Web 指标与来源限制](../design/implementation/connectors-61/marketing-connectors-{a.ui}-ga4-facts-en.png)

![实际后台连接范围](../design/implementation/connectors-61/marketing-connectors-{a.ui}-connection-detail-en.png)

![实际无边框 Desktop](../design/implementation/connectors-61/connector-native-{a.native}-facts-en.png)

![实际 Chrome 原生 Side Panel](../design/implementation/connectors-61/connector-native-{a.native}-sidepanel-en.png)

## 本轮核对的官方资料

- [Google Ads Search 与 SearchStream](https://developers.google.com/google-ads/api/rest/common/search)、[获准账户目录](https://developers.google.com/google-ads/api/docs/account-management/listing-accounts)。
- [GA4 分页报告](https://developers.google.com/analytics/devguides/reporting/data/v1/basics)、[响应元数据](https://developers.google.com/analytics/devguides/reporting/data/v1/rest/v1beta/ResponseMetaData)、[属性报告身份](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1alpha/properties/getReportingIdentitySettings)、[属性目录](https://developers.google.com/analytics/devguides/config/admin/v1/rest/v1beta/accountSummaries/list)。
- [GSC 查询](https://developers.google.com/webmaster-tools/v1/searchanalytics/query)、[站点目录](https://developers.google.com/webmaster-tools/v1/sites/list)：保留返回限制，禁止承诺全量覆盖。
- Meta 官方文档本轮 429；采用可读的 [Meta 官方 SDK 账户定义](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adaccount.py)和 [Insights 定义](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py)核对。正式应用资格和实际字段仍须独立验证。
'''
    (ROOT/'docs/technical/61-marketing-connector-synchronization.md').write_text(document,encoding='utf-8',newline='\n')
    print('Published scoped marketing connector design and current delivery links; original cases retained.')


if __name__=='__main__': main()
