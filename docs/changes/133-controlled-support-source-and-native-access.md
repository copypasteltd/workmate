# 阶段133 · 受控客服来源与原生客户授权

修复客服对保留任务正文未检查原始来源的问题，补齐任务／会话快速切换的响应隔离，并验证真实 Desktop 客户授权与撤销流程。

| 编号 | 本轮完成项 | 交付结果 |
| --- | --- | --- |
| 133-01 | 任务原始来源检查 | 来源隔离、到期、版本擦除及任务隔离后拒绝保留正文，诊断隐藏衍生标题。 |
| 133-02 | 正文版本条件 | 当前版本指纹、严格单值If-Match、跨站预检及审计后来源／版本复核。 |
| 133-03 | Admin 响应隔离 | 不同任务及会话的迟到响应互不覆盖，旧请求不能阻塞新视图；变化／失败／隐藏／到期时清空正文。 |
| 133-04 | 客户 Web／Desktop 表单 | 用户／企业／角色隔离，列表请求取消，异步创建／撤销／复制完成时核对当前页面身份。 |
| 133-05 | 独立原生客户旅程 | 实际Windows包完成OTP／PKCE、明确项目授权、独立Admin只读查看及本机客户撤销。 |
| 133-06 | 原始验证与媒体 | 59项后台相关检查、13项真实跨端旅程、6张截图、3组实时GIF／MP4；失败与确切源码均保留。 |
| 133-07 | 双语与版本交付 | 六组件及中央文档更新中英说明、逻辑图、实际媒体和完整编号清单；普通推送并核对远端SHA，以实际发布回执为准。 |

原始来源漏洞由隔离后仍返回200的实际共享任务请求复现。首次私人任务准备错误、首轮三项测试准备错误和首次原生登录跳转脚本错误均单独保留，不改写成通过。产品权限、免费套餐上限及数据库受限角色不因测试而放宽。重试复用已通过构建的相同产品字节与包哈希，仅修改旅程脚本。

Windows包未签名；业务数据、保留正文与测试文件读取为明确合成夹具，模型没有执行。全部所属页面、客户端、数据库与测试夹具已关闭／回收。完整TC-095、全后台矩阵、各页面无障碍及全产品生产验收继续开放，见[完整编号待办](../quality/remaining-work-stage133.md)。

[实现方案](../technical/133-controlled-support-source-and-native-access.md) · [需求约束](../requirements/10-controlled-support-source-and-native-access.md) · [源码及原始证据检查点](../quality/support-access-checkpoint-133.json)

English: Controlled support now rejects retained bodies after original-source withdrawal, checks the selected content revision and isolates late task/session replies. Actual Web/Admin and packaged native Desktop journeys cover customer grants and revocation. Failed attempts, exact sources and original captures are retained; full product acceptance remains open.
