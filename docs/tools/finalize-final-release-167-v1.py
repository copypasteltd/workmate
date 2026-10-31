"""Record exact published v0.1.0 asset digests, then publish documentation only."""
from pathlib import Path
from hashlib import sha256, sha1
from datetime import datetime, timezone
import json
import os
import subprocess
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
VERSION = 'v0.1.0'
BRANCHES = ['backend', 'web', 'admin', 'desktop', 'extension', 'delivery', 'docs', 'main']

def digest(p):
    h = sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()

def write(p, text):
    with p.open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)

def one(pattern):
    values = [(p, json.loads(p.read_bytes())) for p in (DELIVERY / '.data/release-freeze-167').glob(pattern)]
    values = [(p, v) for p, v in values if v['status'] == 'published']
    assert len(values) == 1
    return values[0]

def main():
    out = DELIVERY / '.data/release-freeze-167' / ('handoff-' + str(uuid.uuid4()))
    out.mkdir(parents=True)
    result = {'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'release': VERSION, 'failure': None}
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes'}
    log = (out / 'commands.log').open('xb')
    def git(*args, repo=ROOT):
        argv = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0', '-c', 'gc.autoPackLimit=0', '-C', str(repo), *args]
        log.write((json.dumps({'repo': str(repo), 'args': args}) + '\n').encode()); log.flush()
        p = subprocess.run(argv, cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log.write(p.stdout + p.stderr + b'\n'); log.flush()
        assert p.returncode == 0, 'Git failed; commands.log retained'
        return p.stdout.decode().strip()
    def refs():
        return {s.split()[1]: s.split()[0] for s in git('ls-remote', 'origin', *['refs/heads/' + b for b in BRANCHES], 'refs/tags/v0.1.0*').splitlines()}
    try:
        git_path, published_git = one('publication-*/receipt.json')
        api_path, published_api = one('github-*/receipt.json')
        frozen_path = DELIVERY / '.data/release-freeze-167/frozen-receipt.json'
        frozen = json.loads(frozen_path.read_bytes())
        cp = json.loads((ROOT / 'docs/quality/release-freeze-checkpoint-167.json').read_bytes())
        assert published_api['all_asset_digests_match'] and len(published_api['assets']) == 6
        assert frozen['artifact_count'] == 7
        assert digest(Path(frozen['complete_archive']['path'])) == frozen['complete_archive']['sha256']
        assert refs() == published_git['verified_refs']
        assert len(published_git['verified_refs']) == 92
        for p, h in cp['qualified_sources'].items():
            assert digest(DEV / p) == h, p
        for p, h in cp['baseline']['preserved_user_files'].items():
            assert digest(ROOT / p) == h, p
        assert digest(DEV / 'copypaste-desktop/.gitattributes') == cp['baseline']['desktop_attributes_sha256']
        old_frozen = cp['baseline']['frozen_rc5']
        assert digest(Path(old_frozen['directory']) / 'release-manifest.json') == old_frozen['manifest_sha256']
        assert digest(Path(old_frozen['directory']) / 'SHA256SUMS') == old_frozen['sums_sha256']
        request = urllib.request.Request('https://api.github.com/repos/copypasteltd/workmate/releases/tags/' + VERSION, headers={'User-Agent': 'workmate-release167-handoff', 'Accept': 'application/vnd.github+json'})
        with urllib.request.urlopen(request, timeout=30) as response:
            assert response.status == 200
            public = json.loads(response.read())
        assert public['tag_name'] == VERSION and not public['draft']
        observed = {a['name']: a for a in public['assets']}
        for a in published_api['assets']:
            current = observed[a['name']]
            assert current['state'] == 'uploaded' and current['size'] == a['size'] and current['digest'] == a['digest']
        report = {'stage': 167, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'published', 'release': VERSION, 'release_url': published_api['release_url'], 'frozen': frozen, 'github': published_api, 'git': published_git, 'public_api': {'url': request.full_url, 'http_status': 200, 'credentials_used': False, 'six_uploaded_asset_digests_match': True}, 'direct_file_download': 'not_independently_retested; API digests and local ZIP integrity verified', 'qualification': {'current_builds': 6, 'windows_packaging_commands': 0, 'reused_verified_windows': cp['windows_distribution'], 'inherited_focused_checks': cp['focused_qualification']}, 'scope': cp['scope'], 'mandatory_full_acceptance_open': 88, 'new_full_acceptance_closures': 0, 'owned_browser_created': False, 'owned_browser_and_services_closed': True, 'virtualization_used': False, 'receipt_sources': {p.relative_to(ROOT).as_posix(): digest(p) for p in [git_path, api_path, frozen_path]}, 'finalizer_sha256': digest(Path(__file__))}
        report_name = 'docs/quality/release-publication-167.json'
        note_name = 'docs/releases/v0.1.0-publication.md'
        write(ROOT / report_name, json.dumps(report, ensure_ascii=False, indent=2) + '\n')
        complete = next(a for a in published_api['assets'] if a['name'].endswith('-complete.zip'))
        checksum = next(a for a in published_api['assets'] if a['name'].endswith('.zip.sha256'))
        note = f"""# v0.1.0 · 已发布 / Published

[Release]({published_api['release_url']}) · [完整ZIP / Complete ZIP]({complete['browser_download_url']}) · [SHA256]({checksum['browser_download_url']})

完整包 {frozen['complete_archive']['bytes']} 字节，七类分发归档包含所有端、Windows完整目录/Portable/Setup、后端、六仓可构建源码、固定Codex、中英说明和实际截图/GIF/MP4。六个线上资产的大小、状态和GitHub摘要逐项吻合；公开API读取HTTP200。没有额外声称本机直链下载验收。

The complete bundle includes seven distributions, all clients, Windows app/portable/installer, backend, six buildable source trees, pinned Codex, bilingual guides and actual media. All six uploaded asset sizes/states/digests match; public API access returns HTTP200. Direct file download was not independently retested.

SHA256: `{frozen['complete_archive']['sha256']}`

| 编号 / No. | 本轮交付 / Handoff | 状态 / Status |
| --- | --- | --- |
| 1 | 六仓重建；Windows三种分发与当前输出一致，核对后复用 | 已完成 / Complete |
| 2 | 首次创建恢复、Admin费用/VIP目标及用户任务/内容入口 | 已纳入 / Included |
| 3 | 完整源码、双语README、真实媒体及校验清单 | 已封装上线 / Published |
| 4 | 八分支、七个新标注标签；旧版本保留 | 92个远端引用核对 / Verified |
| 5 | 外部AI/媒体/广告/支付 | 已授权使用假数据；正式接入待办 / Synthetic; production pending |
| 6 | 签名安装/更新、跨系统及完整专业验收 | 待后续 / Pending |

按要求省略全量历史回归；继承源码一致的定向检查。原始102编号和88项必选完整验收范围保持，不是88个未开发模块。

Broad regression is omitted as requested; focused prior checks are inherited only with matching sources. Original whole-acceptance IDs/scopes remain tracked.

[中英使用说明 / Guide](v0.1.0.md) · [实际发布回执 / Receipt](../quality/release-publication-167.json) · [原编号验收 / Acceptance](../quality/remaining-work-stage167.md)
"""
        write(ROOT / note_name, note)
        header = f"## {VERSION} · 已发布 / Published\n\n[完整ZIP / Complete ZIP]({complete['browser_download_url']}) · [SHA256]({checksum['browser_download_url']}) · [使用 / Guide](releases/v0.1.0.md) · [发布回执 / Receipt](quality/release-publication-167.json)\n\n全部端与源码统一冻结，六个线上资产摘要吻合。All clients and source are frozen; all six uploaded asset digests match. 外部假数据；Windows未签名。Synthetic dependencies; unsigned Windows.\n\n---\n\n"
        for n in ['docs/README.md', 'docs/README.en.md']:
            p = ROOT / n
            p.write_text(header + p.read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
        names = ['docs/README.md', 'docs/README.en.md', report_name, note_name]
        assert git('rev-parse', 'HEAD') == published_git['components']['docs']['commit']
        assert not git('diff', '--cached', '--name-only')
        git('add', '--', *names)
        assert set(git('diff', '--cached', '--name-only', '-z').split('\0')) - {''} == set(names)
        for n in names:
            raw = (ROOT / n).read_bytes()
            assert git('ls-files', '-s', '--', n).split()[1] == sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest()
        git('commit', '-m', 'Record published Workmate v0.1.0 complete handoff and verified assets (stage167)')
        head = git('rev-parse', 'HEAD')
        assert refs() == published_git['verified_refs']
        git('push', '--atomic', 'origin', head + ':refs/heads/docs', head + ':refs/heads/main')
        expected = {**published_git['verified_refs'], 'refs/heads/docs': head, 'refs/heads/main': head}
        assert refs() == expected
        result.update(status='published', release_url=published_api['release_url'], complete_download=complete['browser_download_url'], verified_refs=expected, frozen_tags_unchanged=True, frozen_bytes_unchanged=True, preserved_user_files=12)
    except Exception as e:
        result.update(status='failed', failure=type(e).__name__ + ': ' + str(e))
    finally:
        result['finished_at'] = datetime.now(timezone.utc).isoformat()
        write(out / 'receipt.json', json.dumps(result, ensure_ascii=False, indent=2) + '\n')
        log.close()
        print(json.dumps({'status': result['status'], 'receipt': str(out / 'receipt.json'), 'failure': result['failure']}, ensure_ascii=False), flush=True)
    assert result['status'] == 'published'

if __name__ == '__main__':
    main()
