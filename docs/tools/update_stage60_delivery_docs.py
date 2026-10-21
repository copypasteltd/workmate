"""Publish admitted template-video behavior while retaining original case text."""
import argparse
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parents[2]
DELIVERY=ROOT/'dev/copypaste-delivery'
MARKER='<!-- stage60-template-video -->'


def prepend(path, paragraph):
    text=path.read_text(encoding='utf-8')
    if MARKER in text:return
    heading,body=text.split('\n\n',1)
    path.write_text(heading+'\n\n'+MARKER+'\n'+paragraph+'\n\n'+body,encoding='utf-8',newline='\n')


def main():
    p=argparse.ArgumentParser()
    for n in ('core','full','ui','native'):p.add_argument('--'+n,required=True)
    a=p.parse_args()
    reports={n:json.loads((DELIVERY/f'evidence/template-video-{kind}-{getattr(a,n)}.json').read_text(encoding='utf-8')) for n,kind in [('core','core'),('full','regression'),('ui','ui'),('native','native')]}
    assert all(r['status']=='passed' for r in reports.values())
    n,m,uc,nc=reports['core']['counts']['pass'],reports['full']['counts']['pass'],reports['ui']['counts']['checks'],reports['native']['counts']['checks']
    paragraph=(f'阶段 60 的[基础视频工程](technical/60-template-video-production.md)已实现单模板的独立脚本、分镜、字幕、品牌和固定素材/授权音轨，交付实际 MP4 与其余五类源文件。'
               f'专项 **{n}/{n}** 纳入平台 **{m}/{m}**，保留原全部 607 项命名测试；实际 Web **{uc} 项**及新打包原生客户端 **{nc} 项**通过。'
               '修复当前权限、过期素材、公开分享与预览 I/O 后校验；独立 Admin 正文权限和删除继续生效。'
               'Desktop 继续无边框、无 Electron/Alt 菜单；Extension 工具栏开关原生右侧 Side Panel，并提供视频工作台入口。'
               '两库 069→071 保留 154 张原表全部行摘要及 SQL001–069；新三表强制 RLS。'
               '当前预览在各端 `release/video-60/`，签名/安装/商店资格仍独立跟踪；实际本地合成不调用 AI。'
               '[核查回执](quality/template-video-checkpoint.json)与[当前包清单](quality/template-video-artifacts.json)保留实际版本；原始 102 项及 TC/NFR/G01–G10 完整条件不变。')
    for name in ('docs/README.md','docs/DELIVERY.md'):prepend(ROOT/name,paragraph)
    prepend(ROOT/'docs/quality/09-implementation-alignment-audit.md',paragraph.replace('(technical/','(../technical/').replace('(quality/','('))
    prepend(ROOT/'docs/quality/02-requirements-traceability.md','阶段 60 验证 REQ-018/TC-018 的单模板本地合成子流程，串联独立工程、真实字幕/音轨成片、Web 和无边框客户端、原生侧栏入口、权限与物理删除；[实际证据](template-video-checkpoint.json)绑定实际来源，原始综合验收条件保留。')
    p=ROOT/'docs/README.md';text=p.read_text(encoding='utf-8');row='| 技术 | [60 基础视频工程](technical/60-template-video-production.md) | 独立脚本/分镜、字幕/音轨、真实成片、权限与删除 |\n'
    if row not in text:
        lines=text.splitlines(keepends=True);i=next(i for i,l in enumerate(lines) if '[59 营销设计矩阵]' in l);lines.insert(i+1,row);p.write_text(''.join(lines),encoding='utf-8',newline='\n')
    p=ROOT/'docs/quality/01-test-and-acceptance-plan.md';text=p.read_text(encoding='utf-8');start=text.index('### TC-018 ');end=text.index('### TC-019 ',start)
    if MARKER not in text[start:end]:
        note=(MARKER+'\n阶段 60 执行：实际 15 秒 720×1280、30 fps/450 帧、三分镜、三段烧录繁中字幕、品牌固定 PNG 及已授权的原始非静音测试音轨；原生探测、全文件解码、实际 Chrome/打包 Desktop 播放与六类下载通过。固定素材缺失/损坏/隔离/过期明确失败；分享链接与预览 I/O 后再次校验来源，取消/重试/旧版本保持可追溯。详见[版本绑定回执](template-video-checkpoint.json)。上方原始综合用例状态保留；本次音轨为夹具原创测试音，不是生成式配音，也不包含 REQ-019/020/021 或综合发行验收。\n\n')
        p.write_text(text[:end]+note+text[end:],encoding='utf-8',newline='\n')
    prepend(ROOT/'docs/technical/30-native-window-and-browser-sidepanel.md',f'阶段 60 在新包 `release/video-60/` 实际验证 {nc} 项原生流程：无系统边框、默认菜单和 Alt 菜单；自绘控制；真实 PKCE、受保护视频桥接、成片播放及系统文件保存。扩展真实工具栏仍在右侧打开/收起原生 Side Panel，新增固定公司视频工作台入口。详见[视频回执](../quality/template-video-checkpoint.json)与[新包清单](../quality/template-video-artifacts.json)。下方阶段 59 及更早包保留历史执行范围；Chrome 左右位置遵循用户设置。')
    for name in ('docs/modules/04-marketing-production.md','docs/technical/06-media-and-data-pipelines.md'):
        prepend(ROOT/name,'基础模板视频的当前增量实现见[独立视频工程](../technical/60-template-video-production.md)：脚本/分镜/字幕/授权音轨与真实成片分开交付，固定输入、版本化队列、当前权限、媒体探测及删除可追溯。此项本地合成与生成式视频、特效、TTS/ASR 分别验收，原始需求范围保留。')
    replacements={
        'docs/README.md':('实际平台已安装 28 个原创 Skill 包并校验哈希','实际平台随附 29 个原创 Skill 包并校验哈希'),
        'docs/DELIVERY.md':('18 个角色、28 个 Skill 包已安装','18 个角色、29 个 Skill 包随附交付'),
        'docs/technical/12-implementation-and-repositories.md':('18 角色、28 个实际 Skill 包','18 角色、29 个实际 Skill 包'),
        'docs/technical/19-project-skill-lifecycle.md':('展示 28 个平台随附方法','展示 29 个平台随附方法'),
    }
    for name,(old,new) in replacements.items():
        path=ROOT/name;text=path.read_text(encoding='utf-8')
        assert (old in text) != (new in text),name
        if old in text:path.write_text(text.replace(old,new,1),encoding='utf-8',newline='\n')
    path=ROOT/'docs/contracts/README.md';text=path.read_text(encoding='utf-8')
    for old,new in (('18 个角色、28 个逻辑 Skill','18 个角色、29 个逻辑 Skill'),('设计快照有 18 个角色和 28 个逻辑技能','设计目录有 18 个角色和 29 个逻辑技能')):
        assert (old in text) != (new in text)
        text=text.replace(old,new,1)
    path.write_text(text,encoding='utf-8',newline='\n')
    for name in ('docs/technical/19-project-skill-lifecycle.md','docs/technical/25-role-template-registry-and-runtime-binding.md'):
        prepend(ROOT/name,'阶段 60 新增 `template-video-composition`，当前共 29 个随附 Skill；原 28 个包的字节与 18 个角色的完整验收条件保留。R16 v1.1.0 绑定已实现的模板视频能力，已安装旧版本不自动改变；实际合成工具链验证与完整角色资格分别记录。详见[视频工程](60-template-video-production.md)。')
    document=f'''# 基础视频工程与原生成片

状态：单模板本地合成子流程已通过实际核查，完整产品与专业角色综合验收继续跟踪。原始 REQ-018/TC-018、102 项与 TC/NFR/G01–G10 条件保持不变；生成视频 REQ-019、特效 REQ-020、TTS/ASR REQ-021 各自独立。

## 用户流程与工程

在设计画布的「影片制作」新建工程，编辑独立脚本、连续分镜、品牌颜色/固定 PNG Logo、字幕和可选授权音轨，保存后明确渲染。用户可播放成片、下载六项文件、查看工程及渲染历史、修改生成新版本、取消排队/执行中的渲染，或在失败后明确重试。并发编辑时保留用户草稿并禁止覆盖较新版本。

工程 `copypaste-video-1` 的首模板为 `campaign-cuts-1`。支持 24、25、30、30000/1001 有理帧率，3–60 秒，偶数尺寸 256–1920 像素；整数帧区间为时间线事实，并限制总像素帧预算。1–20 段连续分镜必须覆盖全部时长，0–80 条字幕有序且不重叠。文字按字素断行；缺字、溢出和不可读的品牌对比度明确失败。

图片只读同项目共享固定 PNG 版本，限制大小与解码尺寸、验证真实格式/完整摘要。音频只读固定 WAV/MP3，记录自有或已授权声明、引用、用途、入点和增益；校验真实容器、流和可用时长。源音轨必须覆盖选定片段，不补静音或自动循环；未选择音轨时明确输出无音轨文件，脚本不会自动成为配音。

## 原生编码与字体

使用原生 FFmpeg 参数数组编码 H.264/yuv420p、可选 AAC/48 kHz/立体声及 faststart。素材文件强制本地解复用，禁止网络协议或 shell 插值。按分镜/字幕边界渲染 PNG，再以同卷硬链接形成精确帧图序列；限制中间文件、输出大小、线程、分配和执行时间。临时目录由任务创建，清理前检查解析后的路径边界。

成片必须通过实际 ffprobe 帧数/时长/帧率/尺寸/编码检测及全文件解码；有音轨时记录编码后音量。字幕烧录位于 80%–92% 高度的模板安全区域，同时独立交付 WebVTT。

随 Platform 分发 Noto Sans TC，来自 Google Fonts 固定提交 `3be1884c48c3e45b52ecc725676a08f87776373e`；完整字体 SHA-256 `864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f`，保留 OFL 原文、元数据及逐文件来源。校验许可/字体字节并读取 cmap 检查字符，不依赖系统字体回退。这仅验证随附字体分发，不将任意客户字体视为已获商业许可。

渲染器指纹包含固定字体摘要、编码配置及 FFmpeg/ffprobe **版本输出**摘要。导出的工程引用固定来源版本，未嵌入原素材；重做需要原项目对应版本和一致环境，不宣称离线自包含或跨环境逐字节相同。

## 接口、版本与队列

新增 7 个受认证操作，统一位于 `/v1/tenants/:tenant/projects/:project/video-projects`。补充 OpenAPI 共 12 个 DTO；规范主契约 225 个操作及其 SHA 保持不变。

| 操作 | 行为与约束 |
| --- | --- |
| GET collection | 项目权限、稳定游标、每页 20 项、隐藏隔离/过期工程 |
| POST collection | 严格 DTO、幂等、新工程与固定输入版本原子保存 |
| GET /:video | 当前工程、不可变版本及渲染记录、六类输出可用性 |
| POST /:video/edit | expected_version、最多 50 版、旧版本不改写 |
| POST /:video/renders | expected_version、明确排队、每工程一个活动渲染、最多 100 条记录 |
| POST /:video/renders/:render/cancel | expected_revision、幂等、终态不可改写 |
| GET /:video/renders/:render/preview | 保护的 JSON/摘要字节；20 MB 内联上限，超限使用下载 |

`video_project_versions`、`video_project_sources`、`video_renders` 三表强制 RLS。队列身份不可直接访问业务表；控制身份也不能改写终态或固定工程/来源。每租户 1 个、全局 2 个编码作业；项目排队限额 20。渲染不持有长时间编码事务，采用领取租约、周期重验及发布前最终校验。撤权、取消、输入变化、隔离、过期或租约失效阻止迟到输出。进程中断留下失败事实，用户明确重试；不自动重放未知作业。

六项文件与资产引用、成功回执及审计在一次事务发布；储存/校验失败不会产生部分成功。每次渲染绑定工程版本、规范化输入摘要、固定素材版本/完整 SHA 和渲染器指纹。脚本、分镜、工程 JSON、WebVTT、媒体检测 JSON 与 MP4 均为真实独立资产。

## Codex、权限与删除

R16 视频预设以新版本 v1.1.0 保留原专业验收条件，开放已实现的 `video.render` 合成工具及相关现有读写/打包工具。新增第 29 个产品 Skill `template-video-composition`，原 28 个包逐字节保持不变；R16 只绑定 `video-storyboard`、`template-video-composition` 与 `delivery-core`，声明的工具精确对应三者并集。生成视频和配音按各自要求验收，旧已安装版本不被静默改写。受控 `video_project_queue` 仅在 execute 模式的共享项目任务暴露，ask/plan 和私有会话不暴露共享写入。工具返回真实排队标识，不把排队当作已经完成的成片；相同操作键只建一个工程与作业。

用户、当前 auth_version、企业/项目权限及固定素材在领取、执行中与发布时重验。Admin 正文查看与列表、企业/项目范围、隔离/恢复/删除分别授权，沿用已有审计控制。源素材和工程隔离/过期立即阻止派生下载，公开分享也受相同来源约束；预览与分享 I/O 后再次校验。删除源素材或工程会清除各版本正文、重放副本、媒体检测正文和六项物理对象，保留不含正文的删除凭证与依赖关系。

SQL070 首次成功应用后保持不可变；SQL071 追加即时保留期校验，覆盖清理任务执行前的访问窗口。两库 069→071 核查保留 154 张原表的全部行摘要与 SQL001–069，不生成历史作品、费用或权限事实。

本流程为本地非 AI 合成，AI 费用 HK$0，费用来源记录为 `local_composition_no_ai`。原素材上游费用另计；继续使用已授权的模拟业务配置，所有实际 AI 接入仍只能通过公司内部 OpenAI 兼容服务及 Codex 内核。

## 三端与当前证据

Web 和无边框 Desktop 提供完整编辑、播放、下载与历史；Desktop 使用现有登录桥接取得受保护字节，在 CSP 仅允许的 blob 媒体中播放，保留沙盒/上下文隔离、自绘标题栏、无 Electron 和 Alt 菜单。Extension 工具栏打开/收起 Chrome 原生 Side Panel，默认右侧并遵循 Chrome 用户偏好；其视频入口只能打开固定公司工作台，不接受任意外部地址。

专项 **{n}/{n}** 纳入平台 **{m}/{m}**，保留原全部 607 项命名测试；实际 Web **{uc} 项**、新打包原生流程 **{nc} 项**通过。8 项渲染测试包含原始 TC-018 的 15 秒 720×1280、450 帧、三分镜/三段繁中字幕/品牌素材及原创测试音轨，进行真实 Chrome、打包 Desktop 播放和六类文件下载。测试音轨是夹具作者提供的非静音测试音，不是合成语音或客户已授权音乐库。

实际来源、失败记录、初始未采纳构建、版本/字体指纹、两库保留、截图及剩余边界见[阶段回执](../quality/template-video-checkpoint.json)和[产物清单](../quality/template-video-artifacts.json)。当前包位于各端 `release/video-60/`；执行过 unpacked 程序，Setup/Portable 未签名且未执行安装、商店或生产验收。

![实际 Web 成片播放](../design/implementation/video-60/template-video-{a.ui}-player-en.png)

![实际打包无边框 Desktop](../design/implementation/video-60/video-native-{a.native}-video-player-en.png)

![实际 Chrome 原生侧栏](../design/implementation/video-60/video-native-{a.native}-sidepanel-en.png)
'''
    (ROOT/'docs/technical/60-template-video-production.md').write_text(document,encoding='utf-8',newline='\n')
    print('Published stage 60 scoped video design, immutable-history and acceptance links.')


if __name__=='__main__':main()
