"""Refresh the numbered 26-gap assessment from actual stage-86 evidence."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args], cwd=repo).decode("utf-8").strip()


def main():
    output = ROOT / "docs/quality/2026-10-25-goal-gap-review-06.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/shared-project-checkpoint.json"
    proof = read(checkpoint_file)
    assert proof["status"] == "verified_shared_project_guidance_and_private_chat"
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    assert progress["summary"] == {"partial_verified": 84, "completion_not_proven": 18}
    assessment = ROOT / "docs/quality/2026-10-25-goal-gap-assessment.md"
    text = assessment.read_text(encoding="utf-8")
    title, prior = text.split("\n", 1)
    assert "## 第六次" not in prior
    prior = prior[prior.index("## 第五次工作区复核：当前状态"):]
    prior = prior.replace("## 第五次工作区复核：当前状态", "## 第五次工作区复核：历史状态", 1)
    prior = prior.replace("## English\n", "## English: earlier assessment snapshots\n", 1)
    current = f"""评估日期：2026-10-25，Asia/Taipei；本次为同日第六次复核，覆盖阶段 86 的实际开发与重新验证。完整目标、26 个差异组和原 102 项需求保持；此处记录限定增量的修复结果及剩余差异，不据测试数量推算完成百分比。

## 第六次工作区复核：当前状态

项目共享配置、侧栏私有附件和紧凑视口已有当前源码的实际跨端证据。新工作固定版本、原线程保留旧版或原先无配置状态；本机 Codex 实际执行 v3/v3/v4、读取获准原字节、写入本地文件并分别结算，没有以云端任务替代。此前 Desktop 的来源失效失败现已定位并修复：补齐刷新，拆开历史与编辑弹窗的重复 React key，消除遗留旧正文。生成视频同范围刷新也保留原播放器和暂停位置，错误或换范围仍清除旧内容。旧库夹具改为构造 SQL101 既有任务，再依次核对 SQL102、SQL103 和重放，保持原音频字节、未知费用及未追补授权/配置的事实；不添加产品旧结构绕过。失败回执保留原结果。

| 复核编号 | 当前证据 | 对完成状态的影响 |
| --- | --- | --- |
| REVIEW6-01 | 当前平台 {proof['platform_tests']['tests']} 项通过，79 测试文件/20 原生数据库批次，原 1001 个嵌套用例全部保留；核心 25、兼容 36、客户端 139 分别通过 | 当前完整测试清单重新执行并绑定未变化源码；各范围不能相加代替产品验收 |
| REVIEW6-02 | 实际 Web/Admin/原生右侧栏 14 项通过；附件原字节由上传者下载，同项目另一编辑者不能列出、读版本、下载或访问其私有会话 | 旧附件共享故障已有实际修复；完整大文件、休眠、站点/撤权矩阵继续保留 |
| REVIEW6-03 | 实际紧凑 Chrome 窗口，两种语言展开说明/设置，输入、发送、当前页面均可见且命中；实际点击发送，附加工具末项可经键盘到达并返回聊天 | 修复此前窄侧栏输入区被挤出的限定故障；不等于全端可访问性/200% 缩放/DPI 验收 |
| REVIEW6-04 | 打包 Desktop 50 项通过；来源隔离后当前/历史正文移出 DOM，恢复不改原摘要；新本机执行 v3/v3/v4，三项各结算 90 港币微额 | 新共享配置本机流程已进入并通过；完整本机调度、全部应用操作、恢复和角色资格仍待补齐 |
| REVIEW6-05 | SQL001–102 和四份历史 OpenAPI 原字节保留；新增 SQL103/八项接口；实际配置路由 487，另有一条明确条件 demo 路由 | 增量未覆盖已发布契约；Admin 元数据/正文、隔离/恢复/永久擦除分别授权并有实际观察 |
| REVIEW6-06 | REQ-065 从未证明更新为部分验证，102 项原需求与原完整条件原样保留；当前登记 84 部分、18 未证明完整、0 完整验收，18 候选角色/0 正式合格 | 反映已完成开发与局部验证，继续保留完整 TC-065、至少十二角色资格及 G01–G10；其余差异不收缩 |

当前来源绑定见[阶段 86 检查点](shared-project-checkpoint.json)，工作树输入与回执摘要见[第六次复核记录](2026-10-25-goal-gap-review-06.json)。各端中英 README、实际截图/GIF/MP4 和发布清单按本轮结果同步；最终远程状态以[发布清单](workmate-publication.json)及实际发布回执为准，预提交输入不冒充最终远程状态。

