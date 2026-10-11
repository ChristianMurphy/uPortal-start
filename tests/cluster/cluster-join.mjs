// Checks that node B joined node A's JGroups cluster when it started (tests/cluster/cluster.sh).
//
//   node tests/cluster/cluster-join.mjs a=<log>[,<log>...] b=<log>[,<log>...] [--since <ms>] [--bound <s>]
//
// The logs are each node's Tomcat logs (catalina.<date>.log), where JGroups 3 writes through
// java.util.logging; the harness logs GMS at TRACE, so every view a node installs is there:
// "installing view [vm-1|2] (2) [vm-1, vm-2]". Node B joined when both nodes installed the same
// view of two members. A JOIN that times out makes node B form a cluster of its own, and the two
// nodes are then split until MERGE3 merges them: node A counts node B as a member, node B drops
// node A's messages, cache invalidations included, as coming from a non-member.
//
// The time is counted from node B's first JGroups line (its channel starting) after --since (ms
// since the epoch, in the logs' clock). Prints the outcome and exits 0 when the nodes shared a
// view of two members within --bound seconds (default 30), 1 when they did not, and 2 when that
// can't be told yet: no shared view so far, and node B's log ends within the bound.

import console from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";

const MONTHS = {
  Jan: 0,
  Feb: 1,
  Mar: 2,
  Apr: 3,
  May: 4,
  Jun: 5,
  Jul: 6,
  Aug: 7,
  Sep: 8,
  Oct: 9,
  Nov: 10,
  Dec: 11,
};
// 11-Oct-2026 12:19:32.838 FINE [thread] org.jgroups.protocols.pbcast.GMS.installView vm-1: ...
const LINE =
  /^(\d{2})-([A-Z][a-z]{2})-(\d{4}) (\d{2}):(\d{2}):(\d{2})\.(\d{3}) \S+ \[[^\]]*\] (org\.jgroups\.\S+) (.*)$/;
const VIEW = /installing view (?:MergeView::)?\[([^\]|]+\|\d+)\] \((\d+)\)/;

function parseTime(m) {
  // The logs carry local time without a zone; only differences matter, so read it as UTC
  return Date.UTC(m[3], MONTHS[m[2]], m[1], m[4], m[5], m[6], m[7]);
}

function linesOf(files, since) {
  const out = [];
  for (const file of files) {
    let text;
    try {
      text = readFileSync(file, "latin1");
    } catch {
      continue;
    }
    for (const line of text.split("\n")) {
      const m = LINE.exec(line);
      if (!m) continue;
      const at = parseTime(m);
      if (at >= since) out.push({ at, logger: m[8], text: m[9] });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

const args = process.argv.slice(2);
const files = {};
let since = 0;
let bound = 30;
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--since") since = Number(args[++i]);
  else if (args[i] === "--bound") bound = Number(args[++i]);
  else {
    const m = /^([ab])=(.+)$/.exec(args[i]);
    if (!m) {
      console.error(`Cannot read ${args[i]}`);
      process.exit(2);
    }
    files[m[1]] = m[2].split(",");
  }
}
if (!files.a || !files.b) {
  console.error(
    "Usage: cluster-join.mjs a=<log>[,<log>] b=<log>[,<log>] [--since <ms>] [--bound <s>]",
  );
  process.exit(2);
}

const a = linesOf(files.a, since);
const b = linesOf(files.b, since);
if (b.length === 0) {
  console.log("UNDECIDED: node B logged no JGroups line yet");
  process.exit(2);
}
const started = b[0].at;
const deadline = started + bound * 1000;
const iso = (ms) => new Date(ms).toISOString().slice(11, 23);

// Replay both nodes' views in time order, and find when they first shared a view of two members
const events = [
  ...a.map((l) => ({ ...l, node: "a" })),
  ...b.map((l) => ({ ...l, node: "b" })),
]
  .map((l) => ({ ...l, view: VIEW.exec(l.text) }))
  .filter((l) => l.view)
  .sort((x, y) => x.at - y.at);
const current = { a: null, b: null };
let joined = null;
for (const e of events) {
  current[e.node] = { id: e.view[1], members: Number(e.view[2]) };
  if (
    e.at >= started &&
    current.a &&
    current.b &&
    current.a.id === current.b.id &&
    current.a.members === 2
  ) {
    joined = { at: e.at, id: current.a.id };
    break;
  }
}

const singleton = b.find((l) =>
  /becoming singleton|created cluster \(first member\)/.test(l.text),
);
const timeouts = b.filter((l) =>
  /JOIN\(.*\) sent to .* timed out/.test(l.text),
).length;
const how = singleton
  ? `; node B gave up after ${timeouts} JOIN timeout(s) and formed its own cluster at ${iso(singleton.at)}`
  : "";

if (joined && joined.at <= deadline) {
  console.log(
    `PASS: both nodes installed view [${joined.id}] of two members ${joined.at - started} ms after node B's channel started${how}`,
  );
  process.exit(0);
}
if (joined) {
  console.log(
    `FAIL: the nodes first shared a view of two members, [${joined.id}], ${joined.at - started} ms after node B's channel started (bound ${bound} s)${how}`,
  );
  process.exit(1);
}
const last = Math.max(b[b.length - 1].at, a.length ? a[a.length - 1].at : 0);
if (last > deadline) {
  console.log(
    `FAIL: no view of two members shared by both nodes ${bound} s after node B's channel started (node A: ${current.a ? `[${current.a.id}] (${current.a.members})` : "none"}, node B: ${current.b ? `[${current.b.id}] (${current.b.members})` : "none"})${how}`,
  );
  process.exit(1);
}
console.log(
  `UNDECIDED: no shared view of two members yet, ${last - started} ms after node B's channel started${how}`,
);
process.exit(2);
