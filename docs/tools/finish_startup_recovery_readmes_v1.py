"""Update editable delivery documentation after the immutable packaged run finishes."""
from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[2]


def main():
    report = json.loads((ROOT / 'dev/copypaste-delivery/evidence/startup-recovery-128/desktop-04.json').read_text(encoding='utf-8-sig'))
    assert report['status'] == 'passed' and report['source_unchanged'] and report['package_unchanged']
    cn = ('本轮限定检查通过：91项相关控制层、43项真实固定版本Codex、30项原生数据库/API、'
          '3项当前编译和6项实际未签名打包界面检查。实际旅程验证了登录、授权、一次启动恢复、'
          '原任务的一次收费、单次回答、待响应时撤权，以及1000/1240/1440三个原生窗口宽度。'
          '当前截图、GIF和MP4来自成功的04次运行；失败的01—03次运行及原始记录均完整保留。'
          '发布入口为V11，远端状态以最终推送回执和SHA回读为准。')
    en = ('Bounded checks passed: 91 related controller, 43 actual pinned-Codex, 30 native database/API, '
          'three current compilation and six actual unsigned packaged-UI checks. The journey verifies sign-in, '
          'consent, one startup recovery, one original-task charge, one displayed answer, pending-startup '
          'withdrawal and native widths of 1000/1240/1440. Current PNG/GIF/MP4 captures come from successful '
          'attempt04; failed attempts01–03 and their raw records remain intact. V11 publishes the branches; '
          'the final receipt and remote SHA readback determine publication status.')
    for folder in ['docs', 'dev/copypaste-platform-publication-125', 'dev/copypaste-desktop-publication-125', 'dev/copypaste-delivery']:
        for filename, paragraph in [('README.md', cn), ('README.en.md', en)]:
            p = ROOT / folder / filename
            text = p.read_text(encoding='utf-8-sig')
            assert text.count('<!-- startup-recovery-stage128 -->') == 1
            text = text.replace('workmate-startup-recovery-128-01-', 'workmate-startup-recovery-128-04-')
            anchor = '[方案与接口]' if filename == 'README.md' else '[Design and APIs]'
            assert text.count(anchor) == 1
            text = text.replace(anchor, paragraph + '\n\n' + anchor, 1)
            # Keep the previous qualification in its historical section instead of
            # leaving Stage127 claims inside the current Stage128 introduction.
            if folder == 'docs':
                prefix, marker, tail = text.partition('<!-- startup-recovery-stage128 -->')
                assert marker and '<!-- local-startup-stage127 -->' in prefix
                historical_intro = prefix.split('<!-- local-startup-stage127 -->', 1)[1].strip()
                title = '## 历史阶段127' if filename == 'README.md' else '## Historical Stage127'
                boundary = ('限定验收为73项相关控制层' if filename == 'README.md'
                            else 'Bounded qualification covers 73 related controller')
                assert tail.count(boundary) == 1
                tail = tail.replace(boundary, '<!-- local-startup-stage127 -->\n' + title + '\n\n' + historical_intro + '\n\n' + boundary, 1)
                text = prefix.split('<!-- local-startup-stage127 -->', 1)[0] + marker + tail
            p.write_text(text, encoding='utf-8', newline='\n')
    review = ROOT / 'docs/quality/desktop-startup-recovery-review-128.md'
    text = review.read_text(encoding='utf-8-sig')
    old = '日志无凭证用例已通过；最新打包界面的恢复、单次回答和停止文案等待本轮最终回执 / Journal checks passed; latest packaged feedback awaits its final receipt.'
    assert old in text
    text = text.replace(old, '已通过：恢复日志不含凭证；实际打包04验证正在重连、单次回答和撤权后明确停止提示 / Passed: credential-free journal and actual packaged attempt04 recovery, single answer and readable stopped feedback.')
    text += ('\n实际打包04的6项交互检查通过，所属浏览器、Electron、API、原生数据库和模拟服务均关闭。'
             '人工检查三张原始截图：蓝色与浅底品牌风格、恢复说明、单次回答及撤权说明清楚；'
             '1000/1240/1440宽度的原生窗口检查均无默认边框、菜单、可见滚动条或横向溢出。'
             '这只覆盖本轮主任务旅程，父子任务完整恢复和全部崩溃组合继续开放。\n\n'
             'All six packaged attempt04 interaction checks passed, and owned browser, Electron, API, native database '
             'and synthetic-provider resources closed. Visual review of the three original screenshots confirms '
             'the blue/light brand treatment, readable recovery/withdrawal feedback and one answer. Native widths '
             '1000/1240/1440 have no default frame/menu, visible scroll rails or horizontal overflow. '
             'This covers the recorded main-task journey; complete child workflows and crash combinations remain open.\n')
    review.write_text(text, encoding='utf-8', newline='\n')
    print(json.dumps({'updated_readmes': 8, 'selected_media_attempt': '04', 'review_updated': True}))


if __name__ == '__main__':
    main()
