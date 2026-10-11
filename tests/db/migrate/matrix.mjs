/* global console, process */
// Builds the G-migrate job matrix from matrix.json and checks that it covers what MOD-D25 asks
// for (see "Copy migration in CI" in docs/db-upgrade-harness.md).
//
//   node tests/db/migrate/matrix.mjs push|nightly|workstream
//
// Prints `matrix=<json>` (for $GITHUB_OUTPUT) on stdout and the coverage on stderr; exits with 1
// when the set does not cover its rules:
//   push     every pair is listed in matrix.json; at least two are cross-vendor
//   workstream
//            the light profile of a workstream branch (MOD-D30, prototype only): one listed pair,
//            across vendors
//   nightly  generated: every (source vendor, target vendor) pair once, with the source versions of
//            a vendor taking turns, so every source version appears at least once and every target
//            once per source vendor; the whole Playwright suite runs once per target, after a
//            cross-vendor copy
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(readFileSync(join(here, 'matrix.json'), 'utf8'));
const vendorsDir = join(here, '..', 'vendors');
const families = Object.keys(config.targets);
const familyOf = new Map();
for (const family of families) {
    for (const source of config.sources[family]) familyOf.set(source, family);
    familyOf.set(config.targets[family], family);
}

function nightly() {
    const pairs = [];
    for (const sourceFamily of families) {
        families.forEach((targetFamily, j) => {
            const target = config.targets[targetFamily];
            const candidates = config.sources[sourceFamily].filter((source) => source !== target);
            pairs.push({
                source: candidates[j % candidates.length],
                target,
                playwright: sourceFamily === families[(j + 1) % families.length],
            });
        });
    }
    return pairs;
}

function check(set, pairs) {
    const errors = [];
    const sources = families.flatMap((family) => config.sources[family]);
    const targets = Object.values(config.targets);
    for (const { source, target } of pairs) {
        for (const vendor of [source, target]) {
            if (!existsSync(join(vendorsDir, `${vendor}.properties`))) errors.push(`no tests/db/vendors/${vendor}.properties`);
        }
        if (!sources.includes(source)) errors.push(`${source} is not a source in matrix.json`);
        if (!targets.includes(target)) errors.push(`${target} is not a target in matrix.json`);
        if (source === target) errors.push(`${source} cannot be copied into itself`);
    }
    const count = (values, value) => values.filter((v) => v === value).length;
    const familyPairs = pairs.map((p) => `${familyOf.get(p.source)} -> ${familyOf.get(p.target)}`);
    const cross = pairs.filter((p) => familyOf.get(p.source) !== familyOf.get(p.target)).length;
    if (set === 'push') {
        if (cross < 2) errors.push(`only ${cross} cross-vendor pairs; at least 2 are needed`);
    } else if (set === 'workstream') {
        if (pairs.length !== 1 || cross !== 1) errors.push('the workstream set is one cross-vendor pair');
    } else {
        for (const source of sources) {
            if (count(pairs.map((p) => p.source), source) < 1) errors.push(`source ${source} is never copied`);
        }
        for (const target of targets) {
            if (count(pairs.map((p) => p.target), target) < 2) errors.push(`target ${target} is written fewer than twice`);
        }
        for (const s of families) {
            for (const t of families) {
                if (!familyPairs.includes(`${s} -> ${t}`)) errors.push(`no ${s} -> ${t} pair`);
            }
        }
    }
    console.error(`G-migrate ${set}: ${pairs.length} pairs, ${cross} cross-vendor, ` +
        `${pairs.filter((p) => p.playwright).length} with the Playwright suite`);
    for (const p of pairs) console.error(`  ${p.source} -> ${p.target}${p.playwright ? ' (Playwright)' : ''}`);
    return errors;
}

const set = process.argv[2];
if (!['push', 'nightly', 'workstream'].includes(set)) {
    console.error('Usage: node tests/db/migrate/matrix.mjs push|nightly|workstream');
    process.exit(2);
}
const pairs = (set === 'nightly' ? nightly() : config[set]).map((p) => ({ ...p, playwright: Boolean(p.playwright) }));
const errors = check(set, pairs);
if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    process.exit(1);
}
console.log(`matrix=${JSON.stringify({ include: pairs })}`);
