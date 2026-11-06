from pathlib import Path
root=Path(__file__).resolve().parents[2];tools=root/'docs/tools'
def put(name,text):(tools/name).write_text(text,encoding='utf8',newline='\n')
text=(tools/'build-integrated-round-197-v1.py').read_text(encoding='utf8')
text=text.replace('integrated-197-v1/verification','integrated-197-v2/verification').replace('integrated-197-v1/backend-test','integrated-197-v2/backend-test').replace('integrated-197-v1/implementation-batch','integrated-197-v2/implementation-batch').replace('519','528')
text=text.replace("('real-desktop','real-desktop-journey'),", "('real-desktop','real-desktop-journey'),('desktop-delta','desktop-delta-journey'),")
text=text.replace("'owned_windows_closed']", "'owned_windows_closed','unchanged_main_process','runtime_files','actual_elapsed_ms']")
text=text.replace('.data/deployment-197/host-final-v1','.data/deployment-197-v2/host-final-v2').replace('.data/deployment-197/public-release-v2','.data/deployment-197-v2/public-release-v1').replace('.data/deployment-197/release-metadata-validation','.data/deployment-197-v2/release-metadata-validation')
text=text.replace('integrated-197-v1，','integrated-197-v2，').replace('| Backend | 0.5.4 |','| Backend | 0.5.5 |').replace('| Web | 0.5.3 |','| Web | 0.5.4 |').replace('| Desktop | 0.7.7 |','| Desktop | 0.7.8 |')
text=text.replace('Desktop 0.7.7：','Desktop 0.7.8：')
text=text.replace('[Desktop](real-desktop-journey.json)', '[Desktop 原生闭环0.7.7](real-desktop-journey.json) · [最终0.7.8及相同内核](desktop-delta-journey.json)')
needle="old=load(root/'docs/quality/integrated-round-196/requirements-overlay.json')"
insert="""assert journeys['real-desktop-journey']['desktop_version']=='0.7.7'
assert journeys['desktop-delta-journey']['desktop_version']=='0.7.8'
assert journeys['desktop-delta-journey']['unchanged_main_process']
put('packaging.json',load(dev/'copypaste-desktop/.data/deployment-197-v3/packaging-receipt.json'))
put('owned-native-accounting.json',load(delivery/'.data/deployment-197/owned-native-tasks-v1.sanitized.json'))
put('visual-review-correction.json',{'stage':197,'discovery':'Visual inspection of the original197-v2 Web screenshot found NaNs although the first UI driver had passed. That original receipt and image remain.','cause':'Linux host receipts omit host.elapsed_ms. Use measured host time or canonical started_at/finished_at; otherwise null. All Web/Desktop duration displays reject invalid values.','validation':'Final integrated528 checks, final197-v3 Web review and actual0.7.8 Desktop delta. No original receipt was relabeled.'})
"""
assert needle in text;text=text.replace(needle,insert+needle)
text=text.replace('本轮启动核账覆盖', '截图人工复核发现了 Linux 耗时缺失导致的 NaNs。197-07 整批修正后统一复验；服务端读取真实宿主耗时或原回执的规范起止时间，无法确认则返回 null，各端不显示非法耗时。原通过回执和有缺陷截图均保留。\n\n最终 Desktop0.7.8 已用真实公司登录和现有任务完成显示差异验证；包内全部主进程 JavaScript 与原生运行时逐字节等同于本轮0.7.7真实本机闭环。0.7.7 的本机任务真实消费 HK$0.035904，原预留已结算。没有把差异验证写成0.7.8重新执行了一次付费任务。\n\n本轮启动核账覆盖')
put('build-integrated-round-197-v2.py',text)

