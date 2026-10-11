// HTTP differential replay and security matrix (docs/http-replay.md).
//
//   node tests/replay/replay.mjs record --origin http://localhost:8080 [--suite suite.json] [--out dir] [--label text]
//   node tests/replay/replay.mjs replay --origin http://localhost:8080 [--fixtures dir] [--report file] [--actual saved.json]
//
// record  runs the route crawl (routes.json) and the requests the Playwright suite made (from
//         harvest.mjs) as every role against a freshly initialised portal, plus the security
//         checks, and writes the normalised results as fixtures (default tests/replay/fixtures/5.17).
// replay  runs the same requests against another freshly initialised portal and compares every
//         response with the fixtures. A difference fails unless intended-differences.json lists
//         it. Writes a Markdown report (to $GITHUB_STEP_SUMMARY too) and error annotations.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    LOCAL_ACCOUNTS,
    NORMALISER_VERSION,
    ROLES,
    SECURITY_HEADERS,
    Session,
    compare,
    currentUser,
    exchangeKey,
    login,
    nodeIdResolver,
    normaliseCookie,
    normaliseResponse,
    outcome,
    resolvePath,
    sessionFor,
    renormalise,
} from './lib.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const [command, ...rest] = process.argv.slice(2);
const options = {};
for (let i = 0; i < rest.length; i += 2) options[rest[i].replace(/^--/, '')] = rest[i + 1];
const origin = (options.origin ?? 'http://localhost:8080').replace(/\/$/, '');
const fixtures = options.fixtures ?? options.out ?? join(here, 'fixtures', '5.17');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const writeJson = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 1)}\n`);

// ---------------------------------------------------------------------------------------------
// The plan: what is requested, as whom, in which order
// ---------------------------------------------------------------------------------------------

// Suite requests that are not replayed on another portal: GET /api/updatePermission writes, and
// the others name something by a generated id, which differs from machine to machine (see the
// generated ids in lib.mjs): a typed principal key (14.admin), a group or category key
// (local.22), a permission activity (/permissions/13/) or a portlet id (pP_portletId=97).
const replayable = (path) =>
    !path.startsWith('/uPortal/api/updatePermission') &&
    !/[?&](principal|principals%5B%5D|principals\[\]|pP_principalKey)=\d+\./.test(path) &&
    !/\blocal\.\d+|\/permissions\/\d+\/|[?&]pP_portletId=\d+|PORTLET_ID\.\d+/.test(path);

function plan(routes, suite) {
    const suiteRoles = [...new Set((suite?.requests ?? []).map((r) => r.role))].filter((r) => !ROLES.includes(r)).sort();
    const items = [];
    for (const role of [...ROLES, ...suiteRoles]) {
        const forRole = (route) => !route.roles || route.roles.includes(role);
        const crawl = ROLES.includes(role) ? routes.routes.filter((r) => !r.probe && forRole(r)) : [];
        const portlets = ROLES.includes(role)
            ? routes.portlets.flatMap((fname) => routes.portletStates.map((state) => ({ path: `/uPortal/p/${fname}/${state}/render.uP` })))
            : [];
        const fromSuite = (suite?.requests ?? []).filter((r) => r.role === role && replayable(r.path));
        const probes = ROLES.includes(role) ? routes.routes.filter((r) => r.probe && forRole(r)) : [];
        for (const route of [...crawl, ...portlets]) items.push({ set: 'crawl', role, method: route.method ?? 'GET', path: route.path, route });
        for (const request of fromSuite) items.push({ set: 'suite', role, method: request.method, path: request.path, headers: request.headers, route: request });
        for (const route of probes) items.push({ set: 'crawl', probe: route.probe, role, method: route.method ?? 'GET', path: route.path, route });
    }
    return items;
}

const itemKey = (item) => {
    const headers = item.headers ?? item.route?.headers;
    const token = item.csrfToken ?? item.route?.csrfToken ? ' with _csrf' : '';
    const body = item.requestBody ?? item.route?.body;
    return `${item.set} ${exchangeKey(item)}${token}${headers && Object.keys(headers).length > 0 ? ` ${JSON.stringify(headers)}` : ''}${body ? ` body ${body}` : ''}`;
};

async function execute(items) {
    const exchanges = [];
    let session;
    let current;
    let resolver;
    let done = 0;
    for (const item of items) {
        if (item.role !== current) {
            current = item.role;
            session = await sessionFor(origin, item.role);
            resolver = nodeIdResolver();
        }
        const { route } = item;
        const headers = { ...route.headers };
        if (route.contentType) headers['content-type'] = route.contentType;
        // Recorded paths carry the recording portal's layout node ids
        let url = resolvePath(item.path, resolver);
        if (route.csrfToken) {
            // The token the portal puts into its own action URLs for this session
            const page = await session.send('GET', '/uPortal/f/welcome/normal/render.uP');
            const token = page.body.toString('utf8').match(/[?&;]_csrf=([0-9a-f-]{36})/)?.[1] ?? 'none';
            url += `${url.includes('?') ? '&' : '?'}_csrf=${token}`;
        }
        const response = await session.send(item.method, url, { body: route.body, headers });
        if (item.set === 'crawl' && item.method === 'GET') resolver.learn(item.path, response.body);
        const exchange = { set: item.set, role: item.role, method: item.method, path: item.path };
        const requestHeaders = item.headers ?? route.headers;
        if (requestHeaders && Object.keys(requestHeaders).length > 0) exchange.headers = requestHeaders;
        if (item.probe) exchange.probe = item.probe;
        if (route.csrfToken) exchange.csrfToken = true;
        if (route.body) exchange.requestBody = route.body;
        exchange.response = normaliseResponse(response, origin, item.path);
        exchanges.push(exchange);
        if (++done % 250 === 0) console.error(`  ${done}/${items.length} requests`);
    }
    return exchanges;
}

// ---------------------------------------------------------------------------------------------
// Security checks
// ---------------------------------------------------------------------------------------------

/** Logs in through CAS's login form, the way a browser does; returns whether the portal knows the user. */
async function casLogin(username, password) {
    const session = new Session(origin);
    const service = `${origin}/uPortal/Login`;
    const form = await session.send('GET', `/cas/login?service=${encodeURIComponent(service)}`);
    const html = form.body.toString('utf8');
    const hidden = Object.fromEntries([...html.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const action = html.match(/<form[^>]*action="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&') ?? '/cas/login';
    const body = new URLSearchParams({ ...hidden, username, password }).toString();
    const posted = await session.send('POST', action.startsWith('/') ? action : `/cas/${action}`, {
        body,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
    });
    const location = posted.headers.get('location') ?? '';
    if (!(posted.status === 302 && location.includes('ticket='))) return { formStatus: form.status, status: posted.status, ok: false };
    const ticketUrl = new URL(location);
    const { response } = await session.follow(`${ticketUrl.pathname}${ticketUrl.search}`);
    const user = await currentUser(session);
    return { formStatus: form.status, status: posted.status, ok: response.status === 200 && user === username };
}

async function casOutcome(username, password) {
    try {
        return (await casLogin(username, password)).ok ? 'accepted' : 'refused';
    } catch (error) {
        return `error: ${String(error.message ?? error).replaceAll(/\d+/g, '9')}`;
    }
}

// Pages whose security headers and cookies are kept as a readable snapshot (also compared as
// part of the crawl).
const SNAPSHOT_PAGES = [
    ['guest', '/uPortal/'],
    ['guest', '/uPortal/f/welcome/normal/render.uP'],
    ['guest', '/uPortal/api/session.json'],
    ['guest', '/uPortal/health-check'],
    ['guest', '/uPortal/media/skins/respondr/defaultSkin.css'],
    ['admin', '/uPortal/f/welcome/normal/render.uP'],
    ['admin', '/uPortal/p/portlet-admin/max/render.uP'],
    ['admin', '/uPortal/api/v5-0/people/me'],
    ['admin', '/uPortal/api/portlet-list/'],
];

async function securityChecks(exchanges) {
    const logins = {};
    for (const account of LOCAL_ACCOUNTS) {
        const right = await login(new Session(origin), account);
        const wrong = await login(new Session(origin), account, `${account}-wrong`);
        logins[account] = {
            portal: { password: right.ok ? 'accepted' : `refused (${right.status})`, wrongPassword: wrong.ok ? 'accepted' : 'refused' },
            cas: {
                password: await casOutcome(account, account),
                wrongPassword: await casOutcome(account, `${account}-wrong`),
            },
        };
    }
    // The session cookie the portal sets when a user logs in, with its attributes
    const session = new Session(origin);
    const query = new URLSearchParams({ userName: 'student', password: 'student' });
    const loginResponse = await session.send('GET', `/uPortal/Login?${query}`);
    const loginCookies = loginResponse.setCookies.map((c) => normaliseCookie(c)).sort((a, b) => a.name.localeCompare(b.name));

    const headers = {};
    for (const [role, path] of SNAPSHOT_PAGES) {
        const exchange = exchanges.find((e) => e.set === 'crawl' && e.role === role && e.path === path && e.method === 'GET');
        if (!exchange) continue;
        const values = Object.fromEntries(SECURITY_HEADERS.map((h) => [h, exchange.response.headers?.[h] ?? null]));
        headers[`${role} ${path}`] = { status: exchange.response.status, ...values, cookies: exchange.response.cookies ?? [] };
    }
    const csrf = exchanges
        .filter((e) => e.probe === 'csrf')
        .map((e) => ({
            role: e.role,
            method: e.method,
            path: e.path,
            ...(e.csrfToken ? { token: 'valid' } : {}),
            ...(e.headers ? { headers: e.headers } : {}),
            status: e.response.status,
            outcome: outcome(e.response),
        }));
    return { logins, loginCookies, headers, csrf };
}

function securityMatrix(exchanges) {
    const matrix = {};
    for (const exchange of exchanges.filter((e) => e.set === 'crawl')) {
        const route = `${exchange.method} ${exchange.path}`;
        matrix[route] ??= {};
        matrix[route][exchange.role] = `${exchange.response.status} ${outcome(exchange.response)}`;
    }
    return matrix;
}

function matrixMarkdown(matrix, label) {
    const lines = [
        `# Security matrix (${label})`,
        '',
        'Generated by `tests/replay/replay.mjs record` from the route crawl: the status and auth outcome of every route for every role. `replay` asserts every cell.',
        '',
        `| Route | ${ROLES.join(' | ')} |`,
        `| --- | ${ROLES.map(() => '---').join(' | ')} |`,
    ];
    for (const [route, cells] of Object.entries(matrix)) {
        lines.push(`| \`${route.replaceAll('|', '\\|')}\` | ${ROLES.map((r) => cells[r] ?? '').join(' | ')} |`);
    }
    return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------------------------

