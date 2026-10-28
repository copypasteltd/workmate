"""Adversarial shard-reader tests; fixtures stay in the development workspace."""
import copy
import json
import shutil
import tempfile
import unittest
from pathlib import Path
from publication_proofs import load_proofs, write_shards, encoded

ROOT = Path(__file__).resolve().parents[2]


class ProofShards(unittest.TestCase):
    def setUp(self):
        base = ROOT / 'dev/copypaste-delivery/.data/proof-format-tests'
        base.mkdir(parents=True, exist_ok=True)
        self.directory = Path(tempfile.mkdtemp(dir=base))
        self.rows = [{'repository': 'extension', 'path': 'src/香港.ts', 'sha256': 'a' * 64, 'historical_note': {'unchanged': True}}, {'repository': 'docs', 'path': 'docs/a.json', 'sha256': 'b' * 64}]
        self.manifest = write_shards(self.rows, self.directory, 119)

    def tearDown(self):
        assert self.directory.resolve().is_relative_to(ROOT / 'dev/copypaste-delivery/.data/proof-format-tests')
        shutil.rmtree(self.directory)

    def test_legacy_and_sharded_preserve_every_row_and_unknown_historical_field(self):
        self.assertEqual(load_proofs({'status': 'ready_for_remote_verification', 'proofs': self.rows}, self.directory), self.rows)
        self.assertEqual(load_proofs(self.manifest, self.directory), self.rows)

    def test_tampered_bytes_or_missing_shard_fail_closed(self):
        p = self.directory / self.manifest['proof_shards'][0]['path']; body = p.read_bytes()
        p.write_bytes(body.replace(b'unchanged', b'corrupted'))
        with self.assertRaises(AssertionError): load_proofs(self.manifest, self.directory)
        p.unlink()
        with self.assertRaises(FileNotFoundError): load_proofs(self.manifest, self.directory)

    def test_each_count_length_hash_and_format_are_checked(self):
        for field, value in [('proof_count', 1), ('proofs_format', 'unknown'), ('proofs', self.rows), ('status', 'ready_for_remote_verification')]:
            m = copy.deepcopy(self.manifest); m[field] = value
            with self.assertRaises(AssertionError): load_proofs(m, self.directory)
        for field, value in [('bytes', 1), ('bytes', 21 * 1024 * 1024), ('proofs', 1), ('sha256', 'c' * 64)]:
            m = copy.deepcopy(self.manifest); m['proof_shards'][0][field] = value
            with self.assertRaises(AssertionError): load_proofs(m, self.directory)

    def test_traversal_absolute_and_duplicate_descriptors_are_rejected(self):
        for name in ['../secret', 'docs/quality/publication-proofs/stage119/../proofs-0001.json', 'C:/secret', '/docs/quality/publication-proofs/stage119/proofs-0001.json']:
            m = copy.deepcopy(self.manifest); m['proof_shards'][0]['path'] = name
            with self.assertRaises(AssertionError): load_proofs(m, self.directory)
        m = copy.deepcopy(self.manifest); m['proof_shards'] *= 2; m['proof_count'] *= 2
        with self.assertRaises(AssertionError): load_proofs(m, self.directory)

    def test_duplicate_proof_identities_and_invalid_paths_are_rejected(self):
        for rows in [self.rows + [self.rows[0]], [{**self.rows[0], 'repository': 'main'}], [{**self.rows[0], 'path': '../a'}], [{**self.rows[0], 'path': 'a\\b'}], [{**self.rows[0], 'sha256': 'bad'}]]:
            with self.assertRaises(AssertionError): write_shards(rows, self.directory, 120)

    def test_writer_never_overwrites_an_existing_stage(self):
        with self.assertRaises(FileExistsError): write_shards(self.rows, self.directory, 119)

    def test_large_history_splits_below_limit_without_losing_rows(self):
        rows = [{'repository': 'docs', 'path': f'docs/{i}.json', 'sha256': 'a' * 64, 'retained': '測試' * 400} for i in range(10000)]
        m = write_shards(rows, self.directory, 120)
        self.assertGreater(len(m['proof_shards']), 1)
        self.assertEqual(load_proofs(m, self.directory), rows)
        self.assertEqual(sum(s['proofs'] for s in m['proof_shards']), len(rows))


if __name__ == '__main__': unittest.main(verbosity=2)
