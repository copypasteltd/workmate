from pathlib import Path
root=Path(__file__).resolve().parents[2];scripts=root/'dev/copypaste-delivery/scripts'
text=(scripts/'inspect-owned-native-tasks-196-v2.sh').read_text(encoding='utf8').replace('196','197')
old="const ids=['79b3fe90-269a-4c23-b4cd-cfbbee18bdb4','4b34b469-dcfd-4683-9897-8dcba36acd80'];"
new="const ids=(await pool.query(\"SELECT id FROM tasks WHERE tenant_id=$1 AND project_id=$2 AND created_by=$3 AND execution_location='desktop' AND created_at>='2026-11-06T03:23:00Z' ORDER BY created_at DESC LIMIT 3\",['dfd0a03e-5648-4b7a-a687-fce8aacd658e','30eb572b-52c1-4b99-966d-e3d2239a8b1d','76e77daa-6e41-41fa-b2ea-6c889eb9acd2'])).rows.map(r=>r.id);"
assert old in text;text=text.replace(old,new).replace('two explicitly owned Desktop qualification tasks','current explicitly owned Desktop qualification tasks')
(scripts/'inspect-owned-native-tasks-197-v1.sh').write_text(text,encoding='utf8')
