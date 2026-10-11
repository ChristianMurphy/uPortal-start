"""Tests of audit.py's statement ids: python3 -m unittest discover -s tests/db/gindex -p 'test_*.py'"""

import unittest

from audit import statement_id

# The lazy load of a local account's attributes, as Hibernate 4 and Hibernate 5.2 generate it
ATTRIBUTES_H4 = (
    "select attributes0_.USER_DIR_ID as USER_DIR4_13_1_, attributes0_.id as id1_11_1_, "
    "attributes0_.id as id1_11_0_, attributes0_.ENTITY_VERSION as ENTITY_V2_11_0_, "
    "attributes0_.ATTR_NAME as ATTR_NAM3_11_0_ from UP_PERSON_ATTR attributes0_ "
    "where attributes0_.USER_DIR_ID=$1")
ATTRIBUTES_H52 = (
    "select attributes0_.USER_DIR_ID as USER_DIR4_11_1_, attributes0_.id as id1_11_1_, "
    "attributes0_.id as id1_11_0_, attributes0_.ENTITY_VERSION as ENTITY_V2_11_0_, "
    "attributes0_.ATTR_NAME as ATTR_NAM3_11_0_ from UP_PERSON_ATTR attributes0_ "
    "where attributes0_.USER_DIR_ID=$1")

# The same statements as MariaDB's performance_schema digests them
ATTRIBUTES_H4_DIGEST = (
    "SELECT `attributes0_` . `USER_DIR_ID` AS `USER_DIR4_13_1_` , `attributes0_` . `id` AS `id1_11_1_` , "
    "`attributes0_` . `id` AS `id1_11_0_` , `attributes0_` . `ENTITY_VERSION` AS `ENTITY_V2_11_0_` , "
    "`attributes0_` . `ATTR_NAME` AS `ATTR_NAM3_11_0_` FROM `UP_PERSON_ATTR` `attributes0_` "
    "WHERE `attributes0_` . `USER_DIR_ID` = ?")
ATTRIBUTES_H52_DIGEST = ATTRIBUTES_H4_DIGEST.replace("`USER_DIR4_13_1_`", "`USER_DIR4_11_1_`")


class StatementIdTest(unittest.TestCase):
    def test_hibernate_renumbering_aliases_keeps_the_id(self):
        self.assertNotEqual(ATTRIBUTES_H4, ATTRIBUTES_H52)
        self.assertEqual(statement_id(ATTRIBUTES_H4), statement_id(ATTRIBUTES_H52))

    def test_hibernate_renumbering_table_aliases_keeps_the_id(self):
        self.assertEqual(statement_id(ATTRIBUTES_H52),
                         statement_id(ATTRIBUTES_H52.replace("attributes0_", "attributes1_")))

    def test_hibernate_renumbering_aliases_keeps_a_mariadb_digest_id(self):
        self.assertEqual(statement_id(ATTRIBUTES_H4_DIGEST), statement_id(ATTRIBUTES_H52_DIGEST))

    def test_spacing_and_case_keep_the_id(self):
        self.assertEqual(statement_id(ATTRIBUTES_H52),
                         statement_id("  " + ATTRIBUTES_H52.upper().replace(", ", " ,\n  ") + "\n"))

    def test_another_condition_is_another_statement(self):
        self.assertNotEqual(statement_id(ATTRIBUTES_H52),
                            statement_id(ATTRIBUTES_H52.replace("where attributes0_.USER_DIR_ID=$1",
                                                                "where attributes0_.ATTR_NAME=$1")))

    def test_another_table_is_another_statement(self):
        self.assertNotEqual(statement_id(ATTRIBUTES_H52),
                            statement_id(ATTRIBUTES_H52.replace("UP_PERSON_ATTR", "UP_PERSON_DIR")))

    def test_another_column_is_another_statement(self):
        self.assertNotEqual(statement_id(ATTRIBUTES_H52),
                            statement_id(ATTRIBUTES_H52.replace("attributes0_.ENTITY_VERSION",
                                                                "attributes0_.ATTR_VALUE")))

    def test_column_names_with_digits_are_kept(self):
        self.assertNotEqual(statement_id("select x.col1 from UP_T x where x.a=$1"),
                            statement_id("select x.col2 from UP_T x where x.a=$1"))

    def test_foreign_key_checks_differ_by_table(self):
        check = 'SELECT 1 FROM ONLY "public"."{}" x WHERE $1 OPERATOR(pg_catalog.=) "unique_strings_id" FOR KEY SHARE OF x'
        self.assertNotEqual(statement_id(check.format("up_login_event_aggr")),
                            statement_id(check.format("up_concurrent_user_aggr")))


if __name__ == "__main__":
    unittest.main()
