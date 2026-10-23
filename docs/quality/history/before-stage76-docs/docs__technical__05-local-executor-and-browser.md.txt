# 原生执行器、设备协议与浏览器生命周期

**阶段 75 当前增量：** Desktop 保持本机 Codex，视频角色接通七项公司工具、私有工程、真实合成、播放/保存、版本修改及停止/撤权控制。平台 830 项、重叠定向 58 项、原生 17 项、客户端 47 项和实际打包旅程 18 项通过；当前 17 个本机角色准入不等于全专业验收。见 [实现与源码证据](75-desktop-private-video.md)。原 102 REQ/102 TC、NFR、G01–G10 和 81/21/0 状态保留；较早记录沿用其原始源码范围。

**阶段 74 历史基线：** 本机 Codex 的追问、选择/自填回答、同任务回合继续、等待时停止及撤权已接通；当前 Desktop 有 47 项客户端、17 项真实原生和 12 项实际打包旅程检查。后端源码未变，沿用阶段 73 的 818 项完整回归范围。详见 [方案与限定证据](74-desktop-native-user-input.md)。18 角色/29 Skill 及全部原始验收范围保留，以下较早记录保持各自原始源码边界。

**阶段 73 历史基线：** Desktop 保持本机 Codex，接通公司图片/设计/资料工具和私有成果下载；16 个角色的本机协议可准入。真实原生 14 项、平台完整回归 818 项、打包 Electron 9 项旅程通过，供应商/系统对话框决定明确为假数据夹具。全 18 角色/29 Skill 和完整产品验收仍保留。见 [本机公司工具](73-desktop-native-company-tools.md)。下列阶段 72 及更早记录只证明原始源码范围。

实施状态：本分册保留长期设计约束；本轮锁定版本、实际 API/工具、各端实现与差异，以 [实际开发清单](12-implementation-and-repositories.md) 和 [运行验收](../quality/04-implementation-acceptance.md) 为准，未实现项没有删除。


版本：1.0 · 2026-10-18。关联 REQ-036–042、050、054、057。机器格式见 [设备命令 schema](../contracts/device-command.schema.json)。

## 1. 进程和传输

2026-10-22 起按 [CLIENT01](../requirements/03-client-execution-amendment.md) 区分两条执行路径：Desktop main process 直接管理本机 Codex app-server、会话、工具和用户可授予的完整本机权限；扩展可选 Native Messaging host 仅承接获准文件操作。下文云端签名命令、目录 grant、白名单程序和文件冲突约束适用于文件桥接/受限模式，不能作为 Desktop 完整本机操作能力的上限。实现偏差及新进程设计见 [方向检查](69-desktop-local-codex-and-extension-direction.md)。

设备核心管理配对、授权、命令账本和桥接子进程；Native Messaging host 将扩展消息交给核心。Desktop 的本机 Codex 管理通过独立、类型明确的 IPC 实现，渲染页面与 content script 不直接拥有通用系统命令入口。扩展不能借 Host 开启 Desktop 的完整权限。

Chrome Native Messaging 使用其规定的长度封包和 stdio，不等同产品 JSON REST 或 Codex app-server 通道。仅传控制与对象引用，大文件使用短期上传下载 session。扩展 ID/来源必须匹配正式安装注册。

设备主动建立产品 WebSocket，握手验证设备凭证与绑定身份。云端从命令表发送尚未结束的命令，连接仅为投递通道，数据库与本地账本保存权威状态。

## 2. 配对与本地授权

PairingCode 短时有效且一次使用；用户在本地看到企业名、项目及设备名再确认。首次配对生成设备密钥，私钥存系统凭证设施，服务器保存公钥及 auth_version。

目录授权由本地选择器产生，保存 root 的规范化身份、允许项目、动作、expires_at 与本地策略版本。原始绝对路径留本机，服务器只拿 grant_id 和适当显示名。撤销立即在本机生效，云端新增命令不能恢复被撤销 grant。

