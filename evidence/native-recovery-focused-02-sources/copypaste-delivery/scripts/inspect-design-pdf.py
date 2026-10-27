"""Independently inspect a downloaded raster review PDF and its native rendering."""
from pathlib import Path
import hashlib
import json
import math
import sys
from pypdf import PdfReader
from PIL import Image, ImageChops, ImageStat

pdf_path, rendered_path, reference_path = map(Path, sys.argv[1:4])
width, height = map(int, sys.argv[4:6])
reader = PdfReader(pdf_path, strict=True)
assert not reader.is_encrypted
assert len(reader.pages) == 1
page = reader.pages[0]
assert float(page.mediabox.width) == width * 0.75
assert float(page.mediabox.height) == height * 0.75
assert not page.extract_text().strip(), "The review copy must not claim editable PDF text"
assert not page.get('/Annots')
root = reader.trailer['/Root']
assert not root.get('/OpenAction') and not root.get('/AA') and not root.get('/Names')
images = list(page.images)
assert len(images) == 1
assert images[0].image.size == (width, height)
with Image.open(rendered_path) as rendered, Image.open(reference_path) as reference:
    assert rendered.size == reference.size == (width, height)
    rendered = rendered.convert('RGB')
    reference = reference.convert('RGB')
    difference = ImageStat.Stat(ImageChops.difference(rendered, reference))
    mean_error = sum(difference.mean) / 3
    rms_error = math.sqrt(sum(v * v for v in difference.rms) / 3)
    assert mean_error < 2 and rms_error < 10, (mean_error, rms_error)
    assert rendered.getextrema()[0][1] - rendered.getextrema()[0][0] > 100
print(json.dumps({
    'parser': 'pypdf', 'parser_version': __import__('pypdf').__version__,
    'pages': len(reader.pages), 'page_width_pt': float(page.mediabox.width),
    'page_height_pt': float(page.mediabox.height), 'raster_width': width,
    'raster_height': height, 'image_count': len(images), 'editable_pdf_text': False,
    'render_pixel_mean_error': mean_error, 'render_pixel_rms_error': rms_error,
    'pdf_sha256': hashlib.sha256(pdf_path.read_bytes()).hexdigest(),
    'pdf_bytes': pdf_path.stat().st_size, 'status': 'passed',
}))
