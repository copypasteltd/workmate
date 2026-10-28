"""Lossless, hash-bound proof shards. Legacy manifests remain readable unchanged."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
import json
import re

FORMAT = 'workmate.proofs.sharded.v1'
LIMIT = 20 * 1024 * 1024
BRANCHES = {'backend', 'desktop', 'web', 'admin', 'extension', 'delivery', 'docs'}


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n').encode('utf-8')


def validate_rows(rows):
    assert isinstance(rows, list) and rows, 'Proofs must be a nonempty array'
    seen = set()
    for row in rows:
        assert isinstance(row, dict) and row.get('repository') in BRANCHES
        name = row.get('path')
        assert isinstance(name, str) and name and '\\' not in name and ':' not in name
        assert not any(ord(c) < 32 or ord(c) == 127 for c in name)
        assert not name.startswith('/') and all(p not in ['', '.', '..'] for p in name.split('/'))
        assert re.fullmatch('[a-f0-9]{64}', row.get('sha256', ''))
        key = (row['repository'], name)
        assert key not in seen, 'Duplicate proof identity'
        seen.add(key)
    return rows


def load_proofs(manifest, root):
    """Return every original row; no sample, truncation, fallback or silent dedup."""
    root = Path(root).resolve()
    if 'proofs_format' not in manifest:
        assert manifest['status'] == 'ready_for_remote_verification'
        return validate_rows(manifest['proofs'])
    assert manifest['status'] == 'ready_for_remote_verification_sharded'
    assert manifest['proofs_format'] == FORMAT and manifest['proofs'] == []
    assert type(manifest['proof_count']) is int and manifest['proof_count'] > 0
    descriptors = manifest['proof_shards']
    assert isinstance(descriptors, list) and descriptors
    rows, paths = [], set()
    for index, item in enumerate(descriptors):
        name = item['path']
        assert isinstance(name, str) and re.fullmatch(r'docs/quality/publication-proofs/stage[0-9]+/proofs-[0-9]{4}\.json', name)
        assert name not in paths, 'Duplicate shard path'
        paths.add(name)
        path = root / PurePosixPath(name)
        assert path.resolve().is_relative_to(root / 'docs/quality/publication-proofs') and not path.is_symlink()
        assert type(item['bytes']) is int and 0 < item['bytes'] <= LIMIT
        assert type(item['proofs']) is int and item['proofs'] > 0
        assert re.fullmatch('[a-f0-9]{64}', item['sha256'])
        assert path.stat().st_size == item['bytes'], 'Shard length mismatch'
        body = path.read_bytes()
        assert sha256(body).hexdigest() == item['sha256'], 'Shard hash mismatch'
        shard = json.loads(body)
        assert shard['format'] == FORMAT and shard['index'] == index
        assert len(shard['proofs']) == item['proofs'], 'Shard count mismatch'
        rows.extend(shard['proofs'])
    assert len(rows) == manifest['proof_count'], 'Total proof count mismatch'
    return validate_rows(rows)


def write_shards(rows, root, stage):
    validate_rows(rows)
    assert type(stage) is int and stage > 0
    folder = Path(root) / f'docs/quality/publication-proofs/stage{stage}'
    folder.mkdir(parents=True, exist_ok=False)
    # Stay below the limit even with Unicode filenames and wrapper metadata.
    groups, group, size = [], [], 0
    for row in rows:
        length = len(encoded(row)) + 1
        assert length < LIMIT - 1024
        if size + length > LIMIT - 1024:
            groups.append(group); group, size = [], 0
        group.append(row); size += length
    if group: groups.append(group)
    result = []
    for index, group in enumerate(groups):
        body = encoded({'format': FORMAT, 'index': index, 'proofs': group})
        assert len(body) <= LIMIT
        path = folder / f'proofs-{index + 1:04}.json'
        with path.open('xb') as stream: stream.write(body)
        result.append({'path': path.relative_to(root).as_posix(), 'sha256': sha256(body).hexdigest(), 'bytes': len(body), 'proofs': len(group)})
    candidate = {'status': 'ready_for_remote_verification_sharded', 'proofs_format': FORMAT, 'proofs': [], 'proof_count': len(rows), 'proof_shards': result}
    assert load_proofs(candidate, root) == rows, 'Every row and field must survive roundtrip'
    return candidate
