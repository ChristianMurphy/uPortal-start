// Checks that no clustered job ran on two nodes at once (tests/cluster/cluster.sh).
//
//   node tests/cluster/lock-overlap.mjs <name>=<portal.log>[@<end ms>] ...
//
// Each node logs org.apereo.portal.concurrency.locking.ClusterLockServiceImpl at TRACE (the
// harness adds the logger), so its portal.log shows when it took and gave up each cluster lock
// (a UP_MUTEX row): "acquired db lock for: <mutex>" when it holds the lock and starts the job,
// "released db lock for: <mutex>" when it gives the lock up, and "released local lock for:
// <mutex>" once the job is over, also when giving up the database lock failed. A lock still
// held at the end of a log (the node was killed) is held until <end ms>, the time of the kill,
// or else the end of the log.
//
// Prints how often each node ran each job, and every pair of runs of the same job on two nodes
// that overlap in time; exits 1 when there is one. Both nodes run on one machine, so their log
// timestamps share a clock.

import console from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";

const LINE =
  /^\w+\s+\[[^\]]*\]\s+\S+\s+(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}),(\d{3}) - (acquired db lock|released db lock|released local lock) for: (\S+)/;

function parseTime(date, time, millis) {
  // The portal logs local time without a zone; only differences matter, so read it as UTC
  return Date.parse(`${date}T${time}.${millis}Z`);
}

function runsOf(name, file, endOverride) {
  const runs = [];
  const open = new Map();
  let last = 0;
  for (const line of readFileSync(file, "latin1").split("\n")) {
    const m = LINE.exec(line);
    if (!m) continue;
    const at = parseTime(m[1], m[2], m[3]);
    last = at;
    const [, , , , what, mutex] = m;
    if (what === "acquired db lock") {
      open.set(mutex, at);
    } else if (open.has(mutex)) {
      runs.push({ node: name, mutex, start: open.get(mutex), end: at });
      open.delete(mutex);
    }
  }
  for (const [mutex, start] of open) {
    runs.push({ node: name, mutex, start, end: endOverride ?? last, unfinished: true });
  }
  return runs;
}

const args = process.argv.slice(2);
if (args.length < 2) {
  console.error("Usage: lock-overlap.mjs <name>=<portal.log>[@<end ms>] <name>=<portal.log> ...");
  process.exit(2);
}

let runs = [];
for (const arg of args) {
  const m = /^([^=]+)=(.+?)(?:@(\d+))?$/.exec(arg);
  if (!m) {
    console.error(`Cannot read ${arg}`);
    process.exit(2);
  }
  // The kill time comes from `date +%s%3N` (UTC); the log is local time, shifted the same way
  // as parseTime when the machine runs in UTC, as CI runners do
  runs = runs.concat(runsOf(m[1], m[2], m[3] === undefined ? undefined : Number(m[3])));
}

const iso = (ms) => new Date(ms).toISOString().replace("T", " ").replace("Z", "");
const short = (mutex) => mutex.replace(/^org\.apereo\.portal\./, "");

const counts = new Map();
for (const run of runs) {
  const key = short(run.mutex);
  const perNode = counts.get(key) ?? {};
  perNode[run.node] = (perNode[run.node] ?? 0) + 1;
  counts.set(key, perNode);
}
console.log("Runs of each clustered job per node:");
for (const [mutex, perNode] of [...counts].sort()) {
  console.log(
    `  ${mutex}: ${Object.entries(perNode)
      .map(([node, n]) => `${node} ${n}`)
      .join(", ")}`
  );
}

const overlaps = [];
const byMutex = Map.groupBy(runs, (run) => run.mutex);
for (const [mutex, list] of byMutex) {
  list.sort((a, b) => a.start - b.start);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length && list[j].start < list[i].end; j++) {
      if (list[i].node !== list[j].node) {
        overlaps.push({ mutex, first: list[i], second: list[j] });
      }
    }
  }
}

if (runs.length === 0) {
  console.log("FAILED: no cluster-lock activity in the logs (is the TRACE logger missing?)");
  process.exit(1);
}
if (overlaps.length === 0) {
  console.log(`OK: no job ran on two nodes at once (${runs.length} runs)`);
  process.exit(0);
}
console.log(`FAILED: ${overlaps.length} time(s) a job ran on two nodes at once:`);
for (const { mutex, first, second } of overlaps.slice(0, 20)) {
  const describe = (run) =>
    `${run.node} ${iso(run.start)} to ${iso(run.end)}${run.unfinished ? " (unfinished)" : ""}`;
  console.log(`  ${short(mutex)}: ${describe(first)} and ${describe(second)}`);
}
process.exit(1);