async function record() {
    const routes = readJson(join(here, 'routes.json'));
    const suite = options.suite ? readJson(options.suite) : existsSync(join(fixtures, 'suite-requests.json')) ? readJson(join(fixtures, 'suite-requests.json')) : null;
    mkdirSync(fixtures, { recursive: true });
    if (options.suite) writeJson(join(fixtures, 'suite-requests.json'), suite);
    const items = plan(routes, suite);
    console.error(`record: ${items.length} requests against ${origin}`);
    const exchanges = await execute(items);
    const security = await securityChecks(exchanges);
    const matrix = securityMatrix(exchanges);
    const label = options.label ?? 'uPortal 5.17';
    writeJson(join(fixtures, 'meta.json'), {
        $comment: 'How these fixtures were recorded; see docs/http-replay.md',
        label,
        normaliserVersion: NORMALISER_VERSION,
        roles: [...new Set(exchanges.map((e) => e.role))],
        counts: {
            crawl: exchanges.filter((e) => e.set === 'crawl').length,
            suite: exchanges.filter((e) => e.set === 'suite').length,
            routes: Object.keys(matrix).length,
        },
    });
    writeJson(join(fixtures, 'crawl.json'), exchanges.filter((e) => e.set === 'crawl'));
    writeJson(join(fixtures, 'suite.json'), exchanges.filter((e) => e.set === 'suite'));
    writeJson(join(fixtures, 'security.json'), security);
    writeJson(join(fixtures, 'security-matrix.json'), matrix);
    writeFileSync(join(fixtures, 'security-matrix.md'), matrixMarkdown(matrix, label));
    console.error(`record: wrote ${exchanges.length} exchanges and ${Object.keys(matrix).length} matrix routes to ${fixtures}`);
}

