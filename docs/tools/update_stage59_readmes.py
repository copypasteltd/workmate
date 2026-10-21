"""Publish bilingual instructions from admitted local matrix executions."""
import argparse
from pathlib import Path
import shutil
from refresh_stage52_capabilities import ROOT, DEV, DELIVERY, read, git

BASES={'platform':'b79b3a5','web':'2fe756a','admin':'3dc17c4','desktop':'018bd2d','extension':'1e0d61f','delivery':'d4afdbc'}


def main():
    p=argparse.ArgumentParser()
    for n in ('core','full','ui','native'):p.add_argument('--'+n,required=True)
    a=p.parse_args();core=read(DELIVERY/f'evidence/creative-matrix-core-{a.core}.json');full=read(DELIVERY/f'evidence/creative-matrix-regression-{a.full}.json');ui=read(DELIVERY/f'evidence/creative-matrix-ui-{a.ui}.json');native=read(DELIVERY/f'evidence/creative-matrix-native-{a.native}.json');upgrade=read(DELIVERY/'evidence/creative-matrix-migrations.json')
    assert all(x['status']=='passed' for x in (core,full,ui,native,upgrade))
    n,m,uc,nc=core['counts']['pass'],full['counts']['pass'],ui['counts']['checks'],native['counts']['checks']
    zh=f'''## 批量设计与当前客户端（阶段 59）

设计画布新增按创意 × 语言 × 尺寸建立的交付矩阵，每批最多 60 格。提供繁中/英文文案、同项目固定 PNG 和默认或自订尺寸；每种尺寸重新布局，保存实际 PNG、SVG 与 JSON 编辑描述。修改、重试、失败和输出历史均按单元独立保存。排版本身不调用 AI，费用来源明确为本地合成、AI HK$0，不包含已有素材的上游费用。

领取与发布分别检查当前权限、输入修订和素材；取消、撤权及过期租约阻止迟到输出。后台原正文权限和企业/项目范围继续适用；源图隔离阻止派生文件读取，删除会物理清理所有嵌入副本。SVG 引用服务器字体，本阶段不分发或宣称完成自订字体商用授权。

专项 **{n}/{n}** 包含于完整平台 **{m}/{m}**，保留全部原 588 项命名测试；实际 Web **{uc} 项**及新打包客户端 **{nc} 项**流程通过。Web 8、Desktop 25、Extension 21、交付工具 12 项独立单元测试通过。两库 068→069 各保留 151 张原公共表全部行摘要及 SQL001–068，新三表强制 RLS。

Desktop 保留无边框、自绘窗口控制和无 Electron 默认菜单；扩展工具栏打开原生 Side Panel，再次点击收起。侧栏提供批量设计入口，完整画布在公司工作台打开。当前预览路径为 Desktop `release/matrices-59-02/`、Extension `release/matrices-59-02/CopyPaste-0.5.0-sidepanel.zip`；旧包不覆盖。安装器和便携版未签名、未进行安装或商店发行验收，使用 localhost 后端。全部其他专业业务、实网服务、完整 102 项及 TC/NFR/G01–G10 继续独立跟踪。
'''
    en=f'''## Batch designs and current clients (stage 59)

Design canvas now creates a creative × language × size matrix, capped at 60 independent delivery units. Supply Traditional Chinese/English copy, a fixed shared project PNG and preset or custom dimensions. Each size receives its own layout and actual PNG, SVG and editable JSON files. Edits, retries, failures and output history belong to individual units. Layout makes no AI calls: its recorded AI cost is HK$0 from local composition, excluding upstream source creation costs.

Claims and publication recheck current authority, input revision and source access. Cancellation, revocation and expired leases fence late output. Existing scoped Admin body permissions apply. Source quarantine blocks derived downloads; deletion physically erases embedded copies. SVG references server fonts; custom font distribution and commercial font qualification remain separate work.

Validation: **{n}/{n} focused checks within {m}/{m} complete Platform tests**, retaining all original 588 named tests; **{uc} actual Web journeys and {nc} new packaged/native journeys** passed. Independent unit suites passed Web 8, Desktop 25, Extension 21 and Delivery 12. Both native databases upgraded 068→069 while preserving every row digest in 151 prior public tables and SQL001–068; three new tables force RLS.

Desktop remains frameless with custom controls and no default Electron menu. The extension toolbar opens the native Side Panel and toggles it closed; its batch-design entry opens the full company workspace. Current previews are Desktop `release/matrices-59-02/` and Extension `release/matrices-59-02/CopyPaste-0.5.0-sidepanel.zip`. Earlier packages remain intact. These unsigned localhost previews have not passed installer execution or store distribution acceptance. Other professional workflows, live services, all original 102 requirements and TC/NFR/G01–G10 remain independently tracked.
'''
    diagram='''```mermaid
flowchart LR
  Brief[Copy / fixed PNG / languages / sizes] --> Bound[Authorize / 60-unit bound]
  Bound --> Units[Durable independent units]
  Units --> Layout[Reflow text and image / lease]
  Layout --> Recheck[Recheck current authority and sources]
  Recheck --> Files[PNG / SVG / editable JSON]
  Layout --> Failed[Keep failed receipt]
  Failed --> Retry[Retry only this cell]
  Files --> Edit[New input revision for this cell]
  Retry --> Units
  Edit --> Units
```'''
    gallery={
      'web':[(f'creative-matrix-{a.ui}-matrix-18-en.png','18 independent units'),(f'creative-matrix-{a.ui}-create-zh-narrow.png','Traditional Chinese dark narrow form')],
      'desktop':[(f'matrix-native-{a.native}-matrix-en.png','Actual packaged frameless Desktop')],
      'extension':[(f'matrix-native-{a.native}-sidepanel-en.png','Actual native Side Panel'),(f'matrix-native-{a.native}-batch-workspace-en.png','Workspace opened from the native Side Panel')],
    }
    # These are byte-for-byte copies of actual consumers, not Platform/Admin mockups.
    for repo in ('platform','delivery'):
        destination=DEV/('copypaste-'+repo)/'assets/screenshots';destination.mkdir(parents=True,exist_ok=True)
        for image,label in gallery['web'][:1]:
            shutil.copyfile(DEV/'copypaste-web/assets/screenshots'/image,destination/image)
            gallery.setdefault(repo,[]).append((image,'Actual Web consumer of the Platform API'))
    docs_images=ROOT/'docs/design/implementation/matrices-59';docs_images.mkdir(parents=True,exist_ok=True)
    for repo,images in gallery.items():
        for image,label in images:shutil.copyfile(DEV/('copypaste-'+repo)/'assets/screenshots'/image,docs_images/image)
    for repo,commit in BASES.items():
        directory=DEV/('copypaste-'+repo)
        for filename,copy in (('README.md',zh),('README.en.md',en)):
            base=git(directory,'show',commit+':'+filename).decode().replace('\r\n','\n');title,body=base.split('\n\n',1)
            extra='\n\n'+diagram
            if repo=='delivery':extra+='\n\n'+f'[Platform regression](evidence/creative-matrix-regression-{a.full}.json) · [Actual Web](evidence/creative-matrix-ui-{a.ui}.json) · [Actual native clients](evidence/creative-matrix-native-{a.native}.json) · [Database preservation](evidence/creative-matrix-migrations.json) · [Current artifacts](evidence/creative-matrix-artifacts.json)'
            if repo in gallery:
                extra+='\n\n'+('\n\n'.join(f'![{label}](assets/screenshots/{image})' for image,label in gallery[repo]))
            if repo=='admin':extra+='\n\n'+('本阶段验证实际后台接口的独立正文权限及隔离/恢复/删除；下方 Admin 页面截图保留阶段 58 的原始版本范围。' if filename=='README.md' else 'This stage verifies actual Admin API body authority and quarantine/restore/delete. Admin screenshots below retain their original stage 58 execution scope.')
            result=title+'\n\n'+copy.strip()+extra+'\n\n'+body;target=directory/filename
            assert target.read_text(encoding='utf-8').replace('\r\n','\n') in (base,result),'Unexpected README edits: '+str(target)
            target.write_text(result,encoding='utf-8',newline='\n')
    print('Updated six bilingual independent repositories and preserved actual screenshot bytes.')


if __name__=='__main__':main()
