# 165 · rc.5 冻结检查点 / Freeze checkpoint

状态：qualified。当前生产构建、Windows分发、ASAR字节和固定Codex核对通过。原始证据以同名JSON为准。

|编号|检查|结果|
|---|---|---|
|1|Backend/Web/Admin/Desktop/Extension/Delivery 六仓生产构建|6通过|
|2|Windows unpacked / Portable / NSIS Setup|完成|
|3|ASAR实际条目对照当前main/renderer输出|64文件字节一致|
|4|首次企业创建、同键、撤权、归档、并发的隔离SQL/HTTP|7通过|
|5|创建草稿刷新、账户隔离、退出摘要竞争、损坏状态|4通过|
|6|当前Web/Desktop/Admin请求传输|9通过|
|7|真实Web邮箱登录、丢回包后刷新恢复、明确新建入口|3通过|
|8|真实Admin OTP/TOTP、VIP/费用目标预览、切换、筛选与无发放事实|5通过|
|9|当前实际截图/GIF/MP4|10PNG、3GIF、3MP4；原生旧媒体保留原范围|
|10|本轮自有浏览器/服务关闭|完成；无Docker/WSL，未使用其他PG55432|

Six current builds and fresh Windows distributions pass. ASAR bytes and the pinned Codex runtime match. Current focused checks include7 SQL cases,4 draft cases,9 transport cases and8 real Web/Admin journeys. Synthetic business data and no production provider calls. Owned browsers/services are closed.

原v1第7个夹具因跨数据库角色监控字段受限失败；v2使用公开锁标识，保留真实等待与单企业断言，完整通过。旧测试、失败回执及日志保留不改。完整重复回归按用户要求省略；没有把旧版通过数量移植为本版验证。

完整范围：102原编号和88必选完整验收继续保留，新增整项完整验收关闭0。真实生产依赖、签名/更新、其他OS、完整权限/故障和专业质量验收不在本轮关闭。Admin用户专属任务/内容统一筛选入口仍待后端契约。

[实际JSON](release-freeze-checkpoint-165.json) · [定向记录](functional-closure-165.json) · [全部编号](remaining-work-stage165.md) · [发布使用](../releases/v0.1.0-rc.5.md)
