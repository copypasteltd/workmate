"""Finish guides after V1 found the docs index lives under docs/, not root."""
from pathlib import Path
import json

ROOT = Path(r"D:\dev\copypasted\自有agent")
DETAIL = """**固定运行时准备 / Pinned runtime preparation**：`runtime:prepare` 不下载或查找 PATH。先解压本版 Windows 便携 ZIP，在 PowerShell 设置 `$env:COPYPASTE_LOCAL_CODEX_BIN` 为解压目录中的 `resources/local-codex/codex.exe` 绝对路径（保留旁边全部 helper 文件），再在 desktop 执行 `npm run runtime:prepare`。源码单独交付时，需自行提供与 `contracts/local-codex-runtime.json` 相符的同一组原生文件。首次启动会自动执行原生 PostgreSQL 迁移到145，无需容器。

`runtime:prepare` neither downloads nor searches PATH. Extract this release's Windows directory ZIP, set PowerShell `$env:COPYPASTE_LOCAL_CODEX_BIN` to its absolute `resources/local-codex/codex.exe` path, keep all sibling helpers, and run desktop `npm run runtime:prepare`. A source-only install must supply the exact locked native files. Native database startup applies schema145 automatically.

运行后访问 Web `http://localhost:4317`、Admin `http://localhost:4318`。本机开发验证码保存在 platform `.data/mailbox/`，不是公共邮件服务。另开终端在 platform 执行 `npm run admin:create -- admin@example.com super_admin`，按 `.data/enrolment/` 的一次性资料绑定认证器后删除该私密资料；不提供共享默认密码。Windows 包连接同一后端后使用浏览器登录。

Open Web at localhost4317 and Admin at localhost4318. Development OTP messages are in platform `.data/mailbox/`. In another terminal run platform `npm run admin:create -- admin@example.com super_admin`, enroll its one-time authenticator material, then delete that private enrollment file. No shared administrator password is provided.

"""


def main():
    for component in ("platform", "web", "admin", "desktop", "extension", "delivery"):
        repo = ROOT / "dev" / ("copypaste-" + component)
        path = repo / "README.md"
        body = path.read_bytes()
        cut = body.index(b"**")
        body = body[:cut] + DETAIL.encode() + body[cut:]
        path.write_bytes(body)
        section = body.split(b"---\n\n", 1)[0] + b"---\n\n"
        english = repo / "README.en.md"
        english.write_bytes(section + english.read_bytes())
    guide = ROOT / "docs/releases/v0.1.0-rc.1.md"
    body = guide.read_text(encoding="utf-8")
    body = body.replace("## 交付包 / Deliverables", DETAIL + "## 交付包 / Deliverables", 1)
    guide.write_text(body, encoding="utf-8", newline="\n")
    for name in ("README.md", "README.en.md"):
        index = ROOT / "docs" / name
        index.write_bytes(("<!-- frozen-release-148 -->\n\n[Workmate v0.1.0-rc.1 / 首个冻结候选版](releases/v0.1.0-rc.1.md) · [完整编号 / Ledger](quality/remaining-work-stage148.md) · [构建及发布方案 / Freeze plan](development/148-first-frozen-release.md)\n\n17项后端必要检查与4组真实Web/Windows冒烟通过；按用户要求省略广泛回归，模拟AI。独立源码标签、运行包及校验值由发布回执绑定；完整验收继续开放。 / Seventeen focused backend checks and four real client smoke groups passed. Broad regression was deliberately omitted; AI providers are synthetic. Full acceptance remains open.\n\n---\n\n").encode() + index.read_bytes())
    notes = ROOT / "docs/quality/release-preparation-148.json"
    with notes.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump({"v1": "Prepared all source-bound guides/checkpoint; final docs-index update failed because root README.md does not exist. Original V1 tool retained unchanged.", "v2": "Updates actual docs/README indexes and independent English guides; clarifies explicit local Codex source requirement. Qualified product code and existing execution evidence unchanged."}, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    attrs = ROOT / "dev/copypaste-delivery/.gitattributes"
    with attrs.open("ab") as stream:
        stream.write(b"\n# Stage148 original verifiers, snapshots and raw failures retain exact bytes.\nscripts/*148* -text whitespace=cr-at-eol\nevidence/marketing-import-148/objects/** -diff -text -whitespace\nevidence/marketing-import-148/*.tap -text -whitespace\n")
    print("Finished bilingual freeze guides and exact-byte Stage148 Git attributes; qualified product sources unchanged.")


if __name__ == "__main__":
    main()
