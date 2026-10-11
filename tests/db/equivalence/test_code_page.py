"""Tests of code_page.py: python3 -m unittest discover -s tests/db/equivalence -p 'test_*.py'"""

import os
import tempfile
import unittest

from code_page import convert_directory, to_code_page


class ToCodePageTest(unittest.TestCase):
    def test_keeps_text_the_code_page_holds(self):
        text = "Personen mit «ünïcødé» Attributen & mehr — €, Œ, ™, Équipe"
        self.assertEqual(to_code_page(text), text)

    def test_replaces_an_emoji_with_one_question_mark(self):
        self.assertEqual(to_code_page("PAGS Fixture Child 🌱"), "PAGS Fixture Child ?")

    def test_replaces_each_japanese_character(self):
        self.assertEqual(to_code_page("研究グループ"), "??????")

    def test_replaces_letters_outside_the_code_page(self):
        self.assertEqual(to_code_page("ünïcødé-łøwęr Ŧitle №"), "ünïcødé-?øw?r ?itle ?")

    def test_replaces_numeric_character_references_to_such_characters(self):
        self.assertEqual(to_code_page('name="Umbenannt &#127881;"'), 'name="Umbenannt ?"')
        self.assertEqual(to_code_page("&#x1F389;&#X4E2D;"), "??")

    def test_keeps_numeric_character_references_the_code_page_holds(self):
        text = "caf&#233; &#xE9; &#38; &#8364;"
        self.assertEqual(to_code_page(text), text)

    def test_keeps_one_character_per_code_point(self):
        text = "Zoë Ünïcødé-Łøwęr 🎓" * 10
        self.assertEqual(len(to_code_page(text)), len(text))


class ConvertDirectoryTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.source = os.path.join(self.temp.name, "source")
        self.target = os.path.join(self.temp.name, "target")

    def tearDown(self):
        self.temp.cleanup()

    def write(self, relative, text):
        path = os.path.join(self.source, relative)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with open(path, "w", encoding="utf-8") as f:
            f.write(text)

    def read(self, relative):
        with open(os.path.join(self.target, relative), encoding="utf-8") as f:
            return f.read()

    def test_converts_names_and_contents_and_lists_the_changes(self):
        self.write("group/研究グループ.xml", "<name>研究グループ</name>\n")
        self.write("group/Équipe.xml", "<name>Équipe ✨</name>\n")
        self.write("user/plain.xml", "<name>plain</name>\n")

        changed = convert_directory(self.source, self.target)

        self.assertEqual(changed, ["group/??????.xml", "group/Équipe.xml"])
        self.assertEqual(self.read("group/??????.xml"), "<name>??????</name>\n")
        self.assertEqual(self.read("group/Équipe.xml"), "<name>Équipe ?</name>\n")
        self.assertEqual(self.read("user/plain.xml"), "<name>plain</name>\n")

    def test_refuses_two_names_that_become_one(self):
        self.write("a/研.xml", "x")
        self.write("a/究.xml", "y")
        with self.assertRaisesRegex(ValueError, "both become"):
            convert_directory(self.source, self.target)


if __name__ == "__main__":
    unittest.main()
