from pathlib import Path
root=Path(__file__).resolve().parents[2];delivery=root/'dev/copypaste-delivery';scripts=delivery/'scripts'
source=scripts/'smoke-integrated-198-v3.mjs';target=scripts/'smoke-integrated-198-v4.mjs';assert not target.exists()
s=source.read_text(encoding='utf8')
for old,new in [('deployment-198-v1','deployment-198-v2'),('host-final-v1','host-final-v2'),('integrated-198-v1','integrated-198-v2'),('candidate198 v1','candidate198 v2'),('releases/198/','releases/19802/'),('release198.','release19802.'),('198-v3','198-v4')]:
    assert old in s,(source.name,old);s=s.replace(old,new)
target.write_text(s,encoding='utf8',newline='\n')
# README generator has not been executed. Preserve actual0.7.9 paid evidence,
# and distinguish the final renderer-only0.7.10 release and byte equivalence.
p=root/'docs/tools/update-integrated-readmes-198-v1.py';s=p.read_text(encoding='utf8')
s=s.replace("'web':('0.5.5'","'web':('0.5.6'").replace("'desktop':('0.7.9'","'desktop':('0.7.10'").replace("'delivery':('0.5.4'","'delivery':('0.5.5'")
s=s.replace('198-v4-task-directory','198-v5-task-directory').replace('workmate-198-v4-work-directory','workmate-198-v5-work-directory')
s=s.replace("'desktop':('198-v1-native-execution.png','workmate-198-v1-local-workspace')","'desktop':('198-v2-desktop-directory.png','workmate-198-v2-desktop-directory')")
s=s.replace('198-v3-service-readiness','198-v4-service-readiness').replace('workmate-198-v3-service-review','workmate-198-v4-service-review')
s=s.replace('Desktop0.7.9及Extension','Desktop0.7.10及Extension').replace('Desktop0.7.9 and Extension','Desktop0.7.10 and Extension')
s=s.replace('部署integrated-198-v1','部署integrated-198-v2').replace('integrated-198-v1 deployment','integrated-198-v2 deployment')
s=s.replace('在/releases/198/实际','在/releases/19802/实际').replace('under/releases/198/','under/releases/19802/')
s=s.replace('保留197-v2回退路径','保留198-v1回退路径').replace('197-v2 remains a rollback path','198-v1 remains a rollback path')
s=s.replace('本轮实际0.7.9发布包完成','本轮0.7.9实际包完成').replace('GIF记录附件和开始工作；完成执行截图与真实回执记录最终结果。','最终0.7.10修正目录金额为「已记录用量」，完成真实PKCE、原任务目录与返回复验；全部主进程和原生运行时与0.7.9逐字节相同，没有重复付费任务。当前GIF来自最终目录审阅；0.7.9完成执行截图及回执保留。')
s=s.replace('The GIF records attachment/start; the loaded execution PNG and receipt prove completion.','Final0.7.10 corrects directory amounts to Recorded usage and passes actual PKCE/directory/return checks. Every main-process/runtime byte matches0.7.9; no repeated paid task is claimed. Current GIF records the final directory; the0.7.9 execution PNG/receipt remain.')
s=s.replace('555项相关测试通过；','555项相关测试通过；金额措辞修正后Web／Desktop343项再次通过；').replace('555 relevant tests pass.','555 relevant tests pass, followed by343 Web/Desktop checks after the wording correction.')
s=s.replace('Web0.5.5及Desktop0.7.9','Web0.5.6及Desktop0.7.10').replace('Delivery0.5.4配套','Delivery0.5.5配套')
s=s.replace('native0.7.9/Side Panel0.5.7','native0.7.10/Side Panel0.5.7').replace('Desktop0.7.9／Side Panel0.5.7','Desktop0.7.10／Side Panel0.5.7')
s=s.replace('目录不创建任务、不执行模型、不产生费用；','目录不创建任务、不执行模型、不产生费用；')
s=s.replace('保持0.5.2，没有把','保持0.5.2，没有把')
p.write_text(s,encoding='utf8',newline='\n')
print('prepared final overlay smoke and final-version README generator')
