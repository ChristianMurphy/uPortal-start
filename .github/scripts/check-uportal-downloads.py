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

NEEDS = "${{ needs.uportal.outputs.artifact }}"
# The uportal job's own reuse step sets this output, so only that job may use it.
REUSE = "${{ steps.reuse.outputs.artifact }}"


def depth(line):
    return len(line) - len(line.lstrip())


def job(lines, start):
    """The id of the job that holds line `start`: the nearest key above it that is indented like
    the first key under `jobs:`."""
    top = max((i for i in range(start) if lines[i].rstrip() == "jobs:"), default=None)
    if top is None:
        return ""
    keys = [
        line
        for line in lines[top + 1 : start]
        if line.strip() and not line.lstrip().startswith("#")
    ]
    first = keys[0] if keys else ""
    for line in reversed(lines[top + 1 : start]):
        match = re.match(r"\s*([A-Za-z0-9_-]+):\s*(#.*)?$", line)
        if match and depth(line) == depth(first):
            return match.group(1)
    return ""


def steps(lines):
    """Yield (line number, job id, step lines) for every download-artifact step."""
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
        yield start + 1, job(lines, start), lines[start:end]


def value(step, key):
    """The value of `key` under the step's `with:`, without quotes or a trailing comment."""
    inputs = next((i for i, line in enumerate(step) if line.strip() == "with:"), len(step))
    for line in step[inputs + 1 :]:
        match = re.match(rf"\s*{key}:\s*(.*?)\s*$", line)
        if match:
            text = match.group(1)
            if text[:1] in ("'", '"') and text.find(text[0], 1) > 0:
                return text[1 : text.find(text[0], 1)]
            return re.sub(r"\s+#.*$", "", text)
    return ""


def main(files):
    problems = 0
    checked = 0
    for path in files:
        with open(path, encoding="utf-8") as handle:
            lines = handle.read().splitlines()
        for number, job_id, step in steps(lines):
            name = value(step, "name")
            target = value(step, "path")
            if ".m2" not in target and "uportal" not in name.lower():
                continue
            checked += 1
            if name != NEEDS and not (job_id == "uportal" and name == REUSE):
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
