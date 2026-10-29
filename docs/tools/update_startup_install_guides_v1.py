"""Advance current installation requirements only; retained SQL and proof files are untouched."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPONENTS = ['platform-publication-125', 'desktop-publication-125', 'web', 'admin', 'extension', 'delivery']


def main():
    for component in COMPONENTS:
        for name in ['README.md', 'README.en.md']:
            p = ROOT / 'dev' / ('copypaste-' + component) / name
            raw = p.read_bytes(); previous = 'SQL001–132'.encode(); current = 'SQL001–133'.encode()
            assert raw.count(previous) == 1
            p.write_bytes(raw.replace(previous, current))
    print('Twelve current bilingual setup requirements now bind SQL001–133.')


if __name__ == '__main__': main()
