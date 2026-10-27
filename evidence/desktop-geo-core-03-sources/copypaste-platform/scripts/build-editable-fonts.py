"""Derive deterministic static regular/bold faces from the preserved OFL variable font.

Build-time only: runtime consumes the checked-in bytes, never Python/system fonts.
"""
from hashlib import sha256
from io import BytesIO
import json
from pathlib import Path
import fontTools
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'assets/fonts/noto-sans-tc'
TARGET = ROOT / 'assets/fonts/copypaste-sans-tc'
EXPECTED = '864727d210d54f2537bbe23b3a839436c3992af72de9322af5270897246bd44f'
assert fontTools.__version__ == '4.62.1', 'Use the reviewed build-time FontTools version'
assert sha256((SOURCE / 'NotoSansTC-VF.ttf').read_bytes()).hexdigest() == EXPECTED
TARGET.mkdir(exist_ok=True)
family = 'CopyPaste Sans TC'
files = []
for weight, style in [(400, 'Regular'), (700, 'Bold')]:
    font = TTFont(SOURCE / 'NotoSansTC-VF.ttf', recalcTimestamp=False)
    instantiateVariableFont(font, {'wght': weight}, inplace=True, optimize=True, updateFontNames=True)
    assert 'fvar' not in font and font['OS/2'].usWeightClass == weight
    names = {1: family, 2: style, 3: f'{family} {style};{EXPECTED[:16]};static-1', 4: f'{family} {style}', 6: f'CopyPasteSansTC-{style}', 16: family, 17: style}
    for record in font['name'].names:
        if record.nameID in names:
            font['name'].setName(names[record.nameID], record.nameID, record.platformID, record.platEncID, record.langID)
    destination = TARGET / f'CopyPasteSansTC-{style}.ttf'
    buffer = BytesIO(); font.save(buffer, reorderTables=True); value = buffer.getvalue()
    if destination.exists(): assert destination.read_bytes() == value, 'Never overwrite reviewed font bytes'
    else: destination.write_bytes(value)
    files.append({'file': destination.name, 'weight': weight, 'bytes': len(value), 'sha256': sha256(value).hexdigest()})
license_bytes = (SOURCE / 'OFL.txt').read_bytes()
notice = TARGET / 'OFL.txt'
if notice.exists(): assert notice.read_bytes() == license_bytes
else: notice.write_bytes(license_bytes)
manifest = {'schema': 'copypaste-static-font-1', 'family': family, 'source_family': 'Noto Sans TC', 'source_sha256': EXPECTED,
    'source_manifest': '../noto-sans-tc/source.json', 'tool': 'fontTools.varLib.instancer', 'tool_version': fontTools.__version__,
    'axes': 'Static wght=400 and wght=700; renamed family. Original copyright and OFL retained. No glyph edits.',
    'license': 'SIL Open Font License 1.1', 'license_sha256': sha256(license_bytes).hexdigest(), 'files': files}
value = (json.dumps(manifest, indent=2) + '\n').encode()
destination = TARGET / 'source.json'
if destination.exists(): assert destination.read_bytes() == value
else: destination.write_bytes(value)
print(json.dumps(manifest))
