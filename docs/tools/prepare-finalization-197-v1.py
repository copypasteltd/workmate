from pathlib import Path
root=Path(__file__).resolve().parents[2];delivery=root/'dev/copypaste-delivery'
cleanup=(delivery/'scripts/cleanup-owned-runtime-196-v1.ps1').read_text(encoding='utf8').replace('196','197').replace('postgres-nCaJHI','postgres-alMKmM').replace('32000','24568').replace('36536','24456').replace('23520','23644')
(delivery/'scripts/cleanup-owned-runtime-197-v1.ps1').write_text(cleanup,encoding='utf8')
finalize=(root/'docs/tools/finalize-integrated-round-196-v1.py').read_text(encoding='utf8').replace('196','197').replace('integrated-round-195','integrated-round-196')
start=finalize.index("revoked=load(");end=finalize.index('readmes=[]',start);finalize=finalize[:start]+finalize[end:]
(root/'docs/tools/finalize-integrated-round-197-v1.py').write_text(finalize,encoding='utf8')
print('Prepared exact owned-process cleanup and documentation checks; not executed.')