text=(tools/'update-integrated-readmes-197-v1.py').read_text(encoding='utf8').replace('519','528')
text=text.replace("'platform':('0.5.4'", "'platform':('0.5.5'").replace("'web':('0.5.3'", "'web':('0.5.4'").replace("'desktop':('0.7.7'", "'desktop':('0.7.8'")
text=text.replace('Desktop0.7.7','Desktop0.7.8').replace('Web0.5.3','Web0.5.4').replace('Backend0.5.4','Backend0.5.5')
text=text.replace("'197-v2-task-review.png','workmate-197-v2-task-review'", "'197-v3-task-review.png','workmate-197-v3-task-review'").replace("'197-v2-native-execution.png','workmate-197-v2-local-workspace'", "'197-v3-desktop-review.png','workmate-197-v3-desktop-review'").replace("'197-service-readiness.png','workmate-197-v1-service-review'", "'197-v2-service-readiness.png','workmate-197-v2-service-review'")
text=text.replace('本轮实际发布包完成 PKCE、公司文件真实上传／下载、本机 Codex 文件和命令任务、真实费用结算及撤权。', '本轮0.7.7真实包完成 PKCE、公司文件往返、本机 Codex 文件／命令任务、HK$0.035904结算及撤权。最终0.7.8完成真实登录和耗时显示差异复验，全部包内主进程 JavaScript及原生运行时与该原生闭环逐字节相同；未重复付费任务。')
text=text.replace('The actual package completes PKCE, real company file transfer, native Codex file/command work, real billing and revocation.', 'The actual0.7.7 package completes PKCE, real company file transfer, native Codex file/command work, HK$0.035904 billing and revocation. Final0.7.8 passes fresh sign-in and timing UI delta checks; all packaged main-process JavaScript/native runtime bytes match the qualified native journey. No second paid task is claimed.')
text=text.replace('下载页包含本轮三个客户端包和实际校验值。','下载页包含本轮三个客户端包和实际校验值。Linux 执行耗时使用真实测量或规范起止时间；缺失或非法值不显示为 NaN。')
text=text.replace('Downloads contain this round’s three real client packages and checksums.', 'Downloads contain this round’s three real client packages and checksums. Linux duration uses actual measurements or canonical timestamps; missing/invalid values never render as NaN.')
text=text.replace('本轮提供预留释放、并发准入／完成、零费用工具准入与费用边界回归。', '本轮提供预留释放、并发准入／完成、零费用工具准入与费用边界回归，并修复 Linux 任务回执耗时。')
text=text.replace('实际发布包验证登录、公司私人文件往返、本机 Codex 与费用、撤权和当前本机预览；', '本轮0.7.7实际包验证登录、公司私人文件往返、本机 Codex与HK$0.035904费用、撤权及当前本机预览；最终0.7.8完成真实登录、耗时显示及全部主进程／原生运行时相同字节的差异复验；')
put('update-integrated-readmes-197-v2.py',text)

text=(tools/'publish-integrated-round-197-v1.py').read_text(encoding='utf8').replace('integrated-197-v1/verification','integrated-197-v2/verification').replace('integrated-197-v1/backend','integrated-197-v2/backend')
text=text.replace("['real-desktop-journey','extension-journey','final-smoke']", "['real-desktop-journey','desktop-delta-journey','extension-journey','final-smoke']")
text=text.replace("'backend':{'src/desktop-executions.ts'}", "'backend':{'src/desktop-executions.ts','src/cloud-program-routes.ts'}")
text=text.replace("'src/main.tsx','src/client-failure.ts'", "'src/main.tsx','src/client-failure.ts','src/software-checks.tsx','src/creative-matrices.tsx'")
text=text.replace("'tests/local-agent.test.ts'}", "'tests/local-agent.test.ts','renderer/src/software-checks.tsx','renderer/src/creative-matrices.tsx'}")
text=text.replace("'tests/desktop-unstarted-settlement-197-v1.test.ts'}", "'tests/desktop-unstarted-settlement-197-v1.test.ts','src/execution-timing.ts','tests/execution-timing-197-v1.test.ts','tests/workspace-execution-196-v2.test.ts'}")
text=text.replace("'tests/company-network-197-v1.test.ts'}", "'tests/company-network-197-v1.test.ts','renderer/src/execution-timing.ts','tests/execution-timing-197-v1.test.ts'}")
text=text.replace("'web':set(),'admin':set()", "'web':{'src/execution-timing.ts','tests/execution-timing-197-v1.test.ts'},'admin':set()")
put('publish-integrated-round-197-v2.py',text)
print('Prepared final bounded reports/readmes/publication. No report is premarked passed and no commit was made.')
