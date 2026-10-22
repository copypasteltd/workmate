"""Keep CLIENT01's target and the existing cloud/file-bridge implementation distinct."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
START = '<!-- client01-direction -->'
END = '<!-- /client01-direction -->'
TARGET = 'https://github.com/copypasteltd/workmate/blob/docs/docs/technical/69-desktop-local-codex-and-extension-direction.md'
REQUIREMENTS = 'https://github.com/copypasteltd/workmate/blob/docs/docs/requirements/03-client-execution-amendment.md'


def update(path, text):
    original = path.read_bytes()
    newline = '\r\n' if b'\r\n' in original else '\n'
    with path.open('w', encoding='utf-8', newline='') as output:
        output.write(text.replace('\r\n', '\n').replace('\n', newline))


def main():
    changed = 0
    for component in ('platform', 'web', 'admin', 'desktop', 'extension', 'delivery', 'docs'):
        folder = ROOT / ('docs' if component == 'docs' else f'dev/copypaste-{component}')
        for english in (False, True):
            path = folder / ('README.en.md' if english else 'README.md')
            body = path.read_text(encoding='utf-8')
            if START in body:
                before, rest = body.split(START, 1)
                _, after = rest.split(END, 1)
                body = before + after.lstrip('\n')
            if english:
                note = f'''{START}
## Current client direction — implementation gap

CLIENT01 (2026-10-22) requires **Desktop to run Codex on the customer's computer**, with a real user-opt-in **full local access** mode and Codex Desktop as the operation benchmark. The **Extension uses a ChatGPT-style conversation and attachment layout in Chrome's native right Side Panel**, reads user-selected files and uploads them for cloud Codex execution. All product AI calls still use the company gateway.

**Current implementation:** Desktop still uses cloud Codex with a restricted local file bridge; local Codex/full access is pending. The Extension has the native Side Panel and basic uploads, while its task-form-first UI needs restructuring. Existing screenshots and recordings show that implementation and do not prove the amended capabilities. [Requirements]({REQUIREMENTS}) · [Direction audit and development plan]({TARGET}).

'''
                if component != 'docs':
                    note += 'The architecture diagram below describes the implemented cloud/file-bridge baseline; it is not the target Desktop local-agent architecture.\n\n'
            else:
                note = f'''{START}
## 当前客户端方向与实现差异

CLIENT01（2026-10-22）要求 **Desktop 在客户本机运行 Codex Agent**，提供客户可主动授予的 **完整本机权限**，操作能力对标 Codex Desktop。**Extension 在 Chrome 原生右侧栏采用 ChatGPT 式对话/附件结构**，获取、读取用户获选文件并上传，由云端 Codex 执行。全部产品 AI 请求仍走公司内部网关。

**当前实现：** Desktop 仍是云端 Codex 与受限文件桥接，本机 Codex/完整权限待实现；Extension 已有原生侧栏和基础上传，任务表单主界面仍需重排。现有截图、录屏展示该实现，不证明上述补充能力已经完成。[需求补充]({REQUIREMENTS}) · [方向检查及开发调整]({TARGET})。

'''
                if component != 'docs':
                    note += '下方架构图表示已实现的云端/文件桥接基线，不是 Desktop 本机 Agent 的目标架构。\n\n'
            note += END + '\n\n'
            position = body.index('## ')
            body = body[:position] + note + body[position:]
            if component == 'desktop':
                body = body.replace('面向香港企业的云端 Agent 产品。当前仓库负责 **Desktop**；', '面向香港企业的 Agent 产品，Desktop 的目标为本机 Codex 客户端。当前仓库负责 **Desktop**；')
                body = body.replace('A cloud Agent product for Hong Kong enterprises. This repository owns **Desktop**', 'An enterprise Agent product whose Desktop target runs Codex locally. This repository owns **Desktop**')
            if component == 'docs':
                old = '  Web & Side & Desktop & Admin --> API[Company Backend]\n'
                new = ('  Web & Side & Admin --> API[Company Backend]\n'
                       '  Desktop --> API\n'
                       '  Desktop --> LocalCodex[Customer-device Codex / pending implementation]\n'
                       '  LocalCodex --> LocalTools[Local files / terminal / skills]\n'
                       '  LocalCodex --> Gateway[Internal OpenAI-compatible API]\n')
                if old in body:
                    body = body.replace(old, new, 1)
                heading = '## Architecture and usage\n\n' if english else '## 架构与使用逻辑\n\n'
                caption = ('Target execution split; local Codex and full local access are not implemented in the current Desktop package.\n\n' if english else '下图为当前目标的执行分工；现有 Desktop 包尚未实现本机 Codex 和完整本机权限。\n\n')
                if heading + caption not in body:
                    body = body.replace(heading, heading + caption, 1)
            if body != path.read_text(encoding='utf-8'):
                update(path, body)
                changed += 1
    print(f'Updated {changed} bilingual README files; historical captures remain explicitly scoped.')


if __name__ == '__main__':
    main()