归档链接另按[明确的来源位置与摘要规则](../governance/05-archive-link-resolution.md)核对；历史通用检查的归档相对路径报错仍保留原时间。外部网址与页内锚点不属于本地文件存在性检查的通过范围。

English: Current stage-86 sources pass {proof['platform_tests']['tests']} platform cases preserving all 1001 previous cases, 25 focused, 36 compatibility, 139 client tests, 14 actual Web/Admin/native Side Panel checks and 50 packaged customer-local Desktop checks. Real Codex work pins v3/v3/v4 and separately settles three 90-micro-HKD tasks. The orphaned history body and same-scope video-player refresh defects are repaired; failed attempts remain failed. REQ-065 advances to partial verification, giving 84 partial / 18 unproven / 0 fully accepted requirements. Original conditions, all 26 gap groups, at least twelve qualified roles and G01–G10 remain open. Synthetic providers remain authorized; live professional quality is not claimed.

"""
    text = title + "\n\n" + current + prior
    replacements = {
        "| 部分验证 | 83 项 |": "| 部分验证 | 84 项 |",
        "| 尚未证明完整达标 | 19 项 |": "| 尚未证明完整达标 | 18 项 |",
        "也不能据此声称只剩 19 项开发工作": "也不能据此声称只剩 18 项开发工作",
        "| 当前共享配置专项 / 实际 Web、Admin、侧栏 | 分别 24 / 12 项通过 | 分别绑定当前选定源码；实际跨用户附件隔离及共享配置治理已观察，完整回归未完成 |": "| 当前核心 / 兼容 / 客户端 / 实际 Web、Admin、侧栏 | 分别 25 / 36 / 139 / 14 项通过 | 分别绑定当前选定源码；私有附件、来源治理与紧凑视口均有实际证据 |",
        "| 当前打包 Desktop 增量 | 38 个观察后整体失败 | 等待隔离资料提示超时；新增本机配置版本固定与续做场景未进入，不计为通过 |": "| 当前完整平台 / 打包 Desktop 增量 | 分别 1023 / 50 项通过 | 保留原 1001 平台用例；本机版本固定、续做、资料读取与费用逐项核对，完整业务验收仍开放 |",
        "本报告不更改上述状态，也不给出无法据此推导的完成百分比。": "REQ-065 的限定进展已据证据更新，其余原始条件保留；不给出无法据此推导的完成百分比。",
    }
    for old, new in replacements.items():
        assert text.count(old) == 1, old
        text = text.replace(old, new, 1)
    text, count = re.subn(r"^(\| REQ-065 \| P1 \| )未证明完整( \|.*)$", r"\1部分\2", text, flags=re.M)
    assert count == 1, "REQ-065 mapping must reflect its newly verified partial scope"
    rows = {
        "GAP-03": "| GAP-03 | Extension 对话和文件；流程待补 | 原生右侧栏、独立云端聊天、私有会话分片上传和同项目编辑者隔离；实际两种语言、紧凑窗口、展开说明/设置的输入/发送/当前页面命中和末项键盘访问已通过 | 完整大文件、中断、真实 worker 休眠、换项目、撤权及站点授权矩阵仍待验收；未发附件不承诺关闭侧栏后自动恢复 | 无需 Desktop 完成私有上传与消息绑定；明确项目共享。补齐故障矩阵，不重复提交或串会话，各状态输入与末项可访问 | P0 |",
        "GAP-13": "| GAP-13 | 项目共享、记忆与云文件；流程与验收待补 | 共享配置草稿/预览/不可变发布、继承摘要、固定版本及独立正文治理；核心 25、跨端 14、本机 Desktop 50 和当前平台 1023 通过；本机实际 v3/v3/v4、原字节和各自费用已核对 | 长会话、完整个人偏好交集、Office/PDF 和大目录、全部并发/撤权边界及客户完整业务接受尚未齐；当前列表上限仍需按规模验证 | 新工作固定配置，旧工作保留原版或原先无配置；仅继承明确获准资料，当前权限持续检查；完成 TC-065 全部条件后再关闭 | P1 |",
        "GAP-21": "| GAP-21 | CopyPaste 视觉、双语和可访问性；流程、验收待补 | 品牌 token、浅深主题、繁英；Desktop 无边框/菜单及可见滚动条，真实滚动/焦点/进度保留；窄侧栏展开状态输入/发送可达，视频同范围刷新保留原播放器 | 紧凑侧栏设置态的多重滚动区仍偏密集，需收敛视觉层次；全端组件单源、全部状态/动态文案、时区/指标表达、200% 缩放/键盘/对比/reduced-motion 与目标 DPI 尚未完整验收 | 全端关键页面、错误与空态贴合品牌；各声明尺寸下输入、发送、末项及媒体持续可访问，隐藏轨道不裁切操作 | P0 |",
        "GAP-25": "| GAP-25 | 文档与验收登记；持续维护与验收待补 | docs 主文档、六组件双语 README、实际截图/GIF/MP4、唯一当前检查点；新增归档原位置/摘要校验且旧档案不改写，102 原需求及条件保留 | 完整逐项验收仍开放；后续每次开发继续同步状态、实际媒体和源绑定；外部网址/页内锚点未在本地链接范围验证 | 当前入口区分实现、限定证据与完整验收；按真实结果推进原 TC 和 G01–G10，不用统计数量代替完成率 | P1 |",
    }
    for gap, row in rows.items():
        text, count = re.subn(r"^\| " + gap + r" \|.*$", lambda _: row, text, flags=re.M)
        assert count == 1, gap
    text, count = re.subn(r"^\| 项目与团队 \|.*$", "| 项目与团队 | [阶段 86 共享配置](shared-project-checkpoint.json)、[本机父子 SOP](../technical/76-desktop-native-workflows.md) | 项目配置发布与版本继承已有实际证据；持久专业团队实体、协调/依赖图和统一总预算仍须建设 |", text, flags=re.M)
    assert count == 1
    text = text.replace("当前第五次输入为 738d9f2c67f560823cee2d942668aa3a1ab33c0d", "第五次输入为 738d9f2c67f560823cee2d942668aa3a1ab33c0d")
    text = text.replace("这是一份差异评估与建议顺序，没有执行新的业务修复，也没有将当前版本标为正式完整交付。", "本轮已实施并验证阶段 86 的限定修复，上表仍保留全部目标差异；当前版本未登记为正式完整交付。")
    text, count = re.subn(r"^1\. 保留 GAP-03/GAP-20.*$", "1. 保留阶段 86 的私有附件、紧凑侧栏、共享配置与本机固定版本证据，继续补齐登录到首项成果的完整异常/恢复流程、真实休眠/大文件/站点权限和全部业务角色矩阵；其余 GAP-01–26 继续推进。", text, flags=re.M)
    assert count == 1
    assert set(re.findall(r"^\| (GAP-\d{2}) \|", text, re.M)) == {f"GAP-{i:02}" for i in range(1, 27)}
    assert set(re.findall(r"REQ-\d{3}", text)) == {f"REQ-{i:03}" for i in range(1, 103)}
    assessment.write_text(text, encoding="utf-8", newline="\n")
    repositories = []
    for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
        repo = DEV / ("copypaste-" + component)
        repositories.append({"component": component, "input_head": git(repo, "rev-parse", "HEAD"),
                             "branch": git(repo, "branch", "--show-current"), "has_worktree_changes": bool(git(repo, "status", "--porcelain"))})
    result = {"schema_version": "1.0", "at": datetime.now(timezone.utc).isoformat(),
        "scope": "Sixth same-day progress assessment after actual stage-86 implementation and qualification; pre-publication repository inputs are distinguished from final remote state.",
        "root_input_head": git(ROOT, "rev-parse", "HEAD"), "repositories": repositories,
        "checkpoint": {"path": checkpoint_file.relative_to(ROOT).as_posix(), "sha256": digest(checkpoint_file)},
        "qualification_scopes": proof["qualification_scopes"], "platform_tests": proof["platform_tests"],
        "original_acceptance": {"requirements": 102, "cases": 102, **progress["summary"], "fully_accepted": 0, "qualified_roles": 0, "candidates": 18, "G01_G10": "not_proven"},
        "gap_groups": 26, "all_102_requirement_ids_mapped": True,
        "assessed_document_sha256": {assessment.relative_to(ROOT).as_posix(): digest(assessment)},
        "limitations": proof["not_validated"], "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "refreshed_numbered_gap_assessment", "groups": 26, "requirements": 102, "complete_acceptance": 0}))


if __name__ == "__main__":
    main()
