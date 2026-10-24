# 内部音频与 Desktop 布局更新 / Internal audio and Desktop layout

本次补齐公司内部配音、文件转写与人工字幕版本：Web/原生 Chrome 右侧栏使用云端 Codex，Desktop 使用本机固定 Codex。模型请求只经过公司内部 OpenAI 兼容网关，角色 1.3.0 加载 speech-production 1.1.0，原有角色/Skill 版本保留。原始 WAV/JSON/实际字幕时间不可覆盖，客户可按固定版本修订文字和时间，无额外 AI 调用。

Desktop 延续 CopyPaste 视觉、无边框/无 Electron 菜单和客户主动可撤销完整本机权限。遵循用户更正：真实任务/上传/影片进度继续显示；侧栏、消息、成果与弹层无可见纵向滚动条，各处无横向滚动条。长内容换行，滚轮/键盘与末项操作保持可用。较矮窗口改用紧凑布局，并修复窗口缩放后聚焦的字幕保存按钮移出可视区的问题。三种真实窗口尺寸与繁中深色主题均实际复核。

后台按企业/项目范围和独立元数据、费用、正文权限管理音频作业；敏感原文读取需近期 MFA 并审计。共享任务预算、独立音频 slots/RPM、派发前持久记录、未知 POST 保留预留和禁止自动重发、来源隔离/删除/失权门控均保留。长原始 JSON 在实际 Admin 弹窗内完整换行。

升级先应用新增 SQL101，配置公司配音/转写别名、已核验语言/声音/协议、正数费率，并按既有独立审批发布音频容量（初始 0）。标准 demo 不自动提供本次音频假服务。所有密钥保持服务端。SQL001–100 与原 OpenAPI 字节保留。

当前验证：平台 988（全部原 968 用例保留）、音频/网关 43、兼容 80、客户端 124、真实 Web/Admin/侧栏 10、打包 Desktop 40。实际截图、四组 GIF/MP4、精确源码、完整测试清单和自建资源关闭均保留；失败回执不覆盖。14 份中英双语 README 与主文档同步。

假服务为可解码合成音调、固定转写和推理内容。真实声线/粤语质量、独立人工声音授权确认、音频能力后台核验/发布/回滚、未知请求外部账单证据/独立审批/恢复交付仍待完成。原 102 REQ/102 TC 保持 83 部分、19 未证明、0 完整验收，G01–G10 保留。

English: Adds company-gateway speech, file transcription and immutable manual subtitle revisions across cloud Web/native Side Panel and local-Codex Desktop. Admin independently scopes metadata, costs and recent-MFA audited original bodies. Shared budgets, durable submission, unknown-cost holds, source gates and audio capacity remain enforced. Apply additive SQL101 and explicitly verified company configuration; initial audio capacity is zero. Original migrations/OpenAPI and historical role/skill versions are retained.

Desktop keeps CopyPaste styling, its frameless window, no Electron menu and explicit revocable full local permission. The user's corrected constraint preserves truthful progress while hiding scrollbar rails; content still wraps and real wheel/keyboard/last-action access works. A compact layout and focus preservation fix the subtitle-save control after real OS resizing. Actual 1440×980, 1280×800, 800×600 and Traditional Chinese dark captures are verified.

Evidence covers 988 platform cases preserving all 968 earlier cases, 43 audio/gateway, 80 compatibility, 124 client tests, 10 Web/Admin/Side Panel checks and 40 packaged native checks. Four original GIF/MP4 pairs, bilingual READMEs and exact-source receipts are retained. Synthetic media does not prove live professional voice quality, independent human rights confirmation, managed audio release, unknown-POST external reconciliation, signed installers or complete original acceptance. Original 83/19/0 and G01–G10 remain unchanged.

[方案与配置](../technical/84-internal-audio-production.md) · [实际画面](../quality/audio-production-visual-review.md) · [精确版本检查点](../quality/audio-production-checkpoint.json)