function globToRegExp(glob) {
    return new RegExp(`^${glob.replaceAll(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*')}$`);
}

function loadRegistry() {
    const registry = readJson(join(here, 'intended-differences.json'));
    return registry.differences.map((entry) => ({
        ...entry,
        used: 0,
        matches(exchange, difference) {
            if (entry.roles && !entry.roles.includes(exchange.role)) return false;
            if (entry.method && entry.method !== exchange.method) return false;
            if (entry.set && entry.set !== exchange.set) return false;
            if (!globToRegExp(entry.path).test(exchange.path)) return false;
            if (entry.field !== '*' && !globToRegExp(entry.field).test(difference.field)) return false;
            if ('from' in entry && JSON.stringify(entry.from) !== JSON.stringify(difference.from)) return false;
            if ('to' in entry && JSON.stringify(entry.to) !== JSON.stringify(difference.to)) return false;
            if (entry.fromMatch && !new RegExp(entry.fromMatch).test(String(difference.from))) return false;
            if (entry.toMatch && !new RegExp(entry.toMatch).test(String(difference.to))) return false;
            // 'detail': a regular expression every changed line of a JSON or HTML body must match
            if (entry.detail) {
                const pattern = new RegExp(entry.detail);
                if (!difference.detail || !difference.detail.every((line) => pattern.test(line))) return false;
            }
            return true;
        },
    }));
}

