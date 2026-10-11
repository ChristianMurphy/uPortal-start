/* global console, fetch, performance, process, URL */
// G-index browsing and login driver (MOD-D12): many concurrent users log in, render their
// layout, switch tabs, maximize portlets, search and log out, so the portal runs the statements a
// busy campus portal runs. No dependencies; Node 22 or later.
//
//   node tests/db/gindex/driver.mjs --url http://localhost:8080/uPortal/ --users 1000 \
//       --concurrency 20 --duration 300 [--seed 42] [--prefix gx] [--password student]
//
// Users are the generator's (tests/db/gindex/generate.py): <prefix><6-digit number> with the
// quickstart student's password. A fraction of the sessions stay anonymous (guest).
// Prints one JSON line of totals at the end; exits with 1 when more than --max-error-rate of the
// requests failed (a broken portal must not pass as a quiet workload).

const options = {
    url: 'http://localhost:8080/uPortal/',
    users: 1000,
    concurrency: 20,
    duration: 300,
    seed: 42,
    prefix: 'gx',
    password: 'student',
    guestShare: 0.1,
    maxErrorRate: 0.05,
};
for (let index = 2; index < process.argv.length; index += 2) {
    const key = process.argv[index].replace(/^--/, '').replaceAll(/-([a-z])/g, (_, c) => c.toUpperCase());
    if (!(key in options)) {
        console.error(`Unknown option ${process.argv[index]}`);
        process.exit(2);
    }
    const value = process.argv[index + 1];
    options[key] = typeof options[key] === 'number' ? Number(value) : value;
}
if (!options.url.endsWith('/')) options.url += '/';

// A small seeded generator (mulberry32), so a run picks the same users in the same order
function random(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6d_2b_79_f5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
}

// A portlet maximized on its tab, e.g. f/welcome/p/calendar.u18l1n13/max/render.uP
const PORTLET_MAX = /\/uPortal\/(f\/[\w-]+\/p\/[\w.-]+\/max\/render\.uP)/g;
const SEARCH_TERMS = ['cartoon', 'news', 'calendar', 'library', 'weather', 'student', 'course', 'map', 'email', 'grades'];
const totals = { sessions: 0, logins: 0, requests: 0, errors: 0, byStep: {} };

class Session {
    constructor() {
        this.cookies = new Map();
    }

    async get(path, step, { method = 'GET', body } = {}) {
        let target = new URL(path, options.url).toString();
        const started = performance.now();
        let response;
        // Follow redirects by hand so every Set-Cookie on the way is kept
        for (let hop = 0; hop < 10; hop++) {
            const headers = { 'User-Agent': 'g-index-driver' };
            if (this.cookies.size > 0) {
                headers.Cookie = [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
            }
            if (body) headers['Content-Type'] = 'application/json';
            response = await fetch(target, { method, headers, body, redirect: 'manual' });
            for (const cookie of response.headers.getSetCookie()) {
                const [pair] = cookie.split(';');
                const eq = pair.indexOf('=');
                this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
            }
            const location = response.headers.get('location');
            if (response.status < 300 || response.status >= 400 || !location) break;
            await response.arrayBuffer();
            target = new URL(location, target).toString();
            method = 'GET';
            body = undefined;
        }
        const text = await response.text();
        const ms = performance.now() - started;
        const s = (totals.byStep[step] ??= { requests: 0, errors: 0, ms: 0, status: {} });
        s.requests++;
        s.status[response.status] = (s.status[response.status] ?? 0) + 1;
        s.ms += ms;
        totals.requests++;
        if (response.status >= 400) {
            s.errors++;
            totals.errors++;
        }
        return text;
    }
}

function links(html, pattern) {
    return [...new Set([...html.matchAll(pattern)].map(m => m[1]))];
}

async function visit(rand) {
    const session = new Session();
    totals.sessions++;
    const pick = list => list[Math.floor(rand() * list.length)];
    let home;
    const guest = rand() < options.guestShare;
    if (guest) {
        home = await session.get('f/welcome/normal/render.uP', 'guest-home');
    } else {
        const user = `${options.prefix}${String(1 + Math.floor(rand() * options.users)).padStart(6, '0')}`;
        home = await session.get(`Login?userName=${user}&password=${encodeURIComponent(options.password)}`, 'login');
        totals.logins++;
    }
    const tabs = links(home, /\/uPortal\/f\/([\w-]+)\/normal\/render\.uP/g);
    const portlets = links(home, PORTLET_MAX);
    for (let index = 0; index < 2 && tabs.length > 0; index++) {
        const page = await session.get(`f/${pick(tabs)}/normal/render.uP`, 'tab');
        portlets.push(...links(page, PORTLET_MAX));
    }
    if (portlets.length > 0) await session.get(pick(portlets), 'portlet-max');
    await session.get(`api/v5-0/portal/search?q=${pick(SEARCH_TERMS)}`, 'search');
    if (guest) return;
    await session.get('api/portlet-list/', 'portlet-list');
    await session.get('api/v4-3/dlm/layout.json', 'layout-json');
    await session.get('Logout', 'logout');
}

async function worker(id, deadline) {
    const rand = random(options.seed * 1000 + id);
    while (Date.now() < deadline) {
        try {
            await visit(rand);
        } catch (error) {
            totals.errors++;
            totals.requests++;
            if (totals.errors <= 5) console.error(`worker ${id}: ${error.message}`);
        }
    }
}

const deadline = Date.now() + options.duration * 1000;
const started = Date.now();
await Promise.all(Array.from({ length: options.concurrency }, (_, id) => worker(id, deadline)));
const seconds = (Date.now() - started) / 1000;
for (const s of Object.values(totals.byStep)) s.meanMs = Math.round(s.ms / Math.max(1, s.requests));
console.log(JSON.stringify({ ...totals, seconds: Math.round(seconds), requestsPerSecond: Math.round(totals.requests / seconds) }));
const rate = totals.errors / Math.max(1, totals.requests);
if (totals.requests === 0 || rate > options.maxErrorRate) {
    console.error(`G-index driver: ${totals.errors} of ${totals.requests} requests failed`);
    process.exit(1);
}
