"""Update current navigation/README claims; preserve original documents as bytes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
archive = ROOT / 'docs/quality/history/before-extension-conversation-docs'
archive.mkdir(parents=True, exist_ok=False)
entries = []

def save_before(file):
    relative = file.relative_to(ROOT).as_posix()
    target = archive / (relative.replace('/', '__') + '.txt')
    original = file.read_bytes()
    target.write_bytes(original)
    entries.append({'source': relative, 'archive': target.relative_to(ROOT).as_posix(), 'sha256': sha256(original).hexdigest()})

def update(file, fn):
    save_before(file)
    original = file.read_text(encoding='utf-8')
    text = fn(original)
    assert text != original, file
    file.write_text(text, encoding='utf-8', newline='\n')

link = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/71-extension-cloud-conversations.md'
zh = '**当前实现：** Desktop 独立本机 Codex supervisor 已通过 9 项原生测试，产品的本机授权、费用和随包交付仍待接入。Extension 已接入原生右侧栏对话、历史、底部输入和明确文件版本附件；32 项扩展测试及 7 项真实侧栏旅程检查通过，模型回合按授权模拟。原 102 项及完整客户端验收继续跟踪。[本次扩展实现](' + link + ')。'
en = '**Current implementation:** The independent Desktop local Codex supervisor has passed nine native tests; product consent, billing and bundled distribution still need integration. The Extension now provides native Side Panel conversations, history, a bottom composer and immutable-version attachments. All 32 Extension tests and seven real Side Panel journey checks passed, with explicitly synthetic model turns. The original 102 requirements and full client acceptance remain open. [Extension implementation](' + link + ').'
readmes = [p for folder in (ROOT, ROOT / 'docs', *(ROOT / 'dev').glob('copypaste-*')) for name in ('README.md', 'README.en.md') if (p := folder / name).is_file()]
for file in readmes:
    def edit(text, file=file):
        english = file.name == 'README.en.md'
        pattern = r'^\*\*(?:当前实现：|Current implementation:).*?$'
        replaced, count = re.subn(pattern, en if english else zh, text, count=1, flags=re.M)
        assert count == 1, file
        if file.parent.name == 'copypaste-extension':
            replaced = replaced.replace('`src/panel.ts` 管理企业/项目、任务、资料与结果；', '`src/conversation.ts` 管理私有云端会话、附件版本和发送回执，`src/chat-panel.ts` 渲染消息和输入，`src/panel.ts` 连接企业/项目、任务和账户；')
            replaced = replaced.replace('3. 选择企业、项目和助手，提交工作或打开已有任务。可通过固定入口进入完整的创作、连接和网站工作台。', '3. 选择企业/项目，开始新会话或从历史继续；角色与每条消息预算在折叠设置中，普通消息无需填写工作名称。')
            replaced = replaced.replace('4. 需要资料时选择当前获准文件版本或连接。轮询保留选择；确认后继续原任务，查看结果和累计结算。', '4. 选择或拖入文件，等待“已上传，待发送”，再发送消息。每次只绑定当前消息的明确版本；断网重试或重开侧栏沿用原消息与预算，避免重复收费。')
            replaced = replaced.replace('5. 切换范围或任务读取失败时清空旧内容。页面导航不销毁已有侧栏；关闭不用的页面释放内存。', '5. 在同一云端会话继续追问，查看真实增量事件、成果与费用。可请求停止；来源失效清空旧内容。基础上传和对话不需要安装 Desktop。')
            for old, new in [('workmate-10-interaction.gif', 'workmate-chat-05-conversation.gif'), ('workmate-10-interaction.mp4', 'workmate-chat-05-conversation.mp4')]:
                replaced = replaced.replace(old, new)
            if english:
                extra = '\n## Conversation and attachment flow\n\nChoose a company/project and start or restore a chat. Ordinary messages need no task title. Attach or drop files, wait for “Uploaded, not sent”, then send. Only confirmed immutable versions bind this message. The browser reads the selected file; cloud Codex executes through the company gateway. Basic upload/chat needs no Desktop or Native Messaging. Per-message budgets and specialists are in settings; accounts and standalone business forms are collapsed.\n\nLost acceptance responses retain the original payload, budget and idempotency key across panel reopening. Actual incremental events update the conversation. Current source denial clears old content and blocks sending. Unsaved attachments are not restored after closing; uploaded files remain in the project. Current limits: 20 attachments, each non-empty and up to 5 MiB.\n\nValidation: 32 tests, successful type/build checks and seven native right Side Panel journey checks using real email/PKCE, uploads, Worker, files and billing. Model turns are synthetic. Earlier four-client media below keep their original scope.\n\n![Native conversation](assets/screenshots/workmate-chat-05-continued-en.png)\n\n![Uploaded attachment](assets/screenshots/workmate-chat-05-attachment-ready-en.png)\n\n[Source-bound chat evidence](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/extension-chat-checkpoint.json) · [Design and recovery rules](' + link + ')\n'
            else:
                extra = '\n## 当前对话与消息附件\n\n从企业/项目进入新会话或恢复历史，在底部输入消息；角色和每条消息预算可在设置中调整。文件选择/拖入、读取和上传由浏览器完成，等待“已上传，待发送”后绑定本条消息的明确版本。普通会话不必另填工作名称，基础上传/对话无需 Desktop 或 Native Messaging。通知、账户及独立任务表单折叠保留。\n\n断网后的待确认请求与侧栏恢复沿用原内容、预算和幂等键；当前来源拒绝或内容隔离会清空旧回复并阻止发送。普通未发送附件不跨关闭恢复，已上传文件仍保存在项目。当前每条消息最多 20 个非空附件、每个最多 5 MiB；仍受服务端类型与额度检查。\n\n本次 32 项测试、类型/构建及 7 项真实右侧栏旅程检查通过；身份、上传、Worker、成果和账本真实执行，模型回合明确模拟。下方旧四端媒体记录保留原范围。\n\n![真实原生对话](assets/screenshots/workmate-chat-05-continued-en.png)\n\n![获选文件上传](assets/screenshots/workmate-chat-05-attachment-ready-en.png)\n\n[本次源码及媒体检查点](https://github.com/copypasteltd/workmate/blob/docs/docs/quality/extension-chat-checkpoint.json) · [具体方案与恢复规则](' + link + ')\n'
            replaced += extra
        elif file.parent.name == 'docs':
            replaced += ('\nNew: [Extension cloud conversations](' + link + ') · [Release notes](changes/2026-10-22-extension-conversations.en.md).\n' if english else '\n本次扩展更新：[云端对话及消息附件](technical/71-extension-cloud-conversations.md) · [更新说明](changes/2026-10-22-extension-conversations.md)。\n')
        return replaced
    update(file, edit)

file = ROOT / 'docs/technical/69-desktop-local-codex-and-extension-direction.md'
update(file, lambda t: t.replace('Electron 的用户授权/费用接入及 Extension 对话附件改版仍待完成。', 'Electron 的用户授权/费用接入仍待完成；Extension 的对话/附件主线已接入并完成限定旅程验证，见 [扩展实现](71-extension-cloud-conversations.md)。'))
file = ROOT / 'docs/technical/12-implementation-and-repositories.md'
update(file, lambda t: t.replace('Extension 已有原生右侧栏及基础上传，主体尚需从任务表单重排为对话/附件。', 'Extension 已接入原生右侧栏对话、历史和明确版本附件，验证范围见 [实现说明](71-extension-cloud-conversations.md)。'))
file = ROOT / 'docs/requirements/03-client-execution-amendment.md'
update(file, lambda t: t.replace('Extension 已有原生侧栏和基础文件上传，但对话主界面及附件到消息的完整绑定链仍需调整，EXT-C01–C06 **尚未完整验收**。', 'Extension 的原生侧栏对话、历史、底部输入和明确版本附件已接入，32 项测试及 7 项真实侧栏旅程检查通过；模型回合明确模拟。文件/角色/长时间恢复及生产等完整范围继续验证，EXT-C01–C06 **尚未完整验收**，见 [当前实现](../technical/71-extension-cloud-conversations.md)。'))

progress_file = ROOT / 'docs/quality/requirements-alignment-progress.json'
save_before(progress_file)
progress = json.loads(progress_file.read_text(encoding='utf-8'))
assert 'extension_conversation_repair' not in progress
progress['extension_conversation_repair'] = {'at': datetime.now(timezone.utc).isoformat(), 'checkpoint': 'extension-chat-checkpoint.json',
    'status': 'verified_native_conversation_subset', 'tests': 32, 'native_checks': 7,
    'scope': 'Actual native Side Panel, immutable selected files, same-message response-loss recovery and continuous cloud conversations; synthetic UI model turns',
    'remaining': ['Desktop user-consent/billing/bundled local Agent integration', 'All original client/role/file/production/NFR/G01-G10 conditions'],
    'baseline': {'requirements': 102, 'acceptance_cases': 102, 'partial': 81, 'unproven': 21, 'fully_accepted': 0}}
progress['current_source_qualification'] = {'stage': 71, 'checkpoint': 'extension-chat-checkpoint.json',
    'note': 'Extension uses the new chat receipt. Unchanged Platform and local Desktop core retain canonical-task/local-supervisor qualifications; old complete-client captures are historical, not tests of the new conversation UI.'}
progress_file.write_text(json.dumps(progress, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
(archive / 'manifest.json').write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'files': entries}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'updated_readmes': len(readmes), 'preserved_documents': len(entries)}))
