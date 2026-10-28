"""Copy the newest actual UI captures without replacing historical media."""
from datetime import datetime, timezone
from pathlib import PurePosixPath, Path
import json

from integrate_dedicated_cloud_sources import ROOT, DEV, RAW, OUT, checked, digest

RUNS = ['desktop-ui-07', 'ui-13', 'extension-ui-05']
OUTPUT = OUT / 'media-applied-v2.json'


def main():
    assert not OUTPUT.exists()
    rows = []
    for run in RUNS:
        report = json.loads((RAW / (run + '.json')).read_text(encoding='utf-8'))
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
        journey = json.loads((RAW / (run + '-journey.json')).read_text(encoding='utf-8'))
        assert journey['status'] == 'passed' and len(journey['checks']) == 8 and not journey['errors']
        movies = [journey['media']] if journey.get('media') else journey['recordings']
        for item in journey['screenshots'] + [file for movie in movies for file in movie['files']]:
            source = checked(DEV, item['path'])
            assert digest(source) == item['sha256']
            name = PurePosixPath(item['path'])
            assert name.parts[1:3] == ('assets', 'screenshots') and name.parts[0].endswith('-cloud-121')
            destination = PurePosixPath(name.parts[0].removesuffix('-cloud-121'), *name.parts[1:])
            target = checked(DEV, destination.as_posix())
            assert not target.exists(), target
            rows.append({'source': item['path'], 'target': destination.as_posix(), 'sha256': item['sha256']})
    assert len(rows) == 39 and len({item['target'] for item in rows}) == len(rows)
    for row in rows:
        target = checked(DEV, row['target'])
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(checked(DEV, row['source']).read_bytes())
        assert digest(target) == row['sha256']
    result = {'status': 'copied_and_verified', 'at': datetime.now(timezone.utc).isoformat(),
              'runs': RUNS, 'files': rows, 'deleted_files': 0, 'replaced_files': 0,
              'verifier_sha256': digest(Path(__file__))}
    with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'status': result['status'], 'media_files': len(rows), 'deleted_files': 0}))


if __name__ == '__main__':
    main()
