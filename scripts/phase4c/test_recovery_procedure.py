import unittest

from recovery_procedure import RecoveryFailure, validate_schema_counts


class RecoverySchemaCountTests(unittest.TestCase):
    def test_legitimate_empty_object_categories_are_accepted(self):
        counts = validate_schema_counts((0, 0, 0, 0, 0, 0, 0, 0, 1))
        self.assertEqual(counts["tables"], 0)
        self.assertEqual(counts["triggers"], 0)
        self.assertEqual(counts["rls"], 0)
        self.assertEqual(counts["policies"], 0)
        self.assertEqual(counts["migration_table"], 1)

    def test_missing_migration_ledger_is_rejected(self):
        with self.assertRaises(RecoveryFailure):
            validate_schema_counts((0, 0, 0, 0, 0, 0, 0, 0, 0))

    def test_negative_count_is_rejected(self):
        with self.assertRaises(RecoveryFailure):
            validate_schema_counts((0, 0, -1, 0, 0, 0, 0, 0, 1))

    def test_wrong_number_of_counts_is_rejected(self):
        with self.assertRaises(RecoveryFailure):
            validate_schema_counts((0, 1))


if __name__ == "__main__":
    unittest.main()
