<!-- integrated-round-200 -->

## 200 · 0.5.9 · 從版面開工到可核對交付

[Delivery and limits / 交付與邊界](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-200/README.md) · [Downloads / 下載](https://agent.copypaste.hk/downloads)

1. 登入→選企業／項目→設計畫布→展開「從版面開始新作品」→選六款版面之一及中英文字→確認共用後開工；也可繼續原專員發布來源或導入完整工程包。

2. 在「加入／替換圖片與資料圖表」搜尋並選擇共用固定PNG，核對預覽／使用權後加入或替換；分析源先在檔案中明確發布，再選同口徑原值，最多八條。私人對話文件不會自動暴露給共用項目。

3. 可加空白頁、沿用原複製／排序／刪除、直接畫布編輯及撤銷重做。整份畫布256–1920px適配全部頁面，字形／描邊／圖表最小面積超限時整次拒絕，不留下半修改。保存新版本後產生PNG／SVG／PDF／PPTX及可編輯ZIP，預覽顯示實際已保存版本；重新編輯才顯示未保存。

4. 實際隔離旅程含模擬營銷原值、圖片、四頁／尺寸／撤銷／版本2及真實16MBZIP，模型請求與帳務0；實際已上線Web另完成新工程、版本2、ZIP並接續最終Desktop版本3。淺深色及375／768／1024／1440無頁面橫向溢出。

```mermaid
flowchart LR
 A[Choose layout or published source / 版面或已發布來源] --> B[Confirm shared work / 確認共用工程]
 C[Fixed shared image / 共用圖片固定版本] --> D[Review rights and exact evidence / 核對權限與證據]
 E[Published analysis source / 已發布分析源] --> D
 B --> F[Edit layers and pages / 編輯圖層與頁面]
 D --> F
 F --> G[Adapt all pages atomically / 全頁原子適配]
 G --> H[Actual preview and immutable version / 真實預覽與新版本]
 H --> I[Download editable delivery / 下載可編輯交付]
```

Actual deployed Web200 / 真實已上線Web200

![Actual interface / 實際頁面](assets/screenshots/200-v3-live-production-dark.png)

![Actual interaction / 實際交互](assets/screenshots/workmate-200-v3-live-production.gif)

[Actual recording / 實際錄影](assets/screenshots/workmate-200-v3-live-production.mp4)

下方保留此前版本和完整安裝／使用說明，全部原始驗收範圍仍開放。

<!-- integrated-round-199 -->

## 199 · 0.5.7 · 直接編輯與來源交付接續

[Delivery and limits / 交付與邊界](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-199/README.md) · [Downloads / 下載](https://agent.copypaste.hk/downloads)

1. 登入後選擇企業、項目及專員，在雲端Codex交付後明確將私人源文件發布到項目。從「設計畫布」選取可編輯來源，確認共用後建立工程。

2. 直接選取、拖動、縮放、方向鍵微調（Shift加速）、六向對齊、複製圖層及撤銷重做；文字對齊／行高、圖片適配、形狀描邊／圓角與位置尺寸遵循幾何、品牌與來源約束。未儲存畫面由真正伺服器渲染器產生，不調模型。

3. 草稿只在目前分頁依帳戶／企業／項目／工程有界保留：8小時、2MB、最多8份，退出清理。刷新後明確恢復；伺服器版本改變需確認，復原前重新查權，不靜默覆蓋。先儲存新版本，再產生交付檔案與ZIP。

4. 實際隔離旅程覆蓋拖動／縮放、刷新恢復、併發v3衝突及v4ZIP。真實雲端Codex來源在已上線Web完成v2保存／下載，與Desktop接續；375／768／1024／1440及淺深色有當前證據。修復重選同一企業導致項目列表清空。

```mermaid
flowchart LR
 A[Cloud Codex source / 雲端來源] --> B[Explicit publication / 明確發布]
 B --> C[Shared project / 共用工程]
 C --> D[Direct canvas and draft / 畫布與草稿]
 D --> E[Current authority and actual preview / 授權與真實預覽]
 E --> F[Save immutable version / 儲存新版本]
 F --> G[Download delivery / 下載交付]
 D --> H[Review and recover / 核對並恢復]
 H --> D
```

Current actual deployed Web / 本輪真實Web

![Actual interface / 實際頁面](assets/screenshots/199-v3-live-design-dark.png)

![Actual interaction / 實際交互](assets/screenshots/workmate-199-v3-live-design.gif)

[Actual recording / 實際錄影](assets/screenshots/workmate-199-v3-live-design.mp4)

下方保留此前版本與完整使用／安裝說明。本輪不代表全部原始要求已完成驗收。

<!-- integrated-round-198 -->

## 198 · 0.5.6 · 查找工作与准确返回

[Delivery and limits / 交付與範圍](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-198/README.md) · [Downloads / 下載](https://agent.copypaste.hk/downloads)

1. 登录后选择企业、项目、专业角色及材料，提交云端Codex工作。从侧栏「全部任务」进入完整任务目录，按标题／状态／执行位置／工作模式查找；下一页通过当前权限签名游标读取。
2. 点击任务查看成果、文件、变更、执行、网页、活动和费用；返回保留本账户原筛选和页码。所选标签及仍可用的文件版本按任务恢复，查询文字不会写入浏览器地址栏，凭证及任务正文不放入导航状态。
3. 原会话明确定位指定任务，完整审阅后返回仍是同一任务和标签。通知、成果和会话链接先确认目标企业及项目，权限未确认前不加载目标业务页；手动切换工作区离开旧链接，旧账户迟到请求不能改变新工作。
4. 实际线上验证375／768／1024／1440宽度、浅深色、键盘操作、浏览器前进后退和无效项目提示。下载页已更新到Desktop0.7.10及Extension0.5.7，三个包均完成公开完整下载和SHA-256核对。

```mermaid
flowchart LR
  A[Sign in / 登入] --> B[Organization and project / 企業與項目]
  B --> C[All tasks / 查找工作]
  C --> D[Verify current authority / 當前授權]
  D --> E[Original session and results / 原會話與成果]
  E --> F[Return with context / 保留上下文返回]
```

![Actual interface / 實際頁面](assets/screenshots/198-v6-task-directory-light.png)

![Actual interaction / 實際交互](assets/screenshots/workmate-198-v6-work-directory.gif)

[Actual recording / 實際錄影](assets/screenshots/workmate-198-v6-work-directory.mp4)

![Dark theme / 深色頁面](assets/screenshots/198-v6-task-directory-dark.png)

下方保留早期版本與完整安裝說明。本輪交付不代表全部原始需求已驗收。

<!-- integrated-round-197 -->

## 197 · 0.5.4 · 统一任务审阅

[Delivery and limits / 交付與範圍](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-197/README.md) · [Downloads / 下載](https://agent.copypaste.hk/downloads)

1. 登录后选择企业和项目、专业角色及材料，提交云端 Codex 工作。任务工作台保留成果、文件、变更、执行、网页、活动和费用七个视图。
2. 软件执行检查集中在执行标签内；旧详情页不再重复显示同一面板。文字手工编辑继续产生不可变版本，并保留原请求核对及历史比较。
3. 无请求体的读取连接中断最多重试一次；收到服务响应即交由业务处理。写入结果未知时先查原记录，明确重试原操作，不自动重新派发工作。
4. 实际 HTTPS 页面完成七标签键盘操作、375/768/1024/1440 宽度和暗色审阅检查。下载页包含本轮三个客户端包和实际校验值。Linux 执行耗时使用真实测量或规范起止时间；缺失或非法值不显示为 NaN。

```mermaid
flowchart LR
  A[Sign in / 登入] --> B[Organization and project / 企業與項目]
  B --> C[Role and permission / 角色與授權]
  C --> D[Original task / 原工作]
  D --> E[Review result and usage / 審閱與費用]
  E --> F[Explicit next action / 明確下一步]
```

![Actual interface / 實際頁面](assets/screenshots/197-v5-task-review.png)

![Actual interaction / 實際交互](assets/screenshots/workmate-197-v5-task-review.gif)

[Actual recording / 實際錄影](assets/screenshots/workmate-197-v5-task-review.mp4)

下方保留較早版本記錄。完整外部、專業與生產驗收仍開放。

<!-- integrated-round-196 -->

## 196 · 0.5.2 · 云端成果与编辑

[完整交付與限制 / Delivery and limits](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-196/README.md) · [下載 / Downloads](https://agent.copypaste.hk/downloads)

1. 使用邮箱验证码登录并选择企业/项目。开始新工作时选择专业角色，可查看当前模板交付格式和依赖状态；“使用示例”只填简报，确认预算并提交后才启动工作。
2. 在成功任务中使用成果、文件、变更、执行、网页、活动、费用七个标签，左右键或Home/End可导航。文件标签提供受权预览/下载及符合条件的文字编辑。
3. 打开“查看及编辑文字”，保存会创建新版本并保留原文件，需重新认可新交付；人工编辑不会新建AI任务或模型费用。当前文字限256KiBUTF-8。
4. 若保存响应丢失，内容冻结并显示核对原保存的入口；明确核对会发送同一请求键和正文。不要另开重复保存；退出会清除本分页暂存文字。版本冲突时先核对最新文件。
5. 变更标签选择当前交付和有权限的早期版本，显示文字/格式差异及SHA；执行、网页标签读取真实服务器记录。超限比较提供摘要/下载；全部业务仍受租户、项目和原始来源权限控制。

```mermaid
flowchart LR
 A[Sign in / 登入] --> B[Project, role and budget / 專案角色預算]
 B --> C{Execution / 執行}
 C -->|Web or Extension| D[Company cloud Codex / 公司雲端]
 C -->|Desktop native permission| E[Local Codex / 本機]
 D --> F[Results, files and actual usage / 成果檔案實際費用]
 E --> F
 F --> G[Review and compare / 審閱比較]
 G --> H[Explicit revision / 明確修改]
```

![Actual interface / 實際頁面](assets/screenshots/196-pinned-differences.png)

![Actual interaction / 實際交互](assets/screenshots/workmate-196-v3-workspace-review.gif)

[Actual MP4 / 實際錄影](assets/screenshots/workmate-196-v3-workspace-review.mp4) · [Additional view / 其他頁面](assets/screenshots/196-pending-save.png) · [Additional view / 其他頁面](assets/screenshots/196-role-guidance.png) · [Additional view / 其他頁面](assets/screenshots/196-dark-workspace.png)

範圍：本輪相關旅程通過，原失敗保留。間歇公網連線超時、專業產出、外部接入及完整生產/兼容驗收仍開放。下方較早章節為歷史版本。

<!-- integrated-round-195 -->

## 195 · 0.5.1 · 云端工作台 / Cloud workspace

会话内选择/拖入/贴图/@固定版本，集中查看成果、文件、活动与实际费用，明确交办/笔记语义。

[Round delivery / 本輪交付](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/integrated-round-195/README.md) · [Download / 下載](https://agent.copypaste.hk/downloads)

![Actual interface / 實際介面](assets/screenshots/195-v5-workspace.png)

![Actual interaction / 實際交互](assets/screenshots/workmate-195-v5-workspace.gif)

```mermaid
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

<!-- usage-195 -->

本轮使用流程：

1. 通过邮箱验证码登录，选择企业与项目，在会话内描述工作；附件默认归当前私人会话。
2. 选择或拖入文件，粘贴图片，或用 @ 从素材中选择固定版本；等待上传完成后设置角色、执行方式与预算再交办。
3. 交办会创建真实任务；保存笔记不会调用 AI。网络结果不明时保持原请求重试，避免重复扣费。
4. 任务内切换成果、文件、活动和费用；选择文件查看获准预览或下载，继续修改沿用该任务的执行位置。

[Actual recording MP4 / 实际录像](assets/screenshots/workmate-195-v5-workspace.mp4) · [Additional view / 页面](assets/screenshots/195-v5-workspace-results.png) · [Additional view / 页面](assets/screenshots/195-v5-workspace-dark.png)

<!-- /usage-195 -->

本輪實際測試與旅程見報告；保留歷史失敗，不以代碼量替代全部專業/生產驗收。影片/語音/Google/Meta真實配置、至少12角色專業驗收及完整兼容/運營矩陣仍開放。測試郵箱及未簽名安裝按已確認範圍保留。

Selected regression and real journeys are in the report. Historical failures remain. Real video/audio/Google/Meta configuration, at least12 professional role evaluations and the full compatibility/operations matrix remain open. The requested test mailbox and unsigned manual installation remain.

<!-- product-downloads-193 -->

## 產品下載與安裝 · 193

[開啟產品下載頁](https://agent.copypaste.hk/downloads)。Desktop 0.7.4（Windows 安裝版/便攜版）、Chrome 擴展 0.5.4 ZIP 及檔案校驗清單均可免登入從本站直接下載。

首頁導覽與頁尾、登入頁、工作台側欄及「裝置與檔案」提供下載入口。/downloads 支援直接訪問、刷新、繁中/英文、亮/暗色及手機版面。

目前 Windows 包未簽名；擴展為手動安裝，尚未上架 Chrome 線上應用程式商店；macOS/Linux 安裝包尚未提供。

[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/193-product-downloads.md) · [驗證 / Verification](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/193-product-downloads.md)

![實際下載頁 / Actual public download page](assets/screenshots/193-downloads-desktop-en.png)

[實際手機下載頁 / Actual mobile download page](assets/screenshots/193-downloads-mobile-zh.png)

![實際頁面操作錄製 / Actual download navigation recording](assets/screenshots/193-actual-download-navigation.gif)

<!-- native-recheck-192 -->

## 再次复查与错误可见性 · 192

待对账任务同时显示费用原因与本机回报原因。真实直连浏览器核验页面、原始错误和无横向溢出；云端程序、浏览器检查和交付下载使用实际结果验收。

本轮常规回归：后端91、Web30、后台22、扩展89、桌面控制器74；Linux原生8项通过。普通浏览器直连三域名均200，Python脚本直连仍403；不能宣称全产品零错误。12已移出，视频/音频、Google/Meta、Linux Office及完整矩阵等未选范围保留。

[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/192-native-error-observability.md) · [复查 / Recheck](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/192-native-recheck.md)

![本机原始原因 / Reported local cause](assets/screenshots/192-web-local-cause.png)

![实际桌面结果 / Actual Desktop result](assets/screenshots/192-desktop-local-result.png)

![实际云端下载录像 / Actual cloud download recording](assets/screenshots/192-actual-cloud-download.gif)

<!-- selected-repairs-191 -->

## 指定问题修复与本机交付 · 191

真实用户已在当前云端环境运行程序、Chromium交互并下载核对交付文件。本轮Web产品源码未修改，未重跑其全部历史套件。 02/03/04/05/07取得本轮证据；12按用户要求移出，新的Windows包为未签名手动安装版本。原未知供应商费用和财务预留保留，不把执行容量释放等同结算。

最终Desktop使用安装包默认公司HTTPS地址，经原始CONNECT通道访问真实域名，TLS证书、请求、模型结果及账务未替换；浏览器PKCE同样使用正式HTTPS域名。本次真实闭环通过，但单次验收不等于长期公网稳定性保证，190的01继续保留。 本轮检查：后端40/40、模型网关24/24、Windows云端兼容38/38、Desktop控制器74/74、实际固定Codex断流1/1、Linux原生8/8；真实云任务HK$0.126067、最终Desktop任务HK$0.035144。上述范围独立记录，不称为全产品重新验收；公网及190的其他未选项目继续保留。以下为当前说明，旧版本记录保留作历史。

```mermaid
flowchart LR
 A[Sign in and select workspace] --> B[Cloud Codex: Web and Extension]
 A --> C[Desktop: explicit local permission]
 C --> D[Customer-local Codex]
 B --> E[Company model API and usage]
 D --> E
 B --> F[Native Linux program and browser receipts]
 E --> G[Measured billing and delivery]
 F --> G
```

[方案 / Implementation](https://github.com/copypasteltd/workmate/blob/docs/docs/development/191-native-execution-and-capacity.md) · [证据 / Evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/191-selected-repairs.json) · [Desktop0.7.4手动下载 / Manual download](https://github.com/copypasteltd/workmate/releases/tag/desktop-v0.7.4)

![Actual Desktop result / 实际本机结果](assets/screenshots/191-real-desktop-result.png)

![Actual Web delivery / 实际Web交付](assets/screenshots/191-real-cloud-delivery.png)

Actual Web download recording excerpt; identity labels redacted. 这是Web实际录像节选，不代表其他端的新交互录像。

![Actual Web download](assets/demos/191-actual-cloud-download.gif)

<!-- live-acceptance-189 -->

## 真实生图上线与本轮验收 · 189

`gpt-image-2` 已使用与文字模型相同的上游接口和密钥通过真实生成、编辑验证并发布。实际 Web 设计师任务已生成文件、下载核对散列并计入真实用量。修复1254平方PNG与请求1024不一致的适配，保留上游原始字节；同时移除生图工具对重复全局密钥的错误依赖，并阻止未恢复的生图失败被标成成功。

在角色页选择“设计师”，进入执行模式，填写要求及预算；完成后到文件页下载标准图及原图。文件权限、实际用量与任务审计随原任务保存。

后端完整运行1950项：1949通过、1失败；该浏览器超时问题随后14/14复验通过。Web28/28、后台20/20、Extension89/89、Desktop269/269及全部构建通过。图片适配48/48、逐模型图片／原图保存与测试发现36/36、真实本机协议下的生图失败／恢复2/2分别通过，不能相加当作新全量结果。

Desktop真实供应商任务、公网稳定性、视频／语音／Google与Meta授权、SMTP及Linux原生执行器仍有验收缺口。测试收件箱按要求保留；不宣称完整应用全部通过。[完整方案、使用逻辑、原始失败与回滚](https://github.com/copypasteltd/workmate/blob/docs/docs/development/189-real-image-and-acceptance.md)。

```mermaid
flowchart LR
 A[Select Designer and budget] --> B[Cloud Codex with design skills]
 B --> C[Company API and frozen model connection]
 C --> D[Decode and verify PNG]
 D --> E[1024 image and exact upstream original]
 E --> F[Authorized download and measured billing]
```

![实际 Web 图片交付 / Actual Web image delivery](assets/screenshots/189-real-image-delivery.png)

下方为实际 Web 下载流程录像节选；在其他端的README中引用也仅代表Web证据。

![实际交互](assets/demos/189-actual-image-download.gif)

<!-- live-acceptance-188 -->

## 真实环境测试与上线 · 188

已部署真实文本服务：Web 与 Chrome 原生右侧 Side Panel 已完成“登录 → 上传获准文件 → 云端 Codex 分析 → 生成文件 → 下载 → 核对实际扣费”。后台完成真实用户／企业新建删除、批量状态管理、模型独立 API/Key 编辑删除、VIP 授予撤销及审计检查。操作与使用边界见[完整报告](https://github.com/copypasteltd/workmate/blob/docs/docs/development/188-live-acceptance.md)。

Desktop 使用本机固定版本 Codex，客户主动选择目录并确认完整本机权限。已修复 GPT 模型的原生 exec 格式兼容，真实本机命令／文件／企业工具桥接通过协议测试；最终真实模型 Desktop 复验受公网连接不稳阻塞，尚不能判定端到端通过。全量后端原始回归为 1,936 项：1,834 通过、101 失败、1 跳过；后续针对修复与现行策略的检查分别记录，不能据此宣称全部通过。

配置和使用：管理员在“模型能力”逐模型填写上游 URL、API Key、模型别名与费率，验证并发布可用版本；用户验证邮箱后选择真实企业与项目，再发起有预算的工作。当前仍使用受保护的测试收件箱。生图实际返回403，视频／语音及 Google／Meta 授权缺失；这些服务尚未取得真实验收。

```mermaid
flowchart LR
 A[邮箱验证 / Email verification] --> B[企业与项目 / Workspace and project]
 B --> C[Web 与 Extension: 云端 Codex]
 B --> D[Desktop: 主动授予本机权限]
 D --> E[客户本机 Codex]
 C --> F[公司服务与逐模型连接]
 E --> F
 F --> G[文件交付、实际用量与审计]
```

![实际 Web 云端交付 / Actual Web cloud delivery](assets/screenshots/188-real-cloud-result.png)

下图为真实 Web 已完成任务的只读浏览与滚动录像节选；不代表所有端均已完成真实模型验收。

![实际 Web 结果交互](assets/demos/188-actual-cloud-result.gif)

<!-- web-scroll-187 -->

## Web 滚动区域优化 · 187

[用户端](https://agent.copypaste.hk)已隐藏页面、侧栏、消息和弹窗外层的可见滚动条，保留原生滚动。必要的内部表格、面板和输入区统一细款样式，颜色跟随浅深色主题。窄屏标题与筛选允许换行，宽表格仅在自身区域左右滚动。

使用鼠标滚轮、触控板或手机滑动浏览长内容；导航可独立滚动，弹窗底部仍可访问。此更新已通过 TypeScript/Vite 构建和最终10项实际内网页面检查；浏览器与测试会话已关闭。公网 HTTPS 端到端旅程未在本轮完整验证，检查范围见[实现、使用与回滚](https://github.com/copypasteltd/workmate/blob/docs/docs/development/187-web-scroll-surfaces.md)。

```mermaid
flowchart LR
 A[页面与导航] --> B[隐藏滚动条并保留滚动]
 C[窄屏长内容] --> D[换行并限制宽度]
 E[宽表格] --> F[容器内滚动与统一细款样式]
```

![桌面浅色](assets/screenshots/187-v2-roles-light.png)

![桌面深色](assets/screenshots/187-v2-roles-dark.png)

![手机布局](assets/screenshots/187-v2-roles-mobile.png)

![实际主区域与侧栏滚轮交互](assets/demos/187-web-scroll.gif)

# Workmate · web · v0.1.0

<!-- per-model-connections-178 -->
## 每个模型独立配置上游 · 阶段178

进入 [Admin → 模型能力](https://agent-dashboard.copypaste.hk/catalog?view=capabilities) → **建立配置**，在同一表单填写 `gpt-6-luna`（或上游实际模型别名）、**API Base URL** 和 **API Key**。每个模型独立保存地址及密钥，文字模型须支持 OpenAI Responses API。

使用流程：保存草稿 → 测试连接 → 完整能力验证 → 独立审批发布 → 在角色／模板中绑定已发布能力。连接测试读取 `/models`，保存和测试不会自动发布。完整验证和真实使用会消耗实际上游额度，当前试用记账环境也一样。

密钥由服务器加密保存且不回显；新版本保留原任务冻结的连接。复制版本可明确保留原密钥，更换地址或网络范围必须重新填写。缺少明确连接时直接报错。本轮没有代填真实供应商密钥。

Customer requests continue through the company API. Supplier keys never reach the browser. The trial notice distinguishes simulated accounting/default fixtures from real calls made by explicitly configured models. Existing task authorization, credits and published role selection remain in force. Build: `npm run build`.

```mermaid
flowchart LR
 A[Model, URL and API Key] --> D[Immutable model configuration]
 D --> C[Connection check]
 C --> V[Validation and independent publication]
 V --> T[Task freezes model version]
 T --> G[Company gateway]
 G --> U[That model upstream]
```

[使用细则 / Usage and operations](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/model-connections-178.md) · [Source/runtime increment](https://agent.copypaste.hk/downloads/workmate-model-configuration-178.zip)

![Actual model form](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/screenshots/178-model-form-cdb03034-7f0f-4f3b-b68c-da666853b1c2.png)

![Actual save and connection test](https://raw.githubusercontent.com/copypasteltd/workmate/admin/assets/demos/178-model-connections.gif)

Earlier deployment/release records follow; their synthetic-service descriptions describe their original scope. 以下历史记录保留原部署范围。

---

<!-- public-domains-177 -->
## 正式域名试用部署 · 阶段177

[Web](https://agent.copypaste.hk) · [Admin](https://agent-dashboard.copypaste.hk) · [API readiness](https://ai-api.copypaste.hk/health/ready)

用户端经同源 /v1 代理；邮箱验证码 → 创建工作区及项目 → 模拟额度 → 角色任务 → 交付与下载。

Same-origin /v1 proxy: email code → workspace/project → simulated credit → specialist task → delivery/download.

[Current deployment, login and operations / 当前部署、登录与运维](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/domains-177.md)

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

![Public HTTPS task](assets/screenshots/177b-domain-task-result.png)

![Actual HTTPS interaction](assets/demos/177-public-domains.gif)

[MP4 recording](assets/demos/177-public-domains.mp4)

---

Earlier releases and deployment history / 以下为历史版本及部署记录。

<!-- lan-deployment-176 -->
## 内网 HTTP 部署 · 阶段176

Web: http://192.168.31.20:63070 · Admin: http://192.168.31.20:63071 · API: http://192.168.31.20:63072

支持内网 HTTP 的登录、工作区创建、安全摘要、任务和文件上传；19 个预设角色可读取。

服务器明文凭据：`/root/cfg/workmate/credentials.txt`（root `0600`）。邮箱验证码通过受独立口令保护的测试收件箱读取；Admin 另需验证器 TOTP。外部服务继续使用已授权假数据。

[部署、登录与运维 / Deployment and login guide](https://github.com/copypasteltd/workmate/blob/docs/docs/releases/lan-176.md)

![Actual LAN HTTP page](assets/screenshots/176e-lan-task-result.png)

![Actual post-login interaction](assets/demos/176-lan-http.gif)

[实际操作录像 / Actual recording](assets/demos/176-lan-http.mp4)


## v0.1.3 · 当前完整交付 / Current complete delivery

[Release / 下载](https://github.com/copypasteltd/workmate/releases/tag/v0.1.3) · [中英使用手册 / Bilingual guide](https://github.com/copypasteltd/workmate/blob/v0.1.3/docs/releases/v0.1.3.md)

本轮完整包包含六仓源码和全部端，纳入团队/单次运行费用报表、原成员/协调员账目、交叉筛选和同快照CSV。当前源码与假数据冻结交付按使用者要求收口；服务器资料和正式服务接入后续提供。AI/媒体/广告/支付使用假数据，Windows未签名；完整专业/生产台账保持。

All six source trees/clients are delivered, including team/run financial reports, original member/coordinator entries, intersecting filters and matching snapshot CSV. This current source/synthetic frozen delivery closes as requested; server/live configuration follows later. External services are synthetic and Windows is unsigned. Full professional/production qualification remains tracked.


## 当前完整冻结交付 · v0.1.2

全部端、六仓源码与本次费用入账期间报表统一纳入完整下载包。Desktop在本机运行Codex且支持客户主动授予完整本机权限；Extension使用原生右侧Side Panel，获准读取/上传文件后由云端Codex执行。数据库156；外部AI/媒体/广告/支付采用已授权假数据，Windows未签名。

[完整下载 / Complete release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.2) · [安装、登录和使用 / Setup and flows](https://github.com/copypasteltd/workmate/blob/v0.1.2/docs/releases/v0.1.2.md)

本轮重新构建Backend/Admin；其余运行产物及Windows分发核对后复用。继承源码一致的阶段172定向验证，阶段173不重跑功能测试。Backend/Admin rebuilt; unchanged runtimes/Windows distributions verified and reused. Exact-source stage172 focused checks inherited; no functional tests rerun at173. Older entries below retain their historical scope.

## 冻结交付 v0.1.1

完整包统一包含Windows Desktop（本机Codex、无边框）、Web、独立Admin、Chrome右侧Side Panel、Backend、六仓源码和固定runtime。假数据模式，Windows未签名；当前数据库156。

[完整发行包 / Complete release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.1) · [安装及流程 / Setup and flows](https://github.com/copypasteltd/workmate/blob/v0.1.1/docs/releases/v0.1.1.md)


[English](README.en.md) · [完整Release](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [中英安装使用](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/releases/v0.1.0.md)

面向香港企业的 Codex Agent 平台，首批服务既有 marketing 团队，覆盖设计/媒体、广告与网站/SEO/GEO分析、重复流程和软件开发。本仓库为独立 **web** 端，使用 **React / TypeScript / Vite**。视觉遵循 CopyPaste 的暖白底、深色文字、品牌色和编辑式排版。

## 当前冻结版 · v0.1.0

本版统一交付所有端、后端和六仓源码，包含最新用户任务/内容入口。六仓重新构建；当前Desktop输出与已验收Windows完整目录/Portable/Setup逐文件一致，核对后复用。近期阶段166八项SQL/API与八组实际页面检查保留其源码及原始证据；本轮不重跑全部历史用例。

分支`web`，本版固定标签`v0.1.0-web`。[完整源码与安装包](https://github.com/copypasteltd/workmate/releases/tag/v0.1.0) · [冻结记录](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/release-freeze-checkpoint-167.json) · [待办](https://github.com/copypasteltd/workmate/blob/v0.1.0/docs/quality/remaining-work-stage167.md)。AI/媒体/广告/支付为已授权假数据；Windows未签名。截图/GIF/MP4保留其原实际采集范围，不宣称新增全端安装或专业质量验收。

## 方案与结构

主要入口：`src/main.tsx, src/context.tsx, src/workspace-creation-form.tsx`。Codex 是唯一 Agent 内核，全部模型请求经公司内部 OpenAI 兼容 API，供应商密钥仅留在后端。专业模板固定 Skill、工具和配置版本；设计师组合为 Codex＋设计 Skill＋公司 Image 2。

Web 访问云端 Agent。Extension 使用 Chrome MV3 原生右侧 Side Panel，提供对话/附件界面，只读取客户选择的文件并经同意上传，由云端执行。Desktop 无边框、无 Electron 默认菜单，在客户本机运行 Codex，客户可主动授予完整本机权限，支持停止/撤权及账户、目录隔离。

Admin 独立邮箱验证码＋TOTP，按权限管理用户/企业、消耗与费用、VIP、角色/Skill和内容。用户详情传递真实用户ID；费用账户按主体筛选，VIP锁定目标，换用户销毁旧弹窗及预览。港币金额按微单位保存；预算、余额、实收、赠额、授信和VIP分开记录。人工变更先预览、再确认，保留当前权限/MFA/策略/审批、幂等和审计。

```mermaid
flowchart LR
 W[Web and Chrome Side Panel] --> A[Company API, identity and metering]
 A --> C[Cloud Codex and versioned Skills]
 D[Frameless Desktop] --> L[Customer-local Codex]
 L --> A
 A --> G[Company OpenAI-compatible gateway]
 M[Independent Admin MFA] --> A
 C --> R[Review, revise and download]
 L --> R
```

## 安装与运行

六个独立仓库并列置于 `dev/`：`copypaste-platform`、`copypaste-web`、`copypaste-admin`、`copypaste-desktop`、`copypaste-extension`、`copypaste-delivery`。使用 Windows x64、Node.js 22.14+、Git及原生PostgreSQL；媒体工作需FFmpeg/FFprobe，固定Codex随runtime分发。禁止Docker/WSL及虚拟化。

完整启动以Release指南为准。首次写配置前选空闲数据库端口，从Delivery依次运行 `demo:preflight` → `bootstrap:demo` → `demo:check` → `demo`。保留已有配置和数据；结束执行Delivery的 `npm run stop`。

本仓库单独开发，先准备对应依赖及配套后端：

```powershell
npm ci
npm run dev
```

API为localhost4310，Web4317，Admin4318。开发验证码位于platform `.data/mailbox/`。管理员需在platform执行 `npm run admin:create -- admin@example.com super_admin` 并按一次性资料绑定TOTP。Desktop通过浏览器PKCE登录后选择本机目录和权限；Chrome使用“加载已解压的扩展程序”，点击图标打开侧栏。

## 使用逻辑

1. 邮箱登录，接受邀请或创建企业及首项目。创建结果未确认时保留原请求；断线/刷新后点“确认并继续”恢复原结果。失效/删除回执不会悄悄新建企业。
2. 选择项目和角色，填写brief、文件/品牌/账户、预算和授权。必要资料在原任务补齐；执行固定当时接受的配置与Skill版本。
3. 查看持久进度、审批、成果版本、费用和用量，审阅后下载原文件或继续修改。未知费用保持待核对，不按免费处理或盲目重跑。
4. Admin从用户详情开费用/VIP，核对主体和预览后按策略确认。目录筛选支持刷新/返回恢复。用户详情可进入创建者限定的任务/内容；搜索、分页、刷新和返回保留目标与目录条件，正文权限独立。

## 配置与权限

Web/Admin使用 `VITE_API_BASE` 或同源代理；原生端构建时固定允许来源及扩展ID，回环开发外使用HTTPS。SQL增量历史001–155，API/Worker检查版本及环境身份。源码不带密钥、`.env`、用户数据库、依赖或Git元数据。

会话失效清除旧工作台，迟到结果不能覆盖新登录。文件默认私有；请求、任务领取、工具和下载重新核验当前权限。历史回执不保留已撤销访问权。显式退出清除工作区创建草稿中的名称，仅保留原账户可核对的无正文请求标识。

## 角色预设与Skill

目录定义18个专业预设；数量不代表十二个角色已全部通过专业验收。

| ID | Role | Required Skill bindings |
| --- | --- | --- |
| R01 | 全栈开发工程师 | `fullstack-engineering@1.0.0`, `frontend-implementation@1.0.0`, `backend-api@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R02 | 前端开发工程师 | `frontend-implementation@1.0.0`, `ui-system@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R03 | 后端与 API 工程师 | `backend-api@1.0.0`, `qa-testing@1.0.0`, `delivery-core@1.0.0` |
| R04 | 软件测试工程师 | `qa-testing@1.0.0`, `frontend-implementation@1.0.0`, `delivery-core@1.0.0` |
| R05 | UI/UX 设计师 | `ux-research@1.0.0`, `ui-system@1.0.0`, `frontend-implementation@1.0.0`, `delivery-core@1.0.0` |
| R06 | 设计师 | `creative-direction@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R07 | 品牌视觉设计师 | `brand-system@1.1.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R08 | 广告创意设计师 | `ad-creative@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R09 | 电商商品设计师 | `ecommerce-visual@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R10 | 社媒内容设计师 | `social-content@1.0.0`, `image2-production@1.0.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R11 | 插画与 IP 设计师 | `illustration-ip@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R12 | 字体与版式设计师 | `typography-layout@1.0.0`, `image-art-direction@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R13 | 演示文稿设计师 | `presentation-production@1.1.0`, `typography-layout@1.0.0`, `dataviz@1.1.0`, `delivery-core@1.0.0`, `deterministic-metrics@1.1.0` |
| R14 | 网页与落地页设计师 | `landing-page@1.0.0`, `ui-system@1.0.0`, `frontend-implementation@1.0.0`, `image2-production@1.0.0`, `delivery-core@1.0.0` |
| R15 | 信息图与数据可视化设计师 | `dataviz@1.1.0`, `deterministic-metrics@1.1.0`, `typography-layout@1.0.0`, `delivery-core@1.0.0` |
| R16 | 视频与动效设计师 | `video-storyboard@1.0.0`, `template-video-composition@1.0.0`, `video-generation@1.1.0`, `speech-production@1.2.0`, `delivery-core@1.0.0` |
| R17 | 营销数据分析师 | `ads-analysis@1.1.0`, `deterministic-metrics@1.1.0`, `dataviz@1.1.0`, `delivery-core@1.0.0` |
| R18 | 企业流程自动化顾问 | `workflow-design@1.1.0`, `workflow-execution@1.1.0`, `delivery-core@1.0.0` |



## 实际截图与交互

以下为本次真实Web/SQL恢复和Admin MFA/目标验证的共享媒体，使用合成客户与业务数据；不表示其他原生端重新完成安装验收。

![原工作区恢复](assets/screenshots/workmate-functional-closure-165-01-original-workspace-recovered.png)

![实际断线恢复](assets/screenshots/workmate-functional-closure-165-01-recover-original-workspace.gif)

[实际MP4](assets/screenshots/workmate-functional-closure-165-01-recover-original-workspace.mp4)

## 历史rc.5验证与发布

以下为历史rc.5记录：当时运行七项定向SQL、四项创建草稿检查和实际Web/Admin操作，重建六仓与Windows unpacked/Portable/Setup，核对ASAR和固定Codex。按要求跳过完整重复回归，实际结果以冻结检查点为准。

分支 `web`，固定标签 `v0.1.0-rc.5-web`。后续更新同步分支和更新说明，冻结包及标签保持。外部AI/媒体/广告/支付使用已授权假数据，Windows未签名。102个原编号及88项必选完整验收范围保留，88不是未实现模块数。真实服务、签名更新、多平台与完整专业验收继续跟踪。

[检查点](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/quality/release-freeze-checkpoint-165.json) · [完整编号台账](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/quality/remaining-work-stage165.md) · [旧README快照](https://github.com/copypasteltd/workmate/blob/v0.1.0-rc.5/docs/history/readme-before-rc5/web-zh.md)
