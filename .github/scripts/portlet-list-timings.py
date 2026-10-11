#!/usr/bin/env python3
"""
Diagnosis of MOD-I340, temporary (test-speed branch): how long /api/portletList takes on this
runner, from Tomcat's access log (when its pattern ends with %D, the milliseconds of each request)
and from the timing lines that uPortal's test-speed branch logs in portal.log. Prints a summary
in the last lines of the job log and as a notice annotation.

Usage: portlet-list-timings.py <label> [<Tomcat logs directory>]
"""
import glob
import os
import re
import statistics
import sys

label = sys.argv[1]
logs = sys.argv[2] if len(sys.argv) > 2 else ".gradle/tomcat/logs"


def summary(values):
    if not values:
        return "none"
    values = sorted(values)
    p90 = values[min(len(values) - 1, int(len(values) * 0.9))]
    over = sum(1 for v in values if v > 3000)
    return (f"n={len(values)} median={statistics.median(values):.0f} p90={p90} "
            f"max={values[-1]} over3s={over}")


lines = []
cpu = ""
try:
    with open("/proc/cpuinfo", encoding="utf-8") as f:
        cpu = next((l.split(":", 1)[1].strip() for l in f if l.startswith("model name")), "")
except OSError:
    pass
lines.append(f"runner: {os.cpu_count()} processors, {cpu or 'unknown model'}, "
             f"load {os.getloadavg()[0]:.1f} now")

# Access log: ... "GET /uPortal/api/portletList HTTP/1.1" 200 1234 "referer" "agent" 3456
access = []
for path in glob.glob(os.path.join(logs, "localhost_access_log*.txt")):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"GET /uPortal/api/portletList' in line:
                m = re.search(r" (\d+)$", line.strip())
                if m:
                    access.append(int(m.group(1)))
lines.append(f"access log, whole request in ms: {summary(access)}")

# portal.log: MOD-I340 portletList user=staff registry=12ms person=0ms
#             MOD-I340 portletList user=staff definitions=..ms (..) categories=..ms uncategorized=..ms (..)
parts = {"registry": {}, "person": {}, "definitions": {}, "categories": {}, "uncategorized": {}}
for path in glob.glob(os.path.join(logs, "portal", "portal.log*")):
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if "MOD-I340 portletList" not in line:
                continue
            user = re.search(r"user=(\S+)", line)
            for key in parts:
                m = re.search(rf"{key}=(\d+)ms", line)
                if m and user:
                    parts[key].setdefault(user.group(1), []).append(int(m.group(1)))
for key, by_user in parts.items():
    for user, values in sorted(by_user.items()):
        lines.append(f"handler {key} ms, {user}: {summary(values)}")

print(f"==== /api/portletList timings ({label}, MOD-I340 diagnosis)")
for line in lines:
    print(line)
text = "%0A".join(l.replace("%", "%25") for l in lines)
print(f"::notice title=portletList timings {label} (MOD-I340)::{text}")
