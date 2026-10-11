#!/usr/bin/env python3
"""Checks that a Playwright run meant to fail failed for the expected reason (MOD-I241).

Usage: check-expected-failure.py <report.json> <spec path prefix> <test title> <reason regex>

Reads Playwright's JSON report and exits 0 only when:
  * the run had no errors outside the tests (global setup, configuration, no tests found);
  * at least one test ran and failed, and every failed test is under <spec path prefix>;
  * the test titled <test title> failed, with an error whose message or stack matches <reason regex>.

Anything else, a crash or a missing report included, exits 1 with the reason as an ::error
annotation, so a seeded fault that fails for the wrong reason doesn't pass as caught.
"""

import json
import re
import sys


ANSI = re.compile(r"\x1b\[[0-9;]*m")


def fail(message):
    print(f"::error title=Seeded fault not shown::{ANSI.sub('', message)}")
    sys.exit(1)


def walk(suite, path=""):
    """Yield (file, title, results) for every test in a suite tree."""
    file = suite.get("file") or path
    for spec in suite.get("specs", []):
        for test in spec.get("tests", []):
            yield spec.get("file") or file, spec.get("title", ""), test.get("results", [])
    for child in suite.get("suites", []):
        yield from walk(child, file)


def main(argv):
    if len(argv) != 5:
        fail("usage: check-expected-failure.py <report.json> <spec path prefix> <test title> <reason regex>")
    report_path, prefix, title, reason = argv[1:]
    try:
        with open(report_path, encoding="utf-8") as f:
            report = json.load(f)
    except (OSError, ValueError) as e:
        fail(f"no Playwright report at {report_path}: {e}")
    errors = report.get("errors") or []
    if errors:
        first = (errors[0].get("message") or "").splitlines()
        fail(f"the run failed outside the tests: {first[0] if first else errors[0]}")
    tests = list(walk({"suites": report.get("suites", [])}))
    if not tests:
        fail("the run found no tests")
    failed = [(file, name, results) for file, name, results in tests
              if results and results[-1].get("status") in ("failed", "timedOut", "interrupted")]
    if not failed:
        fail("no test failed")
    outside = sorted({file for file, _, _ in failed if not file.startswith(prefix)})
    if outside:
        fail(f"tests failed outside {prefix}: {', '.join(outside)}")
    matching = [results for _, name, results in failed if name == title]
    if not matching:
        fail(f'"{title}" did not fail')
    pattern = re.compile(reason)
    texts = []
    for results in matching:
        for result in results:
            for error in result.get("errors", []) or [result.get("error") or {}]:
                texts.append(ANSI.sub("", (error.get("message") or "") + "\n" + (error.get("stack") or "")))
    if not any(pattern.search(text) for text in texts):
        first = next((t.strip().splitlines()[0] for t in texts if t.strip()), "no error text")
        fail(f'"{title}" failed for another reason: {first}')
    print(f'Expected failure: "{title}" failed matching /{reason}/; '
          f"{len(failed)} failed test(s), all under {prefix}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
