#!/usr/bin/env python3
"""Turn the fixture and the reference into what a code-page database can hold (MOD-I196).

uPortal 5.17 creates varchar columns. On SQL Server's default collation those keep only the
windows-1252 code page, so 5.17 stores other characters as "?" and can't find a row again by such a
name. No 5.17 site on SQL Server holds emoji or CJK text, so the migration-equivalence check
imports a fixture converted to the code page there, and compares 5.17's export with the reference
converted the same way. See docs/migration-equivalence.md.

    python3 tests/db/equivalence/code_page.py <code page> <from dir> <to dir>

Copies <from dir> to <to dir> and converts the text of every file, and every file and directory
name, with to_code_page(). Prints the files whose content or name changed.
"""

import os
import re
import sys

REPLACEMENT = "?"

# A numeric character reference: &#233; or &#xE9;
_REFERENCE = re.compile(r"&#(?:([0-9]+)|[xX]([0-9a-fA-F]+));")


def _encodable(char, code_page):
    try:
        char.encode(code_page)
        return True
    except UnicodeEncodeError:
        return False


def to_code_page(text, code_page="cp1252"):
    """Replace each character that code_page can't encode with "?", one per code point.

    Numeric character references to such characters are replaced too, since an XML parser turns
    them into the character. Text that code_page can encode, and references to it, stay as they are.
    """

    def reference(match):
        code = int(match.group(1)) if match.group(1) else int(match.group(2), 16)
        if code > sys.maxunicode or not _encodable(chr(code), code_page):
            return REPLACEMENT
        return match.group(0)

    text = _REFERENCE.sub(reference, text)
    return "".join(c if _encodable(c, code_page) else REPLACEMENT for c in text)


def convert_directory(source, target, code_page="cp1252"):
    """Copy source to target with to_code_page() applied to names and UTF-8 contents.

    Returns the relative paths (in target) of the files that changed. Raises ValueError when two
    names become the same, or when target exists.
    """
    if os.path.exists(target):
        raise ValueError(f"{target} exists")
    changed = []
    seen = {}
    for directory, _, files in os.walk(source):
        for name in sorted(files):
            path = os.path.join(directory, name)
            relative = os.path.relpath(path, source)
            converted = os.path.join(*[to_code_page(p, code_page) for p in relative.split(os.sep)])
            if converted in seen:
                raise ValueError(f"{relative} and {seen[converted]} both become {converted}")
            seen[converted] = relative
            with open(path, encoding="utf-8", newline="") as f:
                text = f.read()
            out = os.path.join(target, converted)
            os.makedirs(os.path.dirname(out), exist_ok=True)
            converted_text = to_code_page(text, code_page)
            with open(out, "w", encoding="utf-8", newline="") as f:
                f.write(converted_text)
            if converted != relative or converted_text != text:
                changed.append(converted)
    return sorted(changed)


def main(argv):
    if len(argv) != 4:
        print("Usage: code_page.py <code page> <from dir> <to dir>", file=sys.stderr)
        return 2
    _, code_page, source, target = argv
    changed = convert_directory(source, target, code_page)
    print(f"{source} to {code_page} in {target}: {len(changed)} files changed")
    for path in changed:
        print(f"  {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
