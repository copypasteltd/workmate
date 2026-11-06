"""Show each unchanged execution model in its own current delivery diagram."""
from pathlib import Path
import re,json
ROOT=Path(__file__).resolve().parents[2]
flows={
'admin':'''flowchart LR
 A[Admin email and TOTP / 管理員登入] --> B[Current role and scope / 目前角色範圍]
 B --> C[Users, VIP, funds and content / 用戶與權益內容]
 B --> D[Per-model API URL, key and rates / 模型上游配置]
 C --> E[Policy approval or direct execution / 策略審批或直接執行]
 D --> E
 E --> F[Complete audit / 完整審計]''',
'desktop':'''flowchart LR
 A[Install and browser PKCE / 安裝與授權] --> B[Local folder and specialist / 本機目錄與專員]
 B --> C[Customer grants access / 客戶授予權限]
 C --> D[Local Codex through company API / 本機Codex與公司接口]
 D --> E[Local execution and files / 本機執行與成果]
 A --> F[Authorized shared design / 有權共用設計]
 F --> G[Direct editing and recovery / 直接編輯與恢復]
 G --> H[Immutable version and delivery / 版本與交付]''',
'extension':'''flowchart LR
 A[Toolbar click / 工具列點擊] --> B[Native right Side Panel / 原生右側欄]
 B --> C[Company PKCE and project / 公司授權與項目]
 C --> D[Explicit files or images / 明確選擇附件]
 D --> E[Private upload / 私人上傳]
 E --> F[Cloud Codex via company API / 公司雲端Codex]
 F --> G[Conversation and results / 會話與成果]''',
'delivery':'''flowchart LR
 A[Complete round code batch / 完成整批代碼] --> B[Build all clients / 全端構建]
 B --> C[Integrated regression and journeys / 統一回歸與聯調]
 C --> D[Retained failures and batch fixes / 保留失敗並整批修正]
 D --> B
 C --> E[Candidate and active work checks / 候選與活動任務核對]
 E --> F[Deploy and publish packages / 部署與發包]
 F --> G[Actual downloads and honest limits / 實際取件與範圍]
 G --> H[Bilingual docs and branch publication / 雙語文檔與分支同步]'''
}
for name,flow in flows.items():
 for filename in ['README.md','README.en.md']:
  p=ROOT/'dev'/('copypaste-'+name)/filename;text=p.read_text('utf-8');current,older=text.split('<!-- integrated-round-198 -->',1)
  assert current.startswith('<!-- integrated-round-199 -->');current,n=re.subn(r'```mermaid\n.*?```','```mermaid\n'+flow+'\n```',current,count=1,flags=re.S);assert n==1
  if name=='desktop':current=current.replace('直接編輯與來源交付接續','本機Codex與設計交付接續').replace('Direct editing and source-to-delivery continuity','Local Codex and design continuity')
  elif name=='extension':current=current.replace('直接編輯與來源交付接續','原生側欄與授權文件上傳').replace('Direct editing and source-to-delivery continuity','Native Side Panel and authorized uploads')
  elif name=='admin':current=current.replace('直接編輯與來源交付接續','模型與用戶管理相容覆核').replace('Direct editing and source-to-delivery continuity','Model/user management compatibility review')
  p.write_text(current+'<!-- integrated-round-198 -->'+older,'utf-8')
print(json.dumps({'status':'refined','component_specific_bilingual_diagrams':8}))
