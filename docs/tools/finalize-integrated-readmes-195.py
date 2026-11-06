"""Add source-bound usage details to the current bilingual README sections."""
from pathlib import Path
import re,json
ROOT=Path(__file__).resolve().parents[2]
items={
 'platform':(
  ['管理员先在每个模型能力中保存其 API 地址、密钥、模型别名与费率，运行就绪视图只显示状态，不泄露配置值。','客户附件通过原有分片接口完成并固定版本；会话交办同时验证私人归属、项目、版本与预算，消息/任务/预留款原子提交。','任务工作区按当前授权返回成果、最多200个交付文件、预览入口及实际费用；原始下载与分页 Office 预览使用独立受权接口。','角色人工验收保留任务、模板、技能和交付快照。schema163仅新增不可改写记录和受限统计，不清除旧账务或审计。'],
  ['Configure each model with its own API URL, key, upstream model name and rates. Readiness exposes state without disclosing values.','Complete resumable uploads and pin their versions. Conversation delegation validates private ownership, project, version and budget; message/task/reservation commit atomically.','Authorized task workspaces expose results, up to200 deliverables, preview actions and actual usage. Original downloads and paged Office previews use separate authorized endpoints.','Human role reviews preserve task, template, skill and deliverable snapshots. Additive schema163 retains existing billing and audit history.']),
 'web':(
  ['通过邮箱验证码登录，选择企业与项目，在会话内描述工作；附件默认归当前私人会话。','选择或拖入文件，粘贴图片，或用 @ 从素材中选择固定版本；等待上传完成后设置角色、执行方式与预算再交办。','交办会创建真实任务；保存笔记不会调用 AI。网络结果不明时保持原请求重试，避免重复扣费。','任务内切换成果、文件、活动和费用；选择文件查看获准预览或下载，继续修改沿用该任务的执行位置。'],
  ['Sign in with an email code, choose an organization/project and describe the work in a conversation. Attachments initially belong to that private conversation.','Choose/drop files, paste images or use @ to select a pinned material version. Wait for uploads, set the role/execution mode/budget and delegate.','Delegation creates real work; saving a note does not invoke AI. An uncertain network outcome retains the original idempotent request.','Switch between Results, Files, Activity and Usage. Preview/download authorized files and continue revisions in the original execution location.']),
 'admin':(
  ['管理员完成邮箱验证码与 TOTP 后登录；权限不足或未完成验证的操作由服务端拒绝。','进入运行就绪，筛选需处理项目并重新检查。模型接口、密钥、别名、费率在对应模型能力中维护。','进入角色验收，输入真实任务 ID、选择模板版本并读取交付快照，填写案例类型、结论和证据。','通过记录须符合真实执行成功及客户接受等条件；受控测试不构成专业验收。可筛选、分页并批量撤回，撤回理由和原证据继续保留。'],
  ['Sign in using the administrator email code and TOTP. The server enforces verification and permission boundaries.','Open readiness, filter items needing attention and recheck. Maintain each model API URL, key, name and rates in capability management.','Open role acceptance, enter a real task ID, select a template version and load its delivery snapshot before recording case type, conclusion and evidence.','Passing records require the relevant real execution/customer acceptance conditions. Controlled QA is not professional certification. Filter, page and batch-revoke with reasons while preserving original proof.']),
 'desktop':(
  ['从下载页取得0.7.5安装版或便携版，在系统浏览器完成账户授权。','选择本机工作目录，并在原生确认中授予所需权限；完整本机权限需要客户明确确认，也可随后撤销。','选择或拖入本机文件作为引用；粘贴图片需要目录写权限，主进程将副本保存在获准目录，原始本机文件不会因引用自动上传。','提交本机任务后，由本机 Codex 读取、执行并写出成果，通过公司接口使用模型和结算。撤权后不能继续使用旧授权启动本机操作。'],
  ['Download the0.7.5 Setup or Portable build and complete account authorization in the system browser.','Choose a local working directory and approve native permissions. Full local access requires explicit confirmation and can be revoked.','Choose/drop local file references. Image paste requires directory write permission and creates an approved copy; referencing an original file does not automatically upload it.','Local Codex reads, executes and writes results on the customer machine while models/billing use company services. Revocation prevents new operations under the old grant.']),
 'extension':(
  ['下载0.5.5 ZIP并解压，在 Chrome 扩展管理页开启开发者模式后加载已解压目录。','点击工具栏图标打开浏览器原生右侧栏，在浏览器授权流程中登录公司账户。','选择获准文件或目录，拖入附件或粘贴图片；查看上传状态，成功后交给云端任务处理。','原始访问权限由浏览器与用户授权限制，插件不冒充本机 Desktop Agent。退出后结束该会话的账户使用。'],
  ['Download/unzip the0.5.5 ZIP and load the unpacked directory from Chrome extension management with developer mode enabled.','Click the toolbar action to open the actual right Side Panel and authorize the company account through the browser flow.','Choose approved files/directories, drop attachments or paste images. Check upload state before using the material in cloud tasks.','Browser/user grants limit source access. This client delegates to cloud Codex; the Desktop client provides local execution. Sign out when finished.']),
 'delivery':(
  ['先完成本轮全部代码包，再执行六仓库统一构建和选定测试；本轮最终517项通过，历史失败仍保留。','独立记录付费云端任务、本机安装包 Codex、原生 Side Panel 和后台管理旅程，录制保留真实响应时间。','生成不可变候选包与文件散列，服务器先检查非 root 候选与无活动任务条件，再切换并检查就绪；失败恢复兼容旧版本。','发布安装版、便携版、扩展 ZIP 和校验清单，核对真实完整下载；更新双语说明和本轮需求覆盖层，再普通推送对应分支。'],
  ['Complete the entire code batch before six-repository builds and selected tests. All517 final tests passed; historical failures remain.','Record paid cloud, packaged local Codex, native Side Panel and Admin journeys independently, preserving actual response time.','Create immutable candidate archives/hashes. Validate a non-root candidate and the no-active-task condition before switching; restore a compatible prior version on failure.','Publish Setup, Portable, extension ZIP and checksums; verify complete downloads. Update bilingual documentation and requirement coverage before ordinary branch pushes.']),
}
media={
 'web':('workmate-195-v5-workspace.mp4',['195-v5-workspace-results.png','195-v5-workspace-dark.png']),
 'admin':('workmate-195-v6-readiness.mp4',['195-v6-role-acceptance.png']),
 'desktop':('workmate-195-v1-local-workspace.mp4',[]),
 'extension':('workmate-195-v4-side-panel.mp4',[]),
}
for name,(zh,en) in items.items():
 folder=ROOT/'dev'/('copypaste-'+name)
 for english in [False,True]:
  p=folder/('README.en.md' if english else 'README.md');text=p.read_text(encoding='utf-8')
  text=re.sub(r'(?s)<!-- usage-195 -->.*?<!-- /usage-195 -->\n*','',text,count=1)
  block='<!-- usage-195 -->\n\n'+('本轮使用流程：' if not english else 'Using this release:')+'\n\n'
  block+='\n'.join(str(i)+'. '+s for i,s in enumerate(en if english else zh,1))+'\n\n'
  if name in media:
   video,pngs=media[name]
   for f in [video,*pngs]:assert (folder/'assets/screenshots'/f).is_file(),f
   block+='[Actual recording MP4 / 实际录像](assets/screenshots/'+video+')'
   for f in pngs:block+=' · [Additional view / 页面](assets/screenshots/'+f+')'
   block+='\n\n'
  block+='<!-- /usage-195 -->\n\n'
  marker='本輪實際測試與旅程見報告；'
  assert marker in text
  text=text.replace(marker,block+marker,1)
  p.write_text(text,encoding='utf-8')
print(json.dumps({'status':'usage_details_added','readmes':12}))
