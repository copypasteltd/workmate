"""Export version-five receipts using the already reviewed read-only transport."""
from pathlib import Path
source=Path(__file__).with_name('export-live-receipts-189-v1.py')
text=source.read_text(encoding='utf8')
assert text.count("'live-189-v4']")==1
text=text.replace("'live-189-v4']","'live-189-v4','live-189-v5']")
exec(compile(text,str(source),'exec'),{'__file__':str(source),'__name__':'__main__'})