const escapeCell = (value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const show = (value) => (value === null || value === undefined ? '(none)' : typeof value === 'string' ? value : JSON.stringify(value));

function annotate(message) {
    if (process.env.GITHUB_ACTIONS) console.log(`::error title=HTTP replay::${message.replaceAll('%', '%25').replaceAll('\r', '').replaceAll('\n', '%0A')}`);
}

async function replay() {
    const routes = readJson(join(here, 'routes.json'));
    const meta = readJson(join(fixtures, 'meta.json'));
    if (meta.normaliserVersion !== NORMALISER_VERSION) {
        throw new Error(`The fixtures were normalised with version ${meta.normaliserVersion}, this code is version ${NORMALISER_VERSION}: re-record them (docs/http-replay.md)`);
    }
    const suiteRequests = existsSync(join(fixtures, 'suite-requests.json')) ? readJson(join(fixtures, 'suite-requests.json')) : null;
    const expected = [...readJson(join(fixtures, 'crawl.json')), ...readJson(join(fixtures, 'suite.json'))];
    const expectedByKey = new Map(expected.map((e) => [itemKey(e), e]));
    const items = plan(routes, suiteRequests);
    console.error(`replay: ${items.length} requests against ${origin}, compared with ${meta.label}`);
    // --actual re-evaluates a saved run (build/replay/actual.json), for example after editing the registry
    const saved = options.actual ? readJson(options.actual) : null;
    const actual = saved ? saved.exchanges : await execute(items);
    const registry = loadRegistry();

    const failures = [];
    const intended = [];
    let compared = 0;
    for (const exchange of actual) {
        const recorded = expectedByKey.get(itemKey(exchange));
        if (!recorded) {
            failures.push({ exchange, differences: [{ field: 'fixture', from: null, to: 'not recorded (re-record after changing routes.json)' }] });
            continue;
        }
        compared++;
        expectedByKey.delete(itemKey(exchange));
        const unexplained = [];
        // The masks and sorting rules apply to the recording too, so a rule added later needs no re-record
        const expectedResponse = renormalise(recorded.response, recorded.path);
        for (const difference of compare(expectedResponse, exchange.response)) {
            const entry = registry.find((r) => r.matches(exchange, difference));
            if (entry) {
                entry.used++;
                intended.push({ exchange, difference, entry });
            } else {
                unexplained.push(difference);
            }
        }
        if (unexplained.length > 0) failures.push({ exchange, differences: unexplained, recorded });
    }

    // Security matrix: every cell must keep its outcome unless the status change is registered
    const recordedMatrix = readJson(join(fixtures, 'security-matrix.json'));
    const actualMatrix = securityMatrix(actual);
    const matrixChanges = [];
    for (const [route, cells] of Object.entries(recordedMatrix)) {
        for (const [role, cell] of Object.entries(cells)) {
            const now = actualMatrix[route]?.[role] ?? '(not requested)';
            if (now === cell) continue;
            const [method, ...path] = route.split(' ');
            const registered = intended.some((i) => i.exchange.role === role && i.exchange.method === method && i.exchange.path === path.join(' ') && i.difference.field === 'status');
            matrixChanges.push({ route, role, from: cell, to: now, registered });
        }
    }

    // Logins, CSRF and the header snapshot
    const recordedSecurity = readJson(join(fixtures, 'security.json'));
    const security = saved ? saved.security : await securityChecks(actual);
    const securityChanges = [];
    const walk = (a, b, path) => {
        if (JSON.stringify(a) === JSON.stringify(b)) return;
        if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a)) {
            for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[key], b[key], `${path}.${key}`);
        } else {
            securityChanges.push({ path, from: a, to: b });
        }
    };
    walk(recordedSecurity.logins, security.logins, 'logins');
    walk(recordedSecurity.loginCookies, security.loginCookies, 'loginCookies');
    walk(recordedSecurity.headers, security.headers, 'headers');
    walk(recordedSecurity.csrf, security.csrf, 'csrf');
    const securityFailures = securityChanges.filter((change) => {
        const entry = registry.find((r) => r.security && globToRegExp(r.security).test(change.path) && (!('to' in r) || JSON.stringify(r.to) === JSON.stringify(change.to)));
        if (entry) entry.used++;
        return !entry;
    });

    const missing = [...expectedByKey.values()];
    const stale = registry.filter((r) => r.used === 0);
    const failed = failures.length > 0 || securityFailures.length > 0 || matrixChanges.some((c) => !c.registered);

    // Report
    const lines = [];
    lines.push(`## HTTP replay against ${meta.label}: ${failed ? 'differences found' : 'no unexplained differences'}`);
    lines.push('');
    lines.push(`* Requests: ${actual.length} (${actual.filter((e) => e.set === 'crawl').length} crawl, ${actual.filter((e) => e.set === 'suite').length} from the Playwright suite), roles: ${[...new Set(actual.map((e) => e.role))].join(', ')}`);
    const skipped = (suiteRequests?.requests ?? []).filter((r) => !replayable(r.path)).length;
    if (skipped > 0) lines.push(`* Suite requests not replayed because they write or name a generated id: ${skipped}`);
    lines.push(`* Compared with the recording: ${compared}; unexplained differences in ${failures.length} exchanges; intended differences applied: ${intended.length}`);
    lines.push(`* Security matrix: ${Object.keys(recordedMatrix).length} routes x ${ROLES.length} roles; changed cells: ${matrixChanges.length} (${matrixChanges.filter((c) => !c.registered).length} unexplained)`);
    lines.push(`* Logins, CSRF and header snapshot: ${securityChanges.length} changes (${securityFailures.length} unexplained)`);
    if (missing.length > 0) lines.push(`* Recorded but not replayed: ${missing.length} (routes.json changed? re-record)`);
    if (stale.length > 0) lines.push(`* Registry entries that matched nothing: ${stale.map((s) => s.id).join(', ')}`);
    if (securityFailures.length > 0) {
        lines.push('', '### Security changes', '', '| Check | 5.17 | Now |', '| --- | --- | --- |');
        for (const change of securityFailures) lines.push(`| \`${escapeCell(change.path)}\` | ${escapeCell(show(change.from))} | ${escapeCell(show(change.to))} |`);
        for (const change of securityFailures) annotate(`Security: ${change.path}: ${show(change.from)} -> ${show(change.to)}`);
    }
    const unexplainedCells = matrixChanges.filter((c) => !c.registered);
    if (unexplainedCells.length > 0) {
        lines.push('', '### Security matrix changes', '', '| Route | Role | 5.17 | Now |', '| --- | --- | --- | --- |');
        for (const change of unexplainedCells) lines.push(`| \`${escapeCell(change.route)}\` | ${change.role} | ${change.from} | ${change.to} |`);
    }
    if (failures.length > 0) {
        lines.push('', '### Unexplained differences', '');
        for (const { exchange, differences } of failures.slice(0, 150)) {
            lines.push(`<details><summary><code>${escapeCell(itemKey(exchange))}</code>: ${differences.map((d) => d.field).join(', ')}</summary>`, '', '```');
            for (const difference of differences) {
                if (difference.detail) lines.push(`${difference.field}:`, ...difference.detail.map((d) => `  ${d}`));
                else lines.push(`${difference.field}: ${show(difference.from)} -> ${show(difference.to)}`);
            }
            lines.push('```', '</details>');
            annotate(`${itemKey(exchange)}: ${differences.map((d) => (d.detail ? `${d.field} (${d.detail.length} changes)` : `${d.field}: ${show(d.from)} -> ${show(d.to)}`)).join('; ')}`);
        }
        if (failures.length > 150) lines.push('', `... and ${failures.length - 150} more`);
    }
    if (intended.length > 0) {
        const byEntry = new Map();
        for (const i of intended) byEntry.set(i.entry.id, (byEntry.get(i.entry.id) ?? 0) + 1);
        lines.push('', '### Intended differences applied', '', '| Registry entry | Differences | Reason | Log |', '| --- | --- | --- | --- |');
        for (const entry of registry.filter((r) => byEntry.has(r.id))) lines.push(`| ${entry.id} | ${byEntry.get(entry.id)} | ${escapeCell(entry.reason)} | ${entry.log ?? ''} |`);
    }
    const report = `${lines.join('\n')}\n`;
    const reportPath = options.report ?? join('build', 'replay', 'report.md');
    mkdirSync(dirname(reportPath), { recursive: true });
    writeFileSync(reportPath, report);
    writeJson(join(dirname(reportPath), 'actual.json'), { exchanges: actual, security, matrix: actualMatrix });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, report);
    console.log(report);
    process.exitCode = failed ? 1 : 0;
}

if (command === 'record') await record();
else if (command === 'replay') await replay();
else {
    console.error('usage: replay.mjs record|replay --origin <url> [options]; see docs/http-replay.md');
    process.exitCode = 2;
}
