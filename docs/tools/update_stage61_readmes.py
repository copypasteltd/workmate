"""Publish bilingual instructions and actual connector screenshots in six repos."""
import argparse
import shutil
from refresh_stage52_capabilities import ROOT, DEV, DELIVERY, read, git

BASES={'platform':'c864ead','web':'0623fba','admin':'8a119d5','desktop':'09f5efb','extension':'a641c29','delivery':'70a1515'}


def main():
    p=argparse.ArgumentParser()
    for n in ('core','full','ui','native','clients','upgrade'): p.add_argument('--'+n,required=True)
    a=p.parse_args()
    paths={n:DELIVERY/f'evidence/marketing-connector{suffix}-{getattr(a,n)}.json' for n,suffix in [('core','s-core'),('full','s-regression'),('ui','-ui'),('native','-native'),('clients','-clients'),('upgrade','-upgrade')]}
    runs={n:read(path) for n,path in paths.items()}
    assert all(r['status']=='passed' for r in runs.values())
    n,m,uc,nc=runs['core']['counts']['pass'],runs['full']['counts']['pass'],runs['ui']['counts']['checks'],runs['native']['counts']['checks']
    suites=', '.join(f"{x['repository']} {x['counts']['pass']}" for x in runs['clients']['checks'] if x['check']=='test')
    zh=f'''## 营销账户同步与三端入口（阶段 61）

「连接应用」支持 Google Ads、Meta Ads、Google Analytics 4 和 Search Console。点击供应商、完成明确标识的模拟授权，等待账户/属性/站点发现完成后，选择获准账户及可使用快照的项目。确认范围、选择日期，再明确创建快照。页面显示持久分页、错误、限流后的下一次重试时间和不可变历史；排队/执行中可取消，失败重试创建新的关联作业。

当前按用户要求使用假数据：供应商夹具仅在非生产回环开发模式启用，执行实际 HTTP、OAuth state、Google S256 PKCE 和分页；界面、快照与来源均标记模拟。它没有取得真实广告或网站账户。配置正式接入前，须单独核对供应商应用资格、实际账户权限、版本和报表口径。所有 AI 调用仍经公司内部 OpenAI 兼容服务，Agent 内核仅 Codex。

账户只能选自授权目录；Google 经理账户、GA4 reporting identity/时区、GSC 站点权限与 Meta 广告读取范围保留。快照分别记录抓取时间、日期/粒度、账户币种、查询摘要和覆盖限制；未提供的数据截止时间或指标保持未知。Meta 重叠购买类型不相加，GA4 流量与事件保持独立粒度，GSC 分页完成不表示覆盖所有明细。查看事实或下载真正的 JSON/CSV；Google/Meta 的规范化分析数据集保持到不可变源资产的关联。

普通账户目录和历史使用有界分页，选择范围采用版本检查。撤销清除凭证、取消未完成作业并阻止迟到发布，已发布快照继续受原项目权限、保留期和内容治理控制。Admin 可按授权企业/项目查看连接与同步元数据；正文读取与撤销独立授权，撤销要求新鲜 MFA 并返回可审计的持久操作，不暴露 token。源隔离/过期/删除同步限制分析、下载和分享；物理删除保留不含正文的历史凭证。

Desktop 使用**无边框、自绘拖动区和最小化/最大化/关闭按钮**，无系统边框、Electron 默认菜单或 Alt 菜单。供应商授权只经固定公司网页在浏览器完成，再回到本地工作台；受保护 JSON 通过当前会话桥接与原生保存窗口下载。Extension 点击工具栏打开/收起 **Chrome 原生 Side Panel**，默认右侧并遵循 Chrome 用户偏好；侧栏的「营销账户与同步」仅打开固定公司工作台，不接受任意外部网址。

验证：专项 **{n}/{n}** 纳入完整平台 **{m}/{m}**，保留原全部 638 项命名测试；实际 Web/Admin **{uc} 项**、新打包原生端 **{nc} 项**通过。独立测试：{suites}。两库原生 SQL071→077 保留 157 张原公共表的全部行摘要及 SQL001–071；七张新增表强制 RLS，旧连接只补目录，不补账户/项目权限或业务历史。

当前预览：Desktop `release/connectors-61/`，Extension `release/connectors-61/CopyPaste-0.5.0-sidepanel.zip`。实际执行了 unpacked 程序；Setup/Portable 未签名且未执行安装验收，仍使用 localhost 配置。原始 102 项及 TC/NFR/G01–G10、完整专业角色和生产验收条件全部保留。下方较早阶段的回执与截图保留原执行范围。
'''
    en=f'''## Marketing accounts and native clients (stage 61)

Connections supports Google Ads, Meta Ads, Google Analytics 4 and Search Console. Select a provider, complete the clearly labelled synthetic consent, wait for account/property/site discovery, then confirm discovered accounts and the projects allowed to use snapshots. Select dates and explicitly create a snapshot. The workbench shows durable pages, errors, rate-limit retry time and immutable history. Queued/running jobs can be cancelled; an explicit retry creates a new linked job.

As requested, business data remains synthetic. The supplier fixture runs only in non-production loopback development mode, using actual HTTP, one-use OAuth state, Google S256 PKCE and pagination. UI, facts and snapshots identify this mode; no real marketing account was accessed. Live application approval, actual account permissions, versions and reporting definitions require separate verification. AI requests continue through the company's OpenAI-compatible server, with Codex as the only agent kernel.

Only discovered authorized accounts can be bound. Google manager paths, GA4 reporting identity/timezone, GSC site permissions and Meta ad-read scope are retained. Snapshots distinguish capture time, source dates/grains, currencies, query digests and coverage limits. Missing cutoff times and metrics remain unknown. Overlapping Meta purchase types are not summed, GA4 traffic/event grains remain separate, and GSC pagination does not claim exhaustive detail. Inspect facts or download actual JSON/CSV. Normalized Google/Meta datasets retain immutable source-asset lineage.

Connection and history directories use bounded pagination; scope changes check their expected version. Revocation clears credentials, cancels unfinished work and fences late publication. Existing snapshots retain original project permissions, retention and content governance. Admin metadata is scoped by tenant/project. Body reading and fresh-MFA revocation are separate permissions; revocation returns a durable audited operation without revealing tokens. Source quarantine, expiry and physical deletion constrain derived analysis, downloads and shares while retaining content-free historical receipts.

Desktop is **frameless**, with a custom drag region and minimize/maximize/close controls, no native frame, Electron application menu or Alt menu. Provider authorization opens only a fixed company page in the browser and returns to the native workspace. Protected JSON passes through the current authenticated bridge into the native save dialog. The extension toolbar toggles **Chrome's native Side Panel**, right by default and subject to the user's Chrome preference. Its Marketing accounts & sync entry opens only the fixed company workspace.

Validation: **{n}/{n} focused checks within {m}/{m} Platform tests**, retaining all 638 prior named tests; **{uc} actual Web/Admin checks and {nc} newly packaged native checks** passed. Independent suites: {suites}. Both native databases upgraded SQL071→077 while retaining every row digest in 157 prior public tables and SQL001–071. Seven new tables force RLS; legacy connections receive directory-only profiles without invented account/project grants or business history.

Current localhost previews: Desktop `release/connectors-61/`, Extension `release/connectors-61/CopyPaste-0.5.0-sidepanel.zip`. The unpacked executable was run. Setup/Portable remain unsigned and were not installed by these checks. All original 102 requirements and complete TC/NFR/G01–G10, professional-role and production acceptance remain tracked. Earlier receipts and screenshots below retain their original execution scope.
'''
    diagram='''```mermaid
flowchart LR
  Client[Web / frameless Desktop] --> Consent[Fixed company launch / supplier consent]
  Consent --> Directory[Discovered authorized accounts]
  Directory --> Scope[Confirm account and project scope]
  Scope --> Queue[Freeze query / durable bounded pages]
  Queue --> Recover[Cancel / bounded retry / immutable history]
  Queue --> Snapshot[Immutable facts / cutoff / metric limits]
  Snapshot --> Export[Actual JSON / CSV / normalized source lineage]
  Panel[Chrome native Side Panel] --> Client
  Admin[Scoped Admin / separate body and revoke rights] --> Queue
  Admin --> Governance[Quarantine / expiry / physical erasure]
  Governance --> Export
```'''
    gallery={
        'web':[(f'marketing-connectors-{a.ui}-ga4-facts-en.png','Actual Web facts and metric limits'),(f'marketing-connectors-{a.ui}-workspace-zh-dark.png','Traditional Chinese dark marketing workbench')],
        'admin':[(f'marketing-connectors-{a.ui}-connection-detail-en.png','Actual scoped Admin connection metadata'),(f'marketing-connectors-{a.ui}-connection-zh-narrow.png','Traditional Chinese narrow Admin metadata')],
        'desktop':[(f'connector-native-{a.native}-facts-en.png','Actual packaged frameless Desktop'),(f'connector-native-{a.native}-facts-zh-dark.png','Actual Traditional Chinese dark Desktop')],
        'extension':[(f'connector-native-{a.native}-sidepanel-en.png','Actual Chrome native right Side Panel'),(f'connector-native-{a.native}-marketing-facts-en.png','Marketing workspace opened from the native Side Panel')],
    }
    for repo in ('platform','delivery'):
        folder=DEV/('copypaste-'+repo)/'assets/screenshots';folder.mkdir(parents=True,exist_ok=True)
        image=gallery['web'][0][0];shutil.copyfile(DEV/'copypaste-web/assets/screenshots'/image,folder/image)
        gallery[repo]=[(image,'Actual Web consumer of the connector API')]
    images=ROOT/'docs/design/implementation/connectors-61';images.mkdir(parents=True,exist_ok=True)
    for repo,entries in gallery.items():
        for image,_ in entries:
            shutil.copyfile(DEV/('copypaste-'+repo)/'assets/screenshots'/image,images/image)
    for repo,commit in BASES.items():
        directory=DEV/('copypaste-'+repo)
        for filename,copy in (('README.md',zh),('README.en.md',en)):
            base=git(directory,'show',commit+':'+filename).decode().replace('\r\n','\n');title,body=base.split('\n\n',1)
            extra='\n\n'+diagram
            if repo=='delivery':
                extra+='\n\n'+f'[Full regression](evidence/marketing-connectors-regression-{a.full}.json) · [Actual Web/Admin](evidence/marketing-connector-ui-{a.ui}.json) · [Actual native clients](evidence/marketing-connector-native-{a.native}.json) · [Database preservation](evidence/marketing-connector-migrations-{a.upgrade}.json) · [Current artifacts](evidence/marketing-connector-artifacts.json)'
            extra+='\n\n'+'\n\n'.join(f'![{label}](assets/screenshots/{image})' for image,label in gallery[repo])
            result=title+'\n\n'+copy.strip()+extra+'\n\n'+body;target=directory/filename
            assert target.read_text(encoding='utf-8').replace('\r\n','\n') in (base,result),'Unexpected README edits: '+str(target)
            target.write_text(result,encoding='utf-8',newline='\n')
    print('Updated six bilingual repositories with actual connector screenshots, flow and scoped evidence.')


if __name__=='__main__': main()