## 3. 命令 envelope

必需字段为 protocol_version、command_id、operation_id、tenant_id、task_id、attempt_id、device_id、grant_id、auth_version、fencing_token、action、args、input_hash、issued_at、expires_at、nonce、signature。

signature 使用 Ed25519 的 detached signature，签名内容为删除 signature 字段后按 RFC 8785 规范化的 UTF-8 JSON。input_hash 是规范化 action+args 的 SHA-256；不得将不同输入绑定到同一 command_id。签名 key_id 支持轮换，设备仅信任有效产品控制面公钥。

动作初始为 file.read、file.write、directory.scan、program.run、browser.open、browser.close。args 按动作严格校验；program.run 只接受 executable_id 与 argv 数组，目录与文件路径必须相对授权 root。未知协议/字段/动作拒绝执行，不退化为 shell。

## 4. 领取、重放与租约

先核验身份/签名/过期/授权版本 → 本地账本按 command_id 查重 → 校验 task/attempt 和 fencing_token → 写 accepted → 执行 → 写结果 → 提交服务器回执。设备恢复先处理撤销与取消，再执行新命令。

同 command_id 同输入重发只返回已存结果；同 ID 不同输入为冲突。执行前过期不执行；已经完成的旧命令仍可返回结果供对账。旧 fencing token 不得开始写操作或提交新产物。

服务器不因断线立即向第二台设备重发具有副作用的同一步骤。需要接管时先终止/对账旧租约，生成新命令和更高 fencing；目标设备权限重新验证。

控制帧见 [device-channel schema](../contracts/device-channel.schema.json)。设备 hello 携带已确认游标；服务端 sync 发送会话、auth_version、撤销与取消清单；设备落本地账本并 sync_ack 后，才接收 command。result 具有本地持久 result_seq，服务端落库后 result_ack；断线按游标重传。hello/sync_ack/result 为设备方向，sync/command/result_ack 为服务端方向，反向或握手未完成的帧拒绝。ping/pong 默认 20 秒，连续 60 秒无响应标离线，数值属于可调设计默认；网络重连不重置执行幂等账本。

## 5. 路径与写入安全

相对路径先解析并验证 root，默认拒绝 symlink、junction、设备路径、UNC 和特殊文件。实际访问时使用安全文件句柄及身份核对，减少检查与使用之间的替换风险。单纯字符串前缀匹配不能证明在授权目录内。

写入采用同目录暂存、摘要校验及原子替换；如果 expected_source_hash 不匹配，返回 FILE_CONFLICT。输出文件按命令/版本命名，监听器排除本产品输出，避免循环。权限撤销检查到每个新文件和副作用边界。

## 6. 停止与恢复

取消只终止本任务拥有的子进程或进程组，不按程序名杀掉用户应用。Windows 使用受控子进程/Job Object 等原生能力，其他系统使用等效机制；全程不启动 Docker/WSL。

Pause 在可恢复文件或批次边界生效。已完成的文件记录指纹，重启从清单恢复；无法判定外部动作是否发生时返回 unknown。设备离线的相关任务等待，不能当作成功。

## 7. 浏览器资源账本

记录 context_id、tab_id、owner_task、来源（用户原有/任务新建）、租约及最后活动。open 操作检查每任务和每执行器上限；close 仅影响归属允许的任务资源。

finally 回收任务不用的页面、下载句柄和临时目录；watchdog 扫描过期资源。正常、异常、取消、设备断线都验证回到资源基线。保留登录凭证不要求保留占内存的所有标签页。

## 8. 协议升级与验收

协议含 major.minor；同 major 的可选字段变化需双方兼容验证，未知必需能力返回 UPGRADE_REQUIRED。支持当前及前一个次版本，超出范围停止新任务并保留查询历史能力。

验收包括签名修改、重放、过期、旧 fencing、越界路径、授权撤销、程序白名单、浏览器资源清理及断线结果重复回传。
