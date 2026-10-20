"""Keep current bounded support evidence distinct from historical acceptance."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs'


def save(path, text):
    path.write_text(text, encoding='utf-8', newline='\n')


def insert_after_title(relative, text):
    path = DOCS / relative
    original = path.read_text(encoding='utf-8')
    marker = '<!-- stage51-support -->'
    assert marker not in original, relative
    head, rest = original.split('\n', 1)
    save(path, head + '\n\n' + marker + '\n' + text + '\n' + rest)


def main():
    path = DOCS / 'README.md'
    text = path.read_text(encoding='utf-8')
    start = text.index('当前费用通知增量：')
    end = text.index('VIP 与明确赠额', start)
    text = text[:start] + (
        '当前增量是 [限时只读支持与用户授权](technical/51-controlled-read-only-support.md)：真实管理员身份、明确用户/项目/期限、每次读取复查、正文双重条件、撤销与到期清空。14 组支持专项纳入平台 424/424（711 份来源）；实际 Web/Admin 8/8（816 份来源），另有三个原规范端点响应及一份提取 DTO、9 张未编辑截图。062 两库升级各保留 122 张原公共表，001–061 和历史校验值不变。\n\n'
        'Desktop 继续无边框、自绘窗口控制且无 Electron 默认菜单；Extension 工具栏打开 Chrome 原生 Side Panel，在右侧设置下实测。当前打包外观 10 项、原生权益 6 项、三端费用 8 项及会话恢复独立核查，见 [原生预览与规则](technical/30-native-window-and-browser-sidepanel.md)。完整 102 项 TC、NFR、G01–G10、安装/签名与生产资格持续逐项跟踪。\n\n'
        '此前的 [费用通知与三端账户](technical/50-durable-financial-notifications.md) 保留原事务/outbox 设计与升级证据，当前三端费用复查绑定 817 份来源。原规范和补充合同分别计数，阶段 50 当时的 410/707、808 份来源报告作为历史归档。\n\n'
    ) + text[end:]
    save(path, text)
    path = DOCS / 'quality/09-implementation-alignment-audit.md'
    text = path.read_text(encoding='utf-8')
    text = text.replace('当前最新增量见 [费用通知与三端账户视图]', '阶段 50 当时增量见 [费用通知与三端账户视图]', 1)
    save(path, text)
    insert_after_title('quality/09-implementation-alignment-audit.md',
        '最新局部修复见 [限时只读支持](../technical/51-controlled-read-only-support.md)：平台 424/424，711 份当前来源；14 组支持专项、真实页面 8/8、816 份来源、9 张未编辑截图和四次严格响应检查（3 个原规范端点及 1 份提取 DTO）。062 实际升级两个原生库，每库 122 张原公共表及旧 001–061 不变。客户授权不增加管理员正文、资金、VIP 或用户凭证权限，支持上下文只能执行限定只读路径。界面与打包客户端、既有权限/费用/容量/登录另有来源绑定复查；失败、旧路由清单及旧包原字节保留。全部原始 102 项完整验收、NFR 和 G01–G10 仍保留，以下阶段历史数字不累计为完整 TC。')
    insert_after_title('00-document-map.md',
        '当前阶段 51 的 [限时只读支持](technical/51-controlled-read-only-support.md) 补充用户授权、后台 A13、真实管理员范围、事务与撤销/到期界面，并保留全部原验收；[逐项进度](quality/requirements-alignment-progress.json) 记录当前来源及有界证据。Desktop 无边框、无默认菜单和 Chrome 原生右侧 Side Panel 的规则以 [客户端专册](technical/30-native-window-and-browser-sidepanel.md) 为准。')
    insert_after_title('product/08-admin-dashboard.md',
        'A13 当前已实现 [限时只读支持](../technical/51-controlled-read-only-support.md)：客户在账户设置选择明确项目和期限并可撤销；管理员从真实用户目录选择对象，以自己的 MFA 会话进入有身份横幅的只读视图。客户授权不增加正文、资金或 VIP 权限，不切换到用户登录。撤销/到期/权限变化会拒绝读取并清空页面，详细时序和局部验收见专册，完整 REQ-095/TC-095 保留。')
    insert_after_title('technical/11-admin-control-plane.md',
        '当前支持控制面实现见 [限时只读支持](51-controlled-read-only-support.md)：规范支持会话和客户授权、冻结项目范围、真实管理员会话与当前版本、独立正文门槛、受限只读上下文、原子 AdminOperation/审计/幂等，以及 062 前向迁移。旧无目标支持入口不再创建宽泛授权；全部 Admin 权限和完整 TC 继续按原规范验收。')
    insert_after_title('technical/10-frontend-design-system.md',
        '阶段 51 的 [支持授权与只读视图](51-controlled-read-only-support.md) 延续现有 CopyPaste 蓝色、纸面/墨色、Logo 和字体 token；实际浅深、繁中/英文与 375/768/1024/1440px 截图在专册。Desktop 自绘标题栏、窗口按钮和 Chrome 原生 Side Panel 规则继续适用，不能据这组页面检查宣称全部无障碍或品牌验收完成。')
    insert_after_title('technical/12-implementation-and-repositories.md',
        '阶段 51 当前六仓库同步 [限时只读支持](51-controlled-read-only-support.md)，Platform 424/424 与当前页面/运行字节分别绑定；两库 062 只追加支持范围，不改 122 张原公共表。独立 Desktop renderer 更新用户授权表单，主窗口继续无边框且无默认菜单；原生侧栏继续采用 Chrome Side Panel。最新预览摘要在 [原生包清单](../quality/native-surfaces-artifacts.json)，完整安装/签名/系统和生产门槛保留。')
    insert_after_title('technical/30-native-window-and-browser-sidepanel.md',
        '阶段 51 已同步用户支持授权 renderer 和受限桥接，并重建当前无边框 Desktop；旧阶段 50 安装器/便携包和侧栏 ZIP 保留在各仓库 release 的 stage50 路径。当前预览 10 项实际窗口/原生侧栏检查、6 项原生权益及 8 项三端费用流程通过，精确字节见 [当前包清单](../quality/native-surfaces-artifacts.json)。这不代表安装/卸载、签名或全部系统/DPI 验收完成。下面的阶段 48 内容为当时记录。')
    insert_after_title('technical/50-durable-financial-notifications.md',
        '阶段 51 支持控制面合入后，当前平台全量为 424/424（711 份来源），费用专项仍为原 16 组；三端费用重查 8/8，绑定 817 份来源和相同实际运行包。以下 410/707、808 份来源是阶段 50 当时结果，旧回执保留在独立归档，不改写成当前证明。新增支持流程见 [限时只读支持](51-controlled-read-only-support.md)。')
    path = DOCS / 'contracts/README.md'
    text = path.read_text(encoding='utf-8')
    text += ('\n## 9. 受控支持的原规范与补充视图\n\n'
             '[支持 schema 快照](admin-support-schemas.json) 从原 OpenAPI 按原字节提取八个命名类型及递归依赖，平台副本逐字节相同。原 OpenAPI SHA-256 保持 `51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4`。原用户授权创建/撤销、Admin 支持会话列表/创建/撤销沿用严格规范 DTO；授权列表及只读 view 为明确补充路径。\n\n'
             '实际页面保留三个原规范端点响应和从补充 view 提取的一份原会话 DTO，单独严格验证，不计为四个规范操作，也不增加既有 125 份样本的数字。支持上下文头仅可访问绑定自己的只读 GET；费用、VIP、下载、凭证和其他读取/修改都拒绝。细则与原始回执见 [支持专册](../technical/51-controlled-read-only-support.md)。\n')
    save(path, text)
    for repo in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
        for english in [False, True]:
            path = ROOT / 'dev' / ('copypaste-' + repo) / ('README.en.md' if english else 'README.md')
            text = path.read_text(encoding='utf-8')
            paragraph = ('Stage 51 current regression: 424/424 with 711 source files; controlled-support browser workflows: 8/8 with 816 source files and 9 unedited captures. The 14 support tests, original contract checks, migration preservation and separate native checks are bounded evidence, not completion of all 102 acceptance cases. Current binaries are rebuilt; stage 50 binaries remain unchanged in their archive.\n\n' if english else
                         '阶段 51 当前平台回归 424/424（711 份来源），受控支持页面 8/8（816 份来源、9 张未编辑截图）。14 组支持专项、原规范检查、迁移保留及独立原生检查是有界证据，完整 102 项验收继续跟踪；当前包已重建，阶段 50 包原字节另存。\n\n')
            split = text.index('```mermaid')
            text = text[:split] + paragraph + text[split:]
            text = text.replace('当前平台回归 410/410，真实三端费用流程 8/8。', '阶段 50 当时平台回归 410/410，真实三端费用流程 8/8。')
            text = text.replace('Current platform regression: 410/410; actual three-client financial workflows: 8/8.', 'Stage 50 historical platform regression: 410/410; actual three-client financial workflows: 8/8.')
            save(path, text)
    print('Updated phase 51 bounded design, implementation, contracts and 12 independent guides')


if __name__ == '__main__':
    main()
