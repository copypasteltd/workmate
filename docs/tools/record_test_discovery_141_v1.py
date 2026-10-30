"""Bind a test-entry-only follow-up to the published Stage140 runtime."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse, json, re
from record_native_team_release_139_v2 import check_sources
from record_source_build_reproduction_v1 import credentials, scan
ROOT=Path(__file__).resolve().parents[2]
DEV=ROOT/"dev"
DELIVERY=DEV/"copypaste-delivery"
BASE=ROOT/"docs/quality/creative-packages-checkpoint-140.json"
CP=ROOT/"docs/quality/test-discovery-checkpoint-141.json"
OUT=ROOT/"docs/quality/test-discovery-evidence-141"
REPORT=DEV/"copypaste-platform/evidence/test-discovery-141/attempt-01.json"
PREVIOUS=DELIVERY/".data/creative-packages-140/publication-a3a09779-7a6d-47a2-8285-b1a51a651ae5/receipt.json"
NEW=["scripts/run-current-tests-owned-v10.mjs","tests/current-test-discovery-141-v1.test.ts","scripts/qualify-test-discovery-141-v1.mjs"]
def sha(b):return sha256(b).hexdigest()
def read(p):return json.loads(p.read_bytes())
def ref(p):return {"path":p.relative_to(ROOT).as_posix(),"sha256":sha(p.read_bytes())}
def encoded(v):return (json.dumps(v,ensure_ascii=False,indent=2)+"\n").encode()
def equivalent():
 assert sha(BASE.read_bytes())=="6db035867848f1bf4823611cbc79aa0136fdd9ca3d7f001a40ecfb76e006371a"
 base=read(BASE); sources=dict(base["source_files"]); name="dev/copypaste-platform/package.json"
 frozen=read(DELIVERY/"evidence/creative-packages-140/backend-07-sources.json")["copypaste-platform/package.json"]
 original=(DELIVERY/frozen["path"]).read_bytes();assert sha(original)==sources[name]
 before=json.loads(original);after=read(ROOT/name)
 assert after["scripts"]["test"]=="node --env-file=.env scripts/run-current-tests-owned-v10.mjs"
 after["scripts"]["test"]=before["scripts"]["test"];assert before==after,"Only the test script may change in package metadata"
 for name,digest in sources.items():
  if name!="dev/copypaste-platform/package.json":assert sha((ROOT/name).read_bytes())==digest,name
 sources["dev/copypaste-platform/package.json"]=sha((DEV/"copypaste-platform/package.json").read_bytes())
 for name in NEW:sources["dev/copypaste-platform/"+name]=sha((DEV/"copypaste-platform"/name).read_bytes())
 report=read(REPORT);assert report["status"]=="passed" and report["sources_unchanged"] and len(report["commands"])==3 and all(c["exit_code"]==0 for c in report["commands"])
 assert set(report["sources"])=={"package.json",*NEW}
 for name,digest in report["sources"].items():assert sha((DEV/"copypaste-platform"/name).read_bytes())==digest
 log=DEV/"copypaste-platform"/report["raw_log"]["path"]
 assert sha(log.read_bytes())==report["raw_log"]["sha256"] and re.findall(r"^# tests (\d+)\r?$",log.read_text(encoding="utf-8"),re.M)==["6"]
 for item in base["media_files"]:assert sha((DEV/item["path"]).read_bytes())==item["sha256"]
 return sources,base["qualification_sources"]
def verify():
 cp,index=read(CP),read(OUT/"index.json");assert cp["status"]=="verified_test_entry_only_followup" and cp["base_runtime_checkpoint"]==ref(BASE)
 assert index["recorder_sha256"]==sha(Path(__file__).read_bytes()) and cp["evidence_index"]==ref(OUT/"index.json")
 needles=credentials()
 for row in index["originals"]:
  body=(OUT/row["archive"]).read_bytes();assert len(body)==row["bytes"] and sha(body)==row["sha256"];scan(row["source"],body,needles)
 sources,extra=equivalent();assert sources==cp["source_files"] and extra==cp["qualification_sources"]
 assert check_sources(sources,extra)==cp["git_source_proofs"]
 return {"status":"verified","checkpoint_sha256":sha(CP.read_bytes()),"source_files":len(sources),"exact_git_paths":sum(r["exact_paths"] for r in cp["git_source_proofs"]),"unchanged_runtime_files":1771,"test_entry_checks":6,"new_full_acceptance_closures":0}
def record():
 assert not CP.exists() and not OUT.exists();sources,extra=equivalent();proofs=check_sources(sources,extra)
 previous=read(PREVIOUS);assert previous["status"]=="pushed_and_verified" and previous["remote_after"]["docs"]=="b4d7111da147a87ca9c241eeed057bf914e9296e"
 files=[BASE,PREVIOUS,PREVIOUS.with_name("commands.log"),ROOT/previous["incremental_history_and_links"]["path"],REPORT,DEV/"copypaste-platform"/read(REPORT)["raw_log"]["path"]]
 OUT.mkdir(parents=True);originals=[];needles=credentials()
 for file in files:
  body=file.read_bytes();digest=sha(body);target=OUT/("blobs/"+digest+".blob");target.parent.mkdir(parents=True,exist_ok=True);scan(file.relative_to(ROOT).as_posix(),body,needles)
  if not target.exists():target.write_bytes(body)
  else:assert target.read_bytes()==body
  originals.append({"source":file.relative_to(ROOT).as_posix(),"archive":target.relative_to(OUT).as_posix(),"sha256":digest,"bytes":len(body)})
 index={"at":datetime.now(timezone.utc).isoformat(),"recorder_sha256":sha(Path(__file__).read_bytes()),"originals":originals};(OUT/"index.json").write_bytes(encoded(index))
 cp={"at":datetime.now(timezone.utc).isoformat(),"status":"verified_test_entry_only_followup","base_runtime_checkpoint":ref(BASE),"evidence_index":ref(OUT/"index.json"),"source_files":sources,"qualification_sources":extra,"git_source_proofs":proofs,"previous_publication_receipt":next(r for r in originals if r["source"]==PREVIOUS.relative_to(ROOT).as_posix()),"runtime_source_files_unchanged":1771,"package_metadata_change":"scripts.test only; dependency metadata unchanged","new_test_sources":NEW,"test_entry_checks":6,"whole_platform_runtime_rerun":False,"new_full_acceptance_closures":0,"scope":"Stage140 real three-client creative restoration remains qualified with identical runtime sources. Stage141 fixes only default test discovery; six end-to-end selector checks, real npm test inspection and compiler pass. Original failed attempts and complete product acceptance scopes remain intact."}
 CP.write_bytes(encoded(cp));print(json.dumps(verify()))
if __name__=="__main__":
 parser=argparse.ArgumentParser();group=parser.add_mutually_exclusive_group(required=True);group.add_argument("--record",action="store_true");group.add_argument("--verify",action="store_true");args=parser.parse_args()
 if args.record:record()
 else:print(json.dumps(verify()))
