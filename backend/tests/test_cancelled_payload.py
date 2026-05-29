import sys
from pathlib import Path
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import main


class CancelledPayloadTests(unittest.TestCase):
    def test_cancelled_result_uses_null_metrics(self):
        result = main.build_cancelled_result()

        self.assertEqual(result.grade, "Cancelled")
        self.assertIsNone(result.securityScore)
        self.assertIsNone(result.bugsFound)
        self.assertEqual(result.bugs, [])
        self.assertEqual(result.status, "cancelled")

    def test_normalize_test_result_strips_legacy_metrics(self):
        legacy = main.TestResult(
            grade="Cancelled",
            securityScore=0,
            bugsFound=0,
            bugs=[],
        )
        normalized = main.normalize_test_result(legacy, "cancelled")

        self.assertEqual(normalized.status, "cancelled")
        self.assertIsNone(normalized.securityScore)
        self.assertIsNone(normalized.bugsFound)
        self.assertEqual(normalized.bugs, [])


if __name__ == "__main__":
    unittest.main()
