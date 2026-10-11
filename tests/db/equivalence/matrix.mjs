// Builds the job matrices of .github/workflows/migration-equivalence.yml (see
// docs/migration-equivalence.md).
//
//   node tests/db/equivalence/matrix.mjs push|workstream|nightly
//
// Prints `in-place=<json>` and `copy=<json>` (for $GITHUB_OUTPUT) on stdout and the sets on stderr.
// The 6.0 runtime servers (targets) and the old servers 5.17 runs on (sources) are the ones
// tests/db/migrate/matrix.json lists (MOD-D25).
//   push        as listed in equivalence/matrix.json (the integration branch); copies must cross
//               vendors, and a copy's zone (EQUIVALENCE_ZONE) must be an IANA time zone
//   workstream  the light profile for ccr-43ba0785-hzlrj5-<topic> branches (MOD-D30), as listed
//   nightly     in place on every target; one copy per vendor, from its oldest source into the
//               next vendor's target, so every vendor is copied from and into once
// Exits with 1 when a vendor file is missing or a pair breaks these rules.
/* global process, console */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'matrix.json'), 'utf8'));
const servers = JSON.parse(readFileSync(join(here, '..', 'migrate', 'matrix.json'), 'utf8'));
const families = Object.keys(servers.targets);
const familyOf = (vendor) => families.find((family) =>
    servers.targets[family] === vendor || servers.sources[family].includes(vendor));

const set = process.argv[2];
let inPlace;
let copy;
if (set === 'push' || set === 'workstream') {
    inPlace = config[set]['in-place'];
    copy = config[set].copy;
} else if (set === 'nightly') {
    inPlace = families.map((family) => servers.targets[family]);
    copy = families.map((family, i) => ({
        source: servers.sources[family][0],
        target: servers.targets[families[(i + 1) % families.length]],
    }));
} else {
    console.error('Usage: node tests/db/equivalence/matrix.mjs push|workstream|nightly');
    process.exit(2);
}

const errors = [];
for (const vendor of [...inPlace, ...copy.flatMap((pair) => [pair.source, pair.target])]) {
    if (!existsSync(join(here, '..', 'vendors', `${vendor}.properties`))) {
        errors.push(`no tests/db/vendors/${vendor}.properties`);
    }
    if (!familyOf(vendor)) errors.push(`${vendor} is in no family of tests/db/migrate/matrix.json`);
}
for (const vendor of inPlace) {
    if (!Object.values(servers.targets).includes(vendor)) errors.push(`${vendor} is not a 6.0 runtime server`);
}
const isTimeZone = (zone) => {
    try {
        new Intl.DateTimeFormat('en', { timeZone: zone });
        return true;
    } catch {
        return false;
    }
};
for (const { source, target, zone } of copy) {
    if (familyOf(source) === familyOf(target)) errors.push(`${source} to ${target} does not cross vendors`);
    if (zone !== undefined && !isTimeZone(zone)) errors.push(`${source} to ${target}: ${zone} is not a time zone`);
    if (!Object.values(servers.targets).includes(target)) errors.push(`${target} is not a 6.0 runtime server`);
}
console.error(`${set}: in place on ${inPlace.join(', ')}; copies ${copy.map((p) => `${p.source} to ${p.target}${p.zone ? ` in ${p.zone}` : ''}`).join(', ')}`);
if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exit(1);
}
console.log(`in-place=${JSON.stringify({ vendor: inPlace })}`);
console.log(`copy=${JSON.stringify({ include: copy })}`);
