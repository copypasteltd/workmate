"""Check Markdown file links using verified archive origins, without editing archives."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
from importlib.metadata import version
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parents[2]
HISTORY = ROOT / "docs/quality/history"


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def relative(path):
    return path.relative_to(ROOT).as_posix()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    output = (ROOT / args.report).resolve()
    assert output.is_relative_to(ROOT / "docs/quality") and output.suffix == ".json"
    assert not output.exists(), "Keep each audit receipt unchanged"
    origins, collections, metadata_hashes, issues, byte_aliases = {}, {}, {}, [], []

    def register(archive, original, expected, metadata):
        archive, original = archive.resolve(), original.resolve()
        if not archive.is_relative_to(HISTORY) or not original.is_relative_to(ROOT):
            issues.append({"kind": "origin_outside_scope", "metadata": relative(metadata), "archive": str(archive), "original": str(original)})
            return
        if not isinstance(expected, str) or not re.fullmatch(r"[a-f0-9]{64}", expected):
            issues.append({"kind": "missing_origin_digest", "archive": relative(archive), "metadata": relative(metadata)})
            return
        row = {"original": original, "sha256": expected, "metadata": metadata}
        prior = origins.get(archive)
        if prior and prior["sha256"] != expected:
            issues.append({"kind": "conflicting_origins", "archive": relative(archive), "prior_original": relative(prior["original"]), "candidate_original": relative(original), "metadata": relative(metadata)})
            return
        if prior and prior["original"] != original:
            # Some repair manifests deliberately reuse an identical code/config
            # blob from another repository. They do not redefine a Markdown
            # document's relative-link base. Keep every explicit byte alias.
            if ".md" in prior["original"].suffixes or ".md" in original.suffixes:
                issues.append({"kind": "ambiguous_markdown_origin", "archive": relative(archive), "prior_original": relative(prior["original"]), "candidate_original": relative(original), "metadata": relative(metadata)})
                return
            byte_aliases.append({"archive": relative(archive), "source": relative(original), "sha256": expected, "metadata": relative(metadata)})
            collection = archive.relative_to(HISTORY).parts[0]
            collections.setdefault((collection, original), []).append(archive)
            return
        origins[archive] = row
        collection = archive.relative_to(HISTORY).parts[0]
        collections.setdefault((collection, original), []).append(archive)

    def repository_root(name):
        if name in [".", "root", "docs", ROOT.name]:
            return ROOT
        if name in ["platform", "backend", "web", "admin", "desktop", "extension", "delivery"]:
            return ROOT / "dev" / ("copypaste-" + ("platform" if name == "backend" else name))
        return ROOT / (name if name.startswith("dev/") else "dev/" + name)

    def original_for(row):
        if isinstance(row.get("source"), str) and row["source"].startswith(("docs/", "dev/")):
            return ROOT / row["source"]
        path = row.get("path")
        if not isinstance(path, str):
            return None
        component = row.get("component")
        repository = row.get("repo") or row.get("repository")
        if component:
            return repository_root(component) / path
        if repository:
            return repository_root(repository) / row.get("repository_path", path)
        if path.startswith(("docs/", "dev/")):
            return ROOT / path
        if isinstance(row.get("relative_links_base"), str):
            return ROOT / row["relative_links_base"] / Path(path).name
        return None

    def visit(value, metadata):
        if isinstance(value, list):
            for child in value:
                visit(child, metadata)
        elif isinstance(value, dict):
            if isinstance(value.get("archive"), str):
                original = original_for(value)
                if original:
                    archive_name = value["archive"]
                    archive = ROOT / archive_name if archive_name.startswith(("docs/", "dev/")) else metadata.parent / archive_name
                    register(archive, original, value.get("before_sha256", value.get("sha256", value.get("original_sha256"))), metadata)
            for child in value.values():
                if isinstance(child, (dict, list)):
                    visit(child, metadata)

    metadata_files = {p for p in HISTORY.rglob("*.json") if p.name in ["receipt.json", "manifest.json", "baseline.json", "archive-map.json"]}
    metadata_files.update((ROOT / "docs/quality").glob("*documentation-refresh*.json"))
    for metadata in sorted(metadata_files):
        metadata_hashes[relative(metadata)] = digest(metadata)
        data = json.loads(metadata.read_text(encoding="utf-8-sig"))
        if metadata.parent.name in ["before-desktop-browser-sources", "before-desktop-workflow-sources"]:
            for name, repo in data.items():
                base = ROOT if name == ROOT.name else ROOT / "dev" / name
                for file, expected in repo["files"].items():
                    register(metadata.parent / name / file, base / file, expected, metadata)
        else:
            visit(data, metadata)

    files = set((ROOT / "docs").rglob("*.md"))
    files.update(archive for archive, row in origins.items() if row["original"].suffix == ".md")
    for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
        files.update(ROOT / "dev" / ("copypaste-" + component) / name for name in ["README.md", "README.en.md"])
    parser = MarkdownIt("commonmark")
    counters = Counter()
    checked = []
    verified = {}

    def archive_valid(path):
        if path not in verified:
            row = origins[path]
            actual = digest(path) if path.is_file() else None
            verified[path] = actual == row["sha256"]
            if not verified[path]:
                issues.append({"kind": "archive_digest_mismatch", "archive": relative(path), "expected": row["sha256"], "actual": actual})
        return verified[path]

    def targets(tokens, inherited_line=1):
        for token in tokens:
            line = token.map[0] + 1 if token.map else inherited_line
            if token.type in ["link_open", "image"]:
                target = token.attrGet("href" if token.type == "link_open" else "src")
                if target is not None:
                    yield target, line
            if token.children:
                yield from targets(token.children, line)

    for file in sorted(files):
        file = file.resolve()
        if file.is_relative_to(HISTORY) and file.parent != HISTORY:
            if file not in origins:
                issues.append({"kind": "archive_origin_missing", "file": relative(file)})
                continue
            if not archive_valid(file):
                continue
            original = origins[file]["original"]
            collection = file.relative_to(HISTORY).parts[0]
            origin = "verified_archive"
        else:
            original, collection = file, None
            origin = "authored_history_note" if file.parent == HISTORY else "current_document"
        if not file.is_file():
            issues.append({"kind": "document_missing", "file": relative(file)})
            continue
        counters[origin] += 1
        checked.append({"file": relative(file), "sha256": digest(file), "original": relative(original), "resolution": origin,
                        **({"metadata": relative(origins[file]["metadata"])} if file in origins else {})})
        for target, line in targets(parser.parse(file.read_text(encoding="utf-8-sig"))):
            parsed = urlsplit(target)
            if parsed.scheme and not re.match(r"^[A-Za-z]:[/\\]", target):
                counters["external_or_nonfile_targets_not_fetched"] += 1
                continue
            path = unquote(parsed.path)
            if not path:
                counters["fragments_not_checked"] += 1
                continue
            destination = (original.parent / path).resolve()
            if not destination.is_relative_to(ROOT):
                issues.append({"kind": "file_target_outside_workspace", "file": relative(file), "line": line, "target": target})
                continue
            historical = collections.get((collection, destination), []) if collection else []
            valid_historical = next((p for p in historical if archive_valid(p)), None)
            if valid_historical:
                counters["links_to_verified_collection_copy"] += 1
            elif destination.exists():
                counters["links_to_current_workspace_target"] += 1
            else:
                issues.append({"kind": "file_target_missing", "file": relative(file), "original": relative(original), "line": line, "target": target, "resolved": relative(destination)})
    # The audit is read-only for all inputs, including old metadata and archives.
    for row in checked:
        assert digest(ROOT / row["file"]) == row["sha256"], row["file"]
    for name, expected in metadata_hashes.items():
        assert digest(ROOT / name) == expected, name
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed" if not issues else "failed",
              "scope": "Every docs/**/*.md file, registered Markdown archive preimage (including .md.txt/.md.snapshot), and all twelve current component READMEs. CommonMark inline, image, autolink and reference links are parsed. External URLs and fragment anchors are counted but not fetched/validated. Verified archives resolve from their explicit original source, preferring a hash-verified target in the same collection and otherwise a current workspace target.",
              "parser": {"name": "markdown-it-py", "version": version("markdown-it-py"), "preset": "commonmark"},
              "counts": dict(counters), "documents": checked, "origin_metadata": metadata_hashes,
              "nonmarkdown_byte_aliases": byte_aliases,
              "verified_archive_bytes": len(verified), "issues": issues,
              "all_read_inputs_unchanged": True, "old_archives_modified": False,
              "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"status": result["status"], "counts": result["counts"], "issues": len(issues), "first_issues": issues[:6]}, ensure_ascii=False))
    raise SystemExit(0 if not issues else 1)


if __name__ == "__main__":
    main()
