"""Add current public deployment instructions without rewriting historical evidence."""
from pathlib import Path
import shutil
ROOT=Path(__file__).resolve().parents[2]
guide='https://github.com/copypasteltd/workmate/blob/docs/docs/releases/domains-177.md'
items={
 'platform':('后端使用独立域名配置和 Secure Cookie；保留权限、CSRF、MFA、用量及审计。','Backend origins and Secure cookies are updated; scoped authorization, CSRF, MFA, usage and audits remain enforced.'),
 'web':('用户端经同源 /v1 代理；邮箱验证码 → 创建工作区及项目 → 模拟额度 → 角色任务 → 交付与下载。','Same-origin /v1 proxy: email code → workspace/project → simulated credit → specialist task → delivery/download.'),
 'admin':('后台独立邮箱验证码及 TOTP 登录；管理用户、用量、费用、VIP/权益、内容、审批与审计。','Independent email OTP and TOTP: manage users, usage, charges, VIP/entitlements, content, approvals and audits.'),
 'desktop':('Desktop 0.7.2 在本机运行固定 Codex；浏览器 PKCE 授权后返回无边框窗口，本机权限由用户主动授予，滚动条隐藏。','Desktop 0.7.2 runs pinned Codex locally. Browser PKCE returns to its frameless workspace; local permission is explicit and scroll rails stay hidden.'),
 'extension':('Extension 0.5.3 点击工具栏打开原生右侧 Side Panel；浏览器授权后主动选文件上传，由云端 Codex 执行。','Extension 0.5.3 opens a native right Side Panel from the toolbar. Browser authorization and approved file uploads feed cloud Codex work.'),
 'delivery':('新版本增量部署、下载、双语手册和真实交互记录；旧发行包、标签、凭据及无关服务保留。','Additive deployment, client downloads, bilingual guides and actual recordings preserve frozen releases, credentials and unrelated services.'),
}
for component,(zh,en) in items.items():
 repo=ROOT/'dev'/('copypaste-'+component)
 for english,name in [(False,'README.md'),(True,'README.en.md')]:
  old=(repo/name).read_text(encoding='utf-8');assert '<!-- public-domains-177 -->' not in old
  title,body=old.split('\n',1)
  heading='Public HTTPS deployment · stage177' if english else '正式域名试用部署 · 阶段177'
  note=en if english else zh+'\n\n'+en
  intro=f'''\n\n<!-- public-domains-177 -->
## {heading}

[Web](https://agent.copypaste.hk) · [Admin](https://agent-dashboard.copypaste.hk) · [API readiness](https://ai-api.copypaste.hk/health/ready)

{note}

[Current deployment, login and operations / 当前部署、登录与运维]({guide})

Credentials are unchanged: server `/root/cfg/workmate/credentials.txt`, root `0600`. Admin: `admin@workmate.local` + email OTP + TOTP. Test mailbox: [protected operator inbox](https://agent-dashboard.copypaste.hk/ops/mailbox/). AI/media/ads/payment remain synthetic; records/files persist. 凭据保留，测试收件箱使用独立操作口令，外部服务仍为假数据。

[Desktop 0.7.2 Setup](https://agent.copypaste.hk/downloads/CopyPaste-0.7.2-x64-Setup.exe) · [Portable](https://agent.copypaste.hk/downloads/CopyPaste-0.7.2-x64-Portable.exe) · [Extension 0.5.3 ZIP](https://agent.copypaste.hk/downloads/CopyPaste-Extension-0.5.3.zip) · [Source increment / 源码增量](https://agent.copypaste.hk/downloads/workmate-domains-177.zip)

Windows installers are unsigned. Extract the Extension ZIP and load it unpacked in Chrome developer mode; the extension ID stays `fffkcnmfdhahlnifgdilabheppkgnlok`. Desktop AI access uses company services; supplier keys are not embedded. Windows 未签名，扩展采用已解压加载，固定 ID 不变。

```mermaid
flowchart LR
 W[Web HTTPS] --> P[Same-origin API proxy]
 A[Admin HTTPS and MFA] --> P
 N[Desktop / Extension] --> I[Company API HTTPS]
 P --> B[Isolated backend and database]
 I --> B
 N --> L[Local Codex / approved file upload]
```

'''
  if component=='web':intro+='![Public HTTPS task](assets/screenshots/177b-domain-task-result.png)\n\n![Actual HTTPS interaction](assets/demos/177-public-domains.gif)\n\n[MP4 recording](assets/demos/177-public-domains.mp4)\n\n'
  elif component=='admin':intro+='![Public Admin users](assets/screenshots/177b-domain-users.png)\n\n![Actual Admin interaction](assets/demos/177-public-domains.gif)\n\n[MP4 recording](assets/demos/177-public-domains.mp4)\n\n'
  elif component=='desktop':intro+='![Packaged Desktop sign-in](assets/screenshots/177-domain-signin.png)\n\n[Actual public Web and Admin recordings]('+guide+'#实际页面与核查--actual-pages-and-validation)\n\n'
  elif component=='extension':intro+='![Actual native Side Panel](assets/screenshots/177-domain-sidepanel.png)\n\n[Actual public Web and Admin recordings]('+guide+'#实际页面与核查--actual-pages-and-validation)\n\n'
  else:intro+='[Actual public Web task](https://github.com/copypasteltd/workmate/blob/web/assets/screenshots/177b-domain-task-result.png) · [Actual interaction GIF](https://github.com/copypasteltd/workmate/blob/web/assets/demos/177-public-domains.gif)\n\n'
  intro+='---\n\nEarlier releases and deployment history / 以下为历史版本及部署记录。\n'
  (repo/name).write_text(title+intro+body,encoding='utf-8',newline='\n')
