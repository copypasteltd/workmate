"""Add scoped bilingual video delivery instructions and actual screenshots."""
import argparse
from pathlib import Path
import shutil
from refresh_stage52_capabilities import ROOT, DEV, DELIVERY, read, git

BASES={'platform':'9ade763','web':'1115f35','admin':'12fcb53','desktop':'6efc032','extension':'fbb724e','delivery':'86ddeb7'}


def main():
    p=argparse.ArgumentParser()
    for n in ('core','full','ui','native'): p.add_argument('--'+n,required=True)
    a=p.parse_args()
    runs={n:read(DELIVERY/f'evidence/template-video-{kind}-{getattr(a,n)}.json') for n,kind in [('core','core'),('full','regression'),('ui','ui'),('native','native')]}
    assert all(r['status']=='passed' for r in runs.values())
    n,m,uc,nc=runs['core']['counts']['pass'],runs['full']['counts']['pass'],runs['ui']['counts']['checks'],runs['native']['counts']['checks']
    zh=f'''## 模板视频与当前客户端（阶段 60）

在「设计画布 → 影片制作」创建工程，分别填写脚本、分镜、品牌、字幕及项目共享 PNG 的固定版本。可选固定 WAV/MP3，填写音轨入点、增益和自有/已授权声明。保存工程后明确点击渲染，再播放或下载 MP4、工程 JSON、脚本、分镜、WebVTT 和媒体检测六类文件；修改追加版本，失败保留记录并由用户明确重试，排队和执行中均可取消。

`campaign-cuts-1` 支持 3–60 秒、24/25/30/30000÷1001 fps 和偶数尺寸 256–1920 px，受总像素帧预算约束。以整数帧保存时间线，原生 FFmpeg 编码 H.264/yuv420p 与 AAC/48 kHz，验证实际帧数、时长、解码及音量。固定 Noto Sans TC 字体保留 OFL、来源提交和完整 SHA；缺字、文字溢出、缺失/隔离/过期素材、过短音轨明确失败。编码器指纹是版本输出摘要，工程导出引用源素材，重做需要原项目固定版本和一致环境，不保证跨环境逐字节相同。

新渲染队列拥有独立版本、租约、并发额度、取消与最终发布校验。Admin 继续分别控制企业/项目范围、正文查看、隔离、恢复与删除。分享及普通下载都重验派生来源；删除清理实际对象和正文副本。原生合成不调用 AI，AI HK$0 只描述本次合成，原素材费用另计。

R16 视频角色以新预设 v1.1.0 开放已实现的 `video.render` 合成工具，执行模式中的受控 Codex 工具可幂等提交工程与排队；只读、计划及私有会话不暴露共享写入工具。新增第 29 个预设 Skill `template-video-composition`，原 28 个包和 18 个角色的完整验收条件保留，旧角色版本不自动改写。生成式视频、特效、TTS/ASR 和完整专业角色仍按独立需求跟踪。

专项 **{n}/{n}** 纳入完整平台 **{m}/{m}**，保留原全部 607 项命名测试；实际 Web **{uc} 项**、新打包原生流程 **{nc} 项**通过。Web 8、Desktop 25、Extension 21、Delivery 12 项独立测试通过。两库 069→071 保留 154 张原公共表全部行摘要及 SQL001–069，新三表强制 RLS。

Desktop 无系统边框、Electron 默认菜单或 Alt 菜单，使用自绘窗口控制；受保护成片通过现有登录桥接在本地播放器打开。Extension 工具栏仍打开/收起 Chrome 原生 Side Panel，默认右侧并遵循 Chrome 用户偏好；新增视频工作台入口。当前预览位于 Desktop `release/video-60/` 和 Extension `release/video-60/CopyPaste-0.5.0-sidepanel.zip`。实际执行 unpacked 程序；安装器/便携版未签名、未执行安装验收，使用 localhost 后端。原始 102 项及 TC/NFR/G01–G10 的综合验收条件保留。
'''
    en=f'''## Template video and current clients (stage 60)

Open Design canvas → Video production. Save independent scripts, scene/storyboard tracks, branding, captions and fixed shared project PNG versions. Optionally select a fixed WAV/MP3, its in point/gain and an ownership or license statement. Save the project, explicitly render, then play or download six files: MP4, project JSON, script, storyboard, WebVTT and media probe. Edits append versions; failed receipts remain visible and retries are explicit. Queued and running renders can be cancelled.

`campaign-cuts-1` supports 3–60 seconds, 24/25/30/30000÷1001 fps and even dimensions from 256 to 1920 px within a total pixel/frame budget. Integer-frame timelines are encoded by native FFmpeg as H.264/yuv420p and optional AAC/48 kHz. Actual frames, duration, complete decoding and post-encode audio volume are verified. The bundled Noto Sans TC font includes its OFL, pinned source commit and full SHA. Missing glyphs, overflowing text, missing/quarantined/expired sources and short audio fail explicitly. Encoder fingerprints hash version output. Exported projects reference fixed source media: rebuilding requires those original versions and the recorded environment; byte-identical cross-environment output is not claimed.

The durable queue has immutable input versions, leases, bounded concurrency, cancellation and final authority/source checks. Admin scope, body reading and content actions remain independent permissions. Shared and authenticated downloads recheck derived source availability. Deletion physically erases objects and content copies. Composition makes no AI call; AI HK$0 excludes upstream source creation costs.

New R16 video preset v1.1.0 exposes the implemented `video.render` composition tool. Controlled Codex execute-mode calls can idempotently create and queue a project. Ask/plan and private conversations do not expose this shared writer. The 29th preset skill, `template-video-composition`, preserves the earlier 28 packages and complete acceptance conditions of all 18 roles; earlier installed versions remain unchanged. Generated video, effects, TTS/ASR and complete professional-role qualification retain separate requirements.

Validation: **{n}/{n} focused checks within {m}/{m} full Platform tests**, retaining all 607 previous named tests; **{uc} actual Web checks and {nc} newly packaged native checks** passed. Independent suites: Web 8, Desktop 25, Extension 21 and Delivery 12. Both native databases upgraded 069→071 while preserving all row digests in 154 prior public tables and SQL001–069; three new tables force RLS.

Desktop remains frameless, with custom controls and no Electron or Alt menu. Protected video bytes pass through the existing authenticated bridge into the local player. The extension toolbar still toggles Chrome's native Side Panel, right by default and subject to the user's Chrome setting, with a new video workspace entry. Current previews: Desktop `release/video-60/`, Extension `release/video-60/CopyPaste-0.5.0-sidepanel.zip`. The unpacked runtime was executed. Setup/Portable remain unsigned localhost previews without installer execution acceptance. All original 102 requirements and TC/NFR/G01–G10 retain their complete acceptance conditions.
'''
    diagram='''```mermaid
flowchart LR
  Editor[Script / storyboard / captions / supplied audio] --> Version[Save immutable project revision]
  Version --> Queue[Explicit render / bounded durable queue]
  Codex[Controlled Codex execute tool] --> Queue
  Queue --> Check[Current authority / fixed source SHA / expiry]
  Check --> Encode[Native FFmpeg / integer frames]
  Encode --> Probe[Full decode / media probe / audio volume]
  Probe --> Publish[Recheck lease and sources / publish six files]
  Publish --> Playback[Web and frameless Desktop playback]
  Panel[Native Chrome Side Panel] --> Editor
  Queue --> Cancel[Cancel / immutable failure / explicit retry]
  Publish --> Policy[Admin isolation / source expiry / physical deletion]
```'''
    gallery={
      'web':[(f'template-video-{a.ui}-player-en.png','Actual Web video playback'),(f'template-video-{a.ui}-editor-zh-narrow.png','Traditional Chinese dark video editor')],
      'desktop':[(f'video-native-{a.native}-video-player-en.png','Actual packaged frameless Desktop video player')],
      'extension':[(f'video-native-{a.native}-sidepanel-en.png','Actual right native Side Panel'),(f'video-native-{a.native}-video-workspace-en.png','Video workspace opened from the native Side Panel')],
    }
    for repo in ('platform','delivery'):
        destination=DEV/('copypaste-'+repo)/'assets/screenshots';destination.mkdir(parents=True,exist_ok=True)
        image=gallery['web'][0][0];shutil.copyfile(DEV/'copypaste-web/assets/screenshots'/image,destination/image)
        gallery[repo]=[(image,'Actual Web consumer of the video API')]
    docs_images=ROOT/'docs/design/implementation/video-60';docs_images.mkdir(parents=True,exist_ok=True)
    for repo, images in gallery.items():
        for image,_ in images:shutil.copyfile(DEV/('copypaste-'+repo)/'assets/screenshots'/image,docs_images/image)
    for repo,commit in BASES.items():
        directory=DEV/('copypaste-'+repo)
        for filename,copy in (('README.md',zh),('README.en.md',en)):
            base=git(directory,'show',commit+':'+filename).decode().replace('\r\n','\n');title,body=base.split('\n\n',1)
            extra='\n\n'+diagram
            if repo=='delivery':
                extra+='\n\n'+f'[Full regression](evidence/template-video-regression-{a.full}.json) · [Actual Web](evidence/template-video-ui-{a.ui}.json) · [Actual native clients](evidence/template-video-native-{a.native}.json) · [Database preservation](evidence/template-video-migrations.json) · [Current artifacts](evidence/template-video-artifacts.json)'
                extra+='\n\n'+f'[Actual 15-second MP4](assets/fixtures/template-video-{a.ui}/creative.mp4) · [Frozen-source project](assets/fixtures/template-video-{a.ui}/project.json) · [Fixture provenance](assets/fixtures/template-video-{a.ui}/manifest.json)'
            if repo in gallery:
                extra+='\n\n'+'\n\n'.join(f'![{label}](assets/screenshots/{image})' for image,label in gallery[repo])
            if repo=='admin':
                extra+='\n\n'+('本阶段验证实际视频后台 API 的独立正文权限、范围和内容操作；下方页面截图保留原阶段的实际执行范围。' if filename=='README.md' else 'This stage verifies actual scoped video Admin API body permissions and content actions. Admin screenshots below retain their original execution scope.')
            result=title+'\n\n'+copy.strip()+extra+'\n\n'+body;target=directory/filename
            assert target.read_text(encoding='utf-8').replace('\r\n','\n') in (base,result),'Unexpected README edits: '+str(target)
            target.write_text(result,encoding='utf-8',newline='\n')
    print('Updated six bilingual repositories with actual video screenshots and scoped delivery instructions.')


if __name__=='__main__':main()
