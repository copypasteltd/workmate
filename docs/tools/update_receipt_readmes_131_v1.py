"""Add verified Stage131 user flow, diagrams and actual media to bilingual READMEs."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / "dev/copypaste-desktop-publication-125"
DELIVERY = ROOT / "dev/copypaste-delivery"
REPORT = json.loads((DELIVERY / "evidence/receipt-sync-131/desktop-01-journey.json").read_bytes())
assert REPORT["status"] == "passed" and len(REPORT["checks"]) == 8
assert len(REPORT["screenshots"]) == 4 and len(REPORT["recordings"]) == 2
MARKER = "<!-- durable-receipt-stage131 -->"
BASE = "https://github.com/copypasteltd/workmate/blob/"


def section(language, component):
    chinese = language == "zh"
    docs = "" if component == "docs" else BASE + "main/docs/"
    media = "assets/screenshots/" if component == "desktop" else BASE + "desktop/assets/screenshots/"
    stem = media + "workmate-receipt-sync-131-01-"
    heading = "本机结果与费用回执持久同步 · 阶段131" if chinese else "Durable native result and billing receipt synchronization · Stage131"
    text = (
        "本机子任务完成后，即使公司接口未收到完成请求，或已结算但响应丢失，原始结果仍保存在本机。父任务只有确认子任务回执后才能清理操作记录。恢复连线后选择“同步已储存的回执”；撤销本机权限后或完整退出并重新打开应用后，仍可同步原回执。同步不会重新运行命令、启动QA或新增模型请求。\n\n"
        "已知成功的子任务按公司实际观测结算一次。未知父任务继续保留原预算、等待费用核对；同步成功不代表整个流程成功，也不解除未知本机副作用限制。账号切换和服务端权限继续校验，不能绕过原登录族或企业权限。"
        if chinese else
        "A completed local child keeps its original result when the company finish request is not delivered or its acknowledgement is lost after settlement. The parent cannot clear the operation until the child receipt is acknowledged. Choose **Sync saved receipts** after reconnecting. This also works after withdrawing local access and fully quitting and reopening the app, without replaying commands, starting QA or making another model request.\n\n"
        "The known child settles once using company-observed usage. An unknown parent retains its original budget hold for reconciliation. Receipt synchronization does not establish overall workflow success or clear uncertain local side effects. Account and server authorization remain enforced; another login family or tenant permission cannot be bypassed."
    )
    graph = ("保存原子任务报告", "补交原回执", "原任务终态确认", "提交父任务结果", "未知父任务待核对", "断网或响应丢失", "保留本机记录", "重启或撤权后同步") if chinese else (
        "Save original child report", "Send original receipt", "Original task terminal acknowledgement", "Report parent outcome", "Unknown parent remains under review", "Offline or acknowledgement lost", "Keep local checkpoint", "Sync after restart or access withdrawal")
    diagram = "```mermaid\nflowchart LR\n  A["+graph[0]+"] --> B["+graph[1]+"]\n  B --> C["+graph[2]+"]\n  C --> D["+graph[3]+"]\n  D --> E["+graph[4]+"]\n  B --> F["+graph[5]+"]\n  F --> G["+graph[6]+"]\n  G --> H["+graph[7]+"]\n  H --> B\n```"
    qualification = (
        "限定验证通过：124项控制层检查（含15项新增回执边界）、43项真实固定Codex检查、3条真实本机/SQL回执丢失流程、2项编译检查和8项实际未签名Desktop界面检查。旧版与新版对照确认原缺陷：旧版遗漏子任务完成请求，新版先子后父。真实进程、命令、文件、数据库、HTTP响应丢失和完整应用重启已运行；模型回答及系统对话框选择为测试输入。全部所属测试资源已关闭，原始失败、执行脚本和源码快照保留。"
        if chinese else
        "Bounded validation passed: 124 controller checks including 15 new receipt boundaries, 43 actual pinned-Codex checks, three actual native/SQL receipt-loss journeys, two compiler checks and eight actual unsigned packaged-Desktop checks. An old/current comparison reproduces the lost child finish request on the old code and verifies child-before-parent delivery on the new code. Processes, commands, files, SQL, dropped HTTP responses and a full application restart are actual; model responses and native dialog choices are synthetic. All owned test resources were closed. Original failures, executed QA and source snapshots remain preserved."
    )
    links = (f"[实现方案]({docs}technical/131-desktop-durable-receipt-sync.md) · [当前检查点]({docs}quality/receipt-sync-checkpoint-131.json) · [完整编号待办]({docs}quality/remaining-work-stage131.md)" if chinese else
             f"[Implementation]({docs}technical/131-desktop-durable-receipt-sync.md) · [Current checkpoint]({docs}quality/receipt-sync-checkpoint-131.json) · [Complete numbered open work]({docs}quality/remaining-work-stage131.md)")
    visual = (f"![Saved native receipts awaiting synchronization]({stem}saved-receipts-pending-en.png)\n\n"
              f"![Actual receipt loss and local permission withdrawal]({stem}receipt-loss-and-permission-withdrawal.gif)\n\n"
              f"![Actual synchronization after full application restart]({stem}receipt-sync-after-application-restart.gif)\n\n"
              f"[Fee confirmation]({stem}child-fee-confirmation-en.png) · [撤权后中文提示]({stem}revoked-receipts-pending-zh.png) · [Original receipts synchronized]({stem}original-receipts-synchronized-en.png) · [Loss/withdrawal MP4]({stem}receipt-loss-and-permission-withdrawal.mp4) · [Restart/sync MP4]({stem}receipt-sync-after-application-restart.mp4)")
    limits = ("当前仍有89条必需、12条未确认建议、1条可选完整验收记录开放，不能理解为102个模块尚未编码。任意崩溃/旧进程回收、换登录族后的处理、全部父任务账务核对、专业角色、正式模型/媒体及签名安装继续推进。当前增量使用阶段131独立清单与发布器；阶段128和130证据保持各自历史范围。" if chinese else
              "The full-acceptance ledger retains 89 required, 12 unconfirmed suggestion and one optional records; these are not 102 uncoded modules. Arbitrary crash/process reclamation, login-family changes, complete parent accounting reconciliation, professional roles, live model/media services and signed installation remain open. This increment uses the independent Stage131 manifest/publisher; Stage128 and130 evidence retains its original historical scope.")
    commands = ""
    if component == "desktop":
        commands = "```powershell\nnode scripts/qualify-receipt-sync-v1.mjs unit 11\nnode scripts/qualify-receipt-sync-v1.mjs native 12\nnode scripts/qualify-receipt-sync-v1.mjs types 13\n```\n\n" + ("运行前先准备固定版本Codex；使用新的两位执行编号，禁止覆盖已有原始证据。\n\n" if chinese else "Prepare the pinned Codex runtime first. Use fresh two-digit attempt numbers; never overwrite original evidence.\n\n")
    if component == "delivery":
        commands = "```powershell\nnode scripts/qualify-receipt-journeys-v2.mjs 11\n$env:COPYPASTE_NPM_CLI = 'C:\\path\\to\\npm-cli.js'\nnode scripts/run-desktop-receipt-131-v2.mjs 11\n```\n\n" + ("实际前置配置、固定运行时、原生数据库路径及合格逻辑报告需要先准备；版本化脚本绑定本轮明确通过的前置报告，其他代码版本需建立新的资格脚本和执行编号，不得修改已执行脚本来套用新结果。\n\n" if chinese else "Prepare the actual environment, pinned runtime, native database and qualified prerequisite reports. Versioned QA binds this increment's explicit passing prerequisites. Other source versions need new qualification scripts and attempt numbers; do not edit executed QA to relabel results.\n\n")
    if component == "docs":
        commands = "```powershell\npython -X utf8 docs/tools/record_receipt_sync_131_v1.py --verify\npython -X utf8 docs/tools/prepare_receipt_publication_131_v1.py --verify\npython -X utf8 docs/tools/publish_receipt_sync_131_v1.py --push\n```\n\n" + ("发布器核对阶段130真实远端回执、完整历史安全与README链接、当前Git字节和八个远端分支；只进行普通原子推送，不强推。常规开发者构建/启动方式见后续仓库说明。\n\n" if chinese else "The publisher checks the real Stage130 remote receipt, full history security/README links, current Git bytes and all eight remote refs, then uses an ordinary atomic push. General build/start instructions follow below.\n\n")
    return MARKER+"\n## "+heading+"\n\n"+text+"\n\n"+diagram+"\n\n"+qualification+"\n\n"+links+"\n\n"+visual+"\n\n"+limits+"\n\n"+commands+"---\n\n"


for folder, component in [(DESKTOP, "desktop"), (DELIVERY, "delivery"), (ROOT / "docs", "docs")]:
    for name, language in [("README.md", "zh"), ("README.en.md", "en")]:
        file = folder / name
        content = file.read_text(encoding="utf-8")
        assert MARKER not in content
        title, remainder = content.split("\n", 1)
        file.write_text(title + "\n\n" + section(language, component) + remainder.lstrip("\n"), encoding="utf-8", newline="\n")
print("Updated six bilingual README files with verified Stage131 behavior, diagrams and actual media")
