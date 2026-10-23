# Desktop 本机浏览器与界面更正 / Native browser and Desktop layout

状态：有界浏览器与布局子集已通过最终源码核查。平台 851/851、客户端 68/68、内核 17/17、独立浏览器 10/10、实际打包旅程 25/25；各范围不相加。阶段 76 保留为历史证据。102 REQ/102 TC、81 项部分验证 / 21 项未证明 / 0 项完整验收，以及 G01–G10 保持原定义。

Desktop 由客户本机 Codex 调用十二项本机浏览器工具，实际导航、操作页面、上传、截图和下载；推理仍经公司网关。完整本机权限必须由客户明确授予，并在每次操作检查当前授权、身份和任务归属。远程页面与可信地址栏隔离，不取得公司推理凭据或通用 IPC。任务完成、停止、撤权、登出和退出回收任务拥有的页面及活动下载，保留已完成文件和客户原有窗口。旧线程保留原工具绑定，新会话才启用新工具。

用户已撤销上一条关于进度条的约束。Desktop 保留真实上传、任务、视频及流程状态，隐藏纵向和横向滚动条外观，成果与长内容自动换行。滚轮、触控板、键盘、焦点及最后一项访问必须继续可用；使用真实打包窗口截图和录制复核，详见 [DESK-UI01](../requirements/04-desktop-layout-and-scroll.md)。

模型响应、测试业务页面和系统对话框决定明确使用夹具；Electron、Codex、公司身份与费用、文件及进程退出必须真实执行。裸浏览器 01–13、打包 22–27 的失败记录保留；22 为验证器按钮名称错误，23 为测试转译辅助函数缺失，24/25 为自有测试企业容量限制，26 为保留取消后未知费用预留所触发的网关限额，27 暴露工作区导航遗漏焦点标记，修正实际导航后重新验证。未伪造结算或删除费用预留。最终仅在隔离 UI 数据库配置 32 个用户/平台/企业槽位并新增不可变网关策略版本 2（32 槽位、每分钟 10,000 请求），初始策略、生产默认及限制测试不变。早期浏览器 11 的错误弹窗由精确归属检查后回收其 Electron 子进程，不能写成正常退出。未选用媒体逐字节移至本地忽略归档，并有重定位摘要。失败记录保留其原始结果，不以局部通过冒充全量浏览器、全部 OS 应用或完整产品验收。Extension 继续独立的原生右侧栏，读取客户获准文件并上传云端 Codex，不依赖 Desktop。

## English

The bounded native-browser/layout subset passed final source qualification: 851/851 platform cases, 68/68 client units, 17/17 native-supervisor cases, 10/10 standalone-browser checks and 25/25 packaged-journey checks. These separate scopes are not additive. The UI fixture alone appends immutable provider-policy version 2 and allocates 32 user/platform/tenant/provider slots with 10,000 requests/minute; bootstrap policy and production capacity defaults/enforcement remain unchanged. Desktop's pinned local Codex uses twelve customer-device browser tools through the company inference gateway. Current explicit full local access, task ownership and company authorization remain required. Trusted chrome and remote pages use separate renderers. Owned pages and pending downloads are reclaimed on completion, Stop, revocation, sign-out and exit; completed files and existing customer windows remain. Existing threads keep their original tool bindings.

The previous progress-bar constraint is withdrawn. Truthful task/upload/video/workflow feedback remains. Desktop hides scrollbar presentation, reflows deliverables and long content, and preserves real wheel, touchpad, keyboard and focus access. Model responses, campaign content and native-dialog choices are explicit fixtures; native browser actions, files, processes and company billing are real. Original acceptance boundaries remain unchanged. Extension continues its independent cloud conversation and authorized-file upload in Chrome's native right Side Panel.
