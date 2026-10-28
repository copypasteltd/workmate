"""Reject incomplete or ambiguous evidence before it can become a release claim."""
import unittest
import archive_runtime_startup_evidence as evidence


def tap(total=12, passed=12, failed=0, skipped=0):
    return f'# tests {total}\n# pass {passed}\n# fail {failed}\n# cancelled 0\n# skipped {skipped}\n# todo 0\n'.encode()


class EvidenceTests(unittest.TestCase):
    def test_exact_complete_tap_is_accepted(self):
        self.assertEqual(evidence.counts(tap())['tests'], 12)

    def test_missing_or_partial_tap_is_rejected(self):
        for body in [b'', b'# tests 12\n', tap(12, 11, 1), tap(12, 11, 0, 1), tap(0, 0)]:
            with self.subTest(body=body), self.assertRaises(AssertionError):
                evidence.counts(body)

    def test_a_second_failed_plan_cannot_hide_after_a_passing_plan(self):
        with self.assertRaises(AssertionError):
            evidence.counts(tap() + tap(1, 0, 1))

    def test_claimed_counts_must_match_raw_tap(self):
        claimed = evidence.counts(tap())
        claimed['tests'] = claimed['pass'] = 13
        with self.assertRaises(AssertionError):
            evidence.counts(tap(), claimed)

    def test_paths_cannot_escape_into_another_workspace(self):
        for name in ['../outside', '/absolute', 'C:/outside', 'docs/../../outside', 'docs\\outside']:
            with self.subTest(name=name), self.assertRaises(AssertionError):
                evidence.safe(name)
        self.assertEqual(evidence.safe('docs/quality/receipt.json'), evidence.ROOT / 'docs/quality/receipt.json')

    def test_source_changes_cannot_be_reported_as_a_passing_run(self):
        for value in [{'status': 'failed', 'source_unchanged': True}, {'status': 'passed', 'source_unchanged': False}]:
            with self.subTest(value=value), self.assertRaises(AssertionError):
                evidence.passing(value)

    def test_zero_executed_checks_do_not_qualify_a_native_runtime(self):
        selected = {key: {'status': 'passed', 'source_unchanged': True, 'steps': []} for key in evidence.SELECTED}
        with self.assertRaises(AssertionError):
            evidence.selected_conditions(selected)


if __name__ == '__main__':
    unittest.main()