for name in ['README.md','README.en.md']:
 p=ROOT/'docs'/name
 prefix='''<!-- public-domains-177 -->
## 正式域名已上线 / Public HTTPS deployment

[Web](https://agent.copypaste.hk) · [Admin](https://agent-dashboard.copypaste.hk) · [API](https://ai-api.copypaste.hk/health/ready)

[使用与运维 / Usage and operations](releases/domains-177.md) · [需求 / Requirements](requirements/33-public-domains.md) · [开发 / Implementation](development/177-public-domains.md) · [变更 / Changes](changes/177-public-domains.md) · [核查 / Evidence](quality/public-domains-177.json)

Desktop 0.7.2 / Extension 0.5.3 固定正式端点；现有凭据保留，外部服务继续使用假数据。Native clients use public endpoints; existing credentials and synthetic-provider mode are retained. 以下为历史部署与发行记录 / Earlier deployments and releases follow.

---

'''
 old=p.read_text(encoding='utf-8');assert '<!-- public-domains-177 -->' not in old;p.write_text(prefix+old,encoding='utf-8',newline='\n')
assets=ROOT/'docs/assets/domains-177';assets.mkdir()
for src,name in [('web/assets/screenshots/177b-domain-task-result.png','web-task.png'),('admin/assets/screenshots/177b-domain-users.png','admin-users.png'),('web/assets/demos/177-public-domains.gif','web.gif'),('admin/assets/demos/177-public-domains.gif','admin.gif')]:shutil.copyfile(ROOT/'dev'/('copypaste-'+src),assets/name)
p=ROOT/'docs/releases/domains-177.md'
p.write_text(p.read_text(encoding='utf-8')+'''
## 实际页面与核查 / Actual pages and validation

13 项正式域名浏览器流程、4 项真实打包/原生面板检查及桌面浏览器 PKCE 授权通过；6 项 Cookie/配置检查与20项并发/传输检查通过。记录使用实际 Codex 与明确模拟供应商，录像仅包含登录后页面。自建浏览器、原生窗口和页面均关闭。

Public-domain browser journeys, real packaged/native surface checks and Desktop browser PKCE authorization passed. Cookie/config and transport/concurrency checks also passed. Actual Codex uses explicit synthetic providers; recordings exclude OTP/TOTP entry. Owned windows and browser contexts are closed.

![Web task](../assets/domains-177/web-task.png)

![Admin users](../assets/domains-177/admin-users.png)

![Actual Web interaction](../assets/domains-177/web.gif)

![Actual Admin interaction](../assets/domains-177/admin.gif)
''',encoding='utf-8',newline='\n')
print('Updated six bilingual repository guides, documentation index and current actual media.')
