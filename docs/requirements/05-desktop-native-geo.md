# Desktop 本机 GEO 工作流补充 / Desktop-native GEO workflow

本项落实 Desktop Agent 在客户本机执行的既定要求，覆盖 marketing 的 GEO 固定问句观测。其实现与验收凭证见 [技术设计](../technical/110-desktop-native-geo.md)。本补充不改变既有需求编号、验收条件或完成统计。

## 用户流程 / Customer flow

1. 客户经浏览器登录、PKCE 返回 Desktop，选择有权限的企业和项目，在 Desktop 内打开「本机 GEO 观测」。
2. 创建不可改写的问句集，明确地区、回答语言、品牌别名，以及固定版本的无品牌 Agent。品牌别名仅用于回答后的字面统计，不插入观测提示。
3. 选择每题金额，查看整批总预留和当前配额，再经原生确认框授权。取消确认不生成本机任务、不预留费用。
4. 服务端一次性检查整批问句的余额、配额、Agent、模型和项目预算；全部满足后按题预留，否则整批回滚。本机先持久化原请求，断线后用原幂等键核对。
5. 客户可以依次运行未开始的问句，也可以单独运行或停止某题。每题在本机独立 Codex 线程和空白目录执行，全部推理经公司服务。
6. 依据公司推理回执结算；保存原始回答和摘要，展示字面提及与链接。重复观测创建新运行；比较明确显示方法和配置是否一致。

## 权限与隔离 / Permissions and isolation

本机观测采用只读、无系统和业务工具的专用协议，避免前一问句、项目宣传材料、检索结果或客户工作目录影响观测。常规 Desktop Agent 继续提供客户主动授予的完整本机权限。

原生批量预留和配置读取必须绑定当前 Desktop 登录授权族；Web、Extension 和 renderer 通用 API 桥接均不能冒充原生批量预留。每题绑定设备、全新本机会话、工作目录摘要和固定运行时。项目成员权限、私有记录所有权、已发布来源与模型能力、计划权限和预算约束继续生效；管理员停用或来源撤回后禁止开始执行。

The server grants scoped inference and budget, while the Desktop owns local execution. This workflow does not permit cloud workers to execute native questions, nor does it treat a client-provided answer as server-attested operating-system execution.

## 中断与费用 / Interruptions and charges

- 尚未开始的问句可停止并释放原预留，不发起模型调用。
- 本机已接受但结果未知时，不重新提交模型请求，不填造回答或零费用；保留待核对状态。
- 完成回执提交失败时，恢复仅提交原回执，不运行第二个 turn。
- 费用使用整数微额；确认框显示每题和整批准确金额。最终费用依据公司调用凭证；结果不明时显示待核对。
- 账户切换、权限撤回和页面切换不得使批次继续发起新的问句。

## 页面与交付 / Interface and delivery

沿用 CopyPaste 现有色系、字型、按钮和焦点样式。页面包含问句集、原生批次确认、逐题状态、运行／停止／恢复、原始回答、重复观测比较与导出。无边框 Desktop 不出现 Electron 原生菜单；隐藏滚动条轨道，保留键盘和滚轮操作，窄窗口无水平溢出。

中英双语 README 必须包含实际应用截图、实际交互 GIF、流程图、启动说明和验证范围。使用假数据验收时明确说明；不以模拟回答宣称真实模型质量或品牌排名提升。
