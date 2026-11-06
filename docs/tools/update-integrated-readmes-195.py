"""Update bilingual standalone documentation with actual source-bound media."""
from pathlib import Path
import json,re
ROOT=Path(__file__).resolve().parents[2];DEV=ROOT/'dev'
REPORT='https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-195/README.md'
entries={
 'platform':('0.5.2','后台与运行内核 / Backend and runtime','任务成果与受权预览、真实运行就绪、不可重写角色验收、Linux Office和私人附件协议。','Authorized task workspaces, actual readiness, append-only role evidence, Linux Office and private attachment delegation.'),
 'web':('0.5.1','云端工作台 / Cloud workspace','会话内选择/拖入/贴图/@固定版本，集中查看成果、文件、活动与实际费用，明确交办/笔记语义。','Select/drop/paste/@ pinned files in conversations and review results, files, activity and usage together. Delegation and notes remain distinct.'),
 'admin':('0.5.1','运营管理台 / Admin dashboard','真实接入就绪状态及人工角色验收，支持新增、分页筛选、批量撤回和原始审计。','Actual integration readiness and human role evidence with creation, filtering, paging, batch revocation and retained audit.'),
 'desktop':('0.7.5','本机客户端 / Local desktop','本机Codex、原生完整权限、文件选择/拖入及获准图片副本；无边框、无Electron菜单，保留滚动并隐藏滚动条。','Local Codex with native full access, local file selection/drop and approved image copies; frameless, no Electron menu, scrollable content and hidden rails.'),
 'extension':('0.5.5','原生右侧栏 / Native Side Panel','工具栏打开原生右侧栏，会话/附件结构获取获准文件与粘贴图片并上传，Codex在云端执行。','The toolbar opens the native right Side Panel. Approved files and pasted images upload as conversation attachments to cloud Codex.'),
 'delivery':('0.5.1','交付与实机证据 / Delivery and real-device evidence','先整批代码后统一构建/测试/调试，提供不可变候选包、真实旅程/录制、下载散列、备份及自动回滚。','Implementation-first integrated builds/testing/debugging, immutable candidates, actual journeys/recordings, download hashes, backups and automatic rollback.'),
}
media={'web':('195-v5-workspace.png','workmate-195-v5-workspace.gif'),'admin':('195-v6-readiness.png','workmate-195-v6-readiness.gif'),'desktop':('195-local-workspace.png','workmate-195-v1-local-workspace.gif'),'extension':('195-v4-side-panel.png','workmate-195-v4-side-panel.gif')}
flow='''```mermaid
flowchart LR
 A[Visit / 訪問] --> B[Email sign-in / 郵箱登入]
 B --> C[Workspace / 企業與專案]
 C --> D[Role, files, budget / 角色、檔案、預算]
 D --> E{Client / 客戶端}
 E -->|Web or Extension| F[Cloud Codex / 雲端]
 E -->|Desktop native permission| G[Local Codex / 本機]
 F --> H[Results, revisions, usage / 成果、修改、費用]
 G --> H
```
'''
boundary='本輪實際測試與旅程見報告；保留歷史失敗，不以代碼量替代全部專業/生產驗收。影片/語音/Google/Meta真實配置、至少12角色專業驗收及完整兼容/運營矩陣仍開放。測試郵箱及未簽名安裝按已確認範圍保留。\n\nSelected regression and real journeys are in the report. Historical failures remain. Real video/audio/Google/Meta configuration, at least12 professional role evaluations and the full compatibility/operations matrix remain open. The requested test mailbox and unsigned manual installation remain.\n\n'
for name,(version,title,zh,en) in entries.items():
 base=DEV/('copypaste-'+name);images=''
 if name in media:
  png,gif=media[name]
  for item in [png,gif]:assert (base/'assets/screenshots'/item).is_file(),item
  images=f'![Actual interface / 實際介面](assets/screenshots/{png})\n\n![Actual interaction / 實際交互](assets/screenshots/{gif})\n\n'
 for english in [False,True]:
  p=base/('README.en.md' if english else 'README.md');old=p.read_text(encoding='utf-8')
  old=re.sub(r'(?ms)^## 195 · .*?(?=^## |\Z)','',old,count=1)
  header=f'<!-- integrated-round-195 -->\n\n## 195 · {version} · {title}\n\n'+(en if english else zh)+'\n\n'
  header+=f'[Round delivery / 本輪交付]({REPORT}) · [Download / 下載](https://agent.copypaste.hk/downloads)\n\n'+images
  if name in ['platform','web','desktop','extension']:header+=flow+'\n'
  if name=='admin':header+='`/readiness`: actual dependencies / 真實依賴。`/role-acceptance`: record, filter, batch revoke, audit / 新增、篩選、批次撤回、審計。API/key and rates remain per model in capability management / 接口、密鑰和費率仍跟隨各模型。\n\n'
  if name=='platform':header+='`GET .../tasks/:task/workspace` · `GET .../workspace/preview?asset_version_id=...` · `GET /v1/admin/operational-readiness` · `GET/POST /v1/admin/role-acceptance` · `POST /v1/admin/role-acceptance/revoke`. Schema163 is additive; owner migrations and non-root runtime remain separate.\n\n'
  p.write_text(header+boundary+old,encoding='utf-8')
for english in [False,True]:
 p=ROOT/'docs'/('README.en.md' if english else 'README.md');old=p.read_text(encoding='utf-8')
 text=('Round195 ships unified private inputs/results, Admin readiness/role evidence, native Linux Office and improved client inputs. External, professional and production acceptance remains scoped.' if english else '195輪已整批補齊統一私人輸入/成果、後台就緒/角色驗收、Linux Office及客戶端輸入，統一回歸與實機證據見報告；完整外部、專業及生產驗收仍開放。')
 p.write_text('<!-- integrated-round-195 -->\n\n'+text+'\n\n[Delivery / 交付](quality/integrated-round-195/README.md) · [102 requirements / 102條追溯](quality/integrated-round-195/requirements-102.md) · [Changes / 更新](changes/195-integrated-workspaces.md)\n\n'+old,encoding='utf-8')
(ROOT/'docs/changes/195-integrated-workspaces.md').write_text('''# 195 · 统一输入、成果、运营与角色验收

整批完成代码后统一验证、汇总修复再复验。Web私人附件选择/拖入/贴图/@固定版本，后端原子验证并交办；集中查看成果/文件/活动/费用。Desktop保留真实本机Codex、完整原生权限和无边框；Extension保留原生右侧栏并增强输入。

Admin新增运行就绪视图与不可重写、可批量撤回的角色验收台账。Linux原生Word/Excel/PPTX预览上线，修复Office上传MIME和会话附件协议。API/key仍跟随各模型；最高管理员直执行、其余按策略审批并保留审计的规则保持。

Desktop0.7.5、Extension0.5.5发布至下载页；Web/Admin/Delivery0.5.1、Backend0.5.2/schema163。原失败、受保护用户文件、旧下载和回滚目录保留。配置及凭证备份仅在服务器/root/cfg/workmate/，不进入Git。全产品专业/外部/生产验收不自动升级。

[实际验证与限制](../quality/integrated-round-195/README.md) · [需求](../requirements/195-integrated-development-round.md) · [方案](../development/195-integrated-workspaces-and-acceptance.md)

English: Ships private input/result workspaces, Admin readiness and immutable role evidence, native Linux Office and improved client inputs after an implementation-first integrated validation round. Preserve original failures and private configuration; professional/external/production acceptance remains scoped.
''',encoding='utf-8')
print(json.dumps({'status':'documentation_updated','standalone_readmes':12,'media_repositories':4}))
