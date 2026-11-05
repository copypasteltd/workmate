"""Upload only the reviewed static Web build and four public client files."""
from pathlib import Path
import base64, hashlib, json, time, zipfile
import paramiko

D = Path(__file__).resolve().parents[1]
P = D / '.data/deployment-193'
receipt = json.loads((P / 'package-receipt.private.json').read_bytes())
web = D.parent / 'copypaste-web/dist'
bundle = P / 'web-downloads-193-v1.zip'
with zipfile.ZipFile(bundle, 'x', compression=zipfile.ZIP_DEFLATED) as z:
    for p in sorted(web.rglob('*')):
        if p.is_file():
            assert not p.is_symlink()
            z.write(p, p.relative_to(web).as_posix())
files = {**{k: Path(v) for k, v in receipt['artifact_sources'].items()}, bundle.name: bundle}
manifest = {'stage': 193, 'files': {n: {'bytes': p.stat().st_size, 'sha256': hashlib.file_digest(p.open('rb'), 'sha256').hexdigest()} for n, p in files.items()}}
(P / 'upload-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf8')
files['upload-manifest.json'] = P / 'upload-manifest.json'
spec = json.loads((D / '.data/deployment-189/server-access.private.json').read_bytes())
t = paramiko.Transport((spec['host'], 22))
try:
    t.start_client(timeout=15)
    assert base64.b64encode(hashlib.sha256(t.get_remote_server_key().asbytes()).digest()).decode().rstrip('=') == 'kE5X8/plm2Sr6rI1XOnE82hIcddnpP/i9gvybtg2GNE'
    t.auth_password(spec['username'], spec['password'])
    sftp = paramiko.SFTPClient.from_transport(t)
    target = '/home/carzygod/workmate-upload-193'
    try: sftp.mkdir(target, 0o700)
    except OSError: sftp.stat(target)
    for name, p in files.items():
        remote = target + '/' + name
        try:
            sftp.stat(remote)
            raise AssertionError('Refusing to overwrite prior upload: ' + name)
        except FileNotFoundError: pass
        print(json.dumps({'phase': 'uploading', 'name': name, 'bytes': p.stat().st_size}), flush=True)
        sftp.put(str(p), remote, confirm=True)
        sftp.chmod(remote, 0o600)
    sftp.close()
    report = {'status': 'uploaded', 'target': target, 'files': manifest['files']}
    with (P / 'upload-receipt.json').open('x', encoding='utf8') as f: json.dump(report, f, indent=2)
    print(json.dumps({'status': 'uploaded', 'files': len(files)}), flush=True)
finally: t.close()
