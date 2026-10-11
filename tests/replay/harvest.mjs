// Turns the Playwright traces of a suite run into the list of requests the suite makes, by role
// (docs/http-replay.md, "Recording the reference").
//
//   node tests/replay/harvest.mjs <test-results dir> <output.json> [portal origin]
//
// Each trace.zip holds one *.network file per browser or API context, with HAR entries. The role
// of an entry is the user that context last logged in as: a `/uPortal/Login?userName=` request or
// a CAS form post with `username=`; `/uPortal/Logout` makes it guest again.
//
// Only requests to the portal's own origin are kept. Requests that log in or out, or that carry a
// single-use CAS ticket, are left out (the security checks cover login). Requests that are not
// GET or HEAD are listed under `mutations` but are not replayed: the suite's own state decides
// what they do. They are the suite's state-changing endpoints for the CSRF report.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { maskString } from './lib.mjs';

const [resultsDir, output, origin = 'http://localhost:8080'] = process.argv.slice(2);
if (!resultsDir || !output) {
    console.error('usage: harvest.mjs <test-results dir> <output.json> [portal origin]');
    process.exit(2);
}

function* traces(dir) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) yield* traces(path);
        else if (name.endsWith('.zip') && name.startsWith('trace')) yield path;
    }
}

const header = (entry, name) => entry.request.headers.find((h) => h.name.toLowerCase() === name)?.value;

// Request headers that change what the portal answers; the rest are browser noise.
const KEPT_HEADERS = ['accept', 'x-requested-with', 'content-type'];

/** The replayable form of a suite URL: path and query only, with volatile values made constant. */
function replayablePath(url) {
    const parsed = new URL(url);
    let path = parsed.pathname.replace(/;jsessionid=[^/?]*/i, '');
    const query = new URLSearchParams(parsed.search);
    // jQuery's cache-busting parameter is the time of the request.
    if (query.has('_')) query.set('_', '0');
    const search = query.toString();
    return search ? `${path}?${search}` : path;
}

const requests = new Map();
const mutations = new Map();
let traceCount = 0;
for (const zip of traces(resultsDir)) {
    traceCount++;
    const test = zip.split('/').at(-2);
    const listing = execFileSync('unzip', ['-Z1', zip], { encoding: 'utf8' }).split('\n').filter((f) => f.endsWith('.network'));
    for (const file of listing) {
        const text = execFileSync('unzip', ['-p', zip, file], { encoding: 'utf8', maxBuffer: 1 << 30 });
        const entries = text
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line))
            .filter((event) => event.type === 'resource-snapshot')
            .map((event) => event.snapshot)
            .sort((a, b) => a._monotonicTime - b._monotonicTime);
        let role = 'guest';
        for (const entry of entries) {
            const { method, url } = entry.request;
            if (!url.startsWith(origin)) continue;
            const parsed = new URL(url);
            const postData = entry.request.postData?.text ?? '';
            if (parsed.pathname === '/uPortal/Login') {
                const user = parsed.searchParams.get('userName');
                if (user) role = user;
                continue;
            }
            if (parsed.pathname.startsWith('/cas/')) {
                const user = method === 'POST' && new URLSearchParams(postData).get('username');
                if (user) role = user;
                continue;
            }
            if (parsed.pathname === '/uPortal/Logout') {
                role = 'guest';
                continue;
            }
            // Aggregated skin resources are named by a hash of their content, so their names
            // change with the build; the pages that load them are compared instead.
            if (/\.aggr\.min\.(js|css)$/.test(parsed.pathname)) continue;
            const path = replayablePath(url);
            const headers = {};
            for (const name of KEPT_HEADERS) {
                const value = header(entry, name);
                if (value && !(name === 'content-type' && method === 'GET')) headers[name] = value;
            }
            const key = `${role} ${method} ${path} ${JSON.stringify(headers)}`;
            const target = method === 'GET' || method === 'HEAD' ? requests : mutations;
            const known = target.get(key) ?? { role, method, path, headers, tests: [] };
            if (!known.tests.includes(test)) known.tests.push(test);
            target.set(key, known);
        }
    }
}

const byKey = (a, b) => `${a.role} ${a.path} ${a.method}`.localeCompare(`${b.role} ${b.path} ${b.method}`);
const list = (map) => [...map.values()].sort(byKey).map((r) => ({ ...r, tests: r.tests.length }));
const result = {
    $comment: 'Requests the Playwright suite made against the reference (5.17), by role. Generated by tests/replay/harvest.mjs.',
    traces: traceCount,
    requests: list(requests),
    mutations: list(mutations).map((m) => ({ ...m, path: maskString(m.path) })),
};
writeFileSync(output, `${JSON.stringify(result, null, 1)}\n`);
console.error(`harvest: ${traceCount} traces, ${result.requests.length} distinct requests, ${result.mutations.length} distinct state-changing requests`);
