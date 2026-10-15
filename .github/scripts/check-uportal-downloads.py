#!/usr/bin/env python3
"""Checks that every job downloads the uPortal build by the name its `uportal` job gives (MOD-I371).

Usage: check-uportal-downloads.py [<workflow file>...]    (default: .github/workflows/*.yml)

A download-artifact step fetches the uPortal build when its `path` is under `~/.m2` or its
`name` mentions uportal. Such a step must take its name from `needs.uportal.outputs.artifact`,
or, in the `uportal` job itself, from `steps.reuse.outputs.artifact`. The build is uploaded under
the uPortal commit, so a fixed name such as `uportal-maven-local` finds nothing and the job fails
after its runner wait. Each problem is an ::error annotation, and the exit status is 1. A run that
finds no download of the uPortal build at all exits 1 too, so a parser that stops matching can't
pass.
"""

import glob
import re
import sys

ALLOWED = (
    "${{ needs.uportal.outputs.artifact }}",
    "${{ steps.reuse.outputs.artifact }}",
)


def steps(lines):
    """Yield (line number, step lines) for every download-artifact step."""
    for number, line in enumerate(lines):
        if "uses: actions/download-artifact@" not in line:
            continue
        # The step starts at the nearest line above (or this one) that opens a list item.
        start = number
        while start > 0 and not lines[start].lstrip().startswith("- "):
            start -= 1
        indent = len(lines[start]) - len(lines[start].lstrip())
        end = start + 1
        while end < len(lines):
            text = lines[end]
            if text.strip() and len(text) - len(text.lstrip()) <= indent:
                break
            end += 1
        yield start + 1, lines[start:end]


def value(step, key):
    """The value of `key` under the step's `with:`."""
    inputs = next((i for i, line in enumerate(step) if line.strip() == "with:"), len(step))
    for line in step[inputs + 1 :]:
        match = re.match(rf"\s*{key}:\s*(.*?)\s*$", line)
        if match:
            return match.group(1)
    return ""


def main(files):
    problems = 0
    checked = 0
    for path in files:
        with open(path, encoding="utf-8") as handle:
            lines = handle.read().splitlines()
        for number, step in steps(lines):
            name = value(step, "name")
            target = value(step, "path")
            if ".m2" not in target and "uportal" not in name.lower():
                continue
            checked += 1
            if name not in ALLOWED:
                problems += 1
                print(
                    f"::error file={path},line={number},title=uPortal build download::"
                    f"downloads the uPortal build as '{name}'. Use "
                    "${{ needs.uportal.outputs.artifact }}, the name the build was uploaded under"
                )
    print(f"Checked {checked} download(s) of the uPortal build; {problems} with problems.")
    return 1 if problems or not checked else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:] or sorted(glob.glob(".github/workflows/*.yml"))))
