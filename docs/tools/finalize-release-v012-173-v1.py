"""Verify durable GitHub assets, publish handoff docs, retain frozen source tags."""
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
BASE = DELIVERY / '.data/release-freeze-173'
VERSION = 'v0.1.2'
COMPONENTS = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}
BRANCHES = [*COMPONENTS, 'docs', 'main']


def digest(path):
    h = sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write(path, value):
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    with path.open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)


def one(pattern):
    rows = [(p, json.loads(p.read_bytes())) for p in BASE.glob(pattern)]
    rows = [(p, v) for p, v in rows if v['status'] == 'published']
    assert len(rows) == 1, 'Expected one successful immutable receipt'
    return rows[0]


def main():
    out = BASE / ('handoff-' + str(uuid.uuid4()))
    out.mkdir()
    log = (out / 'commands.log').open('xb')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 173, 'release': VERSION, 'status': 'running', 'failure': None}
    env = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GIT_SSH_COMMAND': 'ssh -o BatchMode=yes'}

    def git(*args, repo=ROOT):
        argv = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0', '-c', 'gc.autoPackLimit=0', '-C', str(repo), *args]
        log.write((json.dumps({'repo': str(repo), 'args': args}) + '\n').encode()); log.flush()
        p = subprocess.run(argv, cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log.write(p.stdout + p.stderr + b'\n'); log.flush()
        assert p.returncode == 0, 'Git failed; original command log retained'
        return p.stdout.decode('utf-8').strip()

    def refs():
        return {s.split()[1]: s.split()[0] for s in git('ls-remote', 'origin', *['refs/heads/' + b for b in BRANCHES], 'refs/tags/v0.1.*').splitlines()}

    try:
        git_path, published_git = one('publication-*/receipt.json')
        api_path, published_api = one('github-*/receipt.json')
        frozen_path = BASE / 'frozen-receipt.json'
        frozen = json.loads(frozen_path.read_bytes())
        cp = json.loads((ROOT / 'docs/quality/release-freeze-checkpoint-173.json').read_bytes())
        assert published_api['all_asset_digests_match'] and len(published_api['assets']) == 6
        assert frozen['status'] == 'frozen' and frozen['artifact_count'] == 7 and frozen['packaging_overlay'] is None
        assert refs() == published_git['verified_refs'] and len(published_git['verified_refs']) == 120
        assert digest(Path(frozen['complete_archive']['path'])) == frozen['complete_archive']['sha256']
        assert digest(Path(frozen['directory']) / 'release-manifest.json') == frozen['manifest_sha256']
        assert digest(Path(frozen['directory']) / 'SHA256SUMS') == frozen['sums_sha256']
        for name, h in cp['qualified_sources'].items():
            assert digest(DEV / name) == h, name
        for name, h in cp['baseline']['preserved_user_files'].items():
            assert digest(ROOT / name) == h, name
        assert digest(DEV / 'copypaste-desktop/.gitattributes') == cp['baseline']['desktop_attributes_sha256']
        for version, old in cp['baseline']['frozen_releases'].items():
            assert digest(Path(old['directory']) / 'release-manifest.json') == old['manifest_sha256'], version
            assert digest(Path(old['directory']) / 'SHA256SUMS') == old['sums_sha256'], version
            assert digest(Path(old['complete_archive']['path'])) == old['complete_archive']['sha256'], version
        for b, c in {**COMPONENTS, 'docs': 'docs'}.items():
            repo = ROOT if b == 'docs' else DEV / ('copypaste-' + c)
            assert git('rev-parse', 'HEAD', repo=repo) == published_git['components'][b]['commit']
            assert not git('diff', 'HEAD', '--name-only', repo=repo)
            assert not git('diff', '--cached', '--name-only', repo=repo)
        request = urllib.request.Request('https://api.github.com/repos/copypasteltd/workmate/releases/tags/' + VERSION, headers={'User-Agent': 'workmate-release173-handoff', 'Accept': 'application/vnd.github+json'})
        with urllib.request.urlopen(request, timeout=30) as response:
            assert response.status == 200
            public = json.loads(response.read())
        assert public['tag_name'] == VERSION and not public['draft']
        observed = {a['name']: a for a in public['assets']}
        for row in published_api['assets']:
            current = observed[row['name']]
            assert current['state'] == 'uploaded' and current['size'] == row['size'] and current['digest'] == row['digest']
        complete = next(a for a in published_api['assets'] if a['name'].endswith('-complete.zip'))
        checksum = next(a for a in published_api['assets'] if a['name'].endswith('.zip.sha256'))
        report_name = 'docs/quality/release-publication-173.json'
        note_name = 'docs/releases/v0.1.2-publication.md'
        report = {'stage': 173, 'at': datetime.now(timezone.utc).isoformat(), 'status': 'published', 'release': VERSION, 'release_url': public['html_url'], 'frozen': frozen, 'github': published_api, 'git': published_git, 'public_api': {'url': request.full_url, 'http_status': 200, 'credentials_used': False, 'six_uploaded_asset_digests_match': True}, 'direct_file_download': 'not_independently_retested; local ZIP integrity and server asset digests verified', 'qualification': {'fresh_backend_admin_builds': 2, 'fresh_functional_tests_at173': 0, 'inherited_exact_source_checks': cp['focused_qualification'], 'windows_packaging_commands': 0, 'reused_verified_windows': cp['windows_distribution']}, 'scope': cp['scope'], 'packaging_overlay': None, 'all_helpers_committed_before_source_tags': True, 'mandatory_full_acceptance_open': 88, 'new_full_acceptance_closures': 0, 'owned_browser_created': False, 'owned_browser_and_services_closed': True, 'virtualization_used': False, 'previous_frozen_bytes_and_tags_unchanged': True, 'receipt_sources': {p.relative_to(ROOT).as_posix(): digest(p) for p in [git_path, api_path, frozen_path]}, 'finalizer_sha256': digest(Path(__file__))}
        write(ROOT / report_name, report)
        write(ROOT / note_name, f'''# v0.1.2 · 已发布 / Published

[Release]({public['html_url']}) · [完整ZIP / Complete ZIP]({complete['browser_download_url']}) · [SHA256]({checksum['browser_download_url']})

完整包 **{frozen['complete_archive']['bytes']}** 字节，七类归档覆盖所有端、Windows完整目录/Portable/Setup、后端、六仓可构建源码、固定Codex、中英README/手册、逻辑图及真实截图/GIF/MP4。纳入阶段172按入账期间、跨期退款、负净额、香港日分组、原扣费引用和同快照明细/CSV。

The complete bundle contains seven distributions, every client, Windows app/Portable/Setup, backend, six buildable source trees, pinned Codex, bilingual guides, diagrams and actual media. It includes posting-period reports, cross-period refunds, negative nets, Hong Kong days and matching snapshot detail/CSV.

SHA256: `{frozen['complete_archive']['sha256']}`

| 编号 / No. | 本轮交付 / Delivery | 状态 / Status |
| --- | --- | --- |
| 1 | 当前Backend/Admin构建、未改客户端及Windows分发核对 | 完成 / Complete |
| 2 | 全端完整包、六仓源码、双语说明和实际媒体 | 已冻结发布 / Frozen and published |
| 3 | 八分支、七个新固定标签、六项线上资产 | 120个远端引用及全部资产摘要核对 / Verified |
| 4 | 实际AI/媒体/广告/支付 | 使用已授权假数据；正式接入待办 / Synthetic; production pending |
| 5 | Windows签名/更新、多系统和完整专业验收 | 待办 / Pending |

本轮仅重新构建Backend/Admin及核对打包，未重跑功能测试；继承源码一致的阶段172定向结果。公开API读取HTTP200，六个资产的大小/状态/服务端摘要一致；未额外重新下载1GB完整包验收。旧冻结包和标签不变，所有打包/发布工具已在本次源码标签内。

This freeze rebuilds backend/Admin and checks packaging, without rerunning functional tests. Exact-source stage172 focused results are inherited. Public API access returns HTTP200; all six uploaded sizes/states/digests match. The full bundle was not independently downloaded again. Previous frozen assets/tags remain unchanged; all helpers are included in the new source tags.

[使用 / Guide](v0.1.2.md) · [发布回执 / Receipt](../quality/release-publication-173.json) · [原编号待办 / Acceptance ledger](../quality/remaining-work-stage172.md)
''')
        header = f'## v0.1.2 · 已发布 / Published\n\n[完整下载 / Complete bundle]({complete["browser_download_url"]}) · [使用 / Guide](releases/v0.1.2.md) · [回执 / Receipt](quality/release-publication-173.json)\n\n全部端、源码和入账期间报表已纳入下载包。All clients, sources and posting-period reports are included. 外部假数据；Windows未签名。Synthetic services; unsigned Windows.\n\n---\n\n'
        for name in ['docs/README.md', 'docs/README.en.md']:
            p = ROOT / name
            p.write_text(header + p.read_text(encoding='utf-8'), encoding='utf-8', newline='\n')
        names = ['docs/README.md', 'docs/README.en.md', report_name, note_name]
        git('add', '--', *names)
        assert set(git('diff', '--cached', '--name-only', '-z').split('\0')) - {''} == set(names)
        for name in names:
            raw = (ROOT / name).read_bytes()
            assert git('ls-files', '-s', '--', name).split()[1] == sha1(('blob ' + str(len(raw)) + '\0').encode() + raw).hexdigest()
        git('commit', '-m', 'Record verified complete v0.1.2 release assets and bilingual handoff')
        head = git('rev-parse', 'HEAD')
        assert refs() == published_git['verified_refs']
        git('push', '--atomic', 'origin', head + ':refs/heads/docs', head + ':refs/heads/main')
        expected = {**published_git['verified_refs'], 'refs/heads/docs': head, 'refs/heads/main': head}
        assert refs() == expected and len(expected) == 120
        for repo in [ROOT, *[DEV / ('copypaste-' + c) for c in COMPONENTS.values()]]:
            assert not git('diff', 'HEAD', '--name-only', repo=repo)
            assert not git('diff', '--cached', '--name-only', repo=repo)
        result.update(status='published', final_docs_commit=head, verified_refs=expected, public_report_sha256=digest(ROOT / report_name), previous_frozen_bytes_and_tags_unchanged=True, preserved_user_files=12, all_seven_tracked_worktrees_clean=True)
    except Exception as e:
        result.update(status='failed', failure=type(e).__name__ + ': ' + str(e))
    finally:
        log.close()
        result['finished_at'] = datetime.now(timezone.utc).isoformat()
        result['finalizer_sha256'] = digest(Path(__file__))
        write(out / 'receipt.json', result)
        print(json.dumps({'status': result['status'], 'receipt': str(out / 'receipt.json'), 'failure': result['failure']}, ensure_ascii=False), flush=True)
    assert result['status'] == 'published'


if __name__ == '__main__':
    main()
